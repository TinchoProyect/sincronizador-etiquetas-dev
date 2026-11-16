const { recalcularStockConsolidado } = require('../utils/recalcularStock');

/**
 * Rutina SQL idempotente de saneamiento estructural para Línea de Negocio 6 (Granolas: GFGN y GSGN),
 * determinismo por ID en agregados post-horno, normalización de fracciones unitarias vs Packs Padre,
 * y limpieza de carros inconclusos de prueba en Laboratorio.
 *
 * Segura para ejecutarse tanto en Laboratorio (etiquetas_pruebas) como al iniciar
 * el servicio de Producción en Nube / Standby (etiquetas).
 */
async function ejecutarSaneamientoLinea6(poolOrClient) {
    const usaPool = typeof poolOrClient.connect === 'function';
    const client = usaPool ? await poolOrClient.connect() : poolOrClient;

    const resumen = {
        relaciones_custom_actualizadas: 0,
        fases_ap_actualizadas: 0,
        pack_hijo_limpiado_en_unitarias: [],
        pack_hijo_corregido_en_packs: [],
        sugeridos_ap_normalizados: 0,
        kilos_unidad_src_normalizados: 0,
        bolsas_prorrateadas_quitadas_de_unitarias: [],
        bolsas_exteriores_packs_aseguradas: [],
        carros_prueba_limpiados_lab: []
    };

    try {
        await client.query('BEGIN');

        // 1. Determinismo por ID en agregados secos post-horno dentro de articulos_produccion_externa_relacion
        //    - GFGN -> GFGNFX1: #26 Arandanos Pasas (0.125 kg/kg, interna) + #55 Coco en Escamas (0.125 kg/kg, interna)
        //    - GSGN -> GSGNFX1: #55 Coco en Escamas (0.125 kg/kg, interna) + #59 Pasa Rubia 2 (0.125 kg/kg, interna)
        const nombresIngRes = await client.query(`
            SELECT id, nombre
            FROM public.ingredientes
            WHERE id IN (26, 55, 59)
        `);
        const mapaNombres = new Map();
        for (const r of nombresIngRes.rows) {
            mapaNombres.set(Number(r.id), r.nombre);
        }

        const customGfgn = [
            {
                ingrediente_id: 26,
                nombre_ingrediente: mapaNombres.get(26) || 'Arandanos Pasas',
                cantidad: 0.125,
                unidad_medida: 'Kilo',
                fase_produccion: 'interna'
            },
            {
                ingrediente_id: 55,
                nombre_ingrediente: mapaNombres.get(55) || 'Coco en Escamas',
                cantidad: 0.125,
                unidad_medida: 'Kilo',
                fase_produccion: 'interna'
            }
        ];

        const customGsgn = [
            {
                ingrediente_id: 55,
                nombre_ingrediente: mapaNombres.get(55) || 'Coco en Escamas',
                cantidad: 0.125,
                unidad_medida: 'Kilo',
                fase_produccion: 'interna'
            },
            {
                ingrediente_id: 59,
                nombre_ingrediente: mapaNombres.get(59) || 'Pasa Rubia 2',
                cantidad: 0.125,
                unidad_medida: 'Kilo',
                fase_produccion: 'interna'
            }
        ];

        const updGfgnRel = await client.query(`
            UPDATE public.articulos_produccion_externa_relacion
            SET ingredientes_custom = $1::jsonb
            WHERE UPPER(BTRIM(articulo_produccion_codigo)) = 'GFGN'
              AND UPPER(BTRIM(articulo_kilo_codigo)) = 'GFGNFX1'
              AND COALESCE(ingredientes_custom, '[]'::jsonb) IS DISTINCT FROM $1::jsonb
            RETURNING id
        `, [JSON.stringify(customGfgn)]);
        resumen.relaciones_custom_actualizadas += (updGfgnRel.rowCount || 0);

        const updGsgnRel = await client.query(`
            UPDATE public.articulos_produccion_externa_relacion
            SET ingredientes_custom = $1::jsonb
            WHERE UPPER(BTRIM(articulo_produccion_codigo)) = 'GSGN'
              AND UPPER(BTRIM(articulo_kilo_codigo)) = 'GSGNFX1'
              AND COALESCE(ingredientes_custom, '[]'::jsonb) IS DISTINCT FROM $1::jsonb
            RETURNING id
        `, [JSON.stringify(customGsgn)]);
        resumen.relaciones_custom_actualizadas += (updGsgnRel.rowCount || 0);

        // 2. En receta_ingredientes de los APs GFGNFX1 y GSGNFX1: marcar fase_produccion = 'interna'
        //    para #26, #55 y #59 (depósito post-horno), conservando 'externa' en Miel #136 y Aceite #135 de GFGN/GSGN.
        const updFasesAp = await client.query(`
            UPDATE public.receta_ingredientes ri
            SET fase_produccion = 'interna'
            FROM public.recetas r
            WHERE ri.receta_id = r.id
              AND UPPER(BTRIM(r.articulo_numero)) IN ('GFGNFX1', 'GSGNFX1')
              AND ri.ingrediente_id IN (26, 55, 59)
              AND COALESCE(ri.fase_produccion, '') <> 'interna'
            RETURNING r.articulo_numero, ri.ingrediente_id
        `);
        resumen.fases_ap_actualizadas = updFasesAp.rowCount || 0;

        // Asegurar que Miel (#136) y Aceite de Coco (#135) en las UPs GFGN y GSGN mantengan fase_produccion = 'externa'
        await client.query(`
            UPDATE public.receta_ingredientes ri
            SET fase_produccion = 'externa'
            FROM public.recetas r
            WHERE ri.receta_id = r.id
              AND UPPER(BTRIM(r.articulo_numero)) IN ('GFGN', 'GSGN')
              AND ri.ingrediente_id IN (135, 136)
              AND COALESCE(ri.fase_produccion, '') <> 'externa'
        `);

        // 3. Normalizar Fracciones Unitarias de Granolas: limpiar pack_hijo_codigo = NULL donde es_pack = false
        const updUnitarias = await client.query(`
            UPDATE public.bunker_articulos
            SET pack_hijo_codigo = NULL
            WHERE UPPER(BTRIM(articulo_id)) IN ('GDFX1', 'GDFX500G', 'GDFX200G', 'GSX1', 'GSX500G', 'GSX200G')
              AND COALESCE(es_pack, false) = false
              AND pack_hijo_codigo IS NOT NULL
            RETURNING articulo_id
        `);
        resumen.pack_hijo_limpiado_en_unitarias = (updUnitarias.rows || []).map(r => r.articulo_id);

        // 4. Corregir pack_hijo_codigo en los Packs Padre de 5x1kg: GDF5x1 -> 'GDFX1' y GS5X1 -> 'GSX1'
        const updPackGdf5x1 = await client.query(`
            UPDATE public.bunker_articulos
            SET pack_hijo_codigo = 'GDFX1',
                es_pack = true,
                pack_unidades = COALESCE(NULLIF(pack_unidades, 1), 5)
            WHERE UPPER(BTRIM(articulo_id)) = 'GDF5X1'
              AND COALESCE(UPPER(BTRIM(pack_hijo_codigo)), '') <> 'GDFX1'
            RETURNING articulo_id, pack_hijo_codigo
        `);
        if ((updPackGdf5x1.rowCount || 0) > 0) {
            resumen.pack_hijo_corregido_en_packs.push(...updPackGdf5x1.rows);
        }

        const updPackGs5x1 = await client.query(`
            UPDATE public.bunker_articulos
            SET pack_hijo_codigo = 'GSX1',
                es_pack = true,
                pack_unidades = COALESCE(NULLIF(pack_unidades, 1), 5)
            WHERE UPPER(BTRIM(articulo_id)) = 'GS5X1'
              AND COALESCE(UPPER(BTRIM(pack_hijo_codigo)), '') <> 'GSX1'
            RETURNING articulo_id, pack_hijo_codigo
        `);
        if ((updPackGs5x1.rowCount || 0) > 0) {
            resumen.pack_hijo_corregido_en_packs.push(...updPackGs5x1.rows);
        }

        // 5. Normalizar articulo_sugerido_numero = AP ('GFGNFX1' / 'GSGNFX1') en las 6 fracciones unitarias de Línea 6
        const updSugeridos = await client.query(`
            UPDATE public.recetas r
            SET articulo_sugerido_numero = i.articulo_vinculado_numero
            FROM public.receta_ingredientes ri
            JOIN public.ingredientes i ON i.id = ri.ingrediente_id,
                 public.bunker_articulos ba
            WHERE ri.receta_id = r.id
              AND UPPER(BTRIM(ba.articulo_id)) = UPPER(BTRIM(r.articulo_numero))
              AND COALESCE(i.es_insumo, false) = false
              AND UPPER(BTRIM(COALESCE(i.articulo_vinculado_numero, ''))) IN ('GFGNFX1', 'GSGNFX1')
              AND COALESCE(ba.es_pack, false) = false
              AND UPPER(BTRIM(ba.articulo_id)) NOT IN ('GFGNFX1', 'GSGNFX1')
              AND COALESCE(UPPER(BTRIM(r.articulo_sugerido_numero)), '') <> UPPER(BTRIM(i.articulo_vinculado_numero))
            RETURNING r.id, r.articulo_numero, i.articulo_vinculado_numero
        `);
        resumen.sugeridos_ap_normalizados = updSugeridos.rowCount || 0;

        // Normalizar kilos_unidad en stock_real_consolidado para artículos de Línea 6 si estuviera nulo/0
        const updSrcKu = await client.query(`
            UPDATE public.stock_real_consolidado src
            SET kilos_unidad = ba.kilos_unidad
            FROM public.bunker_articulos ba
            WHERE UPPER(BTRIM(src.articulo_numero)) = UPPER(BTRIM(ba.articulo_id))
              AND COALESCE(ba.kilos_unidad, 0) > 0
              AND (src.kilos_unidad IS NULL OR src.kilos_unidad <= 0)
              AND UPPER(BTRIM(ba.articulo_id)) IN ('GFGNFX1', 'GSGNFX1', 'MPGDFX6,9', 'MPGDSX7', 'GDFX1', 'GDFX500G', 'GDFX200G', 'GSX1', 'GSX500G', 'GSX200G')
            RETURNING src.articulo_numero
        `);
        resumen.kilos_unidad_src_normalizados = updSrcKu.rowCount || 0;

        // 6. Remover prorrateo erróneo de bolsas exteriores de pack (0.1 u / 0.2 u de #177 Bolsa 30 x 40 o #178 Bolsa 20 x 30)
        //    en las recetas unitarias GDFX200G, GDFX500G, GSX200G y GSX500G, preservando intacta su bolsa unitaria (cantidad >= 1).
        const delBolsaProrrateada = await client.query(`
            DELETE FROM public.receta_ingredientes ri_pack
            USING public.recetas r,
                  public.ingredientes i_pack
            WHERE ri_pack.receta_id = r.id
              AND i_pack.id = ri_pack.ingrediente_id
              AND COALESCE(i_pack.es_insumo, false) = true
              AND ri_pack.cantidad > 0
              AND ri_pack.cantidad < 0.999
              AND i_pack.id IN (175, 177, 178)
              AND UPPER(BTRIM(r.articulo_numero)) IN ('GDFX200G', 'GDFX500G', 'GSX200G', 'GSX500G', 'GDFX1', 'GSX1')
              AND EXISTS (
                  SELECT 1
                  FROM public.receta_ingredientes ri_unit
                  JOIN public.ingredientes i_unit ON i_unit.id = ri_unit.ingrediente_id
                  WHERE ri_unit.receta_id = r.id
                    AND COALESCE(i_unit.es_insumo, false) = true
                    AND ri_unit.cantidad >= 1
                    AND ri_unit.id <> ri_pack.id
              )
            RETURNING r.articulo_numero, i_pack.id AS insumo_id, i_pack.nombre AS insumo_nombre, ri_pack.cantidad
        `);
        resumen.bolsas_prorrateadas_quitadas_de_unitarias = delBolsaProrrateada.rows || [];

        // 7. Asegurar la bolsa exterior entera correspondiente (cantidad = 1, incluido = true) en public.bunker_lista_insumos
        //    sobre todos los Packs Padre de Granolas (incluyendo GDS10x500 además de los 7 listados):
        //    - Packs de 2.00 kg / 2.50 kg (10x200g y 5x500g) -> #177 Bolsa 30 x 40 ($159.40)
        //    - Packs de 5.00 kg (10x500g y 5x1kg)           -> #175 Bolsa 40 x 50 ($250.38)
        const packsGranolasBolsa = [
            { packSkuUpper: 'GDF10X200G', insumoId: '177', fallbackCosto: 159.40 },
            { packSkuUpper: 'GS10X200G',  insumoId: '177', fallbackCosto: 159.40 },
            { packSkuUpper: 'GDF5X500G',  insumoId: '177', fallbackCosto: 159.40 },
            { packSkuUpper: 'GS5X500G',   insumoId: '177', fallbackCosto: 159.40 },
            { packSkuUpper: 'GDF10X500',  insumoId: '175', fallbackCosto: 250.38 },
            { packSkuUpper: 'GDS10X500',  insumoId: '175', fallbackCosto: 250.38 },
            { packSkuUpper: 'GDF5X1',     insumoId: '175', fallbackCosto: 250.38 },
            { packSkuUpper: 'GS5X1',      insumoId: '175', fallbackCosto: 250.38 }
        ];

        for (const cfgPack of packsGranolasBolsa) {
            const insPack = await client.query(`
                INSERT INTO public.bunker_lista_insumos (
                    lista_articulo_id,
                    insumo_articulo_numero,
                    cantidad,
                    costo_unitario_capturado,
                    incluido
                )
                SELECT
                    bla.id,
                    $2::varchar,
                    1.0000,
                    COALESCE((SELECT i.costo_patron FROM public.ingredientes i WHERE i.id = $2::int LIMIT 1), $3::numeric),
                    true
                FROM public.bunker_lista_articulos bla
                WHERE UPPER(BTRIM(bla.articulo_numero)) = $1
                  AND NOT EXISTS (
                      SELECT 1
                      FROM public.bunker_lista_insumos bli
                      WHERE bli.lista_articulo_id = bla.id
                        AND bli.incluido = true
                  )
                RETURNING id, lista_articulo_id, insumo_articulo_numero
            `, [cfgPack.packSkuUpper, cfgPack.insumoId, cfgPack.fallbackCosto]);

            if ((insPack.rowCount || 0) > 0) {
                resumen.bolsas_exteriores_packs_aseguradas.push({
                    pack_sku: cfgPack.packSkuUpper,
                    insumo_id: cfgPack.insumoId,
                    listas_impactadas: insPack.rowCount
                });
            }
        }

        // 8. Exclusivo en Laboratorio (etiquetas_pruebas): limpiar carros inconclusos de prueba #3031 (vacío) y #3032 (GSGN sin confirmar)
        const dbNameRes = await client.query(`SELECT current_database() AS db_name`);
        const currentDb = dbNameRes.rows[0]?.db_name || '';

        if (currentDb === 'etiquetas_pruebas') {
            for (const testCarroId of [3031, 3032]) {
                const checkCarro = await client.query(`
                    SELECT id, fecha_confirmacion
                    FROM public.carros_produccion
                    WHERE id = $1 AND fecha_confirmacion IS NULL
                    FOR UPDATE
                `, [testCarroId]);

                if (checkCarro.rowCount > 0) {
                    // Revertir cualquier movimiento en stock_ventas_movimientos asociado al carro inconcluso
                    const svmRows = await client.query(`
                        SELECT id, articulo_numero, COALESCE(cantidad, 0) AS cantidad
                        FROM public.stock_ventas_movimientos
                        WHERE carro_id = $1
                    `, [testCarroId]);

                    for (const mov of svmRows.rows) {
                        const cantDelta = parseFloat(mov.cantidad) || 0;
                        if (Math.abs(cantDelta) > 0.0001 && mov.articulo_numero) {
                            await client.query(`
                                UPDATE public.stock_real_consolidado
                                SET stock_movimientos = ROUND((COALESCE(stock_movimientos, 0) - $1)::numeric, 4),
                                    ultima_actualizacion = NOW()
                                WHERE UPPER(BTRIM(articulo_numero)) = UPPER(BTRIM($2))
                            `, [cantDelta, mov.articulo_numero]);
                            await recalcularStockConsolidado(client, mov.articulo_numero);
                        }
                    }

                    await client.query(`DELETE FROM public.ingredientes_stock_usuarios WHERE origen_carro_id = $1`, [testCarroId]);
                    await client.query(`DELETE FROM public.stock_ventas_movimientos WHERE carro_id = $1`, [testCarroId]);
                    await client.query(`DELETE FROM public.carros_articulos WHERE carro_id = $1`, [testCarroId]);
                    await client.query(`DELETE FROM public.carros_produccion WHERE id = $1`, [testCarroId]);

                    resumen.carros_prueba_limpiados_lab.push(testCarroId);
                }
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
    ejecutarSaneamientoLinea6
};
