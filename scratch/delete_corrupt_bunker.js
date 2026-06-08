const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://postgres:ta3Mionga@localhost:5432/etiquetas' });

async function run() {
    try {
        await pool.query('BEGIN');

        // Delete from bunker_lista_insumos
        const resInsumos = await pool.query(
            "DELETE FROM public.bunker_lista_insumos WHERE lista_articulo_id IN (SELECT id FROM public.bunker_lista_articulos WHERE articulo_numero = 'EMB-IZND3I')"
        );
        console.log(`Deleted ${resInsumos.rowCount} rows from bunker_lista_insumos`);

        // Delete from bunker_lista_articulos
        const resListArt = await pool.query(
            "DELETE FROM public.bunker_lista_articulos WHERE articulo_numero = 'EMB-IZND3I'"
        );
        console.log(`Deleted ${resListArt.rowCount} rows from bunker_lista_articulos`);

        // Delete from bunker_margenes
        const resMargenes = await pool.query(
            "DELETE FROM public.bunker_margenes WHERE articulo_id = 'EMB-IZND3I'"
        );
        console.log(`Deleted ${resMargenes.rowCount} rows from bunker_margenes`);

        // Delete from bunker_articulos
        const resArt = await pool.query(
            "DELETE FROM public.bunker_articulos WHERE articulo_id = 'EMB-IZND3I'"
        );
        console.log(`Deleted ${resArt.rowCount} rows from bunker_articulos`);

        await pool.query('COMMIT');
        console.log('Transaction committed successfully. Database cleaned.');
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('Error during cleanup transaction, rolled back:', err);
    } finally {
        await pool.end();
    }
}

run();
