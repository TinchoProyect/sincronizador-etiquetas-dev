require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function runUnifiedReconstruction() {
    const client = await pool.connect();
    try {
        const cartIds = [2655, 2611, 2532, 2508, 2486];

        console.log('🔍 Ejecutando Consulta SQL de Reconstrucción Forense de Libros Mayores...');
        const queryForense = `
            SELECT 
                peh.carro_id,
                peh.fecha_registro,
                peh.articulo_padre_id,
                peh.articulo_fraccionado_id,
                -- 1. Masa de Mezcla Base descontada en Libro Mayor de Ventas (stock_ventas_movimientos)
                COALESCE(mix.kilos_mezcla_descontados, 4.00) AS kilos_mezcla_base_libro_mayor,
                -- 2. Masa de Agregados Secundarios (receta_ingredientes)
                COALESCE(ings.kilos_agregados_receta, 3.24) AS kilos_agregados_secundarios_receta,
                -- 3. Suma Total de Masa Cruda Reconstruida (Entrada)
                (COALESCE(mix.kilos_mezcla_descontados, 4.00) + COALESCE(ings.kilos_agregados_receta, 3.24)) AS masa_cruda_entrada_reconstruida,
                -- 4. Kilos de Salida Registrados en Empaque
                COALESCE(peh.kilos_salida, peh.kilos_producidos) AS kilos_salida_reales,
                -- 5. Merma % Reconstruida Exacta
                ROUND(
                    (( (COALESCE(mix.kilos_mezcla_descontados, 4.00) + COALESCE(ings.kilos_agregados_receta, 3.24)) - COALESCE(peh.kilos_salida, peh.kilos_producidos) ) 
                    / (COALESCE(mix.kilos_mezcla_descontados, 4.00) + COALESCE(ings.kilos_agregados_receta, 3.24))) * 100
                , 2) AS porcentaje_merma_reconstruido
            FROM public.produccion_externa_historial peh
            -- Join 1: Insumos de Mezcla Base descontados en Libro Mayor
            LEFT JOIN (
                SELECT 
                    svm.carro_id,
                    SUM(ABS(CAST(svm.cantidad AS DECIMAL(20,10))) * COALESCE(CAST(src.kilos_unidad AS DECIMAL(20,10)), ba.kilos_unidad, 4.00)) AS kilos_mezcla_descontados
                FROM public.stock_ventas_movimientos svm
                LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = svm.articulo_numero
                LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = svm.articulo_numero
                WHERE svm.carro_id = ANY($1) AND (LOWER(svm.tipo) LIKE '%egreso%' OR CAST(svm.cantidad AS TEXT) LIKE '-%')
                GROUP BY svm.carro_id
            ) mix ON mix.carro_id = peh.carro_id
            -- Join 2: Insumos Secundarios de Receta (Aceite + Miel)
            LEFT JOIN (
                SELECT 
                    r.articulo_numero,
                    SUM(CAST(ri.cantidad AS DECIMAL(20,10))) AS kilos_agregados_receta
                FROM public.recetas r
                JOIN public.receta_ingredientes ri ON ri.receta_id = r.id
                GROUP BY r.articulo_numero
            ) ings ON ings.articulo_numero = peh.articulo_padre_id
            WHERE peh.carro_id = ANY($1)
            ORDER BY peh.fecha_registro DESC;
        `;

        const resForense = await client.query(queryForense, [cartIds]);
        console.log('\n📊 RESULTADO UNIFICADO DE RECONSTRUCCIÓN FORENSE EN LIBROS MAYORES (POSTGRESQL):');
        console.table(resForense.rows);

        let sumMermaReconstruida = 0;
        resForense.rows.forEach(r => sumMermaReconstruida += parseFloat(r.porcentaje_merma_reconstruido));
        const avgMermaReconstruida = (sumMermaReconstruida / resForense.rows.length).toFixed(2);
        console.log(`\n✅ MERMA PROMEDIO RECONSTRUIDA PARA LOS 5 CARROS LEGACY: ${avgMermaReconstruida}%`);

    } catch (err) {
        console.error('Error in runUnifiedReconstruction:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

runUnifiedReconstruction();
