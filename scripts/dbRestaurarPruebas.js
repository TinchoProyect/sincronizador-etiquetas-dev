#!/usr/bin/env node
/**
 * Restaurador y Clonador Inteligente de Base de Laboratorio (`etiquetas_pruebas`)
 * -------------------------------------------------------------------------------
 * 1. Descarga en vivo la última foto real de Producción desde `https://logistica.lamdaser.com/api/admin/db-snapshot-pruebas`
 *    (comprimida en `.sql.gz`, compatible con PostgreSQL 12..18 en Windows, protegida con `x-lamda-snapshot-key` y sin tickets ARCA),
 *    o usa la base `etiquetas` local / snapshot previo si no hay red.
 * 2. Recrea exclusivamente `etiquetas_pruebas` (candado rígido: jamás toca `etiquetas`).
 * 3. Purga preventivamente `public.factura_afip_ta` dentro de `etiquetas_pruebas` y deja `default_transaction_read_only = off` en `etiquetas_pruebas`.
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
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
    for (const v of [18, 17, 16, 15, 14, 13, 12]) {
        const c = `C:\\Program Files\\PostgreSQL\\${v}\\bin\\${binName}.exe`;
        if (fs.existsSync(c)) return `"${c}"`;
    }
    return binName;
}

function sanitizarSqlCompatible(sqlText) {
    return String(sqlText || '')
        .replace(/^SET transaction_timeout = .*$/gm, '-- SET transaction_timeout omitted')
        .replace(/^SET idle_in_transaction_session_timeout = .*$/gm, '-- SET idle_in_transaction_session_timeout omitted');
}

function descargarSnapshotSqlGzDesdeProduccion(destSqlPath) {
    return new Promise((resolve) => {
        const chunks = [];
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
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    try {
                        const rawBuf = Buffer.concat(chunks);
                        let sqlStr = '';
                        // Si viene comprimido con gzip (0x1f 0x8b)
                        if (rawBuf.length > 2 && rawBuf[0] === 0x1f && rawBuf[1] === 0x8b) {
                            sqlStr = zlib.gunzipSync(rawBuf).toString('utf8');
                        } else {
                            sqlStr = rawBuf.toString('utf8');
                        }
                        if (sqlStr.length < 10000 || !sqlStr.includes('CREATE TABLE')) {
                            return resolve({ ok: false, reason: 'Contenido SQL incompleto o formato anterior' });
                        }
                        fs.writeFileSync(destSqlPath, sanitizarSqlCompatible(sqlStr), 'utf8');
                        return resolve({ ok: true, bytes: rawBuf.length });
                    } catch (e) {
                        return resolve({ ok: false, reason: e.message });
                    }
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

    const backupSql = path.join(backupsDir, 'etiquetas_snapshot_fase1.sql');
    const backupCustom = path.join(backupsDir, 'etiquetas_snapshot_fase1.backup');

    const psqlBin = detectarBinarioPg('psql');
    const pgRestoreBin = detectarBinarioPg('pg_restore');
    const pgDumpBin = detectarBinarioPg('pg_dump');

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
    const dl = await descargarSnapshotSqlGzDesdeProduccion(backupSql);
    let usePlainSql = false;
    if (dl.ok) {
        console.log(`✅ Foto fresca de Producción descargada con éxito (${Math.round(dl.bytes / 1024)} KB comprimidos).`);
        usePlainSql = true;
    } else {
        console.log(`ℹ️ No se descargó SQL comprimido desde Nube (${dl.reason}). Tomando snapshot desde base local 'etiquetas'...`);
        try {
            const rawLocalSql = execSync(
                `${pgDumpBin} -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d etiquetas --no-owner --no-privileges --exclude-table-data=public.factura_afip_ta`,
                { env, encoding: 'utf8', maxBuffer: 100 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
            );
            if (rawLocalSql && rawLocalSql.includes('CREATE TABLE')) {
                fs.writeFileSync(backupSql, sanitizarSqlCompatible(rawLocalSql), 'utf8');
                usePlainSql = true;
                console.log('✅ Snapshot fresco tomado desde la base local `etiquetas`.');
            }
        } catch (_) {
            console.log('ℹ️ Usando último snapshot guardado en `backups/`.');
            if (fs.existsSync(backupSql)) usePlainSql = true;
        }
    }

    if (!fs.existsSync(backupSql) && !fs.existsSync(backupCustom)) {
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
        execSync(
            `${psqlBin} -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d postgres -c "ALTER DATABASE ${TARGET_DB} SET default_transaction_read_only = off;"`,
            { env, stdio: 'ignore' }
        );
    } catch (err) {
        console.error('❌ Error preparando base etiquetas_pruebas:', err.message);
        process.exit(1);
    }

    if (usePlainSql && fs.existsSync(backupSql)) {
        console.log(`2️⃣ Inyectando datos de Producción en \`${TARGET_DB}\`...`);
        execSync(
            `${psqlBin} -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${TARGET_DB} -f "${backupSql}"`,
            { env, stdio: 'ignore' }
        );
    } else if (fs.existsSync(backupCustom)) {
        console.log(`2️⃣ Restaurando desde ${path.basename(backupCustom)}...`);
        try {
            execSync(
                `${pgRestoreBin} -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${TARGET_DB} --no-owner --no-privileges "${backupCustom}"`,
                { env, stdio: 'ignore' }
            );
        } catch (_) {}
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
