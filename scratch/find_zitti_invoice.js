require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function run() {
    try {
        console.log("--- SEARCHING FOR INVOICE B 32-2 ---");
        const res = await pool.query(
            "SELECT * FROM public.factura_facturas WHERE pto_vta = 32 AND cbte_nro = 2 AND tipo_cbte = 6"
        );
        console.dir(res.rows, { depth: null });

        if (res.rows.length > 0) {
            const facturaId = res.rows[0].id;
            console.log(`--- ITEMS FOR INVOICE ID ${facturaId} ---`);
            const items = await pool.query(
                "SELECT * FROM public.factura_factura_items WHERE factura_id = $1 ORDER BY orden",
                [facturaId]
            );
            console.table(items.rows);

            console.log(`--- BUDGET FOR ID ${res.rows[0].presupuesto_id} ---`);
            const budget = await pool.query(
                "SELECT id, id_cliente, estado, total, descuento FROM public.presupuestos WHERE id = $1",
                [res.rows[0].presupuesto_id]
            );
            console.table(budget.rows);
        }
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
