const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function runMigration05() {
    try {
        const sqlPath = path.join(__dirname, 'src', 'produccion', 'sql', '05_update_estado_check.sql');
        console.log(`📖 Leyendo script SQL de: ${sqlPath}`);
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('🔄 Ejecutando Actualización de Constraint (Estado CHECK)...');
        await pool.query(sql);
        console.log('✅ Constraint actualizado. Estado CONCILIADO permitido.');

    } catch (error) {
        console.error('❌ Error migración 05:', error);
    } finally {
        await pool.end();
    }
}
runMigration05();
