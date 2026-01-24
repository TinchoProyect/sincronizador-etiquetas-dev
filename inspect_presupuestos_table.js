const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function inspectPresupuestosTable() {
    try {
        console.log('Inspeccionando tabla presupuestos...');
        const res = await pool.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'presupuestos'
            ORDER BY ordinal_position;
        `);
        console.table(res.rows);
    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}

inspectPresupuestosTable();
