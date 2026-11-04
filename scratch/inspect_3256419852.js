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
        console.log("--- QUERYING stock_real_consolidado ---");
        const res1 = await pool.query(
            "SELECT * FROM public.stock_real_consolidado WHERE articulo_numero = $1 OR codigo_barras = $1",
            ['3256419852']
        );
        console.log("Found in stock_real_consolidado:");
        console.table(res1.rows);

        console.log("--- QUERYING mantenimiento_movimientos ---");
        const res2 = await pool.query(
            "SELECT id, articulo_numero, cantidad, estado, tipo_movimiento FROM public.mantenimiento_movimientos WHERE articulo_numero = $1 OR id = 326",
            ['3256419852']
        );
        console.log("Found in mantenimiento_movimientos:");
        console.table(res2.rows);

        console.log("--- QUERYING ALL stock_real_consolidado containing avena ---");
        const res3 = await pool.query(
            "SELECT articulo_numero, descripcion, codigo_barras, kilos_unidad FROM public.stock_real_consolidado WHERE descripcion ILIKE '%avena%'"
        );
        console.log("Avena articles in stock_real_consolidado:");
        console.table(res3.rows);

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
