const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'sincronizador_etiquetas',
  password: process.env.DB_PASSWORD || 'mar1978',
  port: process.env.DB_PORT || 5432,
});

async function main() {
    try {
        const sku1 = 'BFX50G';
        const sku2 = 'MPB';

        const skusFamilia = await pool.query(`
            SELECT articulo_produccion_codigo AS sku FROM public.articulos_produccion_externa_relacion WHERE articulo_kilo_codigo = $1 OR articulo_produccion_codigo = $1
            UNION
            SELECT articulo_kilo_codigo AS sku FROM public.articulos_produccion_externa_relacion WHERE articulo_kilo_codigo = $1 OR articulo_produccion_codigo = $1
            UNION
            SELECT $1 AS sku
            UNION
            SELECT $2 AS sku
        `, [sku1, sku2]);

        console.log('skus_familia:', skusFamilia.rows);

        const blueprintQuery = await pool.query(`
            SELECT 
                r.id as receta_id,
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
            WHERE r.articulo_numero IN (SELECT sku FROM (
                SELECT articulo_produccion_codigo AS sku FROM public.articulos_produccion_externa_relacion WHERE articulo_kilo_codigo = $1 OR articulo_produccion_codigo = $1
                UNION
                SELECT articulo_kilo_codigo AS sku FROM public.articulos_produccion_externa_relacion WHERE articulo_kilo_codigo = $1 OR articulo_produccion_codigo = $1
                UNION
                SELECT $1 AS sku
                UNION
                SELECT $2 AS sku
            ) s)
        `, [sku1, sku2]);

        console.log('\nTodas las recetas coincidentes con skus_familia:', blueprintQuery.rows);

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

main();
