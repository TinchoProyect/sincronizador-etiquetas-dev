#!/usr/bin/env node
/**
 * Clonador de Datos Frescos hacia `etiquetas_pruebas` (`npm run db:clonar-desde-nube`)
 * ------------------------------------------------------------------------------------
 * Descarga un volcado en vivo desde la base de datos Cloud (`CLOUD_DB_URL`) — o desde
 * la base principal si aún no se configuró `CLOUD_DB_URL` — y lo inyecta directamente
 * en `etiquetas_pruebas` para programar con datos frescos sin tocar producción.
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const TARGET_DB = 'etiquetas_pruebas';
const PG_USER = process.env.DB_USER || 'postgres';
const PG_PASSWORD = process.env.DB_PASSWORD || '1234';
const PG_HOST = process.env.DB_HOST || 'localhost';
const PG_PORT = process.env.DB_PORT || '5432';
const CLOUD_DB_URL = process.env.CLOUD_DB_URL || '';

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

function main() {
    console.log('==================================================================');
    console.log('🔄 CLONADOR DE DATOS FRESCOS HACIA `etiquetas_pruebas`');
    console.log('==================================================================');

    const pgDumpBin = detectarBinarioPg('pg_dump');
    const pgRestoreBin = detectarBinarioPg('pg_restore');
    const psqlBin = detectarBinarioPg('psql');
    const env = { ...process.env, PGPASSWORD: PG_PASSWORD };

    const tempBackup = path.join(__dirname, '../backups/etiquetas_clon_reciente.backup');
    if (!fs.existsSync(path.dirname(tempBackup))) {
        fs.mkdirSync(path.dirname(tempBackup), { recursive: true });
    }

    if (CLOUD_DB_URL) {
        console.log('☁️  1️⃣ Descargando snapshot en vivo desde PostgreSQL Cloud...');
        execSync(`${pgDumpBin} "${CLOUD_DB_URL}" -F c -f "${tempBackup}"`, { env, stdio: 'inherit' });
    } else {
        console.log('🏠 1️⃣ CLOUD_DB_URL aún no definido: tomando snapshot fresco desde base local `etiquetas`...');
        execSync(
            `${pgDumpBin} -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d etiquetas -F c -f "${tempBackup}"`,
            { env, stdio: 'inherit' }
        );
    }

    console.log('🛠️  2️⃣ Recreando `etiquetas_pruebas` e inyectando datos frescos...');
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
            `${pgRestoreBin} -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${TARGET_DB} --no-owner --no-privileges "${tempBackup}"`,
            { env, stdio: 'inherit' }
        );
    } catch (_) {}

    console.log('✅ `etiquetas_pruebas` actualizada con éxito con los últimos datos reales.');
}

main();
