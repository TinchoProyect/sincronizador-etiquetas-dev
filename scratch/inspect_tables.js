const pool = require('../src/usuarios/pool');

async function main() {
    try {
        const resSample = await pool.query(`
            SELECT bla.id, bla.lista_id, blp.nombre as lista_nombre, bla.articulo_numero, bla.precio_final, bla.disponible
            FROM public.bunker_lista_articulos bla
            JOIN public.bunker_listas_precios blp ON blp.id = bla.lista_id
            WHERE bla.articulo_numero IN ('MCVX20', 'MCVX5', 'MCVX2')
            ORDER BY bla.articulo_numero, bla.lista_id
        `);
        console.log("Ejemplo MCVX en bunker_lista_articulos:");
        console.table(resSample.rows);

        // Check stock or ingredients for mani
        const resIngr = await pool.query(`
            SELECT id, nombre, stock_actual, unidad_medida 
            FROM public.ingredientes 
            WHERE nombre ILIKE '%mani%' OR nombre ILIKE '%maní%'
        `);
        console.log("Ingredientes con maní:");
        console.table(resIngr.rows);

        // Check lots if any
        const resLotes = await pool.query(`
            SELECT column_name, data_type FROM information_schema.columns 
            WHERE table_name = 'bunker_lotes_destinos'
            ORDER BY ordinal_position
        `);
        console.log("Columnas bunker_lotes_destinos:");
        console.table(resLotes.rows);

    } catch (err) {
        console.error("Error:", err);
    } finally {
        setTimeout(() => { pool.end(); process.exit(0); }, 500);
    }
}

main();
