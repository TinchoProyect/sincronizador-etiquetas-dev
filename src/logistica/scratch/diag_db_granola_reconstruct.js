require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function inspectGranolaCarts() {
    const client = await pool.connect();
    try {
        console.log('🔍 1. Consultando recetas para Grana Flor (GFGN / GFGNFX1) y Grana Sol (GSGN / GSGNFX1)...');
        const resRecetas = await client.query(`
            SELECT id, articulo_numero FROM public.recetas
            WHERE articulo_numero IN ('GFGN', 'GFGNFX1', 'GSGN', 'GSGNFX1')
        `);
        console.log('Recetas encontradas para Granolas:', resRecetas.rows);

        for (const rec of resRecetas.rows) {
            console.log(`\n--- Receta id ${rec.id} (articulo_numero: ${rec.articulo_numero}) ---`);
            const resArts = await client.query(`
                SELECT ra.*, a.nombre 
                FROM public.receta_articulos ra 
                LEFT JOIN public.articulos a ON a.numero = ra.articulo_numero 
                WHERE ra.receta_id = $1
            `, [rec.id]);
            console.log('receta_articulos (Mezcla base):', resArts.rows);

            const resIngs = await client.query(`
                SELECT ri.*, i.nombre 
                FROM public.receta_ingredientes ri 
                LEFT JOIN public.ingredientes i ON i.id = ri.ingrediente_id 
                WHERE ri.receta_id = $1
            `, [rec.id]);
            console.log('receta_ingredientes (Insumos agregados):', resIngs.rows);
        }

        console.log('\n🔍 2. Consultando produccion_externa_historial para carros de Granola (2663, 2608, 2555, 2501, 2670)...');
        const resHist = await client.query(`
            SELECT id, carro_id, articulo_padre_id, articulo_fraccionado_id, kilos_entrada, kilos_salida, kilos_producidos, porcentaje_merma, fecha_registro
            FROM public.produccion_externa_historial
            WHERE articulo_padre_id IN ('GFGN', 'GSGN') OR articulo_fraccionado_id IN ('GFGNFX1', 'GSGNFX1')
            ORDER BY fecha_registro DESC;
        `);
        console.table(resHist.rows);

        console.log('\n🔍 3. Consultando egresos de mezcla base en stock_ventas_movimientos para esos carros...');
        const cartIds = resHist.rows.map(r => r.carro_id);
        if (cartIds.length > 0) {
            const resMix = await client.query(`
                SELECT 
                    svm.carro_id,
                    svm.articulo_numero AS sku_mezcla,
                    a.nombre AS descripcion_mezcla,
                    svm.cantidad AS bultos_descontados,
                    ABS(CAST(svm.cantidad AS DECIMAL(20,10))) * COALESCE(CAST(src.kilos_unidad AS DECIMAL(20,10)), ba.kilos_unidad, 1.00) AS kilos_mezcla_descontados,
                    svm.fecha
                FROM public.stock_ventas_movimientos svm
                LEFT JOIN public.articulos a ON a.numero = svm.articulo_numero
                LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = svm.articulo_numero
                LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = svm.articulo_numero
                WHERE svm.carro_id = ANY($1) AND (LOWER(svm.tipo) LIKE '%egreso%' OR CAST(svm.cantidad AS TEXT) LIKE '-%')
                ORDER BY svm.carro_id DESC;
            `, [cartIds]);
            console.table(resMix.rows);
        }

    } catch (err) {
        console.error('Error in inspectGranolaCarts:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

inspectGranolaCarts();
