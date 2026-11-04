/**
 * SERVICIO CENTRALIZADO DE COSTO INTEGRADO BÚNKER (Sistema LAMDA)
 * 
 * Implementa la cascada financiera fidedigna según los 6 Flujos de Mercadería:
 * 1. Costo Base por Kilo (costo_base_sobrescrito > receta de ingredientes > lote reciente > costo patrón maestro)
 * 2. Costo Presentación (Costo Base / Kilo * Factor Presentación en Kg)
 * 3. Insumos de Empaque (Bolsas, etiquetas, precintos incluidos en bunker_lista_insumos)
 * 4. Costo Mano de Obra / Tiempo (costo_tiempo si mano_obra_activa = true)
 * 
 * Total Costo Integrado Unitario = Costo Presentación + Insumos + Mano de Obra
 */

/**
 * Calcula el costo integrado unitario de un artículo para una lista de precios dada.
 * @param {object} db - Cliente o Pool de PostgreSQL
 * @param {string|number} articuloRaw - Código de barras, SKU o ID de ingrediente
 * @param {number} clienteListaId - ID de la lista de precios del cliente (default: 1)
 * @returns {Promise<{ costo_unitario: number, c_base_kilo: number, c_presentacion: number, c_insumos: number, c_tiempo: number, fuente: string, articulo_id: string }>}
 */
