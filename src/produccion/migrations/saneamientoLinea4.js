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
        ingredientes_puente_ldn4_reconectados: 0,
        espejos_bunker_backfill: 0,
        emb_gz6u9k_kilos_unidad_restaurado: 0,
        emb_gz6u9k_residuo_saneado: false,
        fracciones_atys_incorporadas_bunker: [],
        bolsas_asignadas_atys: [],
        listas_inicializadas_atys: 0,
        sugeridos_ap_normalizados: 0,
        kilos_unidad_src_normalizados: 0,
        stock_domicilio_depurado: 0,
        bolsas_pack_quitadas_de_unitarias: [],
        insumos_pack_padre_asegurados: []
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

        // 4. Proteger todos los ingredientes puente sellados de LDN4 y completar espejos faltantes
        //    en ingrediente_bunker_articulos (incluye #18 CCTGXK, #41 CCTSGXK, #123 APTSPGXK, etc.).
        const puentesSelladosLdn4 = [
            { id: 18, apSku: 'CCTGXK' },
            { id: 38, apSku: 'APTSPGXKPM' },
            { id: 41, apSku: 'CCTSGXK' },
            { id: 57, apSku: 'APTPGXK' },
            { id: 123, apSku: 'APTSPGXK' },
            { id: 166, apSku: 'EMB-GZ6U9K' }
        ];

        for (const puente of puentesSelladosLdn4) {
            const checkApExists = await client.query(`
                SELECT articulo_id FROM public.bunker_articulos WHERE UPPER(BTRIM(articulo_id)) = $1 LIMIT 1
            `, [puente.apSku]);

            if (checkApExists.rowCount > 0) {
                const apSkuReal = checkApExists.rows[0].articulo_id;
                const updIng = await client.query(`
                    UPDATE public.ingredientes
                    SET articulo_vinculado_numero = $1
                    WHERE id = $2
                      AND COALESCE(UPPER(BTRIM(articulo_vinculado_numero)), '') <> $3
                    RETURNING id
                `, [apSkuReal, puente.id, puente.apSku]);

                const count = updIng.rowCount || 0;
                resumen.ingredientes_puente_ldn4_reconectados += count;
                if (puente.id === 123) {
                    resumen.ingrediente_123_reconectado = count;
                }

                await client.query(`
                    INSERT INTO public.ingrediente_bunker_articulos (ingrediente_id, bunker_articulo_id)
                    SELECT $1, $2
                    WHERE EXISTS (SELECT 1 FROM public.ingredientes WHERE id = $1)
                    ON CONFLICT (ingrediente_id, bunker_articulo_id) DO NOTHING
                `, [puente.id, apSkuReal]);
            }
        }

        // Backfill global idempotente: todo ingrediente con articulo_vinculado_numero válido
        // en bunker_articulos debe tener su fila espejo en ingrediente_bunker_articulos.
        const insBackfill = await client.query(`
            INSERT INTO public.ingrediente_bunker_articulos (ingrediente_id, bunker_articulo_id)
            SELECT i.id, ba.articulo_id
            FROM public.ingredientes i
            JOIN public.bunker_articulos ba ON UPPER(BTRIM(ba.articulo_id)) = UPPER(BTRIM(i.articulo_vinculado_numero))
            WHERE NULLIF(BTRIM(COALESCE(i.articulo_vinculado_numero, '')), '') IS NOT NULL
            ON CONFLICT (ingrediente_id, bunker_articulo_id) DO NOTHING
        `);
        resumen.espejos_bunker_backfill = insBackfill.rowCount || 0;

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

        // 6. Incorporación canónica e idempotente de las fracciones reales de planta ATYSX1 (1 kg) y ATySx2 (2 kg)
        //    clonando la anatomía oficial del Diccionario Búnker de su hermana ATySx5 (Caso A — 0 alertas estructura_desfasada)
        const hermanaAtys5Res = await client.query(`
            SELECT articulo_id, descripcion, familia_id, rubro, sub_rubro, porcentaje_iva, propiedades_dinamicas
            FROM public.bunker_articulos
            WHERE UPPER(BTRIM(articulo_id)) = 'ATYSX5'
            LIMIT 1
        `);
        const ing123Res = await client.query(`
            SELECT id, nombre, COALESCE(costo_patron, 0) AS costo_patron
            FROM public.ingredientes
            WHERE id = 123
            LIMIT 1
        `);

        if (hermanaAtys5Res.rowCount > 0 && ing123Res.rowCount > 0) {
            const baseHermana = hermanaAtys5Res.rows[0];
            const costoIng123 = parseFloat(ing123Res.rows[0].costo_patron) || 0;
            const propsBase = baseHermana.propiedades_dinamicas || {
                familia_id: 1,
                familia_nombre: 'Frutos Secos',
                articulo_principal: 'ALMENDRA',
                incluir_familia: false,
                posicion_familia: 'ANTES',
                modo_display_familia: 'COMPLETO',
                modo_display_principal: 'COMPLETO',
                silencioso_principal: false,
                asistente_minutos: 5,
                asistente_colaborador_id: 5,
                presentacion_variable_wip: false,
                sufijo_wip: null,
                posiciones: {
                    pos_1: { eje: 'conformacion', valor: 'Peladas', posicion: 1, silencioso: true, abreviatura: 'PADA', modo_display: 'COMPLETO' },
                    pos_2: { eje: 'variedad', valor: 'Non Pareil', posicion: 2, silencioso: true, abreviatura: 'NP', modo_display: 'COMPLETO' },
                    pos_3: { eje: 'calibre', valor: '27/30', posicion: 3, silencioso: true, abreviatura: '27/30', modo_display: 'COMPLETO' },
                    pos_4: { eje: 'tratamiento', valor: 'Tostado y Salado', posicion: 4, silencioso: false, abreviatura: 'TOST/SAL', modo_display: 'ABREVIADO' }
                }
            };

            // ATYSX1 (1 kg) -> Bolsa 20 x 25 (#179, estándar de hermana ATX1 de 1 kg)
            // ATySx2 (2 kg) -> Bolsa 30 x 40 (#177, estándar de hermana ATx2 y todas las almendras de 2 kg)
            const definicionesAtys = [
                {
                    sku_canonico: 'ATYSX1',
                    kilos_unidad: 1.00,
                    descripcion_generada: 'ALMENDRA TOST/SAL x 1kg',
                    bolsa_ingrediente_id: 179,
                    hermana_listas_sku: 'ATX1'
                },
                {
                    sku_canonico: 'ATySx2',
                    kilos_unidad: 2.00,
                    descripcion_generada: 'ALMENDRA TOST/SAL x 2kg',
                    bolsa_ingrediente_id: 177,
                    hermana_listas_sku: 'ATx2'
                }
            ];

            for (const def of definicionesAtys) {
                const artPlantaRes = await client.query(`
                    SELECT a.numero, a.codigo_barras, r.id AS receta_id
                    FROM public.articulos a
                    LEFT JOIN public.recetas r ON UPPER(BTRIM(r.articulo_numero)) = UPPER(BTRIM(a.numero))
                    WHERE UPPER(BTRIM(a.numero)) = UPPER(BTRIM($1))
                    LIMIT 1
                `, [def.sku_canonico]);

                const skuReal = artPlantaRes.rowCount > 0 ? artPlantaRes.rows[0].numero : def.sku_canonico;
                const codigoBarras = artPlantaRes.rowCount > 0 ? (artPlantaRes.rows[0].codigo_barras || null) : null;
                let recetaId = artPlantaRes.rowCount > 0 ? artPlantaRes.rows[0].receta_id : null;

                if (!recetaId) {
                    const insRec = await client.query(`
                        INSERT INTO public.recetas (articulo_numero, descripcion, enlazado_externo, articulo_sugerido_numero)
                        VALUES ($1, $2, false, 'APTSPGXK')
                        RETURNING id
                    `, [skuReal, def.descripcion_generada]);
                    recetaId = insRec.rows[0].id;
                }

                // Asegurar materia prima #123 en receta_ingredientes
                const hasMp = await client.query(`
                    SELECT id FROM public.receta_ingredientes
                    WHERE receta_id = $1 AND ingrediente_id = 123
                    LIMIT 1
                `, [recetaId]);
                if (hasMp.rowCount === 0) {
                    await client.query(`
                        INSERT INTO public.receta_ingredientes (receta_id, nombre_ingrediente, unidad_medida, cantidad, ingrediente_id, fase_produccion)
                        VALUES ($1, $2, 'Kilo', $3, 123, 'externa')
                    `, [recetaId, ing123Res.rows[0].nombre, def.kilos_unidad]);
                }

                // Asegurar envase real (es_insumo = true) en receta_ingredientes si aún no tenía bolsa asignada
                const hasBag = await client.query(`
                    SELECT ri.id, ri.ingrediente_id, COALESCE(i.costo_patron, 0) AS costo_bolsa
                    FROM public.receta_ingredientes ri
                    JOIN public.ingredientes i ON i.id = ri.ingrediente_id
                    WHERE ri.receta_id = $1 AND COALESCE(i.es_insumo, false) = true
                    LIMIT 1
                `, [recetaId]);

                let costoBolsa = 0;
                if (hasBag.rowCount > 0) {
                    costoBolsa = parseFloat(hasBag.rows[0].costo_bolsa) || 0;
                } else {
                    const bagInfo = await client.query(`
                        SELECT id, nombre, COALESCE(costo_patron, 0) AS costo_patron
                        FROM public.ingredientes
                        WHERE id = $1 AND COALESCE(es_insumo, false) = true
                        LIMIT 1
                    `, [def.bolsa_ingrediente_id]);
                    if (bagInfo.rowCount > 0) {
                        costoBolsa = parseFloat(bagInfo.rows[0].costo_patron) || 0;
                        await client.query(`
                            INSERT INTO public.receta_ingredientes (receta_id, nombre_ingrediente, unidad_medida, cantidad, ingrediente_id, fase_produccion)
                            VALUES ($1, $2, 'Unidades', 1.000000, $3, 'externa')
                        `, [recetaId, bagInfo.rows[0].nombre, bagInfo.rows[0].id]);
                        resumen.bolsas_asignadas_atys.push({ sku: skuReal, bolsa_id: bagInfo.rows[0].id, bolsa_nombre: bagInfo.rows[0].nombre });
                    }
                }

                const costoBaseInicial = Number(((def.kilos_unidad * costoIng123) + costoBolsa).toFixed(2));
                const costoBaseKiloInicial = Number((costoBaseInicial / def.kilos_unidad).toFixed(4));

                // Upsert idempotente en public.bunker_articulos sin pisar costos/ediciones posteriores si ya existía
                const existeBa = await client.query(`
                    SELECT articulo_id FROM public.bunker_articulos
                    WHERE UPPER(BTRIM(articulo_id)) = UPPER(BTRIM($1))
                    LIMIT 1
                `, [skuReal]);

                if (existeBa.rowCount === 0) {
                    await client.query(`
                        INSERT INTO public.bunker_articulos (
                            articulo_id, descripcion, descripcion_generada, familia_id,
                            rubro, sub_rubro, kilos_unidad, codigo_barras, costo_base,
                            porcentaje_iva, no_producido_por_lambda, es_pack, pack_unidades, propiedades_dinamicas
                        ) VALUES (
                            $1, 'ALMENDRA', $2, 1,
                            'FRUTOS SECOS', 'ALMENDRAS', $3, $4, $5,
                            21.00, false, false, 1, $6::jsonb
                        )
                    `, [skuReal, def.descripcion_generada, def.kilos_unidad, codigoBarras, costoBaseInicial, JSON.stringify(propsBase)]);
                    resumen.fracciones_atys_incorporadas_bunker.push(skuReal);
                } else {
                    await client.query(`
                        UPDATE public.bunker_articulos
                        SET familia_id = COALESCE(familia_id, 1),
                            rubro = COALESCE(NULLIF(BTRIM(rubro), ''), 'FRUTOS SECOS'),
                            sub_rubro = COALESCE(NULLIF(BTRIM(sub_rubro), ''), 'ALMENDRAS'),
                            kilos_unidad = $2,
                            no_producido_por_lambda = false,
                            propiedades_dinamicas = COALESCE(propiedades_dinamicas, $3::jsonb)
                        WHERE UPPER(BTRIM(articulo_id)) = UPPER(BTRIM($1))
                    `, [skuReal, def.kilos_unidad, JSON.stringify(propsBase)]);
                }

                // Asegurar fila consistente en stock_real_consolidado
                await client.query(`
                    UPDATE public.stock_real_consolidado
                    SET kilos_unidad = $2,
                        descripcion = COALESCE(NULLIF(BTRIM(descripcion), ''), $3)
                    WHERE UPPER(BTRIM(articulo_numero)) = UPPER(BTRIM($1))
                      AND (kilos_unidad IS NULL OR ABS(COALESCE(kilos_unidad, 0) - $2) > 0.001)
                `, [skuReal, def.kilos_unidad, def.descripcion_generada]);

                // Inicializar listas de precios activas en bunker_lista_articulos tomando márgenes/disponibilidad de su hermana directa (ATX1 / ATx2)
                const listasActivasRes = await client.query(`
                    SELECT lp.id AS lista_id,
                           COALESCE(h.margen_ganancia, CASE WHEN lp.id = 8 THEN 25.0000 ELSE 15.0000 END) AS margen_ganancia,
                           COALESCE(h.costo_tiempo, CASE WHEN lp.id = 8 THEN 0.0000 ELSE 583.3300 END) AS costo_tiempo,
                           COALESCE(h.iva, 21.00) AS iva,
                           COALESCE(h.disponible, CASE WHEN lp.id = 8 THEN false ELSE true END) AS disponible,
                           COALESCE(h.modo_calculo, 'AUTOMATIC') AS modo_calculo,
                           COALESCE(h.modo_iva, 'COMPLETO') AS modo_iva,
                           COALESCE(h.mano_obra_activa, CASE WHEN lp.id = 8 THEN false ELSE true END) AS mano_obra_activa
                    FROM public.bunker_listas_precios lp
                    LEFT JOIN public.bunker_lista_articulos h
                      ON h.lista_id = lp.id AND UPPER(BTRIM(h.articulo_numero)) = UPPER(BTRIM($1))
                    WHERE COALESCE(lp.activa, true) = true
                    ORDER BY lp.id ASC
                `, [def.hermana_listas_sku]);

                for (const lRow of listasActivasRes.rows) {
                    const margen = parseFloat(lRow.margen_ganancia) || 0;
                    const moActiva = lRow.mano_obra_activa !== false;
                    const costoTiempo = moActiva ? (parseFloat(lRow.costo_tiempo) || 0) : 0;
                    const ivaPct = parseFloat(lRow.iva) || 21;
                    const factorIva = lRow.modo_iva === 'EXENTO' ? 1 : (lRow.modo_iva === 'MEDIO' ? (1 + (ivaPct / 200)) : (1 + (ivaPct / 100)));
                    const netoSinIva = costoBaseInicial + costoTiempo + (costoBaseInicial * (margen / 100));
                    const precioFinal = Number((netoSinIva * factorIva).toFixed(2));

                    const insLista = await client.query(`
                        INSERT INTO public.bunker_lista_articulos (
                            lista_id, articulo_numero, margen_ganancia, costo_base_sobrescrito,
                            costo_tiempo, iva, precio_final, disponible, modo_calculo, modo_iva, mano_obra_activa
                        ) VALUES (
                            $1, $2, $3, $4,
                            $5, $6, $7, $8, $9, $10, $11
                        )
                        ON CONFLICT (lista_id, articulo_numero) DO NOTHING
                    `, [
                        lRow.lista_id,
                        skuReal,
                        margen,
                        costoBaseKiloInicial,
                        parseFloat(lRow.costo_tiempo) || 0,
                        ivaPct,
                        precioFinal,
                        lRow.disponible,
                        lRow.modo_calculo,
                        lRow.modo_iva,
                        lRow.mano_obra_activa
                    ]);
                    resumen.listas_inicializadas_atys += (insLista.rowCount || 0);
                }
            }
        }

        // 7. Normalizar articulo_sugerido_numero = AP en todas las recetas de fracciones comerciales activas de los 6 circuitos de Línea 4
        const updSugeridos = await client.query(`
            UPDATE public.recetas r
            SET articulo_sugerido_numero = i.articulo_vinculado_numero
            FROM public.receta_ingredientes ri
            JOIN public.ingredientes i ON i.id = ri.ingrediente_id,
                 public.bunker_articulos ba
            WHERE ri.receta_id = r.id
              AND UPPER(BTRIM(ba.articulo_id)) = UPPER(BTRIM(r.articulo_numero))
              AND COALESCE(i.es_insumo, false) = false
              AND UPPER(BTRIM(COALESCE(i.articulo_vinculado_numero, ''))) IN ('APTPGXK', 'APTSPGXK', 'APTSPGXKPM', 'CCTGXK', 'CCTSGXK', 'EMB-GZ6U9K')
              AND COALESCE(ba.familia_id, 0) <> 42
              AND COALESCE(ba.no_producido_por_lambda, false) = false
              AND UPPER(BTRIM(ba.articulo_id)) <> UPPER(BTRIM(i.articulo_vinculado_numero))
              AND COALESCE(UPPER(BTRIM(r.articulo_sugerido_numero)), '') <> UPPER(BTRIM(i.articulo_vinculado_numero))
            RETURNING r.id, r.articulo_numero, i.articulo_vinculado_numero
        `);
        resumen.sugeridos_ap_normalizados = updSugeridos.rowCount || 0;

        // 8. Normalizar kilos_unidad nulos en stock_real_consolidado para fracciones activas de Línea 4 (ej. CCTX1)
        const updSrcKu = await client.query(`
            UPDATE public.stock_real_consolidado src
            SET kilos_unidad = ba.kilos_unidad
            FROM public.bunker_articulos ba
            WHERE UPPER(BTRIM(src.articulo_numero)) = UPPER(BTRIM(ba.articulo_id))
              AND COALESCE(ba.kilos_unidad, 0) > 0
              AND (src.kilos_unidad IS NULL OR src.kilos_unidad <= 0)
              AND EXISTS (
                  SELECT 1
                  FROM public.recetas r
                  JOIN public.receta_ingredientes ri ON ri.receta_id = r.id
                  JOIN public.ingredientes i ON i.id = ri.ingrediente_id
                  WHERE UPPER(BTRIM(r.articulo_numero)) = UPPER(BTRIM(ba.articulo_id))
                    AND UPPER(BTRIM(COALESCE(i.articulo_vinculado_numero, ''))) IN ('APTPGXK', 'APTSPGXK', 'APTSPGXKPM', 'CCTGXK', 'CCTSGXK', 'EMB-GZ6U9K')
              )
            RETURNING src.articulo_numero
        `);
        resumen.kilos_unidad_src_normalizados = updSrcKu.rowCount || 0;

        // Normalizar rubro y sub_rubro en hermanas ATx2, ATx5 y ATySx5 para consistencia total en Búnker
        await client.query(`
            UPDATE public.bunker_articulos
            SET rubro = COALESCE(NULLIF(BTRIM(rubro), ''), 'FRUTOS SECOS'),
                sub_rubro = COALESCE(NULLIF(BTRIM(sub_rubro), ''), 'ALMENDRAS')
            WHERE UPPER(BTRIM(articulo_id)) IN ('ATX2', 'ATX5', 'ATYSX5')
              AND (rubro IS NULL OR BTRIM(rubro) = '' OR sub_rubro IS NULL OR BTRIM(sub_rubro) = '')
        `);

        // 9. Depurar ingredientes exclusivos de Planta/Depósito en stock personal domicilio (ej. #59 Pasa Rubia 2 en usuario_id=5)
        // Conservando intactos los insumos reales de domicilio (Aceite de Coco #135, Miel #136 y cualquier envase personal asignado).
        const delStockDomicilio = await client.query(`
            DELETE FROM public.ingredientes_stock_usuarios isu
            WHERE isu.contexto_envase IS NULL
              AND NOT EXISTS (
                  SELECT 1
                  FROM public.articulos_produccion_externa_relacion rel
                  JOIN public.recetas r_up ON UPPER(BTRIM(r_up.articulo_numero)) = UPPER(BTRIM(rel.articulo_produccion_codigo))
                  JOIN public.receta_ingredientes ri_up ON ri_up.receta_id = r_up.id
                  WHERE ri_up.ingrediente_id = isu.ingrediente_id
              )
              AND NOT EXISTS (
                  SELECT 1
                  FROM public.ingredientes_stock_usuarios isu_env
                  WHERE isu_env.usuario_id = isu.usuario_id
                    AND isu_env.ingrediente_id = isu.ingrediente_id
                    AND isu_env.contexto_envase IS NOT NULL
              )
            RETURNING isu.id, isu.usuario_id, isu.ingrediente_id, isu.cantidad
        `);
        resumen.stock_domicilio_depurado = delStockDomicilio.rowCount || 0;

        // 10. Limpiar bolsas exteriores de pack prorrateadas (0.1 u de #177 Bolsa 30 x 40 o #178 Bolsa 20 x 30)
        // cargadas por error en recetas unitarias chicas de Línea 4 (CCTSx150, ATX150), garantizando que conserven
        // su bolsa unitaria (#180 Bolsa 15 x 18 x 1 u) y que el Pack Padre tenga su bolsa exterior en bunker_lista_insumos.
        const delBolsaPackUnitarias = await client.query(`
            DELETE FROM public.receta_ingredientes ri_pack
            USING public.recetas r,
                  public.ingredientes i_pack
            WHERE ri_pack.receta_id = r.id
              AND i_pack.id = ri_pack.ingrediente_id
              AND COALESCE(i_pack.es_insumo, false) = true
              AND ri_pack.cantidad > 0
              AND ri_pack.cantidad < 0.999
              AND i_pack.id IN (177, 178)
              AND EXISTS (
                  SELECT 1
                  FROM public.receta_ingredientes ri_base
                  JOIN public.ingredientes i_base ON i_base.id = ri_base.ingrediente_id
                  WHERE ri_base.receta_id = r.id
                    AND COALESCE(i_base.es_insumo, false) = false
                    AND UPPER(BTRIM(COALESCE(i_base.articulo_vinculado_numero, ''))) IN ('APTPGXK', 'APTSPGXK', 'APTSPGXKPM', 'CCTGXK', 'CCTSGXK', 'EMB-GZ6U9K')
              )
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
        resumen.bolsas_pack_quitadas_de_unitarias = delBolsaPackUnitarias.rows || [];

        const packsBolsaExterior = [
            { packSkuUpper: 'CCTS10X150', insumoId: '177', fallbackCosto: 159.40 },
            { packSkuUpper: 'AT10X150', insumoId: '178', fallbackCosto: 75.45 },
            { packSkuUpper: 'ATYS10X150', insumoId: '177', fallbackCosto: 159.40 }
        ];

        for (const cfgPack of packsBolsaExterior) {
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
                resumen.insumos_pack_padre_asegurados.push({
                    pack_sku: cfgPack.packSkuUpper,
                    insumo_id: cfgPack.insumoId,
                    listas_impactadas: insPack.rowCount
                });
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
