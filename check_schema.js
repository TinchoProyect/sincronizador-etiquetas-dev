require('dotenv').config();
const { pool } = require('./src/logistica/config/database');

async function test() {
    try {
        const res = await pool.query("SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'rutas_auditorias'");
        console.log(res.rows);
    } catch(e) { console.error(e); }
    process.exit(0);
}
test();
