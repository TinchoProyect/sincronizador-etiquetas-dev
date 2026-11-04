const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function queryFase1Tables() {
    console.log('🔬 ====================================================================');
    console.log('🔬 EXTRACCIÓN EMPÍRICA FASE 1: TABLAS ESTRUCTURALES Y RECETAS (v5.42)');
    console.log('🔬 ====================================================================\n');

    const client = await pool.connect();
    try {
        // A. Relación 1:1 de la Unidad Productiva (Legacy vs Búnker)
        const resA = await client.query(`
            SELECT 
                s.articulo_numero AS legacy_sku,
                s.descripcion AS legacy_nombre,
                ba.articulo_id AS bunker_sku,
                ba.descripcion AS bunker_nombre,
                ba.descripcion_generada AS bunker_descripcion_generada,
                ba.rubro AS bunker_rubro,
                ba.sub_rubro AS bunker_sub_rubro
            FROM public.stock_real_consolidado s
            FULL OUTER JOIN public.bunker_articulos ba ON (ba.articulo_id = s.articulo_numero)
            WHERE s.articulo_numero IN ('BFXP', 'BFX50G', 'BFXUNI')
               OR ba.articulo_id IN ('BFXP', 'BFX50G', 'BFXUNI');
        `);
        console.log('Tabla A: Relación 1:1 de la Unidad Productiva y SKUs Puente/Servicio:');
        console.log(JSON.stringify(resA.rows, null, 2));

        // B. Relación 1:1 de la Mezcla (El Nexo - MPB)
        const resB = await client.query(`
            SELECT 
                s.articulo_numero AS legacy_sku,
                s.descripcion AS legacy_nombre,
                ba.articulo_id AS bunker_sku,
                ba.descripcion AS bunker_nombre,
                ba.descripcion_generada AS bunker_descripcion_generada,
                ba.rubro AS bunker_rubro,
                ba.sub_rubro AS bunker_sub_rubro,
                ba.costo_base AS bunker_costo_base,
                ba.kilos_unidad AS bunker_kilos_unidad
            FROM public.stock_real_consolidado s
            FULL OUTER JOIN public.bunker_articulos ba ON (ba.articulo_id = s.articulo_numero)
            WHERE s.articulo_numero = 'MPB' OR ba.articulo_id = 'MPB';
        `);
        console.log('\nTabla B: Relación 1:1 de la Mezcla (El Nexo - MPB):');
        console.log(JSON.stringify(resB.rows, null, 2));

        // C. Evidencia Estructural de la Receta (FK Pura: UP -> Mezcla)
        const resC1 = await client.query(`
            SELECT 
                r.id AS receta_id,
                r.articulo_numero AS receta_articulo_padre,
                ra.id AS receta_articulo_id,
                ra.articulo_numero AS receta_articulo_hijo_ingrediente,
                ra.cantidad AS cantidad_insumo
            FROM public.recetas r
            JOIN public.receta_articulos ra ON ra.receta_id = r.id
            WHERE r.articulo_numero IN ('BFXP', 'BFX50G', 'BFXUNI')
               OR ra.articulo_numero = 'MPB';
        `);
        console.log('\nTabla C1: Registro en public.recetas y public.receta_articulos:');
        console.log(JSON.stringify(resC1.rows, null, 2));

        const resC2 = await client.query(`
            SELECT 
                rel.id AS relacion_id,
                rel.articulo_produccion_codigo AS articulo_produccion_up,
                rel.articulo_kilo_codigo AS articulo_kilo_puente,
                rel.multiplicador_ingredientes
            FROM public.articulos_produccion_externa_relacion rel
            WHERE rel.articulo_produccion_codigo IN ('BFXP', 'BFX50G')
               OR rel.articulo_kilo_codigo IN ('BFXP', 'BFX50G');
        `);
        console.log('\nTabla C2: Registro en public.articulos_produccion_externa_relacion:');
        console.log(JSON.stringify(resC2.rows, null, 2));

    } catch (err) {
        console.error('❌ Error extrayendo tablas:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

queryFase1Tables();
