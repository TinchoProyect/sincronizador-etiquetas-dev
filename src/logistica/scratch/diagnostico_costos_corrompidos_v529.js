const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function diagnosticarCostosCorrompidos() {
    console.log('🔍 ====================================================================');
    console.log('🔍 DIAGNÓSTICO EMPÍRICO DE COSTOS SOBREESCRITOS CORROMPIDOS (v5.29)');
    console.log('🔍 ====================================================================\n');

    const client = await pool.connect();
    try {
        // 1. Total de registros en bunker_lista_articulos
        const resTotal = await client.query(`SELECT COUNT(*)::integer as total FROM public.bunker_lista_articulos;`);
        console.log(`📊 TOTAL REGISTROS EN bunker_lista_articulos: ${resTotal.rows[0].total}`);

        // 2. Registros con costo_base_sobrescrito IS NOT NULL
        const resSobrescritos = await client.query(`
            SELECT bla.id, bla.articulo_numero, bla.lista_id, bla.costo_base_sobrescrito, bla.fuente_costo_default, ba.costo_base as costo_bunker
            FROM public.bunker_lista_articulos bla
            JOIN public.bunker_articulos ba ON ba.articulo_id = bla.articulo_numero
            WHERE bla.costo_base_sobrescrito IS NOT NULL;
        `);

        console.log(`⚠️ REGISTROS CON costo_base_sobrescrito INYECTADO: ${resSobrescritos.rows.length}`);

        // 3. Registros donde fuente_costo_default IS NOT NULL
        const resFuenteDefault = await client.query(`
            SELECT COUNT(*)::integer as total
            FROM public.bunker_lista_articulos
            WHERE fuente_costo_default IS NOT NULL;
        `);
        console.log(`⚠️ REGISTROS CON fuente_costo_default SETEADO: ${resFuenteDefault.rows[0].total}`);

        console.log('\n📋 Muestra de primeros 5 registros con costo_base_sobrescrito:');
        resSobrescritos.rows.slice(0, 5).forEach(r => {
            console.log(`   -> ArtID: ${r.articulo_numero} | ListaID: ${r.lista_id} | CostoBunker: $${r.costo_bunker} | Sobrescrito: $${r.costo_base_sobrescrito} | Fuente: ${r.fuente_costo_default}`);
        });

    } catch (err) {
        console.error('❌ Error ejecutando diagnóstico de costos corrompidos:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

diagnosticarCostosCorrompidos();
