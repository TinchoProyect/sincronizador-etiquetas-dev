const pool = require('../config/database');
const conciliacionArticulosService = require('../services/conciliacionArticulosService');
const historialPreciosService = require('../services/historialPreciosService');

/**
 * Controlador de Conciliación con IA y Gestión de Costos de Reposición
 */
class ConciliacionController {

    /**
     * POST /api/produccion/conciliacion/articulos/match
     * Busca deterministamente las ofertas candidatas de la Tabla Maestra para un artículo
     */
    async buscarCandidatos(req, res) {
        try {
            const { articulo_id, filtro_manual, criterio_orden, excluir_cero, forzar_refresco } = req.body;

            if (!articulo_id) {
                return res.status(400).json({ success: false, message: 'El parámetro articulo_id es obligatorio.' });
            }

            const resultado = await conciliacionArticulosService.buscarCandidatosTablaMaestra(
                articulo_id, 
                filtro_manual !== undefined ? filtro_manual : null,
                { criterio_orden, excluir_cero, forzar_refresco: Boolean(forzar_refresco) }
            );
            return res.json({
                success: true,
                data: resultado
            });
        } catch (err) {
            console.error('❌ Error en buscarCandidatos conciliación:', err);
            return res.status(500).json({
                success: false,
                message: err.message || 'Error al buscar candidatos en la Tabla Maestra.'
            });
        }
    }

    /**
     * POST /api/produccion/conciliacion/articulos/guardar-estrategia
     * Guarda la ruta de búsqueda consolidada en PostgreSQL bunker_articulos.estrategia_busqueda_json
     */
    async guardarEstrategia(req, res) {
        try {
            const { articulo_id, tags_consolidados, historial_capas, usuario_id } = req.body;

            if (!articulo_id) {
                return res.status(400).json({ success: false, message: 'El parámetro articulo_id es obligatorio.' });
            }

            const estrategiaGuardada = await conciliacionArticulosService.guardarEstrategiaConsolidada(
                articulo_id, 
                tags_consolidados || [], 
                historial_capas || [], 
                usuario_id || null
            );

            return res.json({
                success: true,
                message: `Ruta de búsqueda consolidada guardada con éxito en la BD (ID: ${estrategiaGuardada.estrategia_id}).`,
                data: estrategiaGuardada
            });
        } catch (err) {
            console.error('❌ Error al guardar estrategia:', err);
            return res.status(500).json({
                success: false,
                message: err.message || 'Error al guardar la estrategia de búsqueda.'
            });
        }
    }

    /**
     * DELETE /api/produccion/conciliacion/articulos/eliminar-estrategia
     * Resetea la estrategia consolidada en PostgreSQL
     */
    async eliminarEstrategia(req, res) {
        try {
            const { articulo_id } = req.body;

            if (!articulo_id) {
                return res.status(400).json({ success: false, message: 'El parámetro articulo_id es obligatorio.' });
            }

            await conciliacionArticulosService.eliminarEstrategiaConsolidada(articulo_id);

            return res.json({
                success: true,
                message: `Ruta consolidada eliminada de la BD para el artículo ${articulo_id}.`
            });
        } catch (err) {
            console.error('❌ Error al eliminar estrategia:', err);
            return res.status(500).json({
                success: false,
                message: err.message || 'Error al eliminar la estrategia de búsqueda.'
            });
        }
    }

    /**
     * POST /api/produccion/conciliacion/articulos/refinar-paso
     * Ejecuta una instrucción en lenguaje natural del operador para depurar el subconjunto actual de candidatos
     */
    async refinarPaso(req, res) {
        try {
            const { articulo_id, candidatos_actuales, instruccion_operador, historial_capas } = req.body;

            if (!Array.isArray(candidatos_actuales)) {
                return res.status(400).json({ success: false, message: 'El parámetro candidatos_actuales debe ser un array.' });
            }

            const resultado = await conciliacionArticulosService.refinarSubconjuntoConInstruccion(
                articulo_id || '',
                candidatos_actuales, 
                instruccion_operador || '', 
                historial_capas || []
            );

            return res.json({
                success: true,
                data: resultado
            });
        } catch (err) {
            console.error('❌ Error en refinarPaso conciliación:', err);
            return res.status(500).json({
                success: false,
                message: err.message || 'Error al refinar subconjunto con la instrucción.'
            });
        }
    }

    /**
     * POST /api/produccion/conciliacion/articulos/auditar-ia
     * Ejecuta bajo demanda la auditoría cognitiva con el Comité Gemini IA sobre las ofertas candidatas del artículo
     */
    async auditarConIA(req, res) {
        try {
            const { articulo_id } = req.body;
            if (!articulo_id) {
                return res.status(400).json({ success: false, message: 'El parámetro articulo_id es obligatorio.' });
            }

            const resultado = await conciliacionArticulosService.auditarConComiteGeminiIA(articulo_id);
            return res.json({
                success: true,
                data: resultado
            });
        } catch (err) {
            console.error('❌ Error en auditarConIA conciliación:', err);
            return res.status(500).json({
                success: false,
                message: err.message || 'Error al ejecutar la auditoría cognitiva con Gemini IA.'
            });
        }
    }

