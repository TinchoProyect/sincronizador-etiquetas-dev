const pool = require('./src/produccion/config/database');

async function run() {
    try {
        console.log("--- PUNTOS DE VENTA EN FACTURAS ---");
        let res = await pool.query(`
            SELECT pto_vta, COUNT(*) as count 
            FROM factura_facturas 
            GROUP BY pto_vta 
            ORDER BY count DESC;
        `);
        console.log(res.rows);

        console.log("\n--- PRESUPUESTOS CON FACTURA ---");
        res = await pool.query(`
            SELECT p.id, p.origen_facturacion, f.pto_vta, f.cbte_nro, f.estado
            FROM presupuestos p
            LEFT JOIN factura_facturas f ON f.presupuesto_id = p.id
            WHERE p.id IN (8232682, 8232668)
        `);
        console.log(res.rows);

    } catch(e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
run();
