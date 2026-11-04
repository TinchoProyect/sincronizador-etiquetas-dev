const { pool } = require('../src/logistica/config/database');
async function run() {
    try {
        // Let's run a query on presupuestos for id_cliente = 496 first.
        const r2 = await pool.query(`
            SELECT id, id_cliente, comprobante_lomasoft, origen_facturacion, origen_numero_factura 
            FROM presupuestos 
            WHERE id_cliente = '496' OR id_cliente::text LIKE '%496%'
            LIMIT 10
        `);
        console.log('presupuestos:', r2.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
