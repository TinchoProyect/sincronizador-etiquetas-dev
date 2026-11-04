const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function main() {
    try {
        console.log('Querying bunker_articulos for description matching Caja...');
        const resArts = await pool.query(
            `SELECT articulo_id, descripcion, descripcion_generada, costo_base, kilos_unidad, rubro, sub_rubro 
             FROM public.bunker_articulos 
             WHERE descripcion ILIKE '%Caja%' OR descripcion_generada ILIKE '%Caja%'`
        );
        console.log('Found articles:', resArts.rows);

        for (const art of resArts.rows) {
            const artId = art.articulo_id;
            console.log(`\nQuerying bunker_lista_articulos for article_numero = '${artId}'...`);
            const resLists = await pool.query(
                `SELECT id, lista_id, margen_ganancia, costo_base_sobrescrito, costo_tiempo, iva, precio_final, modo_calculo, exencion_operativa 
                 FROM public.bunker_lista_articulos 
                 WHERE articulo_numero = $1`,
                [artId]
            );
            console.log('Found pricing lists for:', art.descripcion_generada, resLists.rows);
        }

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}

main();
