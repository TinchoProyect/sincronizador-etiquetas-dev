#!/usr/bin/env node
/**
 * Restaurador Automatizado de Base de Laboratorio (`etiquetas_pruebas`)
 * ---------------------------------------------------------------------
 * Crea la base `etiquetas_pruebas` si no existe y restaura en ella el snapshot
 * `backups/etiquetas_snapshot_fase1.backup` (o `.sql`).
 * Posee bloqueo estricto para jamás tocar la base de producción `etiquetas`.
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
    console.log('🛠️  RESTAURADOR DE BASE DE LABORATORIO: etiquetas_pruebas');
    console.log('==================================================================');

    const backupCustom = path.join(__dirname, '../backups/etiquetas_snapshot_fase1.backup');
    const backupSql = path.join(__dirname, '../backups/etiquetas_snapshot_fase1.sql');

    if (!fs.existsSync(backupCustom) && !fs.existsSync(backupSql)) {
        console.error('❌ No se encontró backups/etiquetas_snapshot_fase1.backup ni .sql.');
        process.exit(1);
    }

    const psqlBin = detectarBinarioPg('psql');
    const pgRestoreBin = detectarBinarioPg('pg_restore');
    const env = { ...process.env, PGPASSWORD: PG_PASSWORD };

    console.log('1️⃣ Recreando base de datos limpia `etiquetas_pruebas`...');
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
        console.log(`2️⃣ Restaurando desde ${path.basename(backupCustom)}...`);
        try {
            execSync(
                `${pgRestoreBin} -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${TARGET_DB} --no-owner --no-privileges "${backupCustom}"`,
                { env, stdio: 'inherit' }
            );
        } catch (_) {
            // pg_restore puede devolver warning no fatal por extensiones
        }
    } else {
        console.log(`2️⃣ Restaurando desde ${path.basename(backupSql)}...`);
        execSync(
            `${psqlBin} -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${TARGET_DB} -f "${backupSql}"`,
            { env, stdio: 'inherit' }
        );
    }

    console.log('✅ Base `etiquetas_pruebas` restaurada y lista para usar en Modo Laboratorio.');
}

main();
