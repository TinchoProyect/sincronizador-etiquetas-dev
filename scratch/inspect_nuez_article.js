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
        console.log("--- SEARCHING FOR NUEZ ARTICLE ---");
        const res = await pool.query(
            "SELECT numero, nombre, codigo_barras FROM public.articulos WHERE nombre ILIKE '%Nuez/Cas/34-36%'"
        );
        console.table(res.rows);

        if (res.rows.length > 0) {
            const artNum = 'NCC34/36X5';
            console.log(`--- STOCK CONSOLIDADO FOR SKU ${artNum} ---`);
            const stock = await pool.query(
                "SELECT * FROM public.stock_real_consolidado WHERE articulo_numero = $1",
                [artNum]
            );
            console.table(stock.rows);

            console.log(`--- LATEST VENTAS MOVEMENTS FOR SKU ${artNum} ---`);
            const movs = await pool.query(
                "SELECT id, articulo_numero, cantidad, tipo, fecha, observaciones, origen_ingreso FROM public.stock_ventas_movimientos WHERE articulo_numero = $1 ORDER BY id DESC LIMIT 5",
                [artNum]
            );
            console.table(movs.rows);
        }
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
