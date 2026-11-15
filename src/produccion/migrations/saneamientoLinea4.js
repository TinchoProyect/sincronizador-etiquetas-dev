const { recalcularStockConsolidado } = require('../utils/recalcularStock');

/**
 * Rutina SQL idempotente de saneamiento estructural para Línea de Negocio 4 (Tostaderos),
 * stock de Artículos Puente y blindaje contra auto-vínculos UP = AP.
 *
 * Segura para ejecutarse tanto en Laboratorio (etiquetas_pruebas) como al iniciar
 * el servicio de Producción en Nube / Standby (etiquetas).
 * NO modifica multiplicadores ni reglas de Línea 5 ni Línea 6 (GSGN=10.00, GFGN=10.20).
 */
async function ejecutarSaneamientoLinea4(poolOrClient) {
    const usaPool = typeof poolOrClient.connect === 'function';
    const client = usaPool ? await poolOrClient.connect() : poolOrClient;
    const resumen = {
        autovinculos_eliminados: 0,
        constraint_creada: false,
        multiplicador_aptspguppm_normalizado: 0,
        ingrediente_123_reconectado: 0,
        emb_gz6u9k_kilos_unidad_restaurado: 0,
        emb_gz6u9k_residuo_saneado: false
    };

    try {
        await client.query('BEGIN');

        // 1. Eliminar cualquier auto-vínculo inválido donde UP = AP (ej. id=21 'APTSPGXK' -> 'APTSPGXK')
        const delSelf = await client.query(`
            DELETE FROM public.articulos_produccion_externa_relacion
            WHERE UPPER(BTRIM(articulo_produccion_codigo)) = UPPER(BTRIM(articulo_kilo_codigo))
            RETURNING id, articulo_produccion_codigo, articulo_kilo_codigo
        `);
        resumen.autovinculos_eliminados = delSelf.rowCount || 0;

        // 2. Blindar en BD con CHECK constraint contra futuros auto-vínculos UP = AP
        const chkExists = await client.query(`
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'articulos_produccion_externa_relacion'
              AND c.conname = 'chk_aper_no_autovinculo'
            LIMIT 1
        `);
        if (chkExists.rowCount === 0) {
            await client.query(`
                ALTER TABLE public.articulos_produccion_externa_relacion
                ADD CONSTRAINT chk_aper_no_autovinculo
                CHECK (UPPER(BTRIM(articulo_produccion_codigo)) <> UPPER(BTRIM(articulo_kilo_codigo)))
            `);
            resumen.constraint_creada = true;
        }

        // 3. Normalizar multiplicador_ingredientes = 1.00 en el circuito de Tostadero 'APTSPGUPPM' -> 'APTSPGXKPM'
        //    (SIN tocar GSGN = 10.00 ni GFGN = 10.20 de Línea 6)
        const updMult = await client.query(`
            UPDATE public.articulos_produccion_externa_relacion
            SET multiplicador_ingredientes = 1.00
            WHERE UPPER(BTRIM(articulo_produccion_codigo)) = 'APTSPGUPPM'
              AND UPPER(BTRIM(articulo_kilo_codigo)) = 'APTSPGXKPM'
              AND COALESCE(multiplicador_ingredientes, 1.00) <> 1.00
            RETURNING id
        `);
        resumen.multiplicador_aptspguppm_normalizado = updMult.rowCount || 0;

        // 4. Reconectar ingrediente id = 123 ([98300858] Almendra Tostada y Salada) a su AP 'APTSPGXK'
        //    si estaba vacío o desviado por ingreso de bulto comprado ('EMB-XBN4S5')
        const checkApExists = await client.query(`
            SELECT articulo_id FROM public.bunker_articulos WHERE UPPER(BTRIM(articulo_id)) = 'APTSPGXK' LIMIT 1
        `);
        if (checkApExists.rowCount > 0) {
            const apSku = checkApExists.rows[0].articulo_id;
            const updIng123 = await client.query(`
                UPDATE public.ingredientes
                SET articulo_vinculado_numero = $1
                WHERE id = 123
                  AND COALESCE(UPPER(BTRIM(articulo_vinculado_numero)), '') <> 'APTSPGXK'
                RETURNING id
            `, [apSku]);
            resumen.ingrediente_123_reconectado = updIng123.rowCount || 0;

            await client.query(`
                INSERT INTO public.ingrediente_bunker_articulos (ingrediente_id, bunker_articulo_id)
                SELECT 123, $1
                WHERE EXISTS (SELECT 1 FROM public.ingredientes WHERE id = 123)
                ON CONFLICT (ingrediente_id, bunker_articulo_id) DO NOTHING
            `, [apSku]);
        }

        // 5. Sanear stock fantasma y kilos_unidad de EMB-GZ6U9K:
        //    Restaurar kilos_unidad = 1.00 y llevar a 0.00 el residuo artificial de 18.18
        //    originado cuando el ingreso manual de 19.18 kg restó cantidad (1) en vez de kilos (19.18).
        const embSrcRes = await client.query(`
            SELECT articulo_numero, stock_lomasoft, stock_movimientos, stock_ajustes, stock_consolidado, kilos_unidad
            FROM public.stock_real_consolidado
            WHERE UPPER(BTRIM(articulo_numero)) = 'EMB-GZ6U9K'
            FOR UPDATE
        `);

        if (embSrcRes.rowCount > 0) {
            const embRow = embSrcRes.rows[0];
            const skuEmb = embRow.articulo_numero;
            const kuActual = parseFloat(embRow.kilos_unidad);
            if (isNaN(kuActual) || Math.abs(kuActual - 1.0) > 0.001) {
                await client.query(`
                    UPDATE public.stock_real_consolidado
                    SET kilos_unidad = 1.00, ultima_actualizacion = NOW()
                    WHERE articulo_numero = $1
                `, [skuEmb]);
                resumen.emb_gz6u9k_kilos_unidad_restaurado += 1;
            }

            await client.query(`
                UPDATE public.bunker_articulos
                SET kilos_unidad = 1.00
                WHERE UPPER(BTRIM(articulo_id)) = 'EMB-GZ6U9K'
                  AND COALESCE(kilos_unidad, 0) <> 1.00
            `);

            const stockConsActual = parseFloat(embRow.stock_consolidado || 0);
            if (Math.abs(stockConsActual - 18.18) < 0.02) {
                // También normalizar cantidad = 19.18 en el movimiento histórico que restó 1 en vez de 19.18
                await client.query(`
                    UPDATE public.stock_ventas_movimientos
                    SET cantidad = ABS(kilos)
                    WHERE UPPER(BTRIM(articulo_numero)) = 'EMB-GZ6U9K'
                      AND tipo = 'ingreso a producción'
                      AND ABS(COALESCE(cantidad, 0) - 1) < 0.01
                      AND ABS(ABS(COALESCE(kilos, 0)) - 19.18) < 0.02
                `);

                await client.query(`
                    UPDATE public.stock_real_consolidado
                    SET stock_movimientos = ROUND((COALESCE(stock_movimientos, 0) - 18.18)::numeric, 4),
                        ultima_actualizacion = NOW()
                    WHERE articulo_numero = $1
                `, [skuEmb]);

                await recalcularStockConsolidado(client, skuEmb);
                resumen.emb_gz6u9k_residuo_saneado = true;
            }
        }

        await client.query('COMMIT');
        return resumen;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        if (usaPool) client.release();
    }
}

module.exports = {
    ejecutarSaneamientoLinea4
};