async function calcularCostoIntegradoArticulo(db, articuloRaw, clienteListaId = 1) {
    if (!articuloRaw) {
        return { costo_unitario: 0, c_base_kilo: 0, c_presentacion: 0, c_insumos: 0, c_tiempo: 0, fuente: 'SIN_ARTICULO', articulo_id: null };
    }

    const artStr = String(articuloRaw).trim();
    const artStrClean = artStr.replace(/^↳ \(Stock Cliente\)\s*/i, '').replace(/\s*\(Desc\. esp\. \d+%\)$/i, '').trim();
    const listaId = parseInt(clienteListaId) || 1;

    try {
        // 1. Buscar en bunker_articulos y articulos por código, barra o SKU
        const queryBA = `
            SELECT 
                ba.articulo_id,
                ba.descripcion,
                ba.descripcion_generada,
                ba.kilos_unidad,
                ba.costo_base as ba_costo_base,
                ba.pack_hijo_codigo,
                ba.pack_unidades,
                a.numero as a_numero,
                a.nombre as a_nombre
            FROM public.articulos a
            LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = a.numero
            WHERE a.codigo_barras = $1 
               OR a.numero = $1 
               OR ba.articulo_id = $1
            LIMIT 1
        `;
        let resBA = await db.query(queryBA, [artStr]);

        if (resBA.rows.length === 0) {
            // Intentar match por descripción en bunker_articulos
            resBA = await db.query(`
                SELECT 
                    ba.articulo_id,
                    ba.descripcion,
                    ba.descripcion_generada,
                    ba.kilos_unidad,
                    ba.costo_base as ba_costo_base,
                    ba.pack_hijo_codigo,
                    ba.pack_unidades,
                    ba.articulo_id as a_numero,
                    ba.descripcion as a_nombre
                FROM public.bunker_articulos ba
                WHERE ba.articulo_id = $1
                   OR LOWER(TRIM(ba.descripcion_generada)) = LOWER(TRIM($1))
                   OR LOWER(TRIM(ba.descripcion)) = LOWER(TRIM($1))
                   OR LOWER(TRIM(ba.descripcion_generada)) = LOWER(TRIM($2))
                   OR LOWER(TRIM(ba.descripcion)) = LOWER(TRIM($2))
                LIMIT 1
            `, [artStr, artStrClean]);
        }

        if (resBA.rows.length === 0) {
            // Intentar match por nombre en articulos
            resBA = await db.query(`
                SELECT 
                    ba.articulo_id,
                    ba.descripcion,
                    ba.descripcion_generada,
                    ba.kilos_unidad,
                    ba.costo_base as ba_costo_base,
                    ba.pack_hijo_codigo,
                    ba.pack_unidades,
                    a.numero as a_numero,
                    a.nombre as a_nombre
                FROM public.articulos a
                LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = a.numero
                WHERE LOWER(TRIM(a.nombre)) = LOWER(TRIM($1))
                   OR LOWER(TRIM(a.nombre)) = LOWER(TRIM($2))
                LIMIT 1
            `, [artStr, artStrClean]);
        }

        if (resBA.rows.length > 0 && (resBA.rows[0].articulo_id || resBA.rows[0].a_numero)) {
            const baRow = resBA.rows[0];
            const artId = baRow.articulo_id || baRow.a_numero;
            const factor = parseFloat(baRow.kilos_unidad) > 0 ? parseFloat(baRow.kilos_unidad) : 1.0;

            // 2. Buscar configuración en bunker_lista_articulos (priorizando lista del cliente, fallback a lista 1)
            const queryLA = `
                SELECT 
                    la.id as lista_articulo_id,
                    la.lista_id,
                    la.costo_base_sobrescrito,
                    la.costo_tiempo,
                    la.mano_obra_activa,
                    la.fuente_costo_default
                FROM public.bunker_lista_articulos la
                WHERE la.articulo_numero = $1 AND (la.lista_id = $2 OR la.lista_id = 1)
                ORDER BY CASE WHEN la.lista_id = $2 THEN 1 ELSE 2 END ASC
                LIMIT 1
            `;
            const resLA = await db.query(queryLA, [artId, listaId]);
            const la = resLA.rows.length > 0 ? resLA.rows[0] : null;

            // 3. Buscar si el artículo posee receta
            let costoRecetaTotal = 0;
            let codigoReceta = artId;

            let queryReceta = `
                SELECT r.id, 
                       (SELECT SUM(ri.cantidad * COALESCE(i.costo_patron, 0)) 
                        FROM public.receta_ingredientes ri 
                        JOIN public.ingredientes i ON i.id = ri.ingrediente_id 
                        WHERE ri.receta_id = r.id) as costo_receta_total
                FROM public.recetas r
                WHERE r.articulo_numero = $1
                ORDER BY r.fecha_creacion DESC
                LIMIT 1
            `;
            let resReceta = await db.query(queryReceta, [codigoReceta]);

            // Herencia de receta para packs si no tiene receta directa
            if (resReceta.rows.length === 0 && baRow.pack_hijo_codigo && parseInt(baRow.pack_unidades || 0) <= 1) {
                codigoReceta = baRow.pack_hijo_codigo;
                resReceta = await db.query(queryReceta, [codigoReceta]);
            }

            if (resReceta.rows.length > 0 && resReceta.rows[0].costo_receta_total !== null) {
                costoRecetaTotal = parseFloat(resReceta.rows[0].costo_receta_total) || 0;
            }

            // 4. Determinar Costo Base por Kilo (cBase)
            let cBaseKilo = 0;
            let fuente = 'MAESTRA';

            if (la && la.costo_base_sobrescrito && parseFloat(la.costo_base_sobrescrito) > 0) {
                cBaseKilo = parseFloat(la.costo_base_sobrescrito);
                fuente = 'LISTA_SOBRESCRITO';
            } else if (baRow.pack_hijo_codigo && parseInt(baRow.pack_unidades || 0) > 1 && baRow.pack_hijo_codigo !== artId) {
                const packUnidades = parseInt(baRow.pack_unidades || 1);
                const resHijo = await calcularCostoIntegradoArticulo(db, baRow.pack_hijo_codigo, listaId);
                if (resHijo && resHijo.costo_unitario > 0) {
                    cBaseKilo = (resHijo.costo_unitario * packUnidades) / factor;
                    fuente = 'PACK_HIJO_DERIVADO';
                } else if (costoRecetaTotal > 0) {
                    cBaseKilo = costoRecetaTotal / factor;
                    fuente = 'RECETA';
                }
            } else if (costoRecetaTotal > 0) {
                cBaseKilo = costoRecetaTotal / factor;
                fuente = 'RECETA';
            } else {
                // Buscar último lote
                const queryLote = `
                    SELECT d.costo_kilo_al_momento
                    FROM public.bunker_lotes_destinos d
                    JOIN public.bunker_lotes_vinculos v ON d.vinculo_id = v.id
                    WHERE d.destino_id = $1
                    ORDER BY v.fecha_vinculacion DESC
                    LIMIT 1
                `;
                const resLote = await db.query(queryLote, [artId]);
                if (resLote.rows.length > 0 && parseFloat(resLote.rows[0].costo_kilo_al_momento) > 0) {
                    cBaseKilo = parseFloat(resLote.rows[0].costo_kilo_al_momento);
                    fuente = 'LOTE_DESTINO';
                } else {
                    const cBultoMaestro = parseFloat(baRow.ba_costo_base || 0);
                    cBaseKilo = factor > 0 ? (cBultoMaestro / factor) : cBultoMaestro;
                    fuente = 'COSTO_BASE_MAESTRO';
                }
            }

            const cPresentacion = cBaseKilo * factor;

            // 5. Insumos secundarios
            let cInsumos = 0;
            if (la && la.lista_articulo_id) {
                const queryInsumos = `
                    SELECT SUM(li.cantidad * COALESCE(li.costo_unitario_capturado, 0)) as total_insumos
                    FROM public.bunker_lista_insumos li
                    WHERE li.lista_articulo_id = $1 AND li.incluido = true
                `;
                const resInsumos = await db.query(queryInsumos, [la.lista_articulo_id]);
                if (resInsumos.rows.length > 0 && resInsumos.rows[0].total_insumos !== null) {
                    cInsumos = parseFloat(resInsumos.rows[0].total_insumos) || 0;
                }
            }

            // 6. Mano de obra / Costo de tiempo
            let cTiempo = 0;
            if (la && la.mano_obra_activa === true) {
                cTiempo = parseFloat(la.costo_tiempo) || 0;
            }

            const costoUnitarioIntegrado = Math.round((cPresentacion + cInsumos + cTiempo) * 100) / 100;

            return {
                costo_unitario: costoUnitarioIntegrado,
                c_base_kilo: cBaseKilo,
                c_presentacion: cPresentacion,
                c_insumos: cInsumos,
                c_tiempo: cTiempo,
                fuente: fuente,
                articulo_id: artId
            };
        }

        // 7. Si no es un artículo de búnker, buscar si es un ingrediente crudo
        const queryIng = `
            SELECT id, nombre, costo_patron 
            FROM public.ingredientes 
            WHERE id::text = $1 OR codigo::text = $1 OR LOWER(nombre) = LOWER($1)
            LIMIT 1
        `;
        const resIng = await db.query(queryIng, [artStr]);
        if (resIng.rows.length > 0) {
            const ingCost = parseFloat(resIng.rows[0].costo_patron) || 0;
            return {
                costo_unitario: Math.round(ingCost * 100) / 100,
                c_base_kilo: ingCost,
                c_presentacion: ingCost,
                c_insumos: 0,
                c_tiempo: 0,
                fuente: 'INGREDIENTE_PATRON',
                articulo_id: String(resIng.rows[0].id)
            };
        }

        // 8. Fallback a precios_articulos de Lomasoft
        const queryLoma = `
            SELECT costo FROM public.precios_articulos WHERE articulo = $1 LIMIT 1
        `;
        const resLoma = await db.query(queryLoma, [artStr]);
        if (resLoma.rows.length > 0 && resLoma.rows[0].costo !== null) {
            const lomaCost = parseFloat(resLoma.rows[0].costo) || 0;
            return {
                costo_unitario: Math.round(lomaCost * 100) / 100,
                c_base_kilo: lomaCost,
                c_presentacion: lomaCost,
                c_insumos: 0,
                c_tiempo: 0,
                fuente: 'LOMASOFT_LEGACY',
                articulo_id: artStr
            };
        }

        return {
            costo_unitario: 0,
            c_base_kilo: 0,
            c_presentacion: 0,
            c_insumos: 0,
            c_tiempo: 0,
            fuente: 'NO_ENCONTRADO',
            articulo_id: artStr
        };

    } catch (err) {
        console.error(`❌ [COSTO-INTEGRADO] Error calculando costo para "${articuloRaw}":`, err.message);
        return {
            costo_unitario: 0,
            c_base_kilo: 0,
            c_presentacion: 0,
            c_insumos: 0,
            c_tiempo: 0,
            fuente: 'ERROR_EXCEPCION',
            articulo_id: String(articuloRaw)
        };
    }
}

