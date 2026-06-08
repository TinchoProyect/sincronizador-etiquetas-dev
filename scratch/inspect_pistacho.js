const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://postgres:ta3Mionga@localhost:5432/etiquetas' });

async function run() {
    try {
        console.log("--- BÚSQUEDA DE PISTACHO EN BUNKER ---");
        const b = await pool.query("SELECT * FROM public.bunker_articulos WHERE articulo_id = 'PTSx10' OR descripcion ILIKE '%pistacho%'");
        console.log(JSON.stringify(b.rows, null, 2));

        console.log("--- BÚSQUEDA DE PISTACHO EN ARTICULOS LEGACY ---");
        const a = await pool.query("SELECT numero, nombre, codigo_barras FROM public.articulos WHERE numero = 'PTSx10' OR nombre ILIKE '%pistacho%'");
        console.table(a.rows);

        console.log("--- BÚSQUEDA DE PISTACHO EN STOCK REAL CONSOLIDADO ---");
        const s = await pool.query("SELECT articulo_numero, descripcion, stock_consolidado, stock_lomasoft, stock_movimientos, stock_ajustes FROM public.stock_real_consolidado WHERE articulo_numero = 'PTSx10' OR descripcion ILIKE '%pistacho%'");
        console.table(s.rows);

    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}

run();
