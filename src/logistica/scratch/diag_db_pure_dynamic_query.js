require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function runPureDynamicTest() {
    const client = await pool.connect();
    try {
        console.log('🔍 Ejecutando Consulta SQL 100% Dinámica (Cero Números Mágicos, Cero Hardcodeo)...');
        const queryPure = `
            WITH skus_familia AS (
                SELECT articulo_produccion_codigo AS sku FROM public.articulos_produccion_externa_relacion WHERE articulo_kilo_codigo = $1 OR articulo_produccion_codigo = $1
                UNION
                SELECT articulo_kilo_codigo AS sku FROM public.articulos_produccion_externa_relacion WHERE articulo_kilo_codigo = $1 OR articulo_produccion_codigo = $1
                UNION
                SELECT $1 AS sku
                UNION
                SELECT $2 AS sku
            ),
            blueprint_familia AS (
                SELECT 
                    r.articulo_numero,
                    COALESCE(
                        (SELECT SUM(CAST(ra.cantidad AS DECIMAL(20, 10)) * COALESCE(CAST(src.kilos_unidad AS DECIMAL(20, 10)), ba.kilos_unidad, 1.00))
                         FROM public.receta_articulos ra
                         LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = ra.articulo_numero
                         LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = ra.articulo_numero
                         WHERE ra.receta_id = r.id), 
                        0
                    ) AS masa_base_blueprint,
                    COALESCE(
                        (SELECT SUM(CAST(ri.cantidad AS DECIMAL(20, 10)))
                         FROM public.receta_ingredientes ri
                         WHERE ri.receta_id = r.id), 
                        0
                    ) AS masa_agregados_blueprint
                FROM public.recetas r
                WHERE r.articulo_numero IN (SELECT sku FROM skus_familia)
                LIMIT 1
            )
            SELECT 
                peh.carro_id,
                peh.fecha_registro,
                peh.articulo_padre_id,
                peh.articulo_fraccionado_id,
                COALESCE(
                    peh.kilos_entrada,
                    NULLIF(COALESCE(mix.kilos_mezcla_descontados, 0) + COALESCE(bp.masa_agregados_blueprint, 0), 0),
                    NULLIF(bp.masa_base_blueprint + bp.masa_agregados_blueprint, 0),
                    0
                ) AS kilos_entrada,
                COALESCE(peh.kilos_salida, peh.kilos_producidos) AS kilos_salida,
                ROUND(
                    (( COALESCE(
                        peh.kilos_entrada,
                        NULLIF(COALESCE(mix.kilos_mezcla_descontados, 0) + COALESCE(bp.masa_agregados_blueprint, 0), 0),
                        NULLIF(bp.masa_base_blueprint + bp.masa_agregados_blueprint, 0),
                        0
                    ) - COALESCE(peh.kilos_salida, peh.kilos_producidos) ) / 
                    NULLIF(COALESCE(
                        peh.kilos_entrada,
                        NULLIF(COALESCE(mix.kilos_mezcla_descontados, 0) + COALESCE(bp.masa_agregados_blueprint, 0), 0),
                        NULLIF(bp.masa_base_blueprint + bp.masa_agregados_blueprint, 0),
                        0
                    ), 0)) * 100
                , 2) AS porcentaje_merma
            FROM public.produccion_externa_historial peh
            LEFT JOIN (
                SELECT 
                    svm.carro_id,
                    SUM(ABS(CAST(svm.cantidad AS DECIMAL(20,10))) * COALESCE(CAST(src.kilos_unidad AS DECIMAL(20,10)), ba.kilos_unidad, 1.00)) AS kilos_mezcla_descontados
                FROM public.stock_ventas_movimientos svm
                LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = svm.articulo_numero
                LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = svm.articulo_numero
                WHERE svm.carro_id IS NOT NULL AND (LOWER(svm.tipo) LIKE '%egreso%' OR CAST(svm.cantidad AS TEXT) LIKE '-%')
                GROUP BY svm.carro_id
            ) mix ON mix.carro_id = peh.carro_id
            LEFT JOIN blueprint_familia bp ON true
            WHERE peh.articulo_padre_id IN (SELECT sku FROM skus_familia)
               OR peh.articulo_fraccionado_id IN (SELECT sku FROM skus_familia)
            ORDER BY peh.fecha_registro DESC
            LIMIT 5;
        `;

        const resPure = await client.query(queryPure, ['BFX50G', 'BFXP']);
        console.log('\n📊 RESULTADOS DE LA CONSULTA SQL 100% DINÁMICA:');
        console.table(resPure.rows);

    } catch (err) {
        console.error('Error in runPureDynamicTest:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

runPureDynamicTest();
