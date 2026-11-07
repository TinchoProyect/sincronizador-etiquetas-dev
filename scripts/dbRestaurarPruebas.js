#!/usr/bin/env node
/**
 * Restaurador y Clonador Inteligente de Base de Laboratorio (`etiquetas_pruebas`)
 * -------------------------------------------------------------------------------
 * 1. Descarga en vivo la última foto real de Producción desde `https://logistica.lamdaser.com/api/admin/db-snapshot-pruebas`
 *    (protegido por token criptográfico `x-lamda-snapshot-key` y sin tickets ARCA), o usa la base `etiquetas` local / snapshot previo si no hay red.
 * 2. Recrea exclusivamente `etiquetas_pruebas` (candado rígido: jamás toca `etiquetas`).
 * 3. Purga preventivamente `public.factura_afip_ta` dentro de `etiquetas_pruebas` para que nunca viaje un ticket ARCA de Producción.
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const https = require('https');
const { execSync } = require('child_process');

const TARGET_DB = 'etiquetas_pruebas';
if (TARGET_DB !== 'etiquetas_pruebas') {
    console.error('❌ BLOQUEO DE SEGURIDAD: El restaurador de pruebas solo puede operar sobre `etiquetas_pruebas`.');
    process.exit(1);
}

const PG_USER = process.env.DB_USER || 'postgres';
const PG_PASSWORD = process.env.DB_PASSWORD || '1234';
const PG_HOST = process.env.DB_HOST || 'localhost';
const PG_PORT = process.env.DB_PORT || '5432';
const SNAPSHOT_SECRET = String(process.env.LAMDA_DB_SNAPSHOT_SECRET || 'lamda-snapshot-sec-9f8e7d6c5b4a3210-b2b-prod-2026').trim();
const PROD_SNAPSHOT_URL = String(process.env.LAMDA_PROD_SNAPSHOT_URL || 'https://logistica.lamdaser.com/api/admin/db-snapshot-pruebas').trim();

function detectarBinarioPg(binName) {
    const candidatos = [
        `C:\\Program Files\\PostgreSQL\\18\\bin\\${binName}.exe`,
        `C:\\Program Files\\PostgreSQL\\17\\bin\\${binName}.exe`,
        `C:\\Program Files\\PostgreSQL\\16\\bin\\${binName}.exe`,
        `C:\\Program Files\\PostgreSQL\\15\\bin\\${binName}.exe`
    ];
    for (const c of candidatos) {
        if (fs.existsSync(c)) return `"${c}"`;
    }
    return binName;
}

function descargarSnapshotDesdeProduccionActiva(destPath) {
    return new Promise((resolve) => {
        const tempDownload = destPath + '.downloading';
        const req = https.get(
            PROD_SNAPSHOT_URL,
            {
                headers: { 'x-lamda-snapshot-key': SNAPSHOT_SECRET },
                timeout: 45000
            },
            (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    return resolve({ ok: false, reason: `HTTP ${res.statusCode}` });
                }
                const fileStream = fs.createWriteStream(tempDownload);
                res.pipe(fileStream);
                fileStream.on('finish', () => {
                    fileStream.close(() => {
                        try {
                            const stat = fs.statSync(tempDownload);
                            if (stat.size > 50000) {
                                fs.renameSync(tempDownload, destPath);
                                return resolve({ ok: true, bytes: stat.size });
                            }
                            fs.unlinkSync(tempDownload);
                            return resolve({ ok: false, reason: 'Snapshot demasiado pequeño' });
                        } catch (e) {
                            return resolve({ ok: false, reason: e.message });
                        }
                    });
                });
                fileStream.on('error', (err) => {
                    try { fs.unlinkSync(tempDownload); } catch (_) {}
                    resolve({ ok: false, reason: err.message });
                });
            }
        );
        req.on('error', (err) => resolve({ ok: false, reason: err.message }));
        req.on('timeout', () => {
            req.destroy();
            resolve({ ok: false, reason: 'Timeout descargando snapshot de Producción' });
        });
    });
}

async function main() {
    console.log('==================================================================');
    console.log('🛠️  REFRESCANDO BASE DE LABORATORIO (`etiquetas_pruebas`) CON FOTO REAL DE PRODUCCIÓN');
    console.log('==================================================================');

    const backupsDir = path.join(__dirname, '../backups');
    if (!fs.existsSync(backupsDir)) {
        fs.mkdirSync(backupsDir, { recursive: true });
    }

    const backupCustom = path.join(backupsDir, 'etiquetas_snapshot_fase1.backup');
    const backupSql = path.join(backupsDir, 'etiquetas_snapshot_fase1.sql');

    const psqlBin = detectarBinarioPg('psql');
    const pgRestoreBin = detectarBinarioPg('pg_restore');
    const pgDumpBin = detectarBinarioPg('pg_dump');

    // Probar contraseña local ('ta3Mionga' en PcAlmacen o '1234' en Notebook)
    let activePassword = PG_PASSWORD;
    for (const candidatePass of [PG_PASSWORD, 'ta3Mionga', '1234', 'postgres']) {
        try {
            execSync(`${psqlBin} -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d postgres -c "SELECT 1;"`, {
                env: { ...process.env, PGPASSWORD: candidatePass },
                stdio: 'ignore'
            });
            activePassword = candidatePass;
            break;
        } catch (_) {}
    }
    const env = { ...process.env, PGPASSWORD: activePassword };

    console.log('☁️  0️⃣ Descargando última foto real de Producción activa (logistica.lamdaser.com)...');
    const dl = await descargarSnapshotDesdeProduccionActiva(backupCustom);
    if (dl.ok) {
        console.log(`✅ Foto fresca de Producción descargada con éxito (${Math.round(dl.bytes / 1024)} KB).`);
    } else {
        console.log(`ℹ️ No se pudo descargar desde Nube (${dl.reason}). Verificando base local 'etiquetas'...`);
        try {
            execSync(
                `${pgDumpBin} -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d etiquetas -F c --no-owner --no-privileges --exclude-table-data=public.factura_afip_ta -f "${backupCustom}"`,
                { env, stdio: 'ignore' }
            );
            console.log('✅ Snapshot fresco tomado desde la base local `etiquetas`.');
        } catch (_) {
            console.log('ℹ️ Usando último snapshot guardado en `backups/etiquetas_snapshot_fase1.backup`.');
        }
    }

    if (!fs.existsSync(backupCustom) && !fs.existsSync(backupSql)) {
        console.error('❌ No se encontró ningún snapshot en backups/.');
        process.exit(1);
    }

    console.log('1️⃣ Recreando base de datos aislada `etiquetas_pruebas`...');
    try {
        execSync(
            `${psqlBin} -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${TARGET_DB}' AND pid <> pg_backend_pid();"`,
            { env, stdio: 'ignore' }
        );
        execSync(
            `${psqlBin} -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d postgres -c "DROP DATABASE IF EXISTS ${TARGET_DB};"`,
            { env, stdio: 'inherit' }
        );
        execSync(
            `${psqlBin} -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d postgres -c "CREATE DATABASE ${TARGET_DB};"`,
            { env, stdio: 'inherit' }
        );
    } catch (err) {
        console.error('❌ Error preparando base etiquetas_pruebas:', err.message);
        process.exit(1);
    }

    if (fs.existsSync(backupCustom)) {
        console.log(`2️⃣ Inyectando datos de Producción en \`${TARGET_DB}\`...`);
        try {
            execSync(
                `${pgRestoreBin} -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${TARGET_DB} --no-owner --no-privileges "${backupCustom}"`,
                { env, stdio: 'ignore' }
            );
        } catch (_) {}
    } else {
        console.log(`2️⃣ Restaurando desde ${path.basename(backupSql)}...`);
        execSync(
            `${psqlBin} -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${TARGET_DB} -f "${backupSql}"`,
            { env, stdio: 'ignore' }
        );
    }

    // 3️⃣ Sanitización obligatoria post-clonado: eliminar cualquier ticket TA real de ARCA en etiquetas_pruebas
    try {
        execSync(
            `${psqlBin} -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${TARGET_DB} -c "DELETE FROM public.factura_afip_ta;"`,
            { env, stdio: 'ignore' }
        );
        console.log('🔒 Tickets ARCA de Producción eliminados de `etiquetas_pruebas` (emisión ARCA 100% simulada en Laboratorio).');
    } catch (_) {}

    console.log('✅ Base `etiquetas_pruebas` actualizada con los últimos datos reales de Producción y lista para Modo Laboratorio.');
}

main();
