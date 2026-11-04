const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function diagnosticarDesfasajeHistorico() {
    console.log('🔍 ====================================================================');
    console.log('🔍 DIAGNÓSTICO EMPÍRICO DE SANEAMIENTO HISTÓRICO (v5.27)');
    console.log('🔍 ====================================================================\n');

    const client = await pool.connect();
    try {
        // 1. Conteo Total de Artículos en Búnker
        const resTotal = await client.query(`SELECT COUNT(*)::integer as total FROM public.bunker_articulos;`);
        const totalBunker = resTotal.rows[0].total;

        // 2. Artículos en bunker_articulos que NO tienen ningún registro en bunker_margenes
        const resSinMargenes = await client.query(`
            SELECT ba.articulo_id, ba.descripcion, ba.costo_base, ba.porcentaje_iva, ba.familia_id
            FROM public.bunker_articulos ba
            LEFT JOIN public.bunker_margenes bm ON bm.articulo_id = ba.articulo_id
            WHERE bm.articulo_id IS NULL;
        `);

        // 3. Artículos en bunker_articulos que NO tienen ningún registro en bunker_lista_articulos
        const resSinListas = await client.query(`
            SELECT ba.articulo_id, ba.descripcion, ba.costo_base, ba.porcentaje_iva
            FROM public.bunker_articulos ba
            LEFT JOIN public.bunker_lista_articulos bla ON bla.articulo_numero = ba.articulo_id
            WHERE bla.articulo_numero IS NULL;
        `);

        // 4. Artículos con márgenes pero con descalce de costo/mantenimiento
        const resDescalzados = await client.query(`
            SELECT DISTINCT ba.articulo_id, ba.descripcion, ba.costo_base as costo_bunker, bla.costo_base_sobrescrito, bla.precio_final
            FROM public.bunker_articulos ba
            JOIN public.bunker_lista_articulos bla ON bla.articulo_numero = ba.articulo_id
            WHERE bla.costo_base_sobrescrito IS NULL AND ba.costo_base > 0 AND bla.precio_final = 0;
        `);

        console.log(`📊 TOTAL DE ARTÍCULOS EN BÚNKER: ${totalBunker}`);
        console.log(`⚠️ ARTÍCULOS SIN REGISTROS EN bunker_margenes: ${resSinMargenes.rows.length}`);
        console.log(`⚠️ ARTÍCULOS SIN REGISTROS EN bunker_lista_articulos: ${resSinListas.rows.length}`);
        console.log(`⚠️ ARTÍCULOS CON CONFLICTO DE PRECIO ZERO EN LISTAS: ${resDescalzados.rows.length}`);

        console.log('\n📋 Muestra de primeros 5 artículos desfasados (sin márgenes):');
        resSinMargenes.rows.slice(0, 5).forEach(r => {
            console.log(`   -> ID: ${r.articulo_id} | Desc: "${r.descripcion}" | Costo: $${r.costo_base} | IVA: ${r.porcentaje_iva}%`);
        });

    } catch (err) {
        console.error('❌ Error ejecutando diagnóstico empírico:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

diagnosticarDesfasajeHistorico();
