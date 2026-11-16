/**
 * Rutina SQL idempotente de saneamiento estructural para:
 *   - Línea de Negocio 5 (Barritas: BFXP -> BFX50G -> #141 -> BF24X50, pre-mezcla MPB y tarifa unitaria $175/un)
 *   - Línea de Negocio 3 (Mixes y Pre-mezclas: limpieza de doble bolsa #177 en los 5 Packs Padre,
 *     bolsa 30x40 en MFSPX2, articulo_sugerido_numero y fase_produccion = 'interna', preservando
 *     intactos los mixes en pausa #77 Mix BK y #107 Mix Almafrut).
 *
 * Segura para ejecutarse tanto en Laboratorio (etiquetas_pruebas) como al iniciar
 * el servicio de Producción en Nube / Standby (etiquetas).
 */
async function ejecutarSaneamientoLinea3y5(poolOrClient) {
    const usaPool = typeof poolOrClient.connect === 'function';
    const client = usaPool ? await poolOrClient.connect() : poolOrClient;

    const resumen = {
        linea5_bunker_pack_normalizados: [],
        linea5_src_pack_normalizados: [],
        linea5_sugerido_bf24x50: 0,
        linea5_fases_internas_actualizadas: 0,
        linea5_tarifa_matias_actualizada: 0,
        linea3_mfspx2_bolsa_corregida: 0,
        linea3_sugeridos_completados: [],
        linea3_fases_internas_actualizadas: 0,
        linea3_packs_padre_saneados: []
    };

    try {
        await client.query('BEGIN');

        // =========================================================================
        // BLOQUE A — LÍNEA DE NEGOCIO 5 (BARRITAS: BARRA FLOR)
        // =========================================================================

        // A.1 Fijar es_pack = false, pack_unidades = 1, pack_hijo_codigo = NULL en BFX50G y BF24X50
        const updL5Bunker = await client.query(`
            UPDATE public.bunker_articulos
            SET es_pack = false,
                pack_unidades = 1,
                pack_hijo_codigo = NULL
            WHERE UPPER(BTRIM(articulo_id)) IN ('BFX50G', 'BF24X50')
              AND (
                  COALESCE(es_pack, false) <> false
                  OR COALESCE(pack_unidades, 1) <> 1
                  OR pack_hijo_codigo IS NOT NULL
              )
            RETURNING articulo_id
        `);
        resumen.linea5_bunker_pack_normalizados = (updL5Bunker.rows || []).map(r => r.articulo_id);

        const updL5Src = await client.query(`
            UPDATE public.stock_real_consolidado
            SET es_pack = false,
                pack_unidades = 1,
                pack_hijo_codigo = NULL
            WHERE UPPER(BTRIM(articulo_numero)) IN ('BFX50G', 'BF24X50')
              AND (
                  COALESCE(es_pack, false) <> false
                  OR COALESCE(pack_unidades, 1) <> 1
                  OR pack_hijo_codigo IS NOT NULL
              )
            RETURNING articulo_numero
        `);
        resumen.linea5_src_pack_normalizados = (updL5Src.rows || []).map(r => r.articulo_numero);

        // A.2 Completar articulo_sugerido_numero = 'BFX50G' en BF24X50 (receta #153)
        const updSugBf24 = await client.query(`
            UPDATE public.recetas
            SET articulo_sugerido_numero = 'BFX50G'
            WHERE UPPER(BTRIM(articulo_numero)) = 'BF24X50'
              AND COALESCE(UPPER(BTRIM(articulo_sugerido_numero)), '') <> 'BFX50G'
            RETURNING id, articulo_numero
        `);
        resumen.linea5_sugerido_bf24x50 = updSugBf24.rowCount || 0;

        // A.3 Fijar fase_produccion = 'interna' en receta_ingredientes de BF24X50 y MPB
        const updFasesL5 = await client.query(`
            UPDATE public.receta_ingredientes ri
            SET fase_produccion = 'interna'
            FROM public.recetas r
            WHERE ri.receta_id = r.id
              AND UPPER(BTRIM(r.articulo_numero)) IN ('BF24X50', 'MPB')
              AND COALESCE(ri.fase_produccion, '') <> 'interna'
            RETURNING r.articulo_numero, ri.ingrediente_id
        `);
        resumen.linea5_fases_internas_actualizadas = updFasesL5.rowCount || 0;

        // A.4 Alinear tarifa activa de Matías (usuario_id = 5) para BFX50G: valor_por_unidad = 175.00, unidad_medida = 'un'
        //     (Solo migra si seguía en unidad_medida = 'kg' o valor 3500, preservando futuras tarifas editadas en 'un')
        const updTarifaL5 = await client.query(`
            UPDATE public.colaboradores_tarifas_rendimiento
            SET valor_por_unidad = 175.00,
                unidad_medida = 'un'
            WHERE usuario_id = 5
              AND UPPER(BTRIM(articulo_numero)) = 'BFX50G'
              AND activo = true
              AND (
                  LOWER(BTRIM(COALESCE(unidad_medida, ''))) <> 'un'
                  OR ABS(COALESCE(valor_por_unidad, 0) - 3500.00) < 0.01
              )
            RETURNING id, articulo_numero, valor_por_unidad, unidad_medida
        `);
        resumen.linea5_tarifa_matias_actualizada = updTarifaL5.rowCount || 0;

        // =========================================================================
        // BLOQUE B — LÍNEA DE NEGOCIO 3 (MIXES Y PRE-MEZCLAS INTERNAS)
        // (Preservando intactos #77 Mix BK -> MFSBKXK -> #159 y #107 Mix Almafrut -> MFSAFXK -> #158)
        // =========================================================================

        // B.1 En MFSPX2 (Mix F/SCOS Premiun x 2kg, receta #68), reemplazar #178 Bolsa 20 x 30 por 1 u de #177 Bolsa 30 x 40
        const recMfspx2Res = await client.query(`
            SELECT id
            FROM public.recetas
            WHERE UPPER(BTRIM(articulo_numero)) = 'MFSPX2'
            ORDER BY id ASC
            LIMIT 1
        `);
        if (recMfspx2Res.rowCount > 0) {
            const recMfspx2Id = recMfspx2Res.rows[0].id;
            const tiene178 = await client.query(`
                SELECT id FROM public.receta_ingredientes
                WHERE receta_id = $1 AND ingrediente_id = 178
            `, [recMfspx2Id]);

            if (tiene178.rowCount > 0) {
                const tiene177 = await client.query(`
                    SELECT id FROM public.receta_ingredientes
                    WHERE receta_id = $1 AND ingrediente_id = 177
                `, [recMfspx2Id]);

                if (tiene177.rowCount > 0) {
                    await client.query(`
                        DELETE FROM public.receta_ingredientes
                        WHERE receta_id = $1 AND ingrediente_id = 178
                    `, [recMfspx2Id]);
                    await client.query(`
                        UPDATE public.receta_ingredientes
                        SET cantidad = 1, unidad_medida = 'unidades', fase_produccion = 'interna'
                        WHERE receta_id = $1 AND ingrediente_id = 177
                    `, [recMfspx2Id]);
                } else {
                    await client.query(`
                        UPDATE public.receta_ingredientes
                        SET ingrediente_id = 177, cantidad = 1, unidad_medida = 'unidades', fase_produccion = 'interna'
                        WHERE receta_id = $1 AND ingrediente_id = 178
                    `, [recMfspx2Id]);
                }
                resumen.linea3_mfspx2_bolsa_corregida = 1;
            }
        }

        // B.2 Completar articulo_sugerido_numero en recetas unitarias donde estaba NULL:
        //     - 'MFSTXK' en MFSTx1, MFSTx2 y MFSTx5
        //     - 'MSXK' en MSx2
        const sugeridosTargets = [
            { skuUpper: 'MFSTX1', ap: 'MFSTXK' },
            { skuUpper: 'MFSTX2', ap: 'MFSTXK' },
            { skuUpper: 'MFSTX5', ap: 'MFSTXK' },
            { skuUpper: 'MSX2',   ap: 'MSXK' }
        ];
        for (const t of sugeridosTargets) {
            const updSug = await client.query(`
                UPDATE public.recetas
                SET articulo_sugerido_numero = $2
                WHERE UPPER(BTRIM(articulo_numero)) = $1
                  AND NULLIF(BTRIM(COALESCE(articulo_sugerido_numero, '')), '') IS NULL
                RETURNING id, articulo_numero, articulo_sugerido_numero
            `, [t.skuUpper, t.ap]);
            if ((updSug.rowCount || 0) > 0) {
                resumen.linea3_sugeridos_completados.push(...updSug.rows);
            }
        }

        // B.3 Fijar fase_produccion = 'interna' en APs de Mixes vigentes, Pre-mezclas de Granolas y fracciones unitarias de Mixes vigentes
        const updFasesL3 = await client.query(`
            UPDATE public.receta_ingredientes ri
            SET fase_produccion = 'interna'
            FROM public.recetas r
            WHERE ri.receta_id = r.id
              AND (
                  UPPER(BTRIM(r.articulo_numero)) IN ('MFSXK', 'MFSPXK', 'MFSTXK', 'MSXK', 'MCTXK', 'MFSE7030', 'MPGDSX7', 'MPGDFX6,9')
                  OR UPPER(BTRIM(COALESCE(r.articulo_sugerido_numero, ''))) IN ('MFSXK', 'MFSPXK', 'MFSTXK', 'MSXK', 'MCTXK', 'MFSE7030')
              )
              AND COALESCE(ri.fase_produccion, '') <> 'interna'
            RETURNING r.articulo_numero, ri.ingrediente_id
        `);
        resumen.linea3_fases_internas_actualizadas = updFasesL3.rowCount || 0;

        // B.4 Limpiar el doble cómputo histórico de #177 Bolsa 30 x 40 en los 5 Packs Padre de Mixes:
        //     MCT10X300 (-> MCTX300), MFS10X300G (-> MFSX300G), MFSP10X300 (-> MFSPx300),
        //     MFST10x300 (-> MFSTx300), MS10X300G (-> MSX300G).
        const bolsa177Res = await client.query(`
            SELECT COALESCE(costo_patron, 159.40) AS costo_patron
            FROM public.ingredientes
            WHERE id = 177
            LIMIT 1
        `);
        const costoBolsa177 = parseFloat(bolsa177Res.rows[0]?.costo_patron) || 159.40;

        const packsMixes = [
            { packUpper: 'MCT10X300',  hijoUpper: 'MCTX300' },
            { packUpper: 'MFS10X300G', hijoUpper: 'MFSX300G' },
            { packUpper: 'MFSP10X300', hijoUpper: 'MFSPX300' },
            { packUpper: 'MFST10X300', hijoUpper: 'MFSTX300' },
            { packUpper: 'MS10X300G',  hijoUpper: 'MSX300G' }
        ];

        for (const pm of packsMixes) {
            const packArtRes = await client.query(`
                SELECT articulo_id,
                       COALESCE(NULLIF(kilos_unidad, 0), 3.00) AS kilos_unidad,
                       COALESCE(NULLIF(pack_unidades, 0), 10) AS pack_unidades,
                       COALESCE(costo_base, 0) AS costo_base
                FROM public.bunker_articulos
                WHERE UPPER(BTRIM(articulo_id)) = $1
                LIMIT 1
            `, [pm.packUpper]);
            if (packArtRes.rowCount === 0) continue;

            const packArt = packArtRes.rows[0];
            const packKilos = parseFloat(packArt.kilos_unidad) || 3.00;
            const packUnidades = parseInt(packArt.pack_unidades, 10) || 10;

            const hijoArtRes = await client.query(`
                SELECT articulo_id,
                       COALESCE(NULLIF(kilos_unidad, 0), 0.30) AS kilos_unidad,
                       COALESCE(costo_base, 0) AS costo_base
                FROM public.bunker_articulos
                WHERE UPPER(BTRIM(articulo_id)) = $1
                LIMIT 1
            `, [pm.hijoUpper]);
            if (hijoArtRes.rowCount === 0) continue;

            const hijoArt = hijoArtRes.rows[0];
            const hijoKilos = parseFloat(hijoArt.kilos_unidad) || 0.30;

            const packListasRes = await client.query(`
                SELECT bla.id, bla.lista_id, bla.articulo_numero, bla.costo_base_sobrescrito,
                       bla.costo_tiempo, bla.mano_obra_activa, bla.margen_ganancia,
                       bla.iva, bla.modo_iva, bla.precio_final, bla.disponible,
                       COALESCE(lp.canal_comercial, 'MAYORISTA') AS canal_comercial
                FROM public.bunker_lista_articulos bla
                LEFT JOIN public.bunker_listas_precios lp ON lp.id = bla.lista_id
                WHERE UPPER(BTRIM(bla.articulo_numero)) = $1
                ORDER BY bla.lista_id ASC
            `, [pm.packUpper]);

            const hijoListasRes = await client.query(`
                SELECT bla.id, bla.lista_id, bla.costo_base_sobrescrito,
                       bla.costo_tiempo, bla.mano_obra_activa,
                       COALESCE((
                           SELECT SUM(bli.cantidad * bli.costo_unitario_capturado)
                           FROM public.bunker_lista_insumos bli
                           WHERE bli.lista_articulo_id = bla.id AND COALESCE(bli.incluido, true) = true
                       ), 0) AS costo_insumos_hijo
                FROM public.bunker_lista_articulos bla
                WHERE UPPER(BTRIM(bla.articulo_numero)) = $1
            `, [pm.hijoUpper]);
            const hijoPorLista = new Map(hijoListasRes.rows.map(r => [Number(r.lista_id), r]));
            const hijoL1 = hijoPorLista.get(1) || hijoListasRes.rows[0] || null;

            let costoPuroPackLista1 = null;
            let listasActualizadasPack = 0;

            for (const pla of packListasRes.rows) {
                // 1) Asegurar que #177 Bolsa 30 x 40 esté activa exactamente 1 vez en bunker_lista_insumos de esta lista
                const insRows = await client.query(`
                    SELECT id, cantidad, costo_unitario_capturado, incluido
                    FROM public.bunker_lista_insumos
                    WHERE lista_articulo_id = $1
                      AND BTRIM(insumo_articulo_numero) = '177'
                    ORDER BY id ASC
                `, [pla.id]);

                if (insRows.rowCount === 0) {
                    await client.query(`
                        INSERT INTO public.bunker_lista_insumos (
                            lista_articulo_id, insumo_articulo_numero, cantidad, costo_unitario_capturado, incluido
                        ) VALUES ($1, '177', 1.0000, $2, true)
                    `, [pla.id, costoBolsa177]);
                } else {
                    const keepId = insRows.rows[0].id;
                    if (insRows.rowCount > 1) {
                        const dupIds = insRows.rows.slice(1).map(r => r.id);
                        await client.query(`DELETE FROM public.bunker_lista_insumos WHERE id = ANY($1::int[])`, [dupIds]);
                    }
                    const firstRow = insRows.rows[0];
                    if (firstRow.incluido !== true || Math.abs((parseFloat(firstRow.cantidad) || 0) - 1) > 0.0001) {
                        await client.query(`
                            UPDATE public.bunker_lista_insumos
                            SET cantidad = 1.0000, incluido = true
                            WHERE id = $1
                        `, [keepId]);
                    }
                }

                // 2) Calcular costo operativo puro de 10 hijos en esta lista (sin bolsa exterior #177)
                const hla = hijoPorLista.get(Number(pla.lista_id)) || hijoL1;
                if (!hla) continue;

                const cbsHijoKilo = (hla.costo_base_sobrescrito !== null && parseFloat(hla.costo_base_sobrescrito) > 0)
                    ? parseFloat(hla.costo_base_sobrescrito)
                    : ((parseFloat(hijoArt.costo_base) || 0) / hijoKilos);
                const moHijo = hla.mano_obra_activa !== false ? (parseFloat(hla.costo_tiempo) || 0) : 0;
                const insHijo = parseFloat(hla.costo_insumos_hijo) || 0;
                const costoOperativoUnitarioHijo = (cbsHijoKilo * hijoKilos) + insHijo + moHijo;
                const costoPuroPack = costoOperativoUnitarioHijo * packUnidades;

                if (Number(pla.lista_id) === 1 || costoPuroPackLista1 === null) {
                    if (Number(pla.lista_id) === 1) costoPuroPackLista1 = costoPuroPack;
                    else if (costoPuroPackLista1 === null) costoPuroPackLista1 = costoPuroPack;
                }

                const cbsPuroKilo = Number((costoPuroPack / packKilos).toFixed(4));
                const cbsActualKilo = parseFloat(pla.costo_base_sobrescrito) || 0;
                const bultoActualEnLista = cbsActualKilo * packKilos;

                // Solo reescribir si tenía el residuo histórico de la bolsa incrustada (o desajuste > $0.02 frente a 10 × hijo actual en BD)
                // De este modo es 100% idempotente en ejecuciones sucesivas.
                const insPackRes = await client.query(`
                    SELECT COALESCE(SUM(cantidad * costo_unitario_capturado), 0) AS total_ins
                    FROM public.bunker_lista_insumos
                    WHERE lista_articulo_id = $1 AND COALESCE(incluido, true) = true
                `, [pla.id]);
                const costoInsumosExteriorLista = parseFloat(insPackRes.rows[0]?.total_ins) || costoBolsa177;

                const margen = parseFloat(pla.margen_ganancia) || 0;
                const moPack = pla.mano_obra_activa !== false ? (parseFloat(pla.costo_tiempo) || 0) : 0;
                const ivaPct = parseFloat(pla.iva) || 21;
                const factorIva = pla.modo_iva === 'EXENTO'
                    ? 1
                    : (pla.modo_iva === 'MEDIO' ? (1 + (ivaPct / 200)) : (1 + (ivaPct / 100)));
                const costoNetoConBolsaUnica = costoPuroPack + costoInsumosExteriorLista;
                const nuevoPrecioFinal = Number((((costoNetoConBolsaUnica * (1 + margen / 100)) + moPack) * factorIva).toFixed(2));
                const precioActual = parseFloat(pla.precio_final) || 0;

                if (Math.abs(bultoActualEnLista - costoPuroPack) > 0.02 || Math.abs(nuevoPrecioFinal - precioActual) > 0.02) {
                    await client.query(`
                        UPDATE public.bunker_lista_articulos
                        SET costo_base_sobrescrito = $1,
                            precio_final = $2,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = $3
                    `, [cbsPuroKilo, nuevoPrecioFinal, pla.id]);
                    listasActualizadasPack++;

                    if (String(pla.canal_comercial || '').toUpperCase() === 'NODOS' && pla.disponible !== false) {
                        await client.query(`
                            UPDATE public.nodos_articulos_catalogo
                            SET precio_base_nodo = $1,
                                updated_at = CURRENT_TIMESTAMP
                            WHERE UPPER(BTRIM(bunker_articulo_id)) = $2
                        `, [nuevoPrecioFinal, pm.packUpper]).catch(() => {});
                    }
                }
            }

            if (costoPuroPackLista1 !== null) {
                const costoBasePuroRed2 = Number(costoPuroPackLista1.toFixed(2));
                const costoBaseActualBd = parseFloat(packArt.costo_base) || 0;
                let bunkerBaseActualizado = false;
                if (Math.abs(costoBaseActualBd - costoBasePuroRed2) > 0.02) {
                    await client.query(`
                        UPDATE public.bunker_articulos
                        SET costo_base = $1,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE articulo_id = $2
                    `, [costoBasePuroRed2, packArt.articulo_id]);
                    bunkerBaseActualizado = true;
                }

                if (bunkerBaseActualizado || listasActualizadasPack > 0) {
                    resumen.linea3_packs_padre_saneados.push({
                        pack_sku: packArt.articulo_id,
                        costo_base_anterior: costoBaseActualBd,
                        costo_base_puro: costoBasePuroRed2,
                        listas_actualizadas: listasActualizadasPack
                    });
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
    ejecutarSaneamientoLinea3y5
};
