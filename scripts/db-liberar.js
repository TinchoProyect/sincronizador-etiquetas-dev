const pool = require('../src/produccion/config/database');
const fs = require('fs');
async function check() {
    let client = await pool.connect();
    try {
        const {rows} = await client.query(`
            SELECT pg_get_functiondef(p.oid) AS definition
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE p.proname = 'liberar_stock_mantenimiento';
        `);
        fs.writeFileSync('scripts/out-liberar.txt', rows[0].definition);
        console.log("Done");
    } catch(e) {
        console.error(e);
    } finally {
        client.release();
        pool.end();
    }
}
check();
