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
        console.log('=== INVESTIGANDO CARROS DE PRODUCCIÓN EXTERNA HISTORIAL ===');
        const carros = [2655, 2611, 2532, 2508];
        
        const resPeh = await pool.query(`
            SELECT * FROM public.produccion_externa_historial 
            WHERE carro_id = ANY($1::int[]) 
            ORDER BY carro_id DESC
        `, [carros]);
        
        console.log('\n--- Registros en produccion_externa_historial ---');
        console.table(resPeh.rows);

        const resSvm = await pool.query(`
            SELECT svm.carro_id, svm.articulo_numero, svm.cantidad, svm.tipo,
                   src.descripcion as desc_src, src.kilos_unidad as ku_src,
                   ba.descripcion as desc_ba, ba.kilos_unidad as ku_ba
            FROM public.stock_ventas_movimientos svm
            LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = svm.articulo_numero
            LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = svm.articulo_numero
            WHERE svm.carro_id = ANY($1::int[])
        `, [carros]);
        
        console.log('\n--- Movimientos de Stock en stock_ventas_movimientos ---');
        console.table(resSvm.rows);

        // Fetch relationship for UP / Barra
        const resRel = await pool.query(`
            SELECT * FROM public.articulos_produccion_externa_relacion
        `);
        console.log('\n--- articulos_produccion_externa_relacion ---');
        console.table(resRel.rows);

        // Fetch recipes for UP
        const resRec = await pool.query(`
            SELECT r.id as receta_id, r.articulo_numero,
                   ri.ingrediente_id, ri.cantidad as ing_cant, i.nombre as ing_nombre,
                   ra.articulo_numero as art_num, ra.cantidad as art_cant, ba.descripcion as art_desc, ba.kilos_unidad
            FROM public.recetas r
            LEFT JOIN public.receta_ingredientes ri ON ri.receta_id = r.id
            LEFT JOIN public.ingredientes i ON i.id = ri.ingrediente_id
            LEFT JOIN public.receta_articulos ra ON ra.receta_id = r.id
            LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = ra.articulo_numero
            WHERE r.articulo_numero IN (SELECT articulo_produccion_codigo FROM public.articulos_produccion_externa_relacion UNION SELECT articulo_kilo_codigo FROM public.articulos_produccion_externa_relacion)
        `);
        console.log('\n--- Recetas de la familia UP ---');
        console.table(resRec.rows);

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

main();
