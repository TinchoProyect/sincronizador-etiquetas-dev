/**
 * Controlador de Rutas
 * Lógica de negocio para gestión de rutas de reparto
 */

const RutasModel = require('../models/rutasModel');
const presupuestosModel = require('../models/presupuestosModel');
const { obtenerDestinatariosInicioRuta, despacharNotificacionesInicioRuta } = require('../services/notificacionInicioRutaService');

/**
 * Obtener todas las rutas con filtros
 * GET /api/logistica/rutas
 */
async function obtenerRutas(req, res) {
    try {
        console.log('[RUTAS] Obteniendo rutas con filtros:', req.query);
        
        const filtros = {
            estado: req.query.estado,
            id_chofer: req.query.id_chofer ? parseInt(req.query.id_chofer) : undefined,
            fecha_desde: req.query.fecha_desde,
            fecha_hasta: req.query.fecha_hasta,
            busqueda: req.query.busqueda
        };
        
        const rutas = await RutasModel.obtenerTodas(filtros);
        
        console.log(`[RUTAS] ✅ ${rutas.length} rutas encontradas`);
        
        res.json({
            success: true,
            data: rutas,
            total: rutas.length
        });
        
    } catch (error) {
        console.error('[RUTAS] ❌ Error al obtener rutas:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener rutas',
            message: error.message
        });
    }
}

/**
 * Obtener una ruta por ID con sus presupuestos
 * GET /api/logistica/rutas/:id
 */
async function obtenerRutaPorId(req, res) {
    try {
        const { id } = req.params;
        console.log(`[RUTAS] Obteniendo ruta ID: ${id}`);
        
        const ruta = await RutasModel.obtenerPorId(parseInt(id));
        
        if (!ruta) {
            console.log(`[RUTAS] ⚠️ Ruta ${id} no encontrada`);
            return res.status(404).json({
                success: false,
                error: 'Ruta no encontrada'
            });
        }
        
        console.log(`[RUTAS] ✅ Ruta ${id} encontrada con ${ruta.total_presupuestos} presupuestos`);
        
        // VIGÍA DE DEPURACIÓN (Ticket #8): Traza exacta de totales
        if (ruta.presupuestos && ruta.presupuestos.length > 0) {
            console.log(`[VIGÍA-FINANCIERO] TICKET #8 - TRAZA DE TOTALES EN LOGÍSTICA (RUTA ASIGNADA):`);
            ruta.presupuestos.forEach(p => {
                console.log(`  -> ID_Presupuesto: ${p.id_presupuesto_ext || p.numero_presupuesto || p.id} | Subtotal_Bruto_con_IVA: $${Number(p.subtotal_bruto).toFixed(2)} | Descuento_Detectado: ${Number(p.descuento_aplicado * 100).toFixed(2)}% | Total_Final_Enviado_a_UI: $${Number(p.total).toFixed(2)}`);
            });
        }
        
        res.json({
            success: true,
            data: ruta
        });
        
    } catch (error) {
        console.error('[RUTAS] ❌ Error al obtener ruta:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener ruta',
            message: error.message
        });
    }
}

/**
 * Crear una nueva ruta
 * POST /api/logistica/rutas
 */
async function crearRuta(req, res) {
    try {
        console.log('[RUTAS] Creando nueva ruta:', req.body);
        
        const {
            nombre_ruta,
            fecha_salida,
            id_chofer,
            id_vehiculo
        } = req.body;
        
        // Validaciones
        if (!nombre_ruta) {
            return res.status(400).json({
                success: false,
                error: 'El campo nombre_ruta es requerido'
            });
        }
        
        if (!fecha_salida) {
            return res.status(400).json({
                success: false,
                error: 'El campo fecha_salida es requerido'
            });
        }
        
        if (!id_chofer) {
            return res.status(400).json({
                success: false,
                error: 'El campo id_chofer es requerido'
            });
        }
        
        // Verificar que el chofer existe
        const choferExiste = await RutasModel.choferExiste(id_chofer);
        if (!choferExiste) {
            console.log(`[RUTAS] ⚠️ Chofer ${id_chofer} no existe`);
            return res.status(404).json({
                success: false,
                error: 'Chofer no encontrado'
            });
        }
        
        // Nota: Permitimos fechas pasadas para registrar rutas retroactivas
        // La validación de advertencia se hace en el frontend
        const fechaSalida = new Date(fecha_salida);
        if (fechaSalida < new Date()) {
            console.log('[RUTAS] ℹ️ Creando ruta con fecha pasada (retroactiva)');
        }
        
        // Crear ruta
        const nuevaRuta = await RutasModel.crear({
            nombre_ruta,
            fecha_salida,
            id_chofer: parseInt(id_chofer) || 0,
            id_vehiculo,
            usuario_creador_id: (req.user?.id && parseInt(req.user.id)) || 1
        });
        
        console.log(`[RUTAS] ✅ Ruta creada con ID: ${nuevaRuta.id}`);
        
        res.status(201).json({
            success: true,
            message: 'Ruta creada exitosamente',
            data: nuevaRuta
        });
        
    } catch (error) {
        console.error('[RUTAS] ❌ Error al crear ruta:', error);
        res.status(500).json({
            success: false,
            error: 'Error al crear ruta',
            message: error.message
        });
    }
}

