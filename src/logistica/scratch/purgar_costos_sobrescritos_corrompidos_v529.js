const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function purgarCostosSobrescritosCorrompidos() {
    console.log('🧹 ====================================================================');
    console.log('🧹 PURGADO HISTÓRICO ATÓMICO DE COSTOS SOBREESCRITOS CORROMPIDOS (v5.29)');
    console.log('🧹 ====================================================================\n');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Auditar la cantidad de registros con costo_base_sobrescrito no nulo antes del purgado
        const resPre = await client.query(`
            SELECT COUNT(*)::integer as total
            FROM public.bunker_lista_articulos
            WHERE costo_base_sobrescrito IS NOT NULL;
        `);
        console.log(`⚠️ Registros identificados con costo_base_sobrescrito inyectado: ${resPre.rows[0].total}`);

        // 2. Blanqueo a NULL y Recálculo Síncrono en una sola consulta atómica
        const resRecalc = await client.query(`
            UPDATE public.bunker_lista_articulos bla
            SET costo_base_sobrescrito = NULL,
                precio_final = (
                    (ba.costo_base * (1 + (COALESCE(bla.margen_ganancia, 0) / 100)) + COALESCE(bla.costo_tiempo, 0)) * (1 + (COALESCE(bla.iva, 21.00) / 100))
                ),
                updated_at = CURRENT_TIMESTAMP
            FROM public.bunker_articulos ba
            WHERE ba.articulo_id = bla.articulo_numero
              AND bla.costo_base_sobrescrito IS NOT NULL;
        `);
        console.log(`✅ Blanqueo y Recálculo síncrono atómico aplicado sobre ${resRecalc.rowCount} filas en bunker_lista_articulos.`);

        await client.query('COMMIT');
        console.log(`\n✅ PURGADO HISTÓRICO FINALIZADO Y COMMIT ESTRUCTURAL EJECUTADO (100% PARIDAD RECONSTITUIDA)`);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ ERROR EN PURGADO HISTÓRICO (ROLLBACK EJECUTADO):', err);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

purgarCostosSobrescritosCorrompidos();
