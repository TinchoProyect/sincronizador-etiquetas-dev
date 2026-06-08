const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://postgres:ta3Mionga@localhost:5432/etiquetas' });

async function run() {
    try {
        const res = await pool.query("SELECT * FROM public.bunker_articulos WHERE articulo_id = 'EMB-IZND3I'");
        console.log('--- bunker_articulos ---');
        console.log(JSON.stringify(res.rows, null, 2));

        const resMargenes = await pool.query("SELECT * FROM public.bunker_margenes WHERE articulo_id = 'EMB-IZND3I'");
        console.log('--- bunker_margenes ---');
        console.log(JSON.stringify(resMargenes.rows, null, 2));

        const resListaArt = await pool.query("SELECT * FROM public.bunker_lista_articulos WHERE articulo_numero = 'EMB-IZND3I'");
        console.log('--- bunker_lista_articulos ---');
        console.log(JSON.stringify(resListaArt.rows, null, 2));

        const resLegacy = await pool.query("SELECT * FROM public.stock_real_consolidado WHERE articulo_numero = 'EMB-IZND3I'");
        console.log('--- stock_real_consolidado ---');
        console.log(JSON.stringify(resLegacy.rows, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

run();
