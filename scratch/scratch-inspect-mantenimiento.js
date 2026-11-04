const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function run() {
    try {
        console.log('--- COLUMNS OF mantenimiento_movimientos ---');
        const cols = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'mantenimiento_movimientos'
        `);
        console.table(cols.rows);

        console.log('--- ÚLTIMOS 10 MOVIMIENTOS EN mantenimiento_movimientos ---');
        const rows = await pool.query(`
            SELECT * 
            FROM mantenimiento_movimientos 
            ORDER BY id DESC 
            LIMIT 10;
        `);
        console.log(JSON.stringify(rows.rows, null, 2));

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

run();
