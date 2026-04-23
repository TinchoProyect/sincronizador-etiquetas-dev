const pool = require('./src/produccion/config/database');

async function run() {
    try {
        const res = await pool.query(`
            SELECT id, comprobante_lomasoft, origen_facturacion, estado 
            FROM presupuestos 
            WHERE comprobante_lomasoft IS NOT NULL AND TRIM(comprobante_lomasoft) != '' 
            ORDER BY id DESC LIMIT 5
        `);
        console.log(res.rows);
    } catch(e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
run();
