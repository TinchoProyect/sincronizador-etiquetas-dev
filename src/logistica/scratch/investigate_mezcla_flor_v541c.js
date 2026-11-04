const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function traceMezclaFlor() {
    console.log('🔬 ====================================================================');
    console.log('🔬 RASTREO FORENSE DE LA CADENA "mezcla/flor" Y SKU BFXP (v5.41c)');
    console.log('🔬 ====================================================================\n');

    const client = await pool.connect();
    try {
        // 1. Buscar en bunker_articulos para "mezcla/flor"
        const resBunker = await client.query(`
            SELECT articulo_id, descripcion, descripcion_generada, rubro, sub_rubro, costo_base
            FROM public.bunker_articulos
            WHERE LOWER(descripcion) LIKE '%mezcla%'
               OR LOWER(descripcion_generada) LIKE '%mezcla%'
               OR LOWER(rubro) LIKE '%mezcla%'
               OR LOWER(sub_rubro) LIKE '%mezcla%'
               OR articulo_id IN ('BFX50G', 'BFXP', 'MPB', 'BFXUNI');
        `);
        console.log('1. Coincidencias en public.bunker_articulos:');
        console.log(JSON.stringify(resBunker.rows, null, 2));

        // 2. Buscar en stock_real_consolidado
        const resLegacy = await client.query(`
            SELECT articulo_numero, descripcion, kilos_unidad
            FROM public.stock_real_consolidado
            WHERE articulo_numero IN ('BFX50G', 'BFXP', 'MPB', 'BFXUNI')
               OR LOWER(descripcion) LIKE '%mezcla%';
        `);
        console.log('\n2. Coincidencias en public.stock_real_consolidado:');
        console.log(JSON.stringify(resLegacy.rows, null, 2));

        // 3. Inspeccionar respuesta real de queryRel en mermasController para BFX50G
        const queryRel = `
            WITH target_skus AS (
                SELECT 'BFX50G' AS sku
                UNION
                SELECT articulo_numero FROM public.stock_real_consolidado WHERE articulo_numero = 'BFX50G'
                UNION
                SELECT articulo_id FROM public.bunker_articulos WHERE articulo_id = 'BFX50G'
                UNION
                SELECT pack_hijo_codigo FROM public.bunker_articulos WHERE articulo_id = 'BFX50G' AND pack_hijo_codigo IS NOT NULL
            ),
            vector_a_relacion AS (
                SELECT 
                    r.articulo_produccion_codigo AS sku_up,
                    r.articulo_kilo_codigo AS sku_kilo,
                    COALESCE(r.multiplicador_ingredientes, 1.0000) AS factor_conversion,
                    r.ingredientes_custom,
                    1 AS priority
                FROM public.articulos_produccion_externa_relacion r
                WHERE r.articulo_kilo_codigo IN (SELECT sku FROM target_skus)
                   OR r.articulo_produccion_codigo IN (SELECT sku FROM target_skus)
            ),
            vector_b_c_recetas AS (
                SELECT 
                    rec.articulo_numero AS sku_up,
                    ra.articulo_numero AS sku_kilo,
                    1.0000 AS factor_conversion,
                    NULL::jsonb AS ingredientes_custom,
                    2 AS priority
                FROM public.recetas rec
                JOIN public.receta_articulos ra ON rec.id = ra.receta_id
                WHERE rec.articulo_numero IN (SELECT sku FROM target_skus)
                   OR ra.articulo_numero IN (SELECT sku FROM target_skus)
            ),
            vector_all AS (
                SELECT * FROM vector_a_relacion
                UNION ALL
                SELECT * FROM vector_b_c_recetas
            )
            SELECT 
                v.sku_up AS sku_entrada,
                v.factor_conversion,
                COALESCE(s_up.descripcion, ba_up.descripcion_generada, ba_up.descripcion, v.sku_up) AS descripcion_entrada,
                ba_up.kilos_unidad AS kilos_unidad_entrada,
                v.ingredientes_custom
            FROM vector_all v
            LEFT JOIN public.stock_real_consolidado s_up ON (s_up.articulo_numero = v.sku_up)
            LEFT JOIN public.bunker_articulos ba_up ON (ba_up.articulo_id = v.sku_up)
            ORDER BY v.priority ASC
            LIMIT 1;
        `;
        const resQueryRel = await client.query(queryRel);
        console.log('\n3. Resultado crudo de queryRel para BFX50G:');
        console.log(JSON.stringify(resQueryRel.rows, null, 2));

        // 4. Probar /api/logistica/bunker/finanzas/MPB vs /api/logistica/bunker/finanzas/BFXP
        const BunkerService = require('../services/bunkerService');
        const finMPB = await BunkerService.obtenerRadiografiaFinanciera(client, 'MPB');
        console.log('\n4. Radiografía Financiera de MPB:');
        console.log(JSON.stringify(finMPB, null, 2));

    } catch (err) {
        console.error('❌ Error en rastreo:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

traceMezclaFlor();
