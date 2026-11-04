const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
});

async function main() {
    try {
        console.log('--- DUPLICATE DESCRIPTIONS IN STOCK_REAL_CONSOLIDADO ---');
        const res1 = await pool.query(`
            SELECT descripcion, count(*), array_agg(articulo_numero) as ids
            FROM public.stock_real_consolidado
            GROUP BY descripcion
            HAVING count(*) > 1
        `);
        console.log(JSON.stringify(res1.rows, null, 2));

        console.log('--- DUPLICATE DESCRIPTIONS IN BUNKER_ARTICULOS ---');
        const res2 = await pool.query(`
            SELECT COALESCE(descripcion_generada, descripcion) as desc, count(*), array_agg(articulo_id) as ids
            FROM public.bunker_articulos
            GROUP BY COALESCE(descripcion_generada, descripcion)
            HAVING count(*) > 1
        `);
        console.log(JSON.stringify(res2.rows, null, 2));

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

main();
