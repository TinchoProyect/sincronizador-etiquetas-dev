const fs = require('fs');
const path = require('path');
const { pool } = require('../src/facturacion/config/database');

async function runMigration28() {
    console.log('🚀 [MIGRATION-28] Ejecutando DDL de Marcado de Revisión...');
    const sqlPath = path.join(__dirname, '../src/logistica/migrations/28_marcado_revision_diccionario.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    try {
        await pool.query(sql);
        console.log('✅ [MIGRATION-28] Columnas e índices de marcado creados con éxito en PostgreSQL.');
    } catch (err) {
        console.error('❌ [MIGRATION-28] Error ejecutando migración:', err);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

runMigration28();