/**
 * Actualizar una ruta existente
 * PUT /api/logistica/rutas/:id
 */
async function actualizarRuta(req, res) {
    try {
        const { id } = req.params;
        console.log(`[RUTAS] Actualizando ruta ID: ${id}`, req.body);
        
        const {
            nombre_ruta,
            fecha_salida,
            id_chofer,
            id_vehiculo,
            estado,
            distancia_total_km,
            tiempo_estimado_min
        } = req.body;
        
        // Validar que la ruta existe
        const rutaExistente = await RutasModel.obtenerPorId(parseInt(id));
        if (!rutaExistente) {
            console.log(`[RUTAS] ⚠️ Ruta ${id} no encontrada`);
            return res.status(404).json({
                success: false,
                error: 'Ruta no encontrada'
            });
        }
        
        // Si se cambia el chofer, validar que existe
        if (id_chofer) {
            const choferExiste = await RutasModel.choferExiste(id_chofer);
            if (!choferExiste) {
                console.log(`[RUTAS] ⚠️ Chofer ${id_chofer} no existe`);
                return res.status(404).json({
                    success: false,
                    error: 'Chofer no encontrado'
                });
            }
        }
        
        // Actualizar ruta
        const rutaActualizada = await RutasModel.actualizar(parseInt(id), {
            nombre_ruta,
            fecha_salida,
            id_chofer: id_chofer ? parseInt(id_chofer) : undefined,
            id_vehiculo,
            estado,
            distancia_total_km: distancia_total_km ? parseFloat(distancia_total_km) : undefined,
            tiempo_estimado_min: tiempo_estimado_min ? parseInt(tiempo_estimado_min) : undefined
        });
        
        console.log(`[RUTAS] ✅ Ruta ${id} actualizada`);
        
        res.json({
            success: true,
            message: 'Ruta actualizada exitosamente',
            data: rutaActualizada
        });
        
    } catch (error) {
        console.error('[RUTAS] ❌ Error al actualizar ruta:', error);
        res.status(500).json({
            success: false,
            error: 'Error al actualizar ruta',
            message: error.message
        });
    }
}

/**
 * Asignar presupuestos a una ruta
 * PUT /api/logistica/rutas/:id/asignar
 */
