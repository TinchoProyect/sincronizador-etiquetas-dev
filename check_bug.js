const pool = require('./src/produccion/config/database');

async function run() {
    try {
        console.log("--- 1. BUSCANDO ÓRDENES DE RETIRO RECIENTES PARA VER VALORES ---");
        let res = await pool.query(`
            SELECT 
                p.id, p.id_presupuesto_ext, p.estado, 
                pd.cantidad, pd.valor1, pd.precio1, pd.camp1, pd.camp2, pd.camp3, pd.camp4
            FROM presupuestos p
            JOIN presupuestos_detalles pd ON pd.id_presupuesto = p.id
            WHERE p.tipo_comprobante = 'Orden de Retiro'
            ORDER BY p.id DESC LIMIT 5;
        `);
        console.log(res.rows);

        console.log("\n--- 2. VERIFICANDO PRESUPUESTOS CON FACTURAS ASOCIADAS ---");
        res = await pool.query(`
            SELECT p.id, p.origen_facturacion, p.estado, f.estado as estado_factura, f.pto_vta, f.cbte_nro
            FROM presupuestos p
            JOIN factura_facturas f ON f.presupuesto_id = p.id
            ORDER BY p.id DESC LIMIT 5;
        `);
        console.log(res.rows);

    } catch(e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
run();
