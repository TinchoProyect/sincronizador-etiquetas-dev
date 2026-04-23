const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool();

async function run() {
    try {
        let res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'presupuestos'");
        console.log('Presupuestos:', res.rows.map(r => r.column_name).join(', '));
    } catch(e) {
        console.error(e);
    } finally {
        pool.end();
    }
}

run();
