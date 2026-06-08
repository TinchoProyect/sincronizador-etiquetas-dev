const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://postgres:ta3Mionga@localhost:5432/etiquetas' });

async function run() {
    try {
        const resList = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'bunker_lista_articulos'
        `);
        console.log("bunker_lista_articulos Columns:");
        console.table(resList.rows);

        if (resList.rows.length > 0) {
            const sample = await pool.query("SELECT * FROM public.bunker_lista_articulos LIMIT 5");
            console.log("bunker_lista_articulos Sample:");
            console.log(JSON.stringify(sample.rows, null, 2));
        }

        // Also check if there is an article_id in bunker_articulos or if bunker_articulos corresponds to traditional articulos (Lomas Soft)
        // Let's search if there's any relation with traditional articulos table
        const resArtMatch = await pool.query(`
            SELECT a.numero, a.nombre, b.articulo_id, b.descripcion_generada
            FROM public.articulos a
            JOIN public.bunker_articulos b ON a.numero = b.articulo_id OR a.codigo_barras = b.articulo_id
            LIMIT 5
        `);
        console.log("Direct Joins on ID/barcode:");
        console.table(resArtMatch.rows);

    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}

run();
