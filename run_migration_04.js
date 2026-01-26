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

async function runMigration04() {
    try {
        const sqlPath = path.join(__dirname, 'src', 'produccion', 'sql', '04_fix_conciliacion_fk.sql');
        console.log(`📖 Leyendo script SQL de: ${sqlPath}`);
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('🔄 Ejecutando Refuerzo de Relaciones (FK)...');
        await pool.query(sql);
        console.log('✅ Tablas alteradas exitosamente. Relación fuerte establecida.');

    } catch (error) {
        console.error('❌ Error migración 04:', error);
    } finally {
        await pool.end();
    }
}
runMigration04();
