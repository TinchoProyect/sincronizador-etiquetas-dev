#!/usr/bin/env node
/**
 * Auditor Automático de Operaciones Locales Huérfanas (PcAlmacen → Cloud)
 * ------------------------------------------------------------------------
 * Inspecciona en solo lectura todas las tablas operativas del PostgreSQL local
 * desde una fecha de corte (por defecto 2026-11-09) y las contrasta contra la base
 * productiva de Google Cloud (`https://logistica.lamdaser.com/api/system/orphan-audit/compare`)
 * usando el token del agente puente Zebra (`x-lamda-print-token`, sin depender de Tailscale).
 *
 * Uso CLI:
 *   node scripts/auditarOperacionesHuerfanasLocal.js --since=2026-11-09
 *   node scripts/auditarOperacionesHuerfanasLocal.js --since=2026-11-09 --no-push --json
 *   node scripts/auditarOperacionesHuerfanasLocal.js --allow-lab --no-push --json
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { Pool } = require('pg');

const ROOT_DIR = path.resolve(__dirname, '..');
const _cliJsonMode = (require.main === module) && process.argv.includes('--json');
const _origStdoutWrite = process.stdout.write.bind(process.stdout);
if (_cliJsonMode) {
    process.stdout.write = () => true;
}
process.env.DOTENV_CONFIG_QUIET = 'true';
require('dotenv').config({ path: path.join(ROOT_DIR, '.env'), quiet: true });

const { recolectarInventarioOperativoLocal } = require('../src/shared/orphanAuditService');
const { obtenerSecretoPresenciaZebra } = require('../src/services/zebraPrintBridgeService');

const REPORT_PATH = path.join(ROOT_DIR, 'data', 'reporte_operaciones_huerfanas_local.json');

function crearPoolLocal(allowLab = false) {
    const envDb = String(process.env.DB_NAME || 'etiquetas').trim();
    const isLab = envDb.toLowerCase() === 'etiquetas_pruebas' || String(process.env.LAMDA_MODO_LABORATORIO || '').toLowerCase() === 'true';
    const targetDb = (isLab && allowLab) ? envDb : 'etiquetas';

    return new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        database: targetDb,
        max: 4,
        idleTimeoutMillis: 10000
    });
}

async function ejecutarAuditoriaHuerfanasContraNube({
    sinceDate = '2026-11-09',
    cloudBaseUrl = null,
    pushToCloud = true,
    persistReportOnCloud = true,
    allowLab = false,
    estacionId = null,
    silent = false
} = {}) {
    const pool = crearPoolLocal(allowLab);
    try {
        const inventario = await recolectarInventarioOperativoLocal(pool, {
            sinceDate,
            estacionId: estacionId || process.env.COMPUTERNAME || os.hostname() || 'PCALMACEN'
        });

        const baseUrl = String(cloudBaseUrl || process.env.LAMDA_CLOUD_PRINT_URL || process.env.CLOUD_BASE_URL || 'https://logistica.lamdaser.com')
            .trim()
            .replace(/\/+$/, '');
        const printToken = String(process.env.LAMDA_PRINT_BRIDGE_TOKEN || obtenerSecretoPresenciaZebra()).trim();

        let resultado = null;
        let cloudSynced = false;
        let cloudError = null;

        if (pushToCloud) {
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 15000);
                try {
                    const resp = await fetch(`${baseUrl}/api/system/orphan-audit/compare`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-lamda-print-token': printToken
                        },
                        body: JSON.stringify({
                            ...inventario,
                            persist: Boolean(persistReportOnCloud)
                        }),
                        signal: controller.signal
                    });
                    if (!resp.ok) {
                        const errTxt = await resp.text().catch(() => '');
                        throw new Error(`HTTP ${resp.status} ${errTxt.slice(0, 180)}`);
                    }
                    resultado = await resp.json();
                    cloudSynced = true;
                } finally {
                    clearTimeout(timer);
                }
            } catch (err) {
                cloudError = err.message;
                if (!silent) {
                    console.warn(`⚠️ [ORPHAN-AUDIT] No se pudo contrastar contra Cloud (${baseUrl}): ${err.message}`);
                }
            }
        }

        const reporteFinal = {
            ok: true,
            generadoEn: new Date().toISOString(),
            estacionId: inventario.estacionId,
            desdeFecha: inventario.desdeFecha,
            cloudBaseUrl: pushToCloud ? baseUrl : null,
            cloudSynced,
            cloudError,
            tablasInspeccionadas: inventario.tablas.map(t => ({
                tabla: t.tabla,
                etiqueta: t.etiqueta,
                skipped: Boolean(t.skipped),
                motivo: t.motivo || null,
                registrosLocales: Array.isArray(t.rows) ? t.rows.length : 0
            })),
            comparacionNube: resultado || null
        };

        try {
            const dir = path.dirname(REPORT_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(REPORT_PATH, JSON.stringify(reporteFinal, null, 2), 'utf8');
        } catch (_) {}

        if (!silent) {
            if (cloudSynced && resultado) {
                console.log(`\n📊 [ORPHAN-AUDIT] Resultado vs Cloud (${baseUrl}): ${resultado.totalRegistrosHuerfanos} huérfano(s) en ${resultado.totalTablasConDiferencias} tabla(s).`);
                if (Array.isArray(resultado.detallePorTabla)) {
                    for (const t of resultado.detallePorTabla) {
                        console.log(`   • ${t.etiqueta} (${t.tabla}): ${t.cantidadHuerfanos} huérfano(s) de ${t.cantidadLocalRevisada} revisado(s)`);
                    }
                }
            } else {
                console.log(`\n📋 [ORPHAN-AUDIT] Inventario local recolectado (${reporteFinal.tablasInspeccionadas.length} tablas inspeccionadas desde ${sinceDate}).`);
            }
        }

        return reporteFinal;
    } finally {
        try { await pool.end(); } catch (_) {}
    }
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const getArgVal = (prefix, def = null) => {
        const hit = args.find(a => a.startsWith(prefix));
        return hit ? hit.slice(prefix.length) : def;
    };
    const sinceDate = getArgVal('--since=', '2026-11-09');
    const cloudBaseUrl = getArgVal('--target-url=', null);
    const pushToCloud = !args.includes('--no-push');
    const allowLab = args.includes('--allow-lab');
    const jsonOnly = args.includes('--json');

    ejecutarAuditoriaHuerfanasContraNube({
        sinceDate,
        cloudBaseUrl,
        pushToCloud,
        allowLab,
        silent: jsonOnly
    })
        .then((rep) => {
            if (jsonOnly) {
                process.stdout.write = _origStdoutWrite;
                _origStdoutWrite(JSON.stringify(rep, null, 2) + '\n');
            }
            process.exit(0);
        })
        .catch((err) => {
            console.error('❌ [ORPHAN-AUDIT] Error fatal:', err.message);
            process.exit(1);
        });
}

module.exports = {
    ejecutarAuditoriaHuerfanasContraNube,
    REPORT_PATH
};