async function asignarPresupuestos(req, res) {
    try {
        const { id } = req.params;
        const { ids_presupuestos } = req.body;
        
        console.log(`[RUTAS] Asignando presupuestos a ruta ID: ${id}`, ids_presupuestos);
        
        // Validaciones
        if (!ids_presupuestos || !Array.isArray(ids_presupuestos)) {
            return res.status(400).json({
                success: false,
                error: 'El campo ids_presupuestos es requerido y debe ser un array'
            });
        }
        
        if (ids_presupuestos.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Debe proporcionar al menos un presupuesto para asignar'
            });
        }
        
        // Validar que todos los IDs sean enteros positivos o strings numéricos, o strings tipo 'RT-XX' / 'SOB-XX' / 'PR-XX'
        const idsValidos = ids_presupuestos.every(id => {
            if (Number.isInteger(id) && id > 0) return true;
            if (typeof id === 'string' && !isNaN(id) && Number.isInteger(Number(id)) && Number(id) > 0) return true;
            if (typeof id === 'string' && id.toUpperCase().startsWith('RT-') && !isNaN(parseInt(id.toUpperCase().replace('RT-', '')))) return true;
            if (typeof id === 'string' && id.toUpperCase().startsWith('SOB-') && !isNaN(parseInt(id.toUpperCase().replace('SOB-', '')))) return true;
            if (typeof id === 'string' && id.toUpperCase().startsWith('PR-') && !isNaN(parseInt(id.toUpperCase().replace('PR-', '')))) return true;
            return false;
        });
        
        if (!idsValidos) {
            return res.status(400).json({
                success: false,
                error: 'Todos los IDs deben ser numéricos, retiros válidos (RT-), sobres válidos (SOB-) o contactos válidos (PR-)'
            });
        }
        
        // Asignar presupuestos
        const resultado = await RutasModel.asignarPresupuestos(
            parseInt(id) || 0,
            ids_presupuestos,
            (req.user?.id && parseInt(req.user.id)) || 1
        );
        
        console.log(`[RUTAS] ✅ ${resultado.presupuestos_asignados} presupuestos asignados a ruta ${id}`);
        
        res.json({
            success: true,
            message: `${resultado.presupuestos_asignados} presupuestos asignados exitosamente`,
            data: {
                id_ruta: parseInt(id),
                presupuestos_asignados: resultado.presupuestos_asignados
            }
        });
        
    } catch (error) {
        console.error('[RUTAS] ❌ Error al asignar presupuestos:', error);
        
        // Errores de validación de negocio
        if (error.message.includes('no encontrada') ||
            error.message.includes('no existen') ||
            error.message.includes('ya está asignado') ||
            error.message.includes('no tiene domicilio') ||
            error.message.includes('bloqueo de entrega') ||
            error.message.includes('no tiene coordenadas') ||
            error.message.includes('estado ARMANDO')) {
            return res.status(400).json({
                success: false,
                error: error.message
            });
        }
        
        res.status(500).json({
            success: false,
            error: 'Error al asignar presupuestos',
            message: error.message
        });
    }
}

/**
 * Cambiar estado de una ruta
 * PUT /api/logistica/rutas/:id/estado
 */
