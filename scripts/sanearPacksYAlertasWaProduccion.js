#!/usr/bin/env node
/**
 * Script idempotente de saneamiento para Producción (y verificable en Laboratorio):
 *  a) Corrige BF24X50 en bunker_articulos (es_pack = true, pack_unidades = 24).
 *  b) Migra limpiamente BF24X150G -> BF3X50 ("BARRA Flor 3 x 50g", Pack x 3 (50g c/u),
 *     3 flowpacks #181 en receta y recálculo de costos) previa verificación de 0 pedidos.
 *  c) Limpia la alerta trabada del chat id=55 (5492216781162@c.us) y cualquier chat
 *     con ultimo_mensaje_from_me = true que haya quedado con esperando_respuesta = true.
 *
 * Uso:
 *   node scripts/sanearPacksYAlertasWaProduccion.js          (Modo simulación / solo lectura)
 *   node scripts/sanearPacksYAlertasWaProduccion.js --apply  (Aplica en BD dentro de transacción)
 */

require('dotenv').config();
const db = require('../src/produccion/config/database');
const crmWhatsappDb = require('../src/services/crmWhatsappDbService');
const { calcularEstructuraCostosNodo } = require('../src/produccion/services/nodosBarrialesService');

async function main() {
    const apply = process.argv.includes('--apply');
    console.log('==================================================================');
    console.log(`🧹 SANEAMIENTO PACKS BARRITAS & ALERTAS WA (${apply ? 'APPLY' : 'DRY-RUN'})`);
    console.log('==================================================================');

    const resumen = {
        modo: apply ? 'APPLY' : 'DRY_RUN',
        bf24x50_corregido: false,
        bf24x150g_migrado_a_bf3x50: false,
        chat_55_limpiado: false,
        chats_salientes_limpiados: 0,
        notas: []
    };

    if (apply) {
        await crmWhatsappDb.asegurarTablasCrmWhatsapp();
    }

    const client = await db.connect();
    try {
        if (apply) {
            await client.query('BEGIN');
        }

        // ------------------------------------------------------------------
        // A) Corregir metadata multipack de BF24X50
        // ------------------------------------------------------------------
        const bf24Res = await client.query(
            `SELECT articulo_id, descripcion_generada, kilos_unidad, es_pack, pack_unidades
             FROM public.bunker_articulos
             WHERE UPPER(articulo_id) = 'BF24X50'
             LIMIT 1`
        );
        if (bf24Res.rows[0]) {
            const r24 = bf24Res.rows[0];
            if (!r24.es_pack || Number(r24.pack_unidades) !== 24) {
                console.log(`🔎 BF24X50 detectado con es_pack=${r24.es_pack}, pack_unidades=${r24.pack_unidades} -> actualizar a es_pack=true, pack_unidades=24`);
                if (apply) {
                    await client.query(
                        `UPDATE public.bunker_articulos
                         SET es_pack = true, pack_unidades = 24, updated_at = NOW()
                         WHERE UPPER(articulo_id) = 'BF24X50'`
                    );
                }
                resumen.bf24x50_corregido = true;
            } else {
                resumen.notas.push('BF24X50 ya tenía es_pack=true y pack_unidades=24.');
            }
        } else {
            resumen.notas.push('BF24X50 no encontrado en bunker_articulos.');
        }

        // ------------------------------------------------------------------
        // B) Migrar BF24X150G -> BF3X50 ("BARRA Flor 3 x 50g") con 3 flowpacks #181
        // ------------------------------------------------------------------
        const baOldRes = await client.query(
            `SELECT * FROM public.bunker_articulos WHERE UPPER(articulo_id) = 'BF24X150G' LIMIT 1`
        );
        const baNewRes = await client.query(
            `SELECT * FROM public.bunker_articulos WHERE UPPER(articulo_id) = 'BF3X50' LIMIT 1`
        );
        const nacOldRes = await client.query(
            `SELECT * FROM public.nodos_articulos_catalogo WHERE UPPER(sku_nodo) = 'BF24X150G' LIMIT 1`
        );

        if (baOldRes.rows.length > 0 || nacOldRes.rows.length > 0) {
            const nacRow = nacOldRes.rows[0] || null;
            const catId = nacRow ? Number(nacRow.id) : null;

            const pedChk = await client.query(
                `SELECT COUNT(*)::int AS c
                 FROM public.nodos_pedidos_items
                 WHERE ($1::int IS NOT NULL AND articulo_catalogo_id = $1::int)`,
                [catId]
            );
            const cantPedidos = Number(pedChk.rows[0]?.c || 0);
            if (cantPedidos > 0) {
                throw new Error(`Abortado: existen ${cantPedidos} ítems de pedidos históricos sobre BF24X150G (catalogo id=${catId}).`);
            }

            if (baNewRes.rows.length > 0) {
                resumen.notas.push('BF3X50 ya existe en bunker_articulos; no se duplica.');
            } else {
                const baOld = baOldRes.rows[0];
                const nuevaDesc = 'BARRA Flor 3 x 50g';
                const nuevaEtiqueta = 'Pack x 3 (50g c/u)';

                const env181Res = await client.query(`SELECT COALESCE(costo_patron, 18.16) AS costo FROM public.ingredientes WHERE id = 181 LIMIT 1`);
                const env180Id = nacRow?.insumo_envase_id ? Number(nacRow.insumo_envase_id) : 180;
                const envContRes = await client.query(`SELECT COALESCE(costo_patron, 45.96) AS costo FROM public.ingredientes WHERE id = $1 LIMIT 1`, [env180Id]);
                const costo181 = Number(env181Res.rows[0]?.costo || 18.16);
                const costoCont = Number(envContRes.rows[0]?.costo || 45.96);

                const calcNuevo = nacRow
                    ? calcularEstructuraCostosNodo({
                        costo_insumo_kg: nacRow.costo_insumo_kg,
                        kilos_unidad: nacRow.kilos_unidad,
                        costo_envase_unitario: costoCont,
                        cantidad_envases_unidad: nacRow.cantidad_envases_unidad || 1,
                        costo_envase_extra: Number((3 * costo181).toFixed(2)),
                        segundos_fraccionamiento: nacRow.segundos_fraccionamiento || 300,
                        valor_hora_aplicado: nacRow.valor_hora_aplicado || 7000,
                        margen_lamda_pct: nacRow.margen_lamda_pct || 22,
                        iva_pct: nacRow.iva_pct || 21,
                        iibb_pct: nacRow.iibb_pct || 4,
                        margen_sugerido_gestor_pct: nacRow.margen_sugerido_gestor_pct || 28
                    })
                    : null;

                console.log(`🔎 Migración BF24X150G -> BF3X50 (${nuevaDesc}, 3 flowpacks #181)${calcNuevo ? `, nuevo precio_base_nodo_final=$${calcNuevo.precio_base_nodo_final}` : ''}`);

                if (apply) {
                    // 1. Tabla legacy articulos
                    const artOld = await client.query(`SELECT * FROM public.articulos WHERE UPPER(numero) = 'BF24X150G' LIMIT 1`);
                    if (artOld.rows[0]) {
                        const ao = artOld.rows[0];
                        await client.query(
                            `INSERT INTO public.articulos (numero, nombre, codigo_barras)
                             VALUES ('BF3X50', $1, 'BF3X50')
                             ON CONFLICT (numero) DO UPDATE SET nombre = EXCLUDED.nombre`,
                            [nuevaDesc]
                        );
                        if (ao.codigo_barras && ao.codigo_barras !== ao.numero) {
                            await client.query(
                                `UPDATE public.articulos SET codigo_barras = $1 WHERE UPPER(numero) = 'BF3X50'`,
                                [ao.codigo_barras === 'BF24X150G' ? 'BF3X50' : ao.codigo_barras]
                            );
                        }
                    }

                    // 2. bunker_articulos
                    if (baOld) {
                        const propsNew = (baOld.propiedades_dinamicas && typeof baOld.propiedades_dinamicas === 'object')
                            ? {
                                ...baOld.propiedades_dinamicas,
                                sku_nodo: 'BF3X50',
                                presentacion_etiqueta_nodo: nuevaEtiqueta
                            }
                            : { sku_nodo: 'BF3X50', presentacion_etiqueta_nodo: nuevaEtiqueta };

                        await client.query(
                            `INSERT INTO public.bunker_articulos (
                                articulo_id, costo_base, porcentaje_iva, moneda, redondeo, mantener_utilidad,
                                rubro, sub_rubro, no_producido_por_lambda, kilos_unidad, es_pack, pack_hijo_codigo,
                                propiedades_dinamicas, descripcion, descripcion_generada, expresado_en_gramos,
                                expresado_en_unidades, pack_unidades, familia_id, estrategia_busqueda_json,
                                updated_at, codigo_barras, es_combo, firma_combo
                            ) VALUES (
                                'BF3X50', $1, $2, $3, $4, $5,
                                $6, $7, $8, $9, true, $10,
                                $11::jsonb, $12, $13, true,
                                false, 3, $14, $15,
                                NOW(), 'BF3X50', COALESCE($16, false), $17
                            )`,
                            [
                                baOld.costo_base,
                                baOld.porcentaje_iva,
                                baOld.moneda,
                                baOld.redondeo,
                                baOld.mantener_utilidad,
                                baOld.rubro,
                                baOld.sub_rubro,
                                baOld.no_producido_por_lambda,
                                baOld.kilos_unidad,
                                baOld.pack_hijo_codigo,
                                JSON.stringify(propsNew),
                                baOld.descripcion,
                                nuevaDesc,
                                baOld.familia_id,
                                baOld.estrategia_busqueda_json ? JSON.stringify(baOld.estrategia_busqueda_json) : null,
                                baOld.es_combo,
                                baOld.firma_combo
                            ]
                        );
                    }

                    // 3. Reapuntar tablas hijas
                    await client.query(
                        `UPDATE public.bunker_lista_articulos SET articulo_numero = 'BF3X50' WHERE UPPER(articulo_numero) = 'BF24X150G'`
                    );
                    await client.query(
                        `UPDATE public.stock_real_consolidado
                         SET articulo_numero = 'BF3X50', codigo_barras = 'BF3X50', descripcion = $1, es_pack = true
                         WHERE UPPER(articulo_numero) = 'BF24X150G'`,
                        [nuevaDesc]
                    );

                    // 4. Recetas y flowpacks #181 -> 3 unidades
                    const recUpd = await client.query(
                        `UPDATE public.recetas
                         SET articulo_numero = 'BF3X50', descripcion = $1
                         WHERE UPPER(articulo_numero) = 'BF24X150G'
                         RETURNING id`,
                        [nuevaDesc]
                    );
                    for (const rr of recUpd.rows) {
                        await client.query(
                            `UPDATE public.receta_ingredientes
                             SET cantidad = 3
                             WHERE receta_id = $1 AND ingrediente_id = 181`,
                            [rr.id]
                        );
                    }

                    // 5. Catálogo Nodos + Propuestas + Imágenes base
                    if (nacRow && calcNuevo) {
                        await client.query(
                            `UPDATE public.nodos_articulos_catalogo
                             SET sku_nodo = 'BF3X50',
                                 nombre_publico = $1,
                                 nomenclatura_bunker = $1,
                                 presentacion_etiqueta = $2,
                                 articulo_bunker_origen_codigo = 'BF3X50',
                                 costo_envase_aplicado = $3,
                                 costo_puro_total = $4,
                                 precio_base_nodo_neto = $5,
                                 precio_base_nodo_final = $6,
                                 precio_sugerido_vecino = $7,
                                 updated_at = NOW()
                             WHERE id = $8`,
                            [
                                nuevaDesc,
                                nuevaEtiqueta,
                                calcNuevo.costo_envase_aplicado,
                                calcNuevo.costo_puro_total,
                                calcNuevo.precio_base_nodo_neto,
                                calcNuevo.precio_base_nodo_final,
                                calcNuevo.precio_sugerido_vecino,
                                nacRow.id
                            ]
                        );

                        await client.query(
                            `UPDATE public.nodos_propuestas_fracciones
                             SET respuesta_lamda = REPLACE(REPLACE(respuesta_lamda, 'BF24X150G', 'BF3X50'), 'BARRA Flor 24 x 150g', $1),
                                 updated_at = NOW()
                             WHERE articulo_catalogo_id = $2`,
                            [nuevaDesc, nacRow.id]
                        );
                    }

                    await client.query(
                        `UPDATE public.lamda_imagenes_base
                         SET articulo_sku = 'BF3X50', updated_at = NOW()
                         WHERE UPPER(COALESCE(articulo_sku, '')) = 'BF24X150G'`
                    ).catch(() => {});

                    // 6. Eliminar filas viejas BF24X150G ya migradas
                    await client.query(`DELETE FROM public.bunker_articulos WHERE UPPER(articulo_id) = 'BF24X150G'`);
                    await client.query(`DELETE FROM public.articulos WHERE UPPER(numero) = 'BF24X150G'`);
                }
                resumen.bf24x150g_migrado_a_bf3x50 = true;
            }
        } else {
            resumen.notas.push('No existe BF24X150G en este entorno (no requiere migración).');
        }

        // ------------------------------------------------------------------
        // C) Limpiar alerta trabada chat id=55 y chats con ultimo_mensaje_from_me=true
        // ------------------------------------------------------------------
        const hasColsRes = await client.query(`
            SELECT COUNT(*)::int AS c
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'crm_whatsapp_chats'
              AND column_name IN ('atendido_hasta_at', 'marcado_pendiente_manual')
        `);
        const tieneNuevasColsWa = Number(hasColsRes.rows[0]?.c || 0) === 2;

        const c55Res = await client.query(
            `SELECT id, chat_id, esperando_respuesta, no_leidos, ultimo_mensaje_at
             FROM public.crm_whatsapp_chats
             WHERE chat_id = '5492216781162@c.us'
             LIMIT 1`
        );
        if (c55Res.rows[0]) {
            const c55 = c55Res.rows[0];
            const ul55 = c55.ultimo_mensaje_at ? new Date(c55.ultimo_mensaje_at).toISOString() : '';
            // Limpiar únicamente si sigue clavado en el mensaje del 24/11/2026 (antes de 2026-11-25T15:50Z)
            if ((c55.esperando_respuesta || Number(c55.no_leidos || 0) > 0) && (!ul55 || ul55 <= '2026-11-25T15:50:00.000Z')) {
                console.log(`🔎 Chat id=${c55.id} (${c55.chat_id}) trabado con esperando_respuesta=${c55.esperando_respuesta}, no_leidos=${c55.no_leidos} -> apagar con atendido_hasta_at`);
                if (apply) {
                    if (tieneNuevasColsWa) {
                        await client.query(
                            `UPDATE public.crm_whatsapp_chats
                             SET esperando_respuesta = false,
                                 no_leidos = 0,
                                 marcado_pendiente_manual = false,
                                 atendido_hasta_at = GREATEST(NOW(), COALESCE(ultimo_mensaje_at, NOW())),
                                 updated_at = NOW()
                             WHERE id = $1`,
                            [c55.id]
                        );
                    } else {
                        await client.query(
                            `UPDATE public.crm_whatsapp_chats
                             SET esperando_respuesta = false, no_leidos = 0, updated_at = NOW()
                             WHERE id = $1`,
                            [c55.id]
                        );
                    }
                }
                resumen.chat_55_limpiado = true;
            }
        }

        const condManual = tieneNuevasColsWa ? 'AND COALESCE(marcado_pendiente_manual, false) = false' : '';
        const salChk = await client.query(
            `SELECT COUNT(*)::int AS c
             FROM public.crm_whatsapp_chats
             WHERE esperando_respuesta = true
               AND ultimo_mensaje_from_me = true
               ${condManual}`
        );
        const cantSalientes = Number(salChk.rows[0]?.c || 0);
        if (cantSalientes > 0) {
            console.log(`🔎 Detectados ${cantSalientes} chats con ultimo_mensaje_from_me=true y esperando_respuesta=true -> limpiar`);
            if (apply) {
                if (tieneNuevasColsWa) {
                    await client.query(
                        `UPDATE public.crm_whatsapp_chats
                         SET esperando_respuesta = false,
                             no_leidos = 0,
                             atendido_hasta_at = GREATEST(COALESCE(atendido_hasta_at, to_timestamp(0)), COALESCE(ultimo_mensaje_at, NOW())),
                             updated_at = NOW()
                         WHERE esperando_respuesta = true
                           AND ultimo_mensaje_from_me = true
                           AND COALESCE(marcado_pendiente_manual, false) = false`
                    );
                } else {
                    await client.query(
                        `UPDATE public.crm_whatsapp_chats
                         SET esperando_respuesta = false, no_leidos = 0, updated_at = NOW()
                         WHERE esperando_respuesta = true AND ultimo_mensaje_from_me = true`
                    );
                }
            }
            resumen.chats_salientes_limpiados = cantSalientes;
        }

        if (apply) {
            await client.query('COMMIT');
        }
        console.log('✅ RESULTADO:', JSON.stringify(resumen, null, 2));
    } catch (err) {
        if (apply) {
            await client.query('ROLLBACK').catch(() => {});
        }
        console.error('❌ ERROR en saneamiento:', err.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await db.end().catch(() => {});
    }
}

main();
