require('dotenv').config({ path: './src/produccion/.env' });
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function run() {
    try {
        const res = await pool.query('SELECT * FROM presupuestos_detalles LIMIT 1');
        console.log("Columns:", Object.keys(res.rows[0]));
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}

run();
