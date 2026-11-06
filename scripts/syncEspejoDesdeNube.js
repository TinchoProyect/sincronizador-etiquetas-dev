#!/usr/bin/env node
/**
 * LAMDA Cloud Mirror Sync (Cada 15 minutos — Nube -> PcAlmacen)
 * -------------------------------------------------------------
 * Mantiene en `PcAlmacen` una réplica local calzada al minuto desde el VPS en la nube:
 *  1. Descarga el dump completo de PostgreSQL (`pg_dump`) hacia `backups/espejo_nube/etiquetas_nube_latest.sql`
 *     y lo restaura sobre la base local de respaldo `etiquetas_espejo_nube`.
 *  2. Si `LAMDA_ROLE=GALPON_BRIDGE_ONLY`, asegura que la base local `etiquetas` mantenga
 *     `default_transaction_read_only = on` (Capa 3 del Triple Candado Anti-Doble Arranque).
 *  3. Reconstruye en disco (`src/facturacion/certs/TA-*.json`) el Ticket de Acceso vigente de ARCA/AFIP
 *     leído desde `public.factura_afip_ta` para que un eventual Rollback (< 3 min) jamás pida un
 *     TA duplicado ni provoque bloqueo de 12 horas en AFIP.
 *  4. Sincroniza por `rsync` / `scp` (si `CLOUD_SSH_HOST` está configurado) los 6 activos físicos fuera de BD:
 *     - `src/logistica/public/uploads/`
 *     - `src/facturacion/pdfs/`
 *     - `src/facturacion/certs/`
 *     - `src/app-etiquetas/documentos/`
 *     - `src/services/gsheets/`
 *     - `data/ia_credit_ledger.json`
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { Client } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const ROOT_DIR = path.resolve(__dirname, '..');
const MIRROR_DIR = path.resolve(ROOT_DIR, 'backups/espejo_nube');
const CERTS_DIR = path.resolve(ROOT_DIR, 'src/facturacion/certs');

const ASSET_PATHS = [
    'src/logistica/public/uploads',
    'src/facturacion/pdfs',
    'src/facturacion/certs',
    'src/app-etiquetas/documentos',
    'src/services/gsheets',
    'data/ia_credit_ledger.json'
];

function detectarBinarioPostgres(binName) {
    const candidatos = [
        process.env.PG_BIN_PATH ? path.join(process.env.PG_BIN_PATH, `${binName}.exe`) : null,
        `C:\\Program Files\\PostgreSQL\\17\\bin\\${binName}.exe`,
        `C:\\Program Files\\PostgreSQL\\16\\bin\\${binName}.exe`,
        `C:\\Program Files\\PostgreSQL\\15\\bin\\${binName}.exe`,
        binName
    ].filter(Boolean);

    for (const c of candidatos) {
        if (c === binName || fs.existsSync(c)) return c;
    }
    return binName;
}

async function reconstruirTaAfipDesdeBase(dbConfig) {
    const client = new Client(dbConfig);
    try {
        await client.connect();
        const res = await client.query(`
            SELECT entorno, servicio, token, sign, expira_en, cuit, ta_raw_json
            FROM public.factura_afip_ta
            WHERE expira_en > NOW()
            ORDER BY expira_en DESC
        `);
        if (!fs.existsSync(CERTS_DIR)) {
            fs.mkdirSync(CERTS_DIR, { recursive: true });
        }
        let count = 0;
        for (const row of (res.rows || [])) {
            const isProd = String(row.entorno || '').toUpperCase() === 'PROD';
            const cuit = String(row.cuit || '23248921749').trim();
            const service = String(row.servicio || 'wsfe').trim();
            const fileName = `TA-${cuit}-${service}${isProd ? '-production' : ''}.json`;
            const targetFile = path.join(CERTS_DIR, fileName);

            const payload = (row.ta_raw_json && typeof row.ta_raw_json === 'object' && row.ta_raw_json.credentials)
                ? row.ta_raw_json
                : {
                    header: [
                        { version: '1.0' },
                        { expirationtime: new Date(row.expira_en).toISOString() }
                    ],
                    credentials: {
                        token: row.token,
                        sign: row.sign
                    }
                };
            fs.writeFileSync(targetFile, JSON.stringify(payload, null, 2), 'utf8');
            count++;
        }
        return count;
    } catch (err) {
        console.warn('⚠️ [ESPEJO-NUBE] Aviso al reconstruir TA de AFIP desde BD:', err.message);
        return 0;
    } finally {
        try { await client.end(); } catch (_) {}
    }
}

async function aplicarCandadoReadOnlySiCorresponde(localPgConfig) {
    const role = String(process.env.LAMDA_ROLE || '').trim().toUpperCase();
    if (role !== 'GALPON_BRIDGE_ONLY') return;

    const client = new Client({ ...localPgConfig, database: 'postgres' });
    try {
        await client.connect();
        await client.query(`ALTER DATABASE etiquetas SET default_transaction_read_only = on;`);
        console.log('🔒 [ESPEJO-NUBE] Candado SQL Read-Only verificado sobre base local `etiquetas` (GALPON_BRIDGE_ONLY).');
    } catch (err) {
        console.warn('⚠️ [ESPEJO-NUBE] No se pudo aplicar Read-Only sobre `etiquetas`:', err.message);
    } finally {
        try { await client.end(); } catch (_) {}
    }
}

function sincronizarArchivosFisicosSSH() {
    const sshHost = String(process.env.CLOUD_SSH_HOST || '').trim();
    const sshUser = String(process.env.CLOUD_SSH_USER || 'root').trim();
    const sshRemoteDir = String(process.env.CLOUD_REMOTE_APP_DIR || '/opt/lamda/sincronizador-etiquetas').replace(/\/+$/, '');
    if (!sshHost) {
        console.log('ℹ️ [ESPEJO-NUBE] CLOUD_SSH_HOST no definido; omitiendo rsync/scp de carpetas físicas en esta corrida.');
        return;
    }

    for (const relPath of ASSET_PATHS) {
        const localTarget = path.resolve(ROOT_DIR, relPath);
        const parentDir = path.dirname(localTarget);
        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
        }
        try {
            const cmd = `scp -r -q "${sshUser}@${sshHost}:${sshRemoteDir}/${relPath}" "${parentDir}"`;
            execSync(cmd, { stdio: 'ignore', timeout: 120000 });
            console.log(`📁 [ESPEJO-NUBE] Activo físico sincronizado: ${relPath}`);
        } catch (err) {
            console.warn(`⚠️ [ESPEJO-NUBE] Aviso sincronizando ${relPath}: ${err.message}`);
        }
    }
}

async function ejecutarSincronizacionEspejo() {
    if (!fs.existsSync(MIRROR_DIR)) {
        fs.mkdirSync(MIRROR_DIR, { recursive: true });
    }

    const cloudHost = process.env.CLOUD_DB_HOST || '';
    const cloudPort = parseInt(process.env.CLOUD_DB_PORT || '5432', 10);
    const cloudDb = process.env.CLOUD_DB_NAME || 'etiquetas';
    const cloudUser = process.env.CLOUD_DB_USER || 'postgres';
    const cloudPass = process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || 'postgres';

    const localHost = process.env.LOCAL_DB_HOST || 'localhost';
    const localPort = parseInt(process.env.LOCAL_DB_PORT || '5432', 10);
    const localUser = process.env.LOCAL_DB_USER || 'postgres';
    const localPass = process.env.LOCAL_DB_PASSWORD || process.env.DB_PASSWORD || 'postgres';
    const localMirrorDb = process.env.LOCAL_MIRROR_DB_NAME || 'etiquetas_espejo_nube';

    await aplicarCandadoReadOnlySiCorresponde({
        host: localHost,
        port: localPort,
        user: localUser,
        password: localPass
    });

    if (!cloudHost) {
        console.log('ℹ️ [ESPEJO-NUBE] CLOUD_DB_HOST aún no configurado en .env. Verificando reconstrucción local de TA AFIP...');
        const tas = await reconstruirTaAfipDesdeBase({
            host: localHost,
            port: localPort,
            user: localUser,
            password: localPass,
            database: process.env.DB_NAME || 'etiquetas'
        });
        console.log(`✅ [ESPEJO-NUBE] Verificación local completada (${tas} TA(s) vigentes en disco).`);
        return { ok: true, mode: 'local_check_only', tasReconstruidos: tas };
    }

    const pgDumpBin = detectarBinarioPostgres('pg_dump');
    const psqlBin = detectarBinarioPostgres('psql');
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
    const dumpPath = path.join(MIRROR_DIR, `etiquetas_nube_${stamp}.sql`);
    const latestPath = path.join(MIRROR_DIR, 'etiquetas_nube_latest.sql');

    console.log(`☁️ [ESPEJO-NUBE] Descargando snapshot desde ${cloudHost}:${cloudPort}/${cloudDb}...`);
    execSync(`"${pgDumpBin}" -h ${cloudHost} -p ${cloudPort} -U ${cloudUser} -d ${cloudDb} --clean --if-exists --no-owner --no-privileges -f "${dumpPath}"`, {
        env: { ...process.env, PGPASSWORD: cloudPass },
        stdio: 'inherit'
    });

    fs.copyFileSync(dumpPath, latestPath);

    // Asegurar base local espejo `etiquetas_espejo_nube`
    const adminClient = new Client({ host: localHost, port: localPort, user: localUser, password: localPass, database: 'postgres' });
    await adminClient.connect();
    const checkDb = await adminClient.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [localMirrorDb]);
    if (checkDb.rowCount === 0) {
        await adminClient.query(`CREATE DATABASE ${localMirrorDb}`);
    }
    await adminClient.end();

    console.log(`📥 [ESPEJO-NUBE] Restaurando espejo sobre base local \`${localMirrorDb}\`...`);
    execSync(`"${psqlBin}" -h ${localHost} -p ${localPort} -U ${localUser} -d ${localMirrorDb} -f "${latestPath}"`, {
        env: { ...process.env, PGPASSWORD: localPass },
        stdio: 'ignore'
    });

    const tas = await reconstruirTaAfipDesdeBase({
        host: localHost,
        port: localPort,
        user: localUser,
        password: localPass,
        database: localMirrorDb
    });

    sincronizarArchivosFisicosSSH();

    console.log(`✅ [ESPEJO-NUBE] Espejo 15m actualizado (${latestPath}) + ${tas} TA(s) AFIP sincronizados en disco.`);
    return { ok: true, latestPath, tasReconstruidos: tas };
}

if (require.main === module) {
    ejecutarSincronizacionEspejo().catch((err) => {
        console.error('❌ [ESPEJO-NUBE] Error en sincronización de espejo:', err.message);
        process.exit(1);
    });
}

module.exports = {
    ejecutarSincronizacionEspejo,
    reconstruirTaAfipDesdeBase,
    ASSET_PATHS
};
