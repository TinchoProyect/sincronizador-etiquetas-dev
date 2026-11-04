const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432
});

async function run() {
    console.log('--- Inspecting BFX50G in database ---');

    // 1. Check stock_real_consolidado
    const resStock = await pool.query('SELECT * FROM public.stock_real_consolidado WHERE articulo_numero = $1', ['BFX50G']);
    console.log('\n[stock_real_consolidado]');
    console.log(resStock.rows);

    // 2. Check bunker_articulos
    const resBunker = await pool.query('SELECT * FROM public.bunker_articulos WHERE articulo_id = $1', ['BFX50G']);
    console.log('\n[bunker_articulos]');
    console.log(resBunker.rows);

    // 3. Check precios_articulos
    const resPrecios = await pool.query('SELECT * FROM public.precios_articulos WHERE  articulo = $1', ['BFX50G']);
    console.log('\n[precios_articulos]');
    console.log(resPrecios.rows);

    // Let's do a search query simulation for 'bar 20' or 'barrita' in stock_real_consolidado
    const queryTerm = '%bar%';
    const resSearch = await pool.query(
        "SELECT articulo_numero, descripcion FROM public.stock_real_consolidado WHERE descripcion ILIKE $1 OR articulo_numero ILIKE $1",
        [`%bar%`]
    );
    console.log('\n[Search for "%bar%" in stock_real_consolidado]');
    console.log(resSearch.rows);

    // Let's do a search query simulation for '%flor%'
    const resSearchFlor = await pool.query(
        "SELECT articulo_numero, descripcion FROM public.stock_real_consolidado WHERE descripcion ILIKE $1",
        [`%flor%`]
    );
    console.log('\n[Search for "%flor%" in stock_real_consolidado]');
    console.log(resSearchFlor.rows);

    pool.end();
}

run().catch(console.error);
