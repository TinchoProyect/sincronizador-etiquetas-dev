const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5432/lamda' });

async function run() {
    try {
        let res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'mantenimiento_movimientos'");
        console.log('mantenimiento_movimientos:', res.rows.map(r => r.column_name).join(', '));
    } catch(e) {
        console.error(e);
    } finally {
        pool.end();
    }
}

run();
