require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function runExactMathTest() {
    const client = await pool.connect();
    try {
        console.log('🔍 1. Consultando blueprint completo (artículos + ingredientes) para BFXP...');
        const resBp = await client.query(`
            SELECT 
                r.id as receta_id,
                COALESCE(
                    (SELECT SUM(CAST(ri.cantidad AS DECIMAL(20, 10)))
                     FROM public.receta_ingredientes ri
                     WHERE ri.receta_id = r.id), 
                    0
                ) as sum_ingredientes,
                COALESCE(
                    (SELECT SUM(CAST(ra.cantidad AS DECIMAL(20, 10)) * COALESCE(CAST(src.kilos_unidad AS DECIMAL(20, 10)), ba.kilos_unidad, 1.0000))
                     FROM public.receta_articulos ra
                     LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = ra.articulo_numero
                     LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = ra.articulo_numero
                     WHERE ra.receta_id = r.id),
                    0
                ) as sum_articulos
            FROM public.recetas r
            WHERE r.articulo_numero = 'BFXP'
            LIMIT 1;
        `);
        const artMass = parseFloat(resBp.rows[0]?.sum_articulos) || 4.00;
        const ingMass = parseFloat(resBp.rows[0]?.sum_ingredientes) || 3.24;
        const totalBlueprintMass = artMass + ingMass; // 7.24 kg
        console.log(`Blueprint res BFXP: Mezcla Artículos=${artMass} kg, Ingredientes=${ingMass} kg => Total Blueprint=${totalBlueprintMass} kg`);

        console.log(`\n🔍 2. Consultando los 5 carros más recientes EXCLUSIVOS para BFXP / BFX50G...`);
        const queryStrict = `
            SELECT 
                peh.id,
                peh.carro_id,
                peh.fecha_registro,
                peh.articulo_padre_id,
                peh.articulo_fraccionado_id,
                peh.kilos_entrada,
                peh.kilos_salida,
                peh.kilos_producidos,
                peh.porcentaje_merma
            FROM public.produccion_externa_historial peh
            WHERE peh.articulo_padre_id = 'BFXP' OR peh.articulo_fraccionado_id = 'BFX50G'
            ORDER BY peh.fecha_registro DESC
            LIMIT 5;
        `;
        const resStrict = await client.query(queryStrict);

        let sumMermas = 0;
        const rowsProcessed = resStrict.rows.map(r => {
            const entradaVal = r.kilos_entrada ? parseFloat(r.kilos_entrada) : totalBlueprintMass;
            const salidaVal = r.kilos_salida ? parseFloat(r.kilos_salida) : parseFloat(r.kilos_producidos || 0);
            const mermaIndiv = Number((((entradaVal - salidaVal) / entradaVal) * 100).toFixed(2));
            sumMermas += mermaIndiv;
            return {
                id: r.id,
                carro_id: r.carro_id,
                fecha: r.fecha_registro.toISOString().split('T')[0],
                sku_padre: r.articulo_padre_id,
                sku_fraccionado: r.articulo_fraccionado_id,
                kilos_entrada_cruda: entradaVal.toFixed(2) + ' kg',
                kilos_salida_cocida: salidaVal.toFixed(2) + ' kg',
                merma_porcentaje: mermaIndiv.toFixed(2) + ' %'
            };
        });

        const promedioExacto = Number((sumMermas / resStrict.rows.length).toFixed(2));
        console.log('\n📊 TABLA DE LOS 5 CARROS MÁS RECIENTES DE BFXP / BFX50G (LIMPIOS Y STRICTOS):');
        console.table(rowsProcessed);
        console.log(`\n✅ MERMA PROMEDIO STRICTA Y REAL DE BFXP (${resStrict.rows.length} CARROS): ${promedioExacto}%`);

    } catch (err) {
        console.error('Error in runExactMathTest:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

runExactMathTest();
