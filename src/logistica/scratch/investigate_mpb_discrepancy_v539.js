const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function investigateMPBDiscrepancy() {
    console.log('🔬 ====================================================================');
    console.log('🔬 INVESTIGACIÓN EMPÍRICA DE LA DISCREPANCIA MPB vs MEZCLA BARRA FLOR (v5.39)');
    console.log('🔬 ====================================================================\n');

    const client = await pool.connect();
    try {
        // Buscar todos los artículos en bunker_articulos con rubro o sub_rubro conteniendo "MEZCLA" o "BARRA"
        const resMezclas = await client.query(`
            SELECT articulo_id, descripcion, descripcion_generada, costo_base, kilos_unidad, rubro, sub_rubro
            FROM public.bunker_articulos
            WHERE LOWER(descripcion_generada) LIKE '%mezcla%'
               OR LOWER(descripcion_generada) LIKE '%barra%'
               OR LOWER(descripcion) LIKE '%mezcla%';
        `);
        console.log('1. Todos los artículos de Mezcla / Barra en public.bunker_articulos:');
        console.log(JSON.stringify(resMezclas.rows, null, 2));

        // Inspeccionar todas las recetas de producción
        const resRecetasAll = await client.query(`
            SELECT r.id, r.articulo_numero, r.descripcion, ra.articulo_numero as ingrediente_articulo
            FROM public.recetas r
            LEFT JOIN public.receta_articulos ra ON ra.receta_id = r.id;
        `);
        console.log('\n2. Todas las recetas y sus componentes en public.recetas:');
        console.log(JSON.stringify(resRecetasAll.rows, null, 2));

    } catch (err) {
        console.error('❌ Error en investigación:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

investigateMPBDiscrepancy();
