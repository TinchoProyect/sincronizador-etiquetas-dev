const pool = require('./src/produccion/config/database');

async function run() {
    try {
        const res = await pool.query("SELECT id, tipo_comprobante, origen_numero_factura FROM presupuestos WHERE id = 8232789");
        console.log("Original Sales Budget:", res.rows);
        
        const res2 = await pool.query("SELECT id, tipo_comprobante, origen_numero_factura FROM presupuestos WHERE origen_numero_factura = '8232789'");
        console.log("Orden de Retiro lookup by origen_numero_factura:", res2.rows);

        const res3 = await pool.query("SELECT id, tipo_comprobante, origen_numero_factura, id_presupuesto_ext FROM presupuestos WHERE id_cliente = '533' AND tipo_comprobante = 'Orden de Retiro' ORDER BY id DESC LIMIT 5");
        console.log("Recent Orden de Retiro for client 533:", res3.rows);

        const res4 = await pool.query("SELECT * FROM presupuestos_detalles WHERE articulo = '1568853375' ORDER BY id DESC LIMIT 1");
        console.log("Presupuesto_detalles for article 1568853375:", res4.rows);
    } catch (e) {
        console.error(e.message);
    } finally {
        process.exit(0);
    }
}
run();