/**
 * Calcula en lote los costos integrados para una lista de items de presupuesto/factura.
 * @param {object} db - Cliente o Pool PostgreSQL
 * @param {Array} items - Array de items con { articulo, cantidad }
 * @param {number} clienteListaId - ID de lista de precios
 * @returns {Promise<{ itemsConCosto: Array, costoEstimadoTotal: number }>}
 */
async function enriquecerItemsConCostoIntegrado(db, items, clienteListaId = 1) {
    let costoEstimadoTotal = 0;
    const itemsConCosto = [];

    for (const item of items) {
        const qty = parseFloat(item.cantidad || item.qty) || 0;
        const artCode = item.articulo || item.articulo_id || item.codigo || item.descripcion;
        const resCosto = await calcularCostoIntegradoArticulo(db, artCode, clienteListaId);

        const costoUnit = resCosto.costo_unitario;
        const costoTot = Math.round(qty * costoUnit * 100) / 100;
        costoEstimadoTotal += costoTot;

        itemsConCosto.push({
            ...item,
            costo_unitario: costoUnit,
            costo_total: costoTot,
            costo_fuente: resCosto.fuente,
            articulo_id_resuelto: resCosto.articulo_id
        });
    }

    return {
        itemsConCosto,
        costoEstimadoTotal: Math.round(costoEstimadoTotal * 100) / 100
    };
}

module.exports = {
    calcularCostoIntegradoArticulo,
    enriquecerItemsConCostoIntegrado
};
