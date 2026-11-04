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
     * directamente al ingrediente vinculado en public.ingredientes.costo_patron
     */
    async sincronizarIngredienteDesdeArticulo(req, res) {
        try {
            const { articulo_id, ingrediente_id, costo_kilo_manual, iva_manual } = req.body;

            if (!articulo_id) {
                return res.status(400).json({ success: false, message: 'Parámetro articulo_id requerido.' });
            }

            // 1. Obtener costo_base y kilos_unidad del artículo
            const resArt = await pool.query(
                `SELECT costo_base, kilos_unidad, porcentaje_iva FROM public.bunker_articulos WHERE TRIM(articulo_id) = $1 LIMIT 1`,
                [String(articulo_id).trim()]
            );

            if (resArt.rows.length === 0) {
                return res.status(404).json({ success: false, message: `Artículo ${articulo_id} no encontrado.` });
            }

            const art = resArt.rows[0];
            const kilosUnidad = parseFloat(art.kilos_unidad) || 1;
            
            let costoKiloFinal = 0;
            let ivaFinal = iva_manual !== undefined && iva_manual !== null ? parseFloat(iva_manual) : null;

            if (costo_kilo_manual !== undefined && costo_kilo_manual !== null && parseFloat(costo_kilo_manual) > 0) {
                costoKiloFinal = parseFloat(costo_kilo_manual);
                const nuevoCostoBulto = costoKiloFinal * kilosUnidad;

                // Actualizar bunker_articulos
                await pool.query(
                    `UPDATE public.bunker_articulos 
                     SET costo_base = $1, 
                         porcentaje_iva = COALESCE($2, porcentaje_iva)
                     WHERE TRIM(articulo_id) = $3`,
                    [nuevoCostoBulto, ivaFinal, String(articulo_id).trim()]
                );

                // Recalcular bunker_lista_articulos
                await pool.query(
                    `UPDATE public.bunker_lista_articulos
                     SET costo_base_sobrescrito = $1,
                         iva = COALESCE($2::numeric, iva),
                         precio_final = ($3::numeric * (1 + (COALESCE(margen_ganancia, 0) / 100)) + COALESCE(costo_tiempo, 0)) * (1 + (COALESCE($2::numeric, iva) / 100)),
                         updated_at = NOW()
                     WHERE TRIM(articulo_numero) = $4`,
                    [costoKiloFinal, ivaFinal, nuevoCostoBulto, String(articulo_id).trim()]
                );
            } else {
                const costoBase = parseFloat(art.costo_base) || 0;
                costoKiloFinal = kilosUnidad > 0 ? (costoBase / kilosUnidad) : costoBase;
            }

            // 2. Actualizar public.ingredientes.costo_patron SOLAMENTE si se pasó ingrediente_id explícito
            let ingActualizado = null;
            if (ingrediente_id && parseInt(ingrediente_id) > 0) {
                const resUpdate = await pool.query(
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

            if (!ingActualizado) {
                return res.json({
                    success: true,
                    message: `Costo y parámetros del artículo [${articulo_id}] actualizados con éxito ($${costoKiloFinal.toFixed(2)}/kg). El ingrediente de fábrica no fue modificado.`,
                    costoKilo: costoKiloFinal
                });
            }

            return res.json({
                success: true,
                message: `Costo y parámetros actualizados con éxito: SKU [${articulo_id}] e Ingrediente "${ingActualizado.nombre}" a $${costoKiloFinal.toFixed(2)}/kg.`,
                ingrediente: ingActualizado,
                costoKilo: costoKiloFinal
            });

        } catch (err) {
            console.error('❌ Error en sincronizarIngredienteDesdeArticulo:', err);
            return res.status(500).json({ success: false, message: err.message || 'Error al sincronizar ingrediente.' });
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
            const { ingrediente_id, porcentaje_iva, articulos_target_ids } = req.body;

            if (!ingrediente_id) {
                return res.status(400).json({ success: false, message: 'Parámetro ingrediente_id requerido.' });
            }

            await client.query('BEGIN');

            // 1. Obtener costo_patron del ingrediente
            const resIng = await client.query(
                `SELECT id, nombre, costo_patron, articulo_vinculado_numero FROM public.ingredientes WHERE id = $1 LIMIT 1`,
                [parseInt(ingrediente_id)]
            );

            if (resIng.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: `Ingrediente #${ingrediente_id} no encontrado.` });
            }

            const ing = resIng.rows[0];
            const costoKiloIngrediente = parseFloat(ing.costo_patron) || 0;

            // 2. Resolver el IVA a propagar (desde req.body, del Bulto Origen o fallback)
            const bultoCerradoOrigen = String(ing.articulo_vinculado_numero || '').trim().toLowerCase();
            let ivaPropagacion = porcentaje_iva !== undefined && porcentaje_iva !== null ? parseFloat(porcentaje_iva) : null;

            if (ivaPropagacion === null && bultoCerradoOrigen) {
                const resBulto = await client.query(
                    `SELECT porcentaje_iva FROM public.bunker_articulos WHERE LOWER(TRIM(articulo_id)) = LOWER(TRIM($1)) LIMIT 1`,
                    [bultoCerradoOrigen]
                );
                if (resBulto.rows.length > 0 && resBulto.rows[0].porcentaje_iva) {
                    ivaPropagacion = parseFloat(resBulto.rows[0].porcentaje_iva);
                }
            }

            // 3. Buscar artículos fraccionados con receta que consumen este ingrediente (Flujo 2)
            const resArtRecetas = await client.query(
                `SELECT DISTINCT r.articulo_numero, ba.kilos_unidad, ba.descripcion, ba.porcentaje_iva, ba.es_pack, ba.pack_hijo_codigo, ba.pack_unidades
                 FROM public.receta_ingredientes ri
                 JOIN public.recetas r ON r.id = ri.receta_id
                 JOIN public.bunker_articulos ba ON LOWER(TRIM(ba.articulo_id)) = LOWER(TRIM(r.articulo_numero))
                 WHERE ri.ingrediente_id = $1`,
                [parseInt(ingrediente_id)]
            );

            const origenTieneReceta = bultoCerradoOrigen && resArtRecetas.rows.some(r => (r.articulo_numero || '').trim().toLowerCase() === bultoCerradoOrigen);

            // AISLAMIENTO LDN 1 vs LDN 2: La propagación de un ingrediente a sus fracciones (LDN 2) NO debe alterar ni recalcular el Bulto Cerrado de origen (LDN 1).

            let articulosAfectados = resArtRecetas.rows.filter(r => {
                const sku = (r.articulo_numero || '').trim().toLowerCase();
                return Boolean(sku);
            });

            // 3.1. Detectar también Artículos Padre (Packs) cuyos hijos sean fracciones que consumen este ingrediente
            const hijosSkus = articulosAfectados.map(r => (r.articulo_numero || '').trim());
            if (hijosSkus.length > 0) {
                const resPacks = await client.query(
                    `SELECT ba.articulo_id AS articulo_numero, ba.kilos_unidad, ba.descripcion, ba.porcentaje_iva, ba.es_pack, ba.pack_hijo_codigo, ba.pack_unidades
                     FROM public.bunker_articulos ba
                     WHERE (ba.es_pack = true OR (ba.pack_unidades IS NOT NULL AND ba.pack_unidades > 1))
                       AND ba.pack_hijo_codigo = ANY($1)
                       AND NOT EXISTS (SELECT 1 FROM public.recetas r WHERE LOWER(TRIM(r.articulo_numero)) = LOWER(TRIM(ba.articulo_id)))`,
                    [hijosSkus]
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
                
                // Si la consulta SQL estricta omitió alguno de los resueltos por la UI (ej: vinculación directa), consultar sus datos
                for (const targetSku of articulos_target_ids) {
                    const skuClean = String(targetSku).trim();
                    const alreadyFound = articulosAfectados.some(r => r.articulo_numero.trim().toLowerCase() === skuClean.toLowerCase());
                    if (!alreadyFound && (origenTieneReceta || skuClean.toLowerCase() !== bultoCerradoOrigen)) {
                        const resDirect = await client.query(
                            `SELECT articulo_id AS articulo_numero, kilos_unidad, descripcion, porcentaje_iva, es_pack, pack_hijo_codigo, pack_unidades 
                             FROM public.bunker_articulos 
                             WHERE LOWER(TRIM(articulo_id)) = LOWER(TRIM($1)) LIMIT 1`,
                            [skuClean]
                        );
                        if (resDirect.rows.length > 0) {
                            articulosAfectados.push(resDirect.rows[0]);
                        }
                    }
                }
            }

            if (articulosAfectados.length === 0) {
                await client.query('ROLLBACK');
                return res.json({
                    success: false,
                    message: `No se encontraron artículos fraccionados derivados para el Ingrediente #${ingrediente_id} (${ing.nombre}).`
                });
            }

            let totalActualizados = 0;
            const cambiosHistorialFracciones = [];

            for (const art of articulosAfectados) {
                const sku = art.articulo_numero;
                const kilosUnidad = parseFloat(art.kilos_unidad) || 1;
                const ivaAplicar = ivaPropagacion !== null ? ivaPropagacion : (parseFloat(art.porcentaje_iva) || 21);

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

                let costoBaseBultoTotal = 0;

                if (esPack && art.pack_hijo_codigo) {
                    // CÁLCULO DE ARTÍCULO PADRE (PACK MULTIPACK)
                    const skuHijo = art.pack_hijo_codigo.trim();
                    const packUnidades = parseInt(art.pack_unidades) || 10;

                    // 1. Obtener datos y receta del hijo
                    const resHijo = await client.query(
                        `SELECT kilos_unidad FROM public.bunker_articulos WHERE LOWER(TRIM(articulo_id)) = LOWER(TRIM($1)) LIMIT 1`,
                        [skuHijo]
                    );
                    const kilosHijo = resHijo.rows.length > 0 ? (parseFloat(resHijo.rows[0].kilos_unidad) || 1) : 1;

                    const resRecetaHijo = await client.query(
                        `SELECT ri.ingrediente_id, ri.cantidad, ing.costo_patron
                         FROM public.receta_ingredientes ri
                         JOIN public.recetas r ON r.id = ri.receta_id
                         LEFT JOIN public.ingredientes ing ON ing.id = ri.ingrediente_id
                         WHERE LOWER(TRIM(r.articulo_numero)) = LOWER(TRIM($1))`,
                        [skuHijo]
                    );

                    let costoInsumosHijo = 0;
                    let costoMateriaPrimaHijo = 0;

                    if (resRecetaHijo.rows.length > 0) {
                        resRecetaHijo.rows.forEach(item => {
                            const cant = parseFloat(item.cantidad) || 0;
                            if (parseInt(item.ingrediente_id) === parseInt(ingrediente_id)) {
                                costoMateriaPrimaHijo += cant * costoKiloIngrediente;
                            } else {
                                costoInsumosHijo += cant * (parseFloat(item.costo_patron) || 0);
                            }
                        });
                    }
                    if (costoMateriaPrimaHijo === 0 && resRecetaHijo.rows.length === 0) {
                        costoMateriaPrimaHijo = costoKiloIngrediente * kilosHijo;
                    }

                    // 1.1. Obtener costo_tiempo (mano de obra de fraccionamiento) del hijo
                    const resMoHijo = await client.query(
                        `SELECT COALESCE(costo_tiempo, 0) as costo_tiempo, mano_obra_activa
                         FROM public.bunker_lista_articulos
                         WHERE LOWER(TRIM(articulo_numero)) = LOWER(TRIM($1))
                         ORDER BY es_patron DESC, lista_id ASC
                         LIMIT 1`,
                        [skuHijo]
                    );
                    const moHijo = (resMoHijo.rows.length > 0 && resMoHijo.rows[0].mano_obra_activa !== false)
                        ? (parseFloat(resMoHijo.rows[0].costo_tiempo) || 0)
                        : 0;

                    const costoBultoUnitarioHijo = costoMateriaPrimaHijo + costoInsumosHijo + moHijo;
                    costoBaseBultoTotal = costoBultoUnitarioHijo * packUnidades;

                } else {
                    // CÁLCULO DE FRACCIÓN MONO DIRECTA
                    // 1. Obtener insumos de la receta de este artículo (ej: Bolsa 30x40)
                    const resRecetaItems = await client.query(
                        `SELECT ri.ingrediente_id, ri.cantidad, ing.costo_patron, ing.es_insumo, ing.unidad_medida
                         FROM public.receta_ingredientes ri
                         JOIN public.recetas r ON r.id = ri.receta_id
                         LEFT JOIN public.ingredientes ing ON ing.id = ri.ingrediente_id
                         WHERE LOWER(TRIM(r.articulo_numero)) = LOWER(TRIM($1))`,
                        [sku]
                    );

                    let costoInsumosReceta = 0;
                    let costoMateriaPrimaBulto = 0;

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

                    // Fallback de materia prima solo si no existen ítems desglosados en la receta
                    if (costoMateriaPrimaBulto === 0 && resRecetaItems.rows.length === 0) {
                        costoMateriaPrimaBulto = costoKiloIngrediente * kilosUnidad;
                    }

                    costoBaseBultoTotal = costoMateriaPrimaBulto + costoInsumosReceta;
                }

                const costoKiloBaseSobrescritoCalculado = costoBaseBultoTotal / kilosUnidad;

                // 2. Resolver costo_base para public.bunker_articulos
                // Si tiene insumos de empaque en bunker_lista_insumos para su lista principal, reflejarlos en costo_base maestro
                let costoBaseMaestro = costoBaseBultoTotal;
                const resInsumosPrincipal = await client.query(
                    `SELECT SUM(COALESCE(li.cantidad, 0) * COALESCE(ing.costo_patron, ba.costo_base, li.costo_unitario_capturado, 0)) AS total_insumos
                     FROM public.bunker_lista_insumos li
                     JOIN public.bunker_lista_articulos la ON la.id = li.lista_articulo_id
                     LEFT JOIN public.ingredientes ing ON ing.id::text = li.insumo_articulo_numero
                     LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = li.insumo_articulo_numero
                     WHERE LOWER(TRIM(la.articulo_numero)) = LOWER(TRIM($1))
                       AND COALESCE(li.incluido, true) = true
                     GROUP BY la.id
                     ORDER BY la.lista_id ASC
                     LIMIT 1`,
                    [sku]
                );
                if (resInsumosPrincipal.rows.length > 0) {
                    costoBaseMaestro += parseFloat(resInsumosPrincipal.rows[0]?.total_insumos) || 0;
                }

                await client.query(
                    `UPDATE public.bunker_articulos
                     SET costo_base = $1,
                         porcentaje_iva = $2
                     WHERE LOWER(TRIM(articulo_id)) = LOWER(TRIM($3))`,
                    [costoBaseMaestro, ivaAplicar, sku]
                );

                // 3. Obtener listas de precios y sumar insumos de lista
                const resListas = await client.query(
                    `SELECT id, lista_id, costo_tiempo, margen_ganancia, iva, precio_final, costo_base_sobrescrito 
                     FROM public.bunker_lista_articulos 
                     WHERE LOWER(TRIM(articulo_numero)) = LOWER(TRIM($1))`,
                    [sku]
                );

                for (const la of resListas.rows) {
                    const resInsumosLista = await client.query(
                        `SELECT SUM(COALESCE(li.cantidad, 0) * COALESCE(ing.costo_patron, ba.costo_base, li.costo_unitario_capturado, 0)) AS total_insumos
                         FROM public.bunker_lista_insumos li
                         LEFT JOIN public.ingredientes ing ON ing.id::text = li.insumo_articulo_numero
                         LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = li.insumo_articulo_numero
                         WHERE li.lista_articulo_id = $1 AND COALESCE(li.incluido, true) = true`,
                        [la.id]
                    );
                    const costoInsumosLista = parseFloat(resInsumosLista.rows[0]?.total_insumos) || 0;
                    const costoTotalBultoConTodosInsumos = costoBaseBultoTotal + costoInsumosLista;
                    const costoKiloSobrescritoFinal = costoTotalBultoConTodosInsumos / kilosUnidad;

                    const costoTiempo = parseFloat(la.costo_tiempo) || 0;
                    const margen = parseFloat(la.margen_ganancia) || 0;
                    const ivaLista = ivaAplicar;

                    const precioFinal = (costoTotalBultoConTodosInsumos * (1 + (margen / 100)) + costoTiempo) * (1 + (ivaLista / 100));

                    // Preparar registro para historial
                    cambiosHistorialFracciones.push({
                        articulo_numero: sku,
                        lista_id: la.lista_id,
                        costo_anterior: parseFloat(la.costo_base_sobrescrito || 0),
                        costo_nuevo: costoKiloSobrescritoFinal,
                        precio_anterior: parseFloat(la.precio_final || 0),
                        precio_nuevo: precioFinal,
                        porcentaje_iva: ivaLista,
                        origen_cambio: 'PROPAGACION_FRACCIONES',
                        usuario: 'OPERADOR'
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
                }

                totalActualizados++;
            }

            // Registrar auditoría de variaciones de fracciones
            if (cambiosHistorialFracciones.length > 0) {
                await historialPreciosService.registrarCambiosLote({
                    client,
                    cambios: cambiosHistorialFracciones,
                    origen_cambio: 'PROPAGACION_FRACCIONES',
                    usuario: 'OPERADOR'
                });
            }

            await client.query('COMMIT');

            return res.json({
                success: true,
                message: `Propagación completada con éxito: ${totalActualizados} artículos fraccionados mono-ingrediente actualizados en la BD ($${costoKiloIngrediente.toFixed(2)}/kg).`,
                ingrediente: ing,
                articulosAfectadosCount: totalActualizados
            });

        } catch (err) {
            await client.query('ROLLBACK');
            console.error('❌ Error en propagarIngredienteAFracciones:', err);
            return res.status(500).json({ success: false, message: err.message || 'Error al propagar ingrediente a fracciones.' });
        } finally {
            client.release();
        }
    }
}

module.exports = new ConciliacionController();
