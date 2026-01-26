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

async function runMigration03() {
    try {
        const sqlPath = path.join(__dirname, 'src', 'produccion', 'sql', '03_mantenimiento_conciliaciones.sql');
        console.log(`📖 Leyendo script SQL de: ${sqlPath}`);

        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('🔄 Ejecutando script SQL 03 (Conciliaciones)...');
        await pool.query(sql);

        console.log('✅ Tablas creadas exitosamente.');

        // Verificación
        console.log('\n🔍 Verificando existencia de tablas...');

        const tablesParams = ['mantenimiento_conciliaciones', 'mantenimiento_conciliacion_items'];
        for (let t of tablesParams) {
            const chkTable = await pool.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_name = $1
            `, [t]);
            console.log(`- Tabla ${t}: ${chkTable.rows.length > 0 ? '✅ CREADA' : '❌ NO ENCONTRADA'}`);
        }

    } catch (error) {
        console.error('❌ Error durante la migración 03:', error);
    } finally {
        await pool.end();
    }
}

runMigration03();
