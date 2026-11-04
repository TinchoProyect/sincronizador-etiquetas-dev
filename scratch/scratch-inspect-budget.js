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
        console.log('--- COLUMNS OF presupuestos_detalles ---');
        const cols = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'presupuestos_detalles'
        `);
        console.table(cols.rows);

        console.log('--- SAMPLE ROWS OF presupuestos_detalles ---');
        const rows = await pool.query(`
            SELECT * 
            FROM presupuestos_detalles 
            ORDER BY id DESC 
            LIMIT 5;
        `);
        console.log(JSON.stringify(rows.rows, null, 2));

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

run();