async function cambiarEstado(req, res) {
    try {
        const { id } = req.params;
        const { estado } = req.body;
        
        console.log(`[RUTAS] Cambiando estado de ruta ID: ${id} a ${estado}`);
        
        // Validaciones
        if (!estado) {
            return res.status(400).json({
                success: false,
                error: 'El campo estado es requerido'
            });
        }
        
        const estadosValidos = ['ARMANDO', 'EN_CAMINO', 'FINALIZADA'];
        if (!estadosValidos.includes(estado)) {
            return res.status(400).json({
                success: false,
                error: `Estado inválido. Valores permitidos: ${estadosValidos.join(', ')}`
            });
        }
        
        // Validar que la ruta existe
        const rutaExistente = await RutasModel.obtenerPorId(parseInt(id));
        if (!rutaExistente) {
            console.log(`[RUTAS] ⚠️ Ruta ${id} no encontrada`);
            return res.status(404).json({
                success: false,
                error: 'Ruta no encontrada'
            });
        }
        
        // Validar transiciones de estado
        const estadoActual = rutaExistente.estado;
        
        if (estadoActual === 'FINALIZADA') {
            return res.status(400).json({
                success: false,
                error: 'No se puede cambiar el estado de una ruta finalizada'
            });
        }
        
        if (estado === 'EN_CAMINO' && rutaExistente.total_presupuestos === 0) {
            return res.status(400).json({
                success: false,
                error: 'No se puede iniciar una ruta sin presupuestos asignados'
            });
        }
        
        // Cambiar estado
        const rutaActualizada = await RutasModel.cambiarEstado(parseInt(id), estado);
        
        // Despachar notificaciones de inicio de ruta en background si fueron solicitadas
        const { notificar_clientes, clientes_ids } = req.body;
        if (estado === 'EN_CAMINO' && notificar_clientes === true && Array.isArray(clientes_ids) && clientes_ids.length > 0) {
            setImmediate(async () => {
                try {
                    await despacharNotificacionesInicioRuta(id, clientes_ids);
                } catch (errNoti) {
                    console.error(`[RUTAS-PC] ⚠️ Error en background al despachar notificaciones de inicio para ruta #${id}:`, errNoti.message);
                }
            });
        }
        
        // [TICKET #024] Si se fuerza FINALIZADA desde el Backend/PC, replicar inyección atómica de Mantenimiento
        if (estado === 'FINALIZADA') {
            const client = await req.db.connect();
            try {
                await client.query('BEGIN');
                
                // 1. Órdenes de Tratamiento
                // Desvincular órdenes no retiradas (PENDIENTE_CLIENTE / PENDIENTE_VALIDACION) para que no queden atrapadas en la ruta cerrada
                await client.query(`
                    UPDATE ordenes_tratamiento
                    SET id_ruta = NULL,
                        orden_entrega = 999
                    WHERE id_ruta = $1 AND estado_logistico IN ('PENDIENTE_CLIENTE', 'PENDIENTE_VALIDACION')
                `, [id]);

                const updatedTR = await client.query(`
                    UPDATE ordenes_tratamiento
                    SET estado_logistico = 'INGRESADO_LOCAL',
                        fecha_ingreso_mantenimiento = NOW()
                    WHERE id_ruta = $1 AND estado_logistico IN ('EN_CAMINO', 'RETIRADO')
                    RETURNING id, chofer_nombre
                `, [id]);

                if (updatedTR.rows.length > 0) {
                    const ids = updatedTR.rows.map(r => r.id);
                    await client.query(`
                        INSERT INTO mantenimiento_movimientos (
                            id_orden_tratamiento, cantidad, usuario, tipo_movimiento, observaciones, fecha_movimiento, estado
                        )
                        SELECT 
                            ot.id,
                            COALESCE((SELECT SUM(bultos) FROM ordenes_tratamiento_detalles WHERE id_orden_tratamiento = ot.id), 0),
                            ot.chofer_nombre,
                            'RETIRO_TRATAMIENTO',
                            (SELECT json_agg(json_build_object('desc', descripcion_externa, 'kilos', kilos, 'bultos', bultos, 'motivo', motivo))::text 
                             FROM ordenes_tratamiento_detalles WHERE id_orden_tratamiento = ot.id),
                            NOW(),
                            'PENDIENTE'
                        FROM ordenes_tratamiento ot
                        WHERE ot.id = ANY($1::int[])
                    `, [ids]);
                }

                // 2. Órdenes de Retiro Comerciales (Presupuestos)
                const updatedRetiros = await client.query(`
                    UPDATE presupuestos
                    SET estado_logistico = 'INGRESADO_LOCAL'
                    WHERE id_ruta = $1 AND (tipo_comprobante = 'Orden de Retiro' OR estado = 'Orden de Retiro' OR estado = 'Administrativa NC')
                    AND estado_logistico = 'RETIRADO'
                    RETURNING id
                `, [id]);

                if (updatedRetiros.rows.length > 0) {
                    const presupuestosIds = updatedRetiros.rows.map(r => r.id);
                    const retirosDetalles = await client.query(`
                        SELECT 
                            pd.id_presupuesto, pd.cantidad, COALESCE(a.numero, pd.articulo) as articulo_numero 
                        FROM presupuestos_detalles pd
                        LEFT JOIN articulos a ON a.codigo_barras = pd.articulo OR a.numero = pd.articulo
                        WHERE pd.id_presupuesto = ANY($1::int[]) AND pd.articulo IS NOT NULL
                    `, [presupuestosIds]);

                    for (const det of retirosDetalles.rows) {
                        await client.query(`
                            INSERT INTO mantenimiento_movimientos
                            (articulo_numero, cantidad, id_presupuesto_origen, usuario, tipo_movimiento, estado, observaciones)
                            VALUES ($1, $2, $3, $4, 'INGRESO', 'PENDIENTE', $5)
                        `, [
                            det.articulo_numero, det.cantidad, det.id_presupuesto,
                            'Logística Desktop (Admin)', 'Ingreso por Hoja de Ruta - Desktop'
                        ]);
                    }
                }

                // [TICKET #025] 3. Mercadería No Entregada / Entregas Parciales (Artículos con cantidad_original > cantidad)
                const partialItemsQuery = `
                    SELECT 
                        pd.id_presupuesto,
                        pd.articulo,
                        COALESCE(a.numero, pd.articulo) as articulo_numero,
                        COALESCE(a.nombre, pd.articulo) as articulo_nombre,
                        (pd.cantidad_original - pd.cantidad) as cantidad_no_entregada,
                        p.id_cliente
                    FROM presupuestos_detalles pd
                    JOIN presupuestos p ON p.id = pd.id_presupuesto
                    LEFT JOIN articulos a ON a.codigo_barras = pd.articulo OR a.numero = pd.articulo
                    WHERE p.id_ruta = $1
                      AND pd.cantidad_original IS NOT NULL
                      AND pd.cantidad_original > pd.cantidad
                `;
                const resPartialItems = await client.query(partialItemsQuery, [id]);
                if (resPartialItems.rows.length > 0) {
                    console.log(`[RUTAS-PC] 📦 Procesando ${resPartialItems.rows.length} artículos no entregados por entregas parciales/rechazos...`);
                    for (const item of resPartialItems.rows) {
                        const checkDup = await client.query(`
                            SELECT id FROM mantenimiento_movimientos
                            WHERE id_presupuesto_origen = $1 AND articulo_numero = $2 AND estado = 'PENDIENTE'
                        `, [item.id_presupuesto, item.articulo_numero]);

                        if (checkDup.rowCount === 0) {
                            await client.query(`
                                INSERT INTO mantenimiento_movimientos
                                (articulo_numero, cantidad, id_presupuesto_origen, usuario, tipo_movimiento, estado, observaciones)
                                VALUES ($1, $2, $3, $4, 'INGRESO', 'PENDIENTE', $5)
                            `, [
                                item.articulo_numero,
                                parseFloat(item.cantidad_no_entregada),
                                item.id_presupuesto,
                                'Logística Desktop (Admin)',
                                `Retorno automático por entrega parcial / rechazo: ${parseFloat(item.cantidad_no_entregada)} u. de ${item.articulo_nombre} (Cliente ${item.id_cliente})`
                            ]);
                            console.log(`[RUTAS-PC] ✅ Inyectado a Mantenimiento: ${parseFloat(item.cantidad_no_entregada)} u. de ${item.articulo_nombre} (Presupuesto #${item.id_presupuesto})`);
                        }
                    }
                }

                // 4a. Visitas de Preventa no realizadas (aún en PENDIENTE): desvincular de la ruta cerrada
                await client.query(`
                    UPDATE public.bunker_prospectos
                    SET id_ruta = NULL,
                        en_pool_logistica = false,
                        orden_entrega = 999,
                        updated_at = NOW()
                    WHERE id_ruta = $1 AND COALESCE(estado_ruta, 'PENDIENTE') = 'PENDIENTE'
                `, [id]);

                // 4b. Sobres de Efectivo no retirados (aún en PREPARADO): desvincular de la ruta para que vuelvan al Pool
                await client.query(`
                    UPDATE public.factura_pagos_efectivo
                    SET id_ruta = NULL,
                        orden_entrega = 999,
                        fecha_actualizacion = NOW()
                    WHERE id_ruta = $1 AND estado = 'PREPARADO'
                `, [id]);

                // 4c. Sobres de Efectivo efectivamente retirados en la ruta (EN_TRANSITO): pasan a RECIBIDO_LOCAL
                const sobresRecibidosRes = await client.query(`
                    UPDATE public.factura_pagos_efectivo
                    SET estado = 'RECIBIDO_LOCAL',
                        sincronizado_supabase = false,
                        fecha_actualizacion = NOW()
                    WHERE id_ruta = $1 AND estado = 'EN_TRANSITO'
                    RETURNING id, codigo_sobre
                `, [id]);
                
                await client.query('COMMIT');

                if (sobresRecibidosRes.rows.length > 0) {
                    const PagosEfectivoService = require('../services/pagosEfectivoService');
                    for (const s of sobresRecibidosRes.rows) {
                        PagosEfectivoService.actualizarEstado({
                            sobreId: s.id,
                            nuevoEstado: 'RECIBIDO_LOCAL',
                            operador: 'Cierre Hoja de Ruta (Desktop)'
                        }).catch(err => console.warn('[RUTAS-PC] ⚠️ Error sincronizando sobre RECIBIDO_LOCAL en Supabase:', err.message));
                    }
                }
            } catch (error) {
                await client.query('ROLLBACK');
                console.error('[RUTAS-PC] ❌ Error inyectando mantenimiento:', error);
            } finally {
                client.release();
            }
        }

        console.log(`[RUTAS] ✅ Estado de ruta ${id} cambiado de ${estadoActual} a ${estado}`);
        
        res.json({
            success: true,
            message: `Estado cambiado exitosamente de ${estadoActual} a ${estado}`,
            data: rutaActualizada
        });
        
    } catch (error) {
        console.error('[RUTAS] ❌ Error al cambiar estado:', error);
        res.status(500).json({
            success: false,
            error: 'Error al cambiar estado de ruta',
            message: error.message
        });
    }
}

