const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function resincronizarArticulosHistoricos() {
    console.log('🔄 ====================================================================');
    console.log('🔄 SANEAMIENTO HISTÓRICO ATÓMICO DE ARTÍCULOS BÚNKER ➔ FINANZAS (v5.27)');
    console.log('🔄 ====================================================================\n');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Obtener todas las listas de precio activas desde bunker_listas_precios
        const resListas = await client.query(`SELECT id, nombre FROM public.bunker_listas_precios WHERE activa IS NOT FALSE ORDER BY id ASC;`);
        const listas = resListas.rows;
        console.log(`📋 Listas de precio activas en el sistema: ${listas.length} lista(s)`);

        // 2. Obtener los 10 artículos desfasados sin márgenes en bunker_margenes
        const resSinMargenes = await client.query(`
            SELECT ba.articulo_id, ba.descripcion, ba.costo_base, ba.porcentaje_iva
            FROM public.bunker_articulos ba
            LEFT JOIN public.bunker_margenes bm ON bm.articulo_id = ba.articulo_id
            WHERE bm.articulo_id IS NULL;
        `);

        console.log(`⚠️ Identificados ${resSinMargenes.rows.length} artículo(s) sin registros en bunker_margenes. Iniciando saneamiento...`);

        let procesadosMargenes = 0;
        for (const art of resSinMargenes.rows) {
            const artId = art.articulo_id;
            const cBase = parseFloat(art.costo_base) || 0;
            const baseIva = parseFloat(art.porcentaje_iva) || 21.00;

            for (const lista of listas) {
                const margenPct = 0; // Margen inicial seguro

                // A. Insertar en bunker_margenes
                await client.query(`
                    INSERT INTO public.bunker_margenes (articulo_id, lista_id, margen_porcentaje)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (articulo_id, lista_id) DO UPDATE SET margen_porcentaje = EXCLUDED.margen_porcentaje;
                `, [artId, lista.id, margenPct]);

                // B. Insertar / Recalcular en bunker_lista_articulos
                const ivaCoeff = 1 + (baseIva / 100);
                const precioFinal = (cBase * (1 + (margenPct / 100))) * ivaCoeff;

                const queryExist = `SELECT id FROM public.bunker_lista_articulos WHERE lista_id = $1 AND articulo_numero = $2;`;
                const resExist = await client.query(queryExist, [lista.id, artId]);

                if (resExist.rows.length > 0) {
                    await client.query(`
                        UPDATE public.bunker_lista_articulos
                        SET margen_ganancia = $1, iva = $2, precio_final = $3, disponible = true
                        WHERE lista_id = $4 AND articulo_numero = $5;
                    `, [margenPct, baseIva, precioFinal, lista.id, artId]);
                } else {
                    await client.query(`
                        INSERT INTO public.bunker_lista_articulos (
                            lista_id, articulo_numero, costo_base_sobrescrito,
                            costo_tiempo, iva, margen_ganancia, precio_final,
                            modo_calculo, modo_iva, es_patron, disponible
                        ) VALUES (
                            $1, $2, NULL, 0, $3, $4, $5, 'AUTOMATIC', 'COMPLETO', false, true
                        );
                    `, [lista.id, artId, baseIva, margenPct, precioFinal]);
                }
            }
            procesadosMargenes++;
        }

        // 3. Recalcular y corregir los 19 artículos con precio_final = 0 descalzados
        const resDescalzados = await client.query(`
            SELECT DISTINCT bla.id, bla.articulo_numero, bla.lista_id, bla.margen_ganancia, ba.costo_base, ba.porcentaje_iva
            FROM public.bunker_lista_articulos bla
            JOIN public.bunker_articulos ba ON ba.articulo_id = bla.articulo_numero
            WHERE bla.costo_base_sobrescrito IS NULL AND ba.costo_base > 0 AND bla.precio_final = 0;
        `);

        console.log(`⚠️ Identificados ${resDescalzados.rows.length} artículo(s) con precio zero en listas. Recalculando...`);

        let procesadosPreciosZero = 0;
        for (const row of resDescalzados.rows) {
            const cBase = parseFloat(row.costo_base) || 0;
            const baseIva = parseFloat(row.porcentaje_iva) || 21.00;
            const margenPct = parseFloat(row.margen_ganancia) || 0;
            const ivaCoeff = 1 + (baseIva / 100);
            const precioFinal = (cBase * (1 + (margenPct / 100))) * ivaCoeff;

            await client.query(`
                UPDATE public.bunker_lista_articulos
                SET iva = $1, precio_final = $2
                WHERE id = $3;
            `, [baseIva, precioFinal, row.id]);
            procesadosPreciosZero++;
        }

        await client.query('COMMIT');
        console.log(`\n✅ SANEAMIENTO HISTÓRICO FINALIZADO Y COMMIT ESTRUCTURAL EJECUTADO:`);
        console.log(`   - Artículos sin márgenes saneados: ${procesadosMargenes}`);
        console.log(`   - Registros de precio zero recalculados: ${procesadosPreciosZero}`);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ ERROR EN SANEAMIENTO HISTÓRICO (ROLLBACK EJECUTADO):', err);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

resincronizarArticulosHistoricos();