    /**
     * POST /api/produccion/conciliacion/articulos/confirmar
     * Confirma la selección del operador, actualiza costo_base en bunker_articulos, 
     * recalcula listas comerciales en bunker_lista_articulos y registra auditoría.
     */
    async confirmarConciliacion(req, res) {
        const client = await pool.connect();
        try {
            const {
                articulo_id,
                nuevo_costo_base,
                proveedor_id,
                proveedor_nombre,
                codigo_proveedor,
                descripcion_proveedor,
                precio_costo_bulto,
                costo_kilo_calculado,
                fecha_actualizacion_oferta,
                antiguedad_dias,
                nivel_coincidencia,
                justificacion_determinista,
                usuario_id
            } = req.body;

            if (!articulo_id || nuevo_costo_base === undefined || nuevo_costo_base === null) {
                return res.status(400).json({
                    success: false,
                    message: 'Faltan parámetros obligatorios: articulo_id y nuevo_costo_base.'
                });
            }

            const costoBaseVal = parseFloat(nuevo_costo_base);
            if (isNaN(costoBaseVal) || costoBaseVal < 0) {
                return res.status(400).json({ success: false, message: 'El nuevo costo base debe ser un número válido >= 0.' });
            }

            await client.query('BEGIN');

            const esIngrediente = req.body.es_ingrediente === true || String(articulo_id).startsWith('ING-');
            const cleanIngId = esIngrediente 
                ? parseInt(req.body.ingrediente_id || String(articulo_id).replace(/^ING-?/i, ''), 10) 
                : null;

            if (esIngrediente && cleanIngId) {
                // FLUJO EXCLUSIVO: CONCILIACIÓN DE INGREDIENTE PURO DE FÁBRICA
                const resIng = await client.query(
                    `SELECT id, nombre, costo_patron, unidad_medida FROM public.ingredientes WHERE id = $1 LIMIT 1`,
                    [cleanIngId]
                );
                if (resIng.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(404).json({ success: false, message: `Insumo de fábrica #${cleanIngId} no encontrado.` });
                }
                const ingRow = resIng.rows[0];
                const costoKiloVal = parseFloat(costo_kilo_calculado) || parseFloat(nuevo_costo_base) || 0;

                // 1. Actualizar costo_patron en ingredientes
                await client.query(
                    `UPDATE public.ingredientes SET costo_patron = $1 WHERE id = $2`,
                    [costoKiloVal, cleanIngId]
                );

                // NOTA ARQUITECTÓNICA: No se sobrescribe bunker_lotes_destinos.costo_kilo_al_momento
                // ya que cada lote histórico en la Mesa de Recepción debe conservar inmutable el precio al que ingresó.

                // 3. Registrar auditoría en bunker_conciliacion_articulos
                const isPureInteger = (val) => val !== null && val !== undefined && /^\d+$/.test(String(val).trim());
                let provIdFinal = isPureInteger(proveedor_id) ? parseInt(proveedor_id) : null;
                if (!provIdFinal && proveedor_nombre) {
                    const resProv = await client.query(
                        `SELECT id FROM public.proveedores WHERE nombre ILIKE $1 LIMIT 1`,
                        [`%${String(proveedor_nombre).trim()}%`]
                    );
                    if (resProv.rows.length > 0) provIdFinal = resProv.rows[0].id;
                }

                let nivelCoincidenciaSafe = String(nivel_coincidencia || '').trim();
                if (nivelCoincidenciaSafe !== 'MATCH_EXACTO' && nivelCoincidenciaSafe !== 'SUGERENCIA_ALTERNATIVA') {
                    nivelCoincidenciaSafe = 'MATCH_EXACTO';
                }

                await client.query(
                    `INSERT INTO public.bunker_conciliacion_articulos (
                        articulo_id, ingrediente_id, proveedor_id, proveedor_nombre, codigo_proveedor,
                        descripcion_proveedor, precio_costo, costo_kilo_calculado,
                        fecha_actualizacion_oferta, antiguedad_dias, nivel_coincidencia,
                        justificacion_determinista, usuario_id, fecha_conciliacion
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())`,
                    [
                        null,
                        cleanIngId,
                        provIdFinal,
                        proveedor_nombre || 'Proveedor Supabase',
                        codigo_proveedor || 'N/D',
                        descripcion_proveedor || 'Sin Descripción',
                        precio_costo_bulto || costoKiloVal,
                        costoKiloVal,
                        fecha_actualizacion_oferta || new Date(),
                        antiguedad_dias || 0,
                        nivelCoincidenciaSafe,
                        justificacion_determinista || 'Conciliación de insumo aprobada por operador',
                        usuario_id || null
                    ]
                );

                // 4. Registrar en historial de cambios de precios
                const cambiosHistorial = [{
                    articulo_numero: `ING-${cleanIngId}`,
                    lista_id: 1,
                    costo_anterior: parseFloat(ingRow.costo_patron || 0),
                    costo_nuevo: costoKiloVal,
                    precio_anterior: parseFloat(ingRow.costo_patron || 0),
                    precio_nuevo: costoKiloVal,
                    porcentaje_iva: req.body.porcentaje_iva !== undefined && req.body.porcentaje_iva !== null ? parseFloat(req.body.porcentaje_iva) : 21,
                    kilos_unidad: 1,
                    descripcion: `${ingRow.nombre} (Insumo de Fábrica)`,
                    origen_cambio: 'CONCILIACION_IA_INSUMO',
                    usuario: usuario_id ? String(usuario_id) : 'OPERADOR'
                }];

                await historialPreciosService.registrarCambiosLote({
                    client,
                    cambios: cambiosHistorial,
                    origen_cambio: 'CONCILIACION_IA_INSUMO',
                    usuario: usuario_id ? String(usuario_id) : 'OPERADOR'
                });

                await client.query('COMMIT');

                return res.json({
                    success: true,
                    es_ingrediente: true,
                    ingrediente_id: cleanIngId,
                    nuevo_costo: costoKiloVal,
                    message: `Costo del insumo #${cleanIngId} (${ingRow.nombre}) actualizado con éxito a $${costoKiloVal.toFixed(2)}/kg.`
                });
            }

            const porcentajeIvaVal = req.body.porcentaje_iva !== undefined && req.body.porcentaje_iva !== null
                ? parseFloat(req.body.porcentaje_iva)
                : null;

            // 1. Actualizar el costo_base y porcentaje_iva en public.bunker_articulos
            if (porcentajeIvaVal !== null) {
                await client.query(
                    `UPDATE public.bunker_articulos
                     SET costo_base = $1,
                         porcentaje_iva = $2
                     WHERE TRIM(articulo_id) = $3`,
                    [costoBaseVal, porcentajeIvaVal, String(articulo_id).trim()]
                );
            } else {
                await client.query(
                    `UPDATE public.bunker_articulos
                     SET costo_base = $1
                     WHERE TRIM(articulo_id) = $2`,
                    [costoBaseVal, String(articulo_id).trim()]
                );
            }

            // 2. Recalcular precio_final, iva y costo_base_sobrescrito en public.bunker_lista_articulos para todas las listas
            let costoKiloVal = parseFloat(costo_kilo_calculado) || 0;
            if (!costoKiloVal || costoKiloVal <= 0) {
                const resK = await client.query(
                    `SELECT kilos_unidad FROM public.bunker_articulos WHERE TRIM(articulo_id) = $1 LIMIT 1`,
                    [String(articulo_id).trim()]
                );
                const ku = resK.rows[0] ? (parseFloat(resK.rows[0].kilos_unidad) || 1) : 1;
                costoKiloVal = costoBaseVal / ku;
            }

            // Capturar precios anteriores para el historial
            const resPrevListas = await client.query(
                `SELECT lista_id, costo_base_sobrescrito, precio_final, iva FROM public.bunker_lista_articulos WHERE TRIM(articulo_numero) = $1`,
                [String(articulo_id).trim()]
            );

            if (porcentajeIvaVal !== null) {
                await client.query(
                    `UPDATE public.bunker_lista_articulos
                     SET costo_base_sobrescrito = $1::numeric,
                         iva = $2::numeric,
                         precio_final = ($3::numeric * (1 + (COALESCE(margen_ganancia, 0) / 100)) + COALESCE(costo_tiempo, 0)) * (1 + ($2::numeric / 100)),
                         updated_at = NOW()
                     WHERE TRIM(articulo_numero) = $4`,
                    [costoKiloVal, porcentajeIvaVal, costoBaseVal, String(articulo_id).trim()]
                );
            } else {
                await client.query(
                    `UPDATE public.bunker_lista_articulos
                     SET costo_base_sobrescrito = $1::numeric,
                         precio_final = ($2::numeric * (1 + (COALESCE(margen_ganancia, 0) / 100)) + COALESCE(costo_tiempo, 0)) * (1 + (COALESCE(iva, 0) / 100)),
                         updated_at = NOW()
                     WHERE TRIM(articulo_numero) = $3`,
                    [costoKiloVal, costoBaseVal, String(articulo_id).trim()]
                );
            }

            // Registrar auditoría de variaciones en la base de datos
            const resPostListas = await client.query(
                `SELECT lista_id, costo_base_sobrescrito, precio_final, iva FROM public.bunker_lista_articulos WHERE TRIM(articulo_numero) = $1`,
                [String(articulo_id).trim()]
            );
            const mapPrev = new Map();
            resPrevListas.rows.forEach(p => mapPrev.set(p.lista_id, p));
            const cambiosHistorial = resPostListas.rows.map(post => {
                const prev = mapPrev.get(post.lista_id) || {};
                return {
                    articulo_numero: String(articulo_id).trim(),
                    lista_id: post.lista_id,
                    costo_anterior: parseFloat(prev.costo_base_sobrescrito || 0),
                    costo_nuevo: parseFloat(post.costo_base_sobrescrito || 0),
                    precio_anterior: parseFloat(prev.precio_final || 0),
                    precio_nuevo: parseFloat(post.precio_final || 0),
                    porcentaje_iva: parseFloat(post.iva || porcentajeIvaVal || 21),
                    origen_cambio: 'CONCILIACION_IA',
                    usuario: usuario_id ? String(usuario_id) : 'OPERADOR'
                };
            });
            await historialPreciosService.registrarCambiosLote({
                client,
                cambios: cambiosHistorial,
                origen_cambio: 'CONCILIACION_IA',
                usuario: usuario_id ? String(usuario_id) : 'OPERADOR'
            });

            // 2.2. Actualizar el costo_patron del ingrediente vinculado en public.ingredientes SOLAMENTE si se solicita explícitamente
            if (req.body.sincronizar_ingrediente === true) {
                await client.query(
                    `UPDATE public.ingredientes
                     SET costo_patron = $1
                     WHERE LOWER(TRIM(articulo_vinculado_numero)) = LOWER(TRIM($2))
                        OR id IN (
                            SELECT ingrediente_id 
                            FROM public.ingrediente_bunker_articulos 
                            WHERE LOWER(TRIM(bunker_articulo_id)) = LOWER(TRIM($2))
                        )`,
                    [costoKiloVal, String(articulo_id).trim()]
                );
            }

            // NOTA ARQUITECTÓNICA: No se sobrescribe bunker_lotes_destinos.costo_kilo_al_momento
            // para preservar la trazabilidad histórica inmutable de cada lote recepcionado.

            const isPureInteger = (val) => val !== null && val !== undefined && /^\d+$/.test(String(val).trim());
            let provIdFinal = isPureInteger(proveedor_id) ? parseInt(proveedor_id) : null;

            if (!provIdFinal && proveedor_nombre) {
                const resProv = await client.query(
                    `SELECT id FROM public.proveedores WHERE nombre ILIKE $1 LIMIT 1`,
                    [`%${String(proveedor_nombre).trim()}%`]
                );
                if (resProv.rows.length > 0) {
                    provIdFinal = resProv.rows[0].id;
                }
            }

            let nivelCoincidenciaSafe = String(nivel_coincidencia || '').trim();
            if (nivelCoincidenciaSafe !== 'MATCH_EXACTO' && nivelCoincidenciaSafe !== 'SUGERENCIA_ALTERNATIVA') {
                nivelCoincidenciaSafe = 'MATCH_EXACTO';
            }

            // 3. Registrar auditoría en public.bunker_conciliacion_articulos
            await client.query(
                `INSERT INTO public.bunker_conciliacion_articulos (
                    articulo_id, proveedor_id, proveedor_nombre, codigo_proveedor,
                    descripcion_proveedor, precio_costo, costo_kilo_calculado,
                    fecha_actualizacion_oferta, antiguedad_dias, nivel_coincidencia,
                    justificacion_determinista, usuario_id, fecha_conciliacion
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
                [
                    String(articulo_id).trim(),
                    provIdFinal,
                    proveedor_nombre || 'Proveedor Supabase',
                    codigo_proveedor || 'N/D',
                    descripcion_proveedor || 'Sin Descripción',
                    precio_costo_bulto || 0,
                    costo_kilo_calculado || 0,
                    fecha_actualizacion_oferta || new Date(),
                    antiguedad_dias || 0,
                    nivelCoincidenciaSafe,
                    justificacion_determinista || 'Conciliación aprobada por operador',
                    usuario_id || null
                ]
            );

            await client.query('COMMIT');

            return res.json({
                success: true,
                message: `Costo base del artículo ${articulo_id} actualizado con éxito a $${costoBaseVal.toFixed(2)}/bulto.`
            });

        } catch (err) {
            await client.query('ROLLBACK');
            console.error('❌ Error en confirmarConciliacion:', err);
            return res.status(500).json({
                success: false,
                message: err.message || 'Error al confirmar la conciliación.'
            });
        } finally {
            client.release();
        }
    }

    /**
     * POST /api/produccion/simulacion/sincronizar-ingrediente
     * Sincroniza el costo por kilo del artículo comercial (LDN 1)
     * directamente al ingrediente vinculado en public.ingredientes.costo_patron,
     * respetando mano_obra_activa, modo_iva, bunker_lista_insumos, historial y cascada Nodos/Combos.
     */
    async sincronizarIngredienteDesdeArticulo(req, res) {
        const client = await pool.connect();
        try {
            const { articulo_id, ingrediente_id, costo_kilo_manual, iva_manual } = req.body;

            if (!articulo_id) {
                return res.status(400).json({ success: false, message: 'Parámetro articulo_id requerido.' });
            }

            const skuClean = String(articulo_id).trim();
            await client.query('BEGIN');

            // 1. Obtener costo_base y kilos_unidad del artículo
            const resArt = await client.query(
                `SELECT articulo_id, costo_base, kilos_unidad, porcentaje_iva FROM public.bunker_articulos WHERE LOWER(TRIM(articulo_id)) = LOWER(TRIM($1)) LIMIT 1`,
                [skuClean]
            );

            if (resArt.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: `Artículo ${articulo_id} no encontrado.` });
            }

            const art = resArt.rows[0];
            const skuOficial = art.articulo_id;
            const kilosUnidad = parseFloat(art.kilos_unidad) || 1;

            let costoKiloFinal = 0;
            const ivaFinal = (iva_manual !== undefined && iva_manual !== null && !isNaN(parseFloat(iva_manual)))
                ? parseFloat(iva_manual)
                : null;
            const articulosNodosActualizados = new Set();
            const cambiosHistorial = [];

            if (costo_kilo_manual !== undefined && costo_kilo_manual !== null && parseFloat(costo_kilo_manual) > 0) {
                costoKiloFinal = Number(parseFloat(costo_kilo_manual).toFixed(4));
                const nuevoCostoBulto = Number((costoKiloFinal * kilosUnidad).toFixed(2));

                // Actualizar bunker_articulos incluyendo updated_at
                await client.query(
                    `UPDATE public.bunker_articulos
                     SET costo_base = $1,
                         porcentaje_iva = COALESCE($2, porcentaje_iva),
                         updated_at = CURRENT_TIMESTAMP
                     WHERE LOWER(TRIM(articulo_id)) = LOWER(TRIM($3))`,
                    [nuevoCostoBulto, ivaFinal, skuOficial]
                );

                // Recalcular bunker_lista_articulos respetando mano_obra_activa, modo_iva e insumos de lista
                const resListas = await client.query(
                    `SELECT la.id, la.lista_id, la.costo_tiempo, COALESCE(la.mano_obra_activa, true) AS mano_obra_activa,
                            la.margen_ganancia, la.iva, COALESCE(la.modo_iva, 'COMPLETO') AS modo_iva,
                            la.precio_final, la.costo_base_sobrescrito, COALESCE(la.disponible, true) AS disponible,
                            COALESCE(blp.canal_comercial, 'MAYORISTA') AS canal_comercial
                     FROM public.bunker_lista_articulos la
                     JOIN public.bunker_listas_precios blp ON blp.id = la.lista_id
                     WHERE LOWER(TRIM(la.articulo_numero)) = LOWER(TRIM($1))
                       AND blp.activa = true`,
                    [skuOficial]
                );

                for (const la of resListas.rows) {
                    const esCanalNodos = String(la.canal_comercial || '').toUpperCase() === 'NODOS';
                    if (esCanalNodos && la.disponible === false) {
                        continue;
                    }
                    if (esCanalNodos) {
                        articulosNodosActualizados.add(String(skuOficial));
                    }

                    const resInsLista = await client.query(
                        `SELECT SUM(COALESCE(li.cantidad, 0) * COALESCE(ing.costo_patron, ba.costo_base, li.costo_unitario_capturado, 0)) AS total_insumos
                         FROM public.bunker_lista_insumos li
                         LEFT JOIN public.ingredientes ing ON ing.id::text = li.insumo_articulo_numero
                         LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = li.insumo_articulo_numero
                         WHERE li.lista_articulo_id = $1 AND COALESCE(li.incluido, true) = true`,
                        [la.id]
                    );
                    const costoInsumosLista = parseFloat(resInsLista.rows[0]?.total_insumos) || 0;
                    const costoTiempo = la.mano_obra_activa !== false ? (parseFloat(la.costo_tiempo) || 0) : 0;
                    const margen = parseFloat(la.margen_ganancia) || 0;
                    const ivaLista = ivaFinal !== null
                        ? ivaFinal
                        : (la.iva !== null && la.iva !== undefined ? parseFloat(la.iva) : (parseFloat(art.porcentaje_iva) || 21));
                    const modoIva = String(la.modo_iva || 'COMPLETO').toUpperCase();
                    let ivaEfectivo = ivaLista;
                    if (modoIva === 'MEDIO') ivaEfectivo = ivaLista / 2;
                    else if (modoIva === 'SIN' || modoIva === 'EXENTO') ivaEfectivo = 0;

                    const costoTotalConInsumos = nuevoCostoBulto + costoInsumosLista;
                    const precioFinal = Number((((costoTotalConInsumos * (1 + (margen / 100))) + costoTiempo) * (1 + (ivaEfectivo / 100))).toFixed(2));

                    cambiosHistorial.push({
                        articulo_numero: skuOficial,
                        lista_id: la.lista_id,
                        costo_anterior: parseFloat(la.costo_base_sobrescrito || 0),
                        costo_nuevo: costoKiloFinal,
                        precio_anterior: parseFloat(la.precio_final || 0),
                        precio_nuevo: precioFinal,
                        porcentaje_iva: ivaLista,
                        origen_cambio: 'EDICION_MANUAL_LDN1',
                        usuario: req.user ? (req.user.username || req.user.nombre) : 'OPERADOR'
                    });

                    await client.query(
                        `UPDATE public.bunker_lista_articulos
                         SET costo_base_sobrescrito = $1,
                             iva = $2,
                             precio_final = $3,
                             updated_at = NOW()
                         WHERE id = $4`,
                        [costoKiloFinal, ivaLista, precioFinal, la.id]
                    );
                }

                if (cambiosHistorial.length > 0) {
                    await historialPreciosService.registrarCambiosLote({
                        client,
                        cambios: cambiosHistorial,
                        origen_cambio: 'EDICION_MANUAL_LDN1',
                        usuario: req.user ? (req.user.username || req.user.nombre) : 'OPERADOR'
                    });
                }
            } else {
                const costoBase = parseFloat(art.costo_base) || 0;
                costoKiloFinal = kilosUnidad > 0 ? Number((costoBase / kilosUnidad).toFixed(4)) : costoBase;
            }

            // 2. Actualizar public.ingredientes.costo_patron SOLAMENTE si se pasó ingrediente_id explícito
            let ingActualizado = null;
            if (ingrediente_id && parseInt(ingrediente_id) > 0) {
                const resUpdate = await client.query(
                    `UPDATE public.ingredientes
                     SET costo_patron = $1
                     WHERE id = $2
                     RETURNING id, nombre, costo_patron`,
                    [costoKiloFinal, parseInt(ingrediente_id)]
                );
                if (resUpdate.rows.length > 0) {
                    ingActualizado = resUpdate.rows[0];
                }
            }

            await client.query('COMMIT');

            // 3. Sincronización aguas abajo: Nodos (Lista 8) y Combos (LDN 8)
            if (articulosNodosActualizados.size > 0) {
                try {
                    const nodosBarrialesService = require('../services/nodosBarrialesService');
                    for (const artId of articulosNodosActualizados) {
                        await nodosBarrialesService.sincronizarCatalogoNodoDesdeBunker(artId);
                    }
                } catch (nodoErr) {
                    console.warn('[LDN1->NODOS] Aviso sincronizando catálogo Nodos:', nodoErr.message);
                }
            }
            if (costo_kilo_manual !== undefined && costo_kilo_manual !== null && parseFloat(costo_kilo_manual) > 0) {
                try {
                    const combosCompuestosService = require('../services/combosCompuestosService');
                    await combosCompuestosService.recalcularCombosAfectadosPorCambio(pool, { skusModificados: [skuOficial] });
                } catch (comboErr) {
                    console.warn('[LDN1->COMBOS] Aviso recalculando combos en cascada:', comboErr.message);
                }
            }

            if (!ingActualizado) {
                return res.json({
                    success: true,
                    message: `Costo y parámetros del artículo [${skuOficial}] actualizados con éxito ($${costoKiloFinal.toFixed(2)}/kg). El ingrediente de fábrica no fue modificado.`,
                    costoKilo: costoKiloFinal,
                    listasActualizadasCount: cambiosHistorial.length
                });
            }

            return res.json({
                success: true,
                message: `Costo y parámetros actualizados con éxito: SKU [${skuOficial}] e Ingrediente "${ingActualizado.nombre}" a $${costoKiloFinal.toFixed(2)}/kg.`,
                ingrediente: ingActualizado,
                costoKilo: costoKiloFinal,
                listasActualizadasCount: cambiosHistorial.length
            });

        } catch (err) {
            try { await client.query('ROLLBACK'); } catch (_) {}
            console.error('❌ Error en sincronizarIngredienteDesdeArticulo:', err);
            return res.status(500).json({ success: false, message: err.message || 'Error al sincronizar ingrediente.' });
        } finally {
            client.release();
        }
    }

    /**
     * POST /api/produccion/simulacion/propagar-ingrediente-a-fracciones
     * Propaga el costo por kilo e IVA de un ingrediente de fábrica a todas sus fracciones 
     * mono-ingrediente 100% puras derivadas, conservando insumos de empaque y costo de tiempo (mano de obra).
     */
    async propagarIngredienteAFracciones(req, res) {
        const client = await pool.connect();
        try {
            const {
                ingrediente_id,
                porcentaje_iva,
                forzar_iva,
                articulos_target_ids,
                nuevo_costo_patron,
                ap_codigo,
                nuevo_costo_base_ap
            } = req.body;

            if (!ingrediente_id) {
                return res.status(400).json({ success: false, message: 'Parámetro ingrediente_id requerido.' });
            }

            await client.query('BEGIN');

            // 1. Obtener costo_patron del ingrediente (y actualizarlo en la misma transacción si viene costo vivo simulado)
            const resIng = await client.query(
                `SELECT id, nombre, costo_patron, articulo_vinculado_numero, COALESCE(es_insumo, false) AS es_insumo
                 FROM public.ingredientes
                 WHERE id = $1
                 LIMIT 1`,
                [parseInt(ingrediente_id)]
            );

            if (resIng.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: `Ingrediente #${ingrediente_id} no encontrado.` });
            }

            const ing = resIng.rows[0];
            let costoKiloIngrediente = parseFloat(ing.costo_patron) || 0;
            let huboCambioIngredienteOAp = false;
            const articulosActualizados = [];
            const listasActualizadas = [];
            const omitidos = [];
            const advertencias = [];

            if (nuevo_costo_patron !== undefined && nuevo_costo_patron !== null && !isNaN(parseFloat(nuevo_costo_patron)) && parseFloat(nuevo_costo_patron) > 0) {
                const nuevoPatron = Number(parseFloat(nuevo_costo_patron).toFixed(4));
                if (Math.abs(nuevoPatron - costoKiloIngrediente) >= 0.0001) {
                    await client.query(
                        `UPDATE public.ingredientes SET costo_patron = $1 WHERE id = $2`,
                        [nuevoPatron, parseInt(ingrediente_id)]
                    );
                    ing.costo_patron = nuevoPatron;
                    huboCambioIngredienteOAp = true;
                }
                costoKiloIngrediente = nuevoPatron;
            }

            // 2. Blindaje estricto de IVA (10.5% / 21% / 0%):
            //    - Un insumo de empaque (es_insumo=true) JAMÁS sobrescribe el IVA de un alimento.
            //    - Solo se fuerza IVA global cuando el operador lo solicita explícitamente (forzar_iva === true).
            //    - Por defecto, cada fracción y cada lista conserva su propia alícuota real en BD (usando bulto origen solo como fallback si estuviera nula).
            const bultoCerradoOrigen = String(ing.articulo_vinculado_numero || '').trim().toLowerCase();
            let ivaFallbackOrigen = null;
            if (bultoCerradoOrigen) {
                const resBulto = await client.query(
                    `SELECT porcentaje_iva FROM public.bunker_articulos WHERE LOWER(TRIM(articulo_id)) = LOWER(TRIM($1)) LIMIT 1`,
                    [bultoCerradoOrigen]
                );
                if (resBulto.rows.length > 0 && resBulto.rows[0].porcentaje_iva !== null && resBulto.rows[0].porcentaje_iva !== undefined) {
                    ivaFallbackOrigen = parseFloat(resBulto.rows[0].porcentaje_iva);
                }
            }

            const ivaPropagacion = (!ing.es_insumo && forzar_iva === true && porcentaje_iva !== undefined && porcentaje_iva !== null && !isNaN(parseFloat(porcentaje_iva)))
                ? parseFloat(porcentaje_iva)
                : null;

            // 2.1 Si el ingrediente proviene de un Artículo Puente (ej. Tostadero LDN 4), sincronizar el AP en la misma transacción
            if (ap_codigo && nuevo_costo_base_ap !== undefined && nuevo_costo_base_ap !== null && !isNaN(parseFloat(nuevo_costo_base_ap)) && parseFloat(nuevo_costo_base_ap) > 0) {
                const apSkuClean = String(ap_codigo).trim();
                const resAp = await client.query(
                    `SELECT articulo_id, kilos_unidad, porcentaje_iva FROM public.bunker_articulos WHERE LOWER(TRIM(articulo_id)) = LOWER(TRIM($1)) LIMIT 1`,
                    [apSkuClean]
                );
                if (resAp.rows.length > 0) {
                    const apRow = resAp.rows[0];
                    const kilosAp = parseFloat(apRow.kilos_unidad) > 0 ? parseFloat(apRow.kilos_unidad) : 1;
                    const costoApKilo = Number(parseFloat(nuevo_costo_base_ap).toFixed(4));
                    const costoApBulto = Number((costoApKilo * kilosAp).toFixed(2));
                    const ivaAp = ivaPropagacion !== null
                        ? ivaPropagacion
                        : (apRow.porcentaje_iva !== null && apRow.porcentaje_iva !== undefined ? parseFloat(apRow.porcentaje_iva) : (ivaFallbackOrigen !== null ? ivaFallbackOrigen : 21));

                    await client.query(
                        `UPDATE public.bunker_articulos
                         SET costo_base = $1,
                             porcentaje_iva = $2,
                             updated_at = CURRENT_TIMESTAMP
                         WHERE LOWER(TRIM(articulo_id)) = LOWER(TRIM($3))`,
                        [costoApBulto, ivaAp, apRow.articulo_id]
                    );
                    articulosActualizados.push({ articulo_id: apRow.articulo_id, costo_base: costoApBulto, porcentaje_iva: ivaAp });

                    const resListasAp = await client.query(
                        `SELECT la.id, la.lista_id, la.costo_tiempo, COALESCE(la.mano_obra_activa, true) AS mano_obra_activa,
                                la.margen_ganancia, la.iva, COALESCE(la.modo_iva, 'COMPLETO') AS modo_iva
                         FROM public.bunker_lista_articulos la
                         JOIN public.bunker_listas_precios blp ON blp.id = la.lista_id
                         WHERE LOWER(TRIM(la.articulo_numero)) = LOWER(TRIM($1))
                           AND blp.activa = true`,
                        [apRow.articulo_id]
                    );
                    for (const laAp of resListasAp.rows) {
                        const moAp = laAp.mano_obra_activa !== false ? (parseFloat(laAp.costo_tiempo) || 0) : 0;
                        const margenAp = parseFloat(laAp.margen_ganancia) || 0;
                        const ivaListaAp = ivaPropagacion !== null
                            ? ivaPropagacion
                            : (laAp.iva !== null && laAp.iva !== undefined ? parseFloat(laAp.iva) : ivaAp);
                        const modoIvaAp = String(laAp.modo_iva || 'COMPLETO').toUpperCase();
                        let ivaEfAp = ivaListaAp;
                        if (modoIvaAp === 'MEDIO') ivaEfAp = ivaListaAp / 2;
                        else if (modoIvaAp === 'SIN' || modoIvaAp === 'EXENTO') ivaEfAp = 0;
                        const precioAp = Number((((costoApBulto * (1 + (margenAp / 100))) + moAp) * (1 + (ivaEfAp / 100))).toFixed(2));

                        await client.query(
                            `UPDATE public.bunker_lista_articulos
                             SET costo_base_sobrescrito = $1,
                                 iva = $2,
                                 precio_final = $3,
                                 updated_at = NOW()
                             WHERE id = $4`,
                            [costoApKilo, ivaListaAp, precioAp, laAp.id]
                        );
                        listasActualizadas.push({
                            id: laAp.id,
                            lista_id: laAp.lista_id,
                            articulo_numero: apRow.articulo_id,
                            costo_base_sobrescrito: costoApKilo,
                            iva: ivaListaAp,
                            precio_final: precioAp
                        });
                    }
                    huboCambioIngredienteOAp = true;
                }
            }

            // 3. Buscar artículos fraccionados con receta activa que consumen este ingrediente (Flujo 2 / Flujo 4)
            // Excluye Artículos Puente (familia 42), obsoletos, exclusivos de producción externa (UP) y huérfanos sin alta en Búnker.
            // Nota determinista: si un artículo tiene receta activa y no está obsoleto, se propaga coherentemente aunque arrastre
            // una bandera histórica ba.no_producido_por_lambda = true (informándolo en advertencias en vez de descartarlo en silencio).
            const resArtRecetas = await client.query(
                `SELECT DISTINCT r.articulo_numero, ba.kilos_unidad, ba.descripcion, ba.porcentaje_iva, ba.es_pack, ba.pack_hijo_codigo, ba.pack_unidades,
                                COALESCE(ba.no_producido_por_lambda, false) AS no_producido_por_lambda
                 FROM public.receta_ingredientes ri
                 JOIN public.recetas r ON r.id = ri.receta_id
                 JOIN public.bunker_articulos ba ON LOWER(TRIM(ba.articulo_id)) = LOWER(TRIM(r.articulo_numero))
                 LEFT JOIN public.stock_real_consolidado src ON LOWER(TRIM(src.articulo_numero)) = LOWER(TRIM(ba.articulo_id))
                 WHERE ri.ingrediente_id = $1
                   AND COALESCE(ba.familia_id, 0) <> 42
                   AND COALESCE(src.solo_produccion_externa, false) = false
                   AND COALESCE((ba.propiedades_dinamicas->>'obsoleto')::boolean, false) = false`,
                [parseInt(ingrediente_id)]
            );

            const origenTieneReceta = bultoCerradoOrigen && resArtRecetas.rows.some(r => (r.articulo_numero || '').trim().toLowerCase() === bultoCerradoOrigen);

            // AISLAMIENTO LDN 1 vs LDN 2: La propagación de un ingrediente a sus fracciones (LDN 2) NO debe alterar ni recalcular el Bulto Cerrado de origen (LDN 1).

            let articulosAfectados = resArtRecetas.rows.filter(r => {
                const sku = (r.articulo_numero || '').trim().toLowerCase();
                return Boolean(sku);
            });

            // 3.1. Detectar también Artículos Padre (Packs) cuyos hijos sean fracciones que consumen este ingrediente
            const hijosSkusLower = articulosAfectados.map(r => (r.articulo_numero || '').trim().toLowerCase());
            if (hijosSkusLower.length > 0) {
                const resPacks = await client.query(
                    `SELECT ba.articulo_id AS articulo_numero, ba.kilos_unidad, ba.descripcion, ba.porcentaje_iva, ba.es_pack, ba.pack_hijo_codigo, ba.pack_unidades,
                            COALESCE(ba.no_producido_por_lambda, false) AS no_producido_por_lambda
                     FROM public.bunker_articulos ba
                     LEFT JOIN public.stock_real_consolidado src ON LOWER(TRIM(src.articulo_numero)) = LOWER(TRIM(ba.articulo_id))
                     WHERE (ba.es_pack = true OR (ba.pack_unidades IS NOT NULL AND ba.pack_unidades > 1))
                       AND LOWER(TRIM(COALESCE(ba.pack_hijo_codigo, ''))) = ANY($1)
                       AND COALESCE(ba.familia_id, 0) <> 42
                       AND COALESCE(src.solo_produccion_externa, false) = false
                       AND COALESCE((ba.propiedades_dinamicas->>'obsoleto')::boolean, false) = false
                       AND NOT EXISTS (SELECT 1 FROM public.recetas r WHERE LOWER(TRIM(r.articulo_numero)) = LOWER(TRIM(ba.articulo_id)))`,
                    [hijosSkusLower]
                );
                resPacks.rows.forEach(p => {
                    const pSku = (p.articulo_numero || '').trim().toLowerCase();
                    if (!articulosAfectados.some(a => (a.articulo_numero || '').trim().toLowerCase() === pSku)) {
                        articulosAfectados.push(p);
                    }
                });
            }

            // Si el cliente especificó los SKUs objetivos deterministas (por ejemplo, desde los checkboxes de auditoría de la UI):
            if (Array.isArray(articulos_target_ids) && articulos_target_ids.length > 0) {
                const targetSet = new Set(articulos_target_ids.map(s => String(s).trim().toLowerCase()));
                articulosAfectados = articulosAfectados.filter(r => targetSet.has((r.articulo_numero || '').trim().toLowerCase()));

                // Cero descartes silenciosos: auditar cada SKU solicitado que no haya entrado por la consulta base
                for (const targetSku of articulos_target_ids) {
                    const skuClean = String(targetSku).trim();
                    if (!skuClean) continue;
                    const alreadyFound = articulosAfectados.some(r => r.articulo_numero.trim().toLowerCase() === skuClean.toLowerCase());
                    if (alreadyFound) continue;

                    const resCheck = await client.query(
                        `SELECT ba.articulo_id AS articulo_numero, ba.kilos_unidad, ba.descripcion, ba.porcentaje_iva,
                                ba.es_pack, ba.pack_hijo_codigo, ba.pack_unidades, ba.familia_id,
                                COALESCE(ba.no_producido_por_lambda, false) AS no_producido_por_lambda,
                                COALESCE(src.solo_produccion_externa, false) AS solo_produccion_externa,
                                COALESCE((ba.propiedades_dinamicas->>'obsoleto')::boolean, false) AS es_obsoleto,
                                EXISTS (SELECT 1 FROM public.recetas r WHERE LOWER(TRIM(r.articulo_numero)) = LOWER(TRIM(ba.articulo_id))) AS tiene_receta
                         FROM public.bunker_articulos ba
                         LEFT JOIN public.stock_real_consolidado src ON LOWER(TRIM(src.articulo_numero)) = LOWER(TRIM(ba.articulo_id))
                         WHERE LOWER(TRIM(ba.articulo_id)) = LOWER(TRIM($1))
                         LIMIT 1`,
                        [skuClean]
                    );

                    if (resCheck.rows.length === 0) {
                        omitidos.push({ sku: skuClean, motivo: 'SKU no encontrado en public.bunker_articulos' });
                        continue;
                    }

                    const cand = resCheck.rows[0];
                    if (Number(cand.familia_id || 0) === 42) {
                        omitidos.push({ sku: cand.articulo_numero, motivo: 'Pertenece a Familia 42 (Artículo Puente / Producción Interna)' });
                        continue;
                    }
                    if (cand.es_obsoleto) {
                        omitidos.push({ sku: cand.articulo_numero, motivo: 'Artículo marcado como obsoleto en Búnker' });
                        continue;
                    }
                    if (cand.solo_produccion_externa) {
                        omitidos.push({ sku: cand.articulo_numero, motivo: 'Artículo exclusivo de Producción Externa (UP)' });
                        continue;
                    }
                    if (!origenTieneReceta && skuClean.toLowerCase() === bultoCerradoOrigen) {
                        omitidos.push({ sku: cand.articulo_numero, motivo: 'Es el Bulto Cerrado origen (LDN 1), aislado de propagación LDN 2' });
                        continue;
                    }
                    const esPackCand = (cand.es_pack === true || parseInt(cand.pack_unidades) > 1) && Boolean(cand.pack_hijo_codigo);
                    if (!cand.tiene_receta && !esPackCand && cand.no_producido_por_lambda) {
                        omitidos.push({ sku: cand.articulo_numero, motivo: 'Artículo de reventa sin receta ni pack (no_producido_por_lambda = true)' });
                        continue;
                    }

                    articulosAfectados.push(cand);
                }
            }

            if (articulosAfectados.length === 0 && !huboCambioIngredienteOAp) {
                await client.query('ROLLBACK');
                const detalleOmitidos = omitidos.length > 0
                    ? ` Motivos de exclusión: ${omitidos.map(o => `[${o.sku}] ${o.motivo}`).join(' · ')}.`
                    : '';
                return res.json({
                    success: false,
                    message: `No se encontraron artículos fraccionados elegibles para el Ingrediente #${ingrediente_id} (${ing.nombre}).${detalleOmitidos}`,
                    omitidos,
                    advertencias
                });
            }

            // Registrar advertencias no bloqueantes si algún artículo propagado con receta tiene bandera histórica no_producido_por_lambda=true
            articulosAfectados.forEach(a => {
                if (a.no_producido_por_lambda === true) {
                    advertencias.push({
                        sku: a.articulo_numero,
                        motivo: 'Tiene receta activa pero arrastra bandera no_producido_por_lambda=true en bunker_articulos (se propagó por tener receta vigente).'
                    });
                }
            });

            // Procesar fracciones hijas antes que Packs Padres para mantener coherencia en la transacción
            articulosAfectados.sort((a, b) => (a.pack_hijo_codigo ? 1 : 0) - (b.pack_hijo_codigo ? 1 : 0));

            let totalActualizados = 0;
            const cambiosHistorialFracciones = [];
            const articulosNodosActualizados = new Set();

            for (const art of articulosAfectados) {
                const sku = art.articulo_numero;
                const kilosUnidad = parseFloat(art.kilos_unidad) || 1;
                const ivaAplicar = ivaPropagacion !== null
                    ? ivaPropagacion
                    : (art.porcentaje_iva !== null && art.porcentaje_iva !== undefined
                        ? parseFloat(art.porcentaje_iva)
                        : (ivaFallbackOrigen !== null ? ivaFallbackOrigen : 21));

                // Determinar si es Pack Padre Real (sin receta propia, es_pack=true o pack_unidades>1, y con hijo válido no recursivo)
                const resTieneReceta = await client.query(
                    `SELECT 1 FROM public.recetas WHERE LOWER(TRIM(articulo_numero)) = LOWER(TRIM($1)) LIMIT 1`,
                    [sku]
                );
                const tieneRecetaPropia = resTieneReceta.rows.length > 0;
                const skuHijoClean = (art.pack_hijo_codigo || '').trim().toLowerCase();
                const esPack = (art.es_pack === true || (parseInt(art.pack_unidades) > 1)) &&
                               Boolean(art.pack_hijo_codigo) &&
                               !tieneRecetaPropia &&
                               skuHijoClean !== sku.toLowerCase() &&
                               skuHijoClean !== bultoCerradoOrigen;

                let costoBaseBultoSinInsumosLista = 0;
                let packMeta = null;
                let tieneEmpaqueEnRecetaPropia = false;

                if (esPack && art.pack_hijo_codigo) {
                    // CÁLCULO DE ARTÍCULO PADRE (PACK MULTIPACK)
                    const skuHijo = art.pack_hijo_codigo.trim();
                    const packUnidades = parseInt(art.pack_unidades) || 10;

                    const resHijo = await client.query(
                        `SELECT kilos_unidad FROM public.bunker_articulos WHERE LOWER(TRIM(articulo_id)) = LOWER(TRIM($1)) LIMIT 1`,
                        [skuHijo]
                    );
                    const kilosHijo = resHijo.rows.length > 0 ? (parseFloat(resHijo.rows[0].kilos_unidad) || 1) : 1;

                    const resRecetaHijo = await client.query(
                        `SELECT ri.ingrediente_id, ri.cantidad, ing.costo_patron, COALESCE(ing.es_insumo, false) AS es_insumo, ing.unidad_medida
                         FROM public.receta_ingredientes ri
                         JOIN public.recetas r ON r.id = ri.receta_id
                         LEFT JOIN public.ingredientes ing ON ing.id = ri.ingrediente_id
                         WHERE LOWER(TRIM(r.articulo_numero)) = LOWER(TRIM($1))`,
                        [skuHijo]
                    );

                    let costoInsumosRecetaHijo = 0;
                    let costoMateriaPrimaHijo = 0;
                    const hijoTieneEmpaqueEnReceta = resRecetaHijo.rows.some(item => item.es_insumo === true || item.unidad_medida === 'Unidades');

                    if (resRecetaHijo.rows.length > 0) {
                        resRecetaHijo.rows.forEach(item => {
                            const cant = parseFloat(item.cantidad) || 0;
                            if (parseInt(item.ingrediente_id) === parseInt(ingrediente_id)) {
                                costoMateriaPrimaHijo += cant * costoKiloIngrediente;
                            } else {
                                costoInsumosRecetaHijo += cant * (parseFloat(item.costo_patron) || 0);
                            }
                        });
                    }
                    if (costoMateriaPrimaHijo === 0 && resRecetaHijo.rows.length === 0) {
                        costoMateriaPrimaHijo = costoKiloIngrediente * kilosHijo;
                    }

                    // Costo de referencia en lista patrón / Lista 1 del hijo (sin duplicar empaque si el hijo ya tiene bolsa en receta)
                    const resLaHijoPatron = await client.query(
                        `SELECT id, COALESCE(costo_tiempo, 0) AS costo_tiempo, COALESCE(mano_obra_activa, true) AS mano_obra_activa
                         FROM public.bunker_lista_articulos
                         WHERE LOWER(TRIM(articulo_numero)) = LOWER(TRIM($1))
                         ORDER BY es_patron DESC, lista_id ASC
                         LIMIT 1`,
                        [skuHijo]
                    );
                    let moHijoPatron = 0;
                    let insumosListaHijoPatron = 0;
                    if (resLaHijoPatron.rows.length > 0) {
                        moHijoPatron = resLaHijoPatron.rows[0].mano_obra_activa !== false
                            ? (parseFloat(resLaHijoPatron.rows[0].costo_tiempo) || 0)
                            : 0;
                        if (!hijoTieneEmpaqueEnReceta) {
                            const resInsHijo = await client.query(
                                `SELECT SUM(COALESCE(li.cantidad, 0) * COALESCE(ing.costo_patron, ba.costo_base, li.costo_unitario_capturado, 0)) AS total_insumos
                                 FROM public.bunker_lista_insumos li
                                 LEFT JOIN public.ingredientes ing ON ing.id::text = li.insumo_articulo_numero
                                 LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = li.insumo_articulo_numero
                                 WHERE li.lista_articulo_id = $1 AND COALESCE(li.incluido, true) = true`,
                                [resLaHijoPatron.rows[0].id]
                            );
                            insumosListaHijoPatron = parseFloat(resInsHijo.rows[0]?.total_insumos) || 0;
                        }
                    }

                    const costoBultoUnitarioHijoPatron = costoMateriaPrimaHijo + costoInsumosRecetaHijo + insumosListaHijoPatron + moHijoPatron;
                    costoBaseBultoSinInsumosLista = costoBultoUnitarioHijoPatron * packUnidades;
                    packMeta = {
                        skuHijo,
                        packUnidades,
                        hijoTieneEmpaqueEnReceta,
                        costoBaseRecetaHijo: costoMateriaPrimaHijo + costoInsumosRecetaHijo,
                        costoBultoUnitarioHijoPatron
                    };
                } else {
                    // CÁLCULO DE FRACCIÓN DIRECTA (usa estrictamente ri.cantidad de la receta)
                    const resRecetaItems = await client.query(
                        `SELECT ri.ingrediente_id, ri.cantidad, ing.costo_patron, COALESCE(ing.es_insumo, false) AS es_insumo, ing.unidad_medida
                         FROM public.receta_ingredientes ri
                         JOIN public.recetas r ON r.id = ri.receta_id
                         LEFT JOIN public.ingredientes ing ON ing.id = ri.ingrediente_id
                         WHERE LOWER(TRIM(r.articulo_numero)) = LOWER(TRIM($1))`,
                        [sku]
                    );

                    let costoInsumosReceta = 0;
                    let costoMateriaPrimaBulto = 0;
                    tieneEmpaqueEnRecetaPropia = resRecetaItems.rows.some(item => item.es_insumo === true || item.unidad_medida === 'Unidades');

                    if (resRecetaItems.rows.length > 0) {
                        resRecetaItems.rows.forEach(item => {
                            const cant = parseFloat(item.cantidad) || 0;
                            if (parseInt(item.ingrediente_id) === parseInt(ingrediente_id)) {
                                costoMateriaPrimaBulto += cant * costoKiloIngrediente;
                            } else {
                                const costoPatronInsumo = parseFloat(item.costo_patron) || 0;
                                costoInsumosReceta += cant * costoPatronInsumo;
                            }
                        });
                    }

                    if (costoMateriaPrimaBulto === 0 && resRecetaItems.rows.length === 0) {
                        costoMateriaPrimaBulto = costoKiloIngrediente * kilosUnidad;
                    }

                    costoBaseBultoSinInsumosLista = costoMateriaPrimaBulto + costoInsumosReceta;
                }

                // 2. Guardar costo_base en public.bunker_articulos SIN incrustar bunker_lista_insumos propios del artículo/pack
                // (evita duplicar la bolsa exterior 30x40 en Packs como ATyS10x150, ADP10X200G, APN25/2710X150G).
                const costoBaseMaestro = Number(costoBaseBultoSinInsumosLista.toFixed(2));

                await client.query(
                    `UPDATE public.bunker_articulos
                     SET costo_base = $1,
                         porcentaje_iva = $2,
                         updated_at = CURRENT_TIMESTAMP
                     WHERE LOWER(TRIM(articulo_id)) = LOWER(TRIM($3))`,
                    [costoBaseMaestro, ivaAplicar, sku]
                );
                articulosActualizados.push({ articulo_id: sku, costo_base: costoBaseMaestro, porcentaje_iva: ivaAplicar });

                // 3. Obtener listas activas y actualizar precio_final (sumando insumos propios de la lista solo si aplica y sin duplicar empaque de receta)
                const resListas = await client.query(
                    `SELECT la.id, la.lista_id, la.costo_tiempo, COALESCE(la.mano_obra_activa, true) AS mano_obra_activa,
                            la.margen_ganancia, la.iva, COALESCE(la.modo_iva, 'COMPLETO') AS modo_iva,
                            la.precio_final, la.costo_base_sobrescrito, COALESCE(la.disponible, true) AS disponible,
                            COALESCE(blp.canal_comercial, 'MAYORISTA') AS canal_comercial
                     FROM public.bunker_lista_articulos la
                     JOIN public.bunker_listas_precios blp ON blp.id = la.lista_id
                     WHERE LOWER(TRIM(la.articulo_numero)) = LOWER(TRIM($1))
                       AND blp.activa = true`,
                    [sku]
                );

                for (const la of resListas.rows) {
                    const esCanalNodos = String(la.canal_comercial || '').toUpperCase() === 'NODOS';
                    if (esCanalNodos && la.disponible === false) {
                        continue;
                    }
                    if (esCanalNodos) {
                        articulosNodosActualizados.add(String(sku));
                    }

                    let costoBaseSinInsEnEstaLista = costoBaseBultoSinInsumosLista;
                    if (packMeta) {
                        const resLaHijoLista = await client.query(
                            `SELECT id, COALESCE(costo_tiempo, 0) AS costo_tiempo, COALESCE(mano_obra_activa, true) AS mano_obra_activa
                             FROM public.bunker_lista_articulos
                             WHERE lista_id = $1 AND LOWER(TRIM(articulo_numero)) = LOWER(TRIM($2))
                             LIMIT 1`,
                            [la.lista_id, packMeta.skuHijo]
                        );
                        if (resLaHijoLista.rows.length > 0) {
                            const laHijoRow = resLaHijoLista.rows[0];
                            const moHijoLista = laHijoRow.mano_obra_activa !== false ? (parseFloat(laHijoRow.costo_tiempo) || 0) : 0;
                            let insHijoLista = 0;
                            if (!packMeta.hijoTieneEmpaqueEnReceta) {
                                const resInsHijoLista = await client.query(
                                    `SELECT SUM(COALESCE(li.cantidad, 0) * COALESCE(ing.costo_patron, ba.costo_base, li.costo_unitario_capturado, 0)) AS total_insumos
                                     FROM public.bunker_lista_insumos li
                                     LEFT JOIN public.ingredientes ing ON ing.id::text = li.insumo_articulo_numero
                                     LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = li.insumo_articulo_numero
                                     WHERE li.lista_articulo_id = $1 AND COALESCE(li.incluido, true) = true`,
                                    [laHijoRow.id]
                                );
                                insHijoLista = parseFloat(resInsHijoLista.rows[0]?.total_insumos) || 0;
                            }
                            costoBaseSinInsEnEstaLista = (packMeta.costoBaseRecetaHijo + insHijoLista + moHijoLista) * packMeta.packUnidades;
                        }
                    }

                    // Guard contra doble conteo: en fracción directa que ya tiene bolsa en receta, no sumar además bunker_lista_insumos.
                    // En Packs Padres (esPack=true), bunker_lista_insumos corresponde a la bolsa exterior del Pack y SÍ se suma al costo neto del bulto.
                    let costoInsumosLista = 0;
                    if (esPack || !tieneEmpaqueEnRecetaPropia) {
                        const resInsumosLista = await client.query(
                            `SELECT SUM(COALESCE(li.cantidad, 0) * COALESCE(ing.costo_patron, ba.costo_base, li.costo_unitario_capturado, 0)) AS total_insumos
                             FROM public.bunker_lista_insumos li
                             LEFT JOIN public.ingredientes ing ON ing.id::text = li.insumo_articulo_numero
                             LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = li.insumo_articulo_numero
                             WHERE li.lista_articulo_id = $1 AND COALESCE(li.incluido, true) = true`,
                            [la.id]
                        );
                        costoInsumosLista = parseFloat(resInsumosLista.rows[0]?.total_insumos) || 0;
                    }
                    const costoTotalBultoConTodosInsumos = costoBaseSinInsEnEstaLista + costoInsumosLista;
                    const costoKiloSobrescritoFinal = Number((costoBaseSinInsEnEstaLista / kilosUnidad).toFixed(4));

                    const costoTiempo = la.mano_obra_activa !== false ? (parseFloat(la.costo_tiempo) || 0) : 0;
                    const margen = parseFloat(la.margen_ganancia) || 0;
                    const ivaLista = ivaPropagacion !== null
                        ? ivaPropagacion
                        : (la.iva !== null && la.iva !== undefined ? parseFloat(la.iva) : ivaAplicar);
                    const modoIva = String(la.modo_iva || 'COMPLETO').toUpperCase();
                    let ivaEfectivo = ivaLista;
                    if (modoIva === 'MEDIO') ivaEfectivo = ivaLista / 2;
                    else if (modoIva === 'SIN' || modoIva === 'EXENTO') ivaEfectivo = 0;

                    const precioFinal = Number((((costoTotalBultoConTodosInsumos * (1 + (margen / 100))) + costoTiempo) * (1 + (ivaEfectivo / 100))).toFixed(2));

                    cambiosHistorialFracciones.push({
                        articulo_numero: sku,
                        lista_id: la.lista_id,
                        costo_anterior: parseFloat(la.costo_base_sobrescrito || 0),
                        costo_nuevo: costoKiloSobrescritoFinal,
                        precio_anterior: parseFloat(la.precio_final || 0),
                        precio_nuevo: precioFinal,
                        porcentaje_iva: ivaLista,
                        origen_cambio: 'PROPAGACION_FRACCIONES',
                        usuario: req.user ? (req.user.username || req.user.nombre) : 'OPERADOR'
                    });

                    await client.query(
                        `UPDATE public.bunker_lista_articulos
                         SET costo_base_sobrescrito = $1,
                             iva = $2,
                             precio_final = $3,
                             updated_at = NOW()
                         WHERE id = $4`,
                        [costoKiloSobrescritoFinal, ivaLista, precioFinal, la.id]
                    );
                    listasActualizadas.push({
                        id: la.id,
                        lista_id: la.lista_id,
                        articulo_numero: sku,
                        costo_base_sobrescrito: costoKiloSobrescritoFinal,
                        iva: ivaLista,
                        precio_final: precioFinal
                    });
                }

                totalActualizados++;
            }

            // Registrar auditoría de variaciones de fracciones
            if (cambiosHistorialFracciones.length > 0) {
                await historialPreciosService.registrarCambiosLote({
                    client,
                    cambios: cambiosHistorialFracciones,
                    origen_cambio: 'PROPAGACION_FRACCIONES',
                    usuario: req.user ? (req.user.username || req.user.nombre) : 'OPERADOR'
                });
            }

            await client.query('COMMIT');

            if (articulosNodosActualizados.size > 0) {
                const nodosBarrialesService = require('../services/nodosBarrialesService');
                for (const artId of articulosNodosActualizados) {
                    await nodosBarrialesService.sincronizarCatalogoNodoDesdeBunker(artId);
                }
            }
            try {
                const combosCompuestosService = require('../services/combosCompuestosService');
                const skusProp = Array.isArray(articulosActualizados)
                    ? articulosActualizados.map(x => String(x?.articulo_id || x?.sku || x || '').trim()).filter(Boolean)
                    : [];
                if (skusProp.length > 0) {
                    await combosCompuestosService.recalcularCombosAfectadosPorCambio(pool, { skusModificados: skusProp });
                }
            } catch (comboErr) {
                console.warn('[CONCILIACION->COMBOS] Aviso recalculando combos en cascada:', comboErr.message);
            }

            const sufijoOmitidos = omitidos.length > 0
                ? ` (${omitidos.length} SKU omitido(s): ${omitidos.map(o => `${o.sku}: ${o.motivo}`).join(' · ')})`
                : '';

            return res.json({
                success: true,
                message: `Propagación completada con éxito: ${totalActualizados} artículos fraccionados mono-ingrediente actualizados en la BD ($${costoKiloIngrediente.toFixed(2)}/kg).${sufijoOmitidos}`,
                ingrediente: ing,
                articulosAfectadosCount: totalActualizados,
                articulosActualizados,
                listasActualizadas,
                omitidos,
                advertencias
            });

        } catch (err) {
            try { await client.query('ROLLBACK'); } catch (_) {}
            console.error('❌ Error en propagarIngredienteAFracciones:', err);
            return res.status(500).json({ success: false, message: err.message || 'Error al propagar ingrediente a fracciones.' });
        } finally {
            client.release();
        }
    }
}

module.exports = new ConciliacionController();
