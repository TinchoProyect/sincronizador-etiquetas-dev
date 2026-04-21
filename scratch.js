const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool();

async function run() {
    try {
        let res = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'presupuestos'");
        console.log('Presupuestos:', res.rows.map(r => r.column_name).join(', '));
        res = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'presupuestos_detalles'");
        console.log('Detalles:', res.rows.map(r => r.column_name).join(', '));
    } catch(e) {
        console.error(e);
    } finally {
        pool.end();
    }
}

run();