/**
 * Obtener presupuestos disponibles para asignar a rutas
 * GET /api/logistica/rutas/presupuestos-disponibles
 */
async function obtenerPresupuestosDisponibles(req, res) {
    try {
        console.log('[RUTAS] Obteniendo presupuestos disponibles');
        
        const presupuestos = await presupuestosModel.obtenerPresupuestosDisponibles(req.db);
        
        console.log(`[RUTAS] ✅ ${presupuestos.length} presupuestos disponibles encontrados`);
        
        // VIGÍA DE DEPURACIÓN (Ticket #8): Traza exacta de totales
        if (presupuestos.length > 0) {
            console.log(`[VIGÍA-FINANCIERO] TICKET #8 - TRAZA DE TOTALES EN LOGÍSTICA (DISPONIBLES):`);
            presupuestos.forEach(p => {
                console.log(`  -> ID_Presupuesto: ${p.id_presupuesto_ext || p.numero_presupuesto || p.id} | Subtotal_Bruto_con_IVA: $${Number(p.subtotal_bruto).toFixed(2)} | Descuento_Detectado: ${Number(p.descuento_aplicado * 100).toFixed(2)}% | Total_Final_Enviado_a_UI: $${Number(p.total).toFixed(2)}`);
            });
        }
        
        res.json({
            success: true,
            data: presupuestos,
            total: presupuestos.length
        });
        
    } catch (error) {
        console.error('[RUTAS] ❌ Error al obtener presupuestos disponibles:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener presupuestos disponibles',
            message: error.message
        });
    }
}

/**
 * Eliminar una ruta con restauración automática de presupuestos
 * DELETE /api/logistica/rutas/:id
 */
async function eliminarRuta(req, res) {
    try {
        const { id } = req.params;
        console.log(`[RUTAS] Eliminando ruta ID: ${id}`);
        
        // Validar que la ruta existe
        const rutaExistente = await RutasModel.obtenerPorId(parseInt(id));
        if (!rutaExistente) {
            console.log(`[RUTAS] ⚠️ Ruta ${id} no encontrada`);
            return res.status(404).json({
                success: false,
                error: 'Ruta no encontrada'
            });
        }
        
        // Eliminar ruta (con restauración automática de presupuestos)
        const resultado = await RutasModel.eliminar(parseInt(id));
        
        console.log(`[RUTAS] ✅ Ruta ${id} eliminada`);
        console.log(`[RUTAS] ✅ ${resultado.presupuestos_restaurados} presupuestos restaurados`);
        
        res.json({
            success: true,
            message: resultado.presupuestos_restaurados > 0 
                ? `Ruta eliminada. ${resultado.presupuestos_restaurados} pedido(s) restaurado(s) a estado pendiente.`
                : 'Ruta eliminada exitosamente',
            data: {
                ruta_eliminada: resultado.ruta_eliminada.id,
                presupuestos_restaurados: resultado.presupuestos_restaurados
            }
        });
        
    } catch (error) {
        console.error('[RUTAS] ❌ Error al eliminar ruta:', error);
        res.status(500).json({
            success: false,
            error: 'Error al eliminar ruta',
            message: error.message
        });
    }
}

/**
 * Obtener clientes y paradas para modal de inicio de ruta en Desktop
 * GET /api/logistica/rutas/:id/destinatarios-inicio
 */
async function obtenerDestinatariosInicio(req, res) {
    try {
        const { id } = req.params;
        const clientes = await obtenerDestinatariosInicioRuta(id);
        res.json({ success: true, clientes });
    } catch (error) {
        console.error(`[RUTAS-PC] Error obteniendo destinatarios inicio para ruta ${req.params.id}:`, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
}

module.exports = {
    obtenerRutas,
    obtenerRutaPorId,
    crearRuta,
    actualizarRuta,
    asignarPresupuestos,
    cambiarEstado,
    obtenerPresupuestosDisponibles,
    eliminarRuta,
    obtenerDestinatariosInicio
};
