/**
 * Rutas de Rutas
 * Endpoints para gestión de rutas de reparto
 */

const express = require('express');
const router = express.Router();

console.log('🔍 [RUTAS] Configurando rutas del módulo...');

// Importar controladores
const {
    obtenerRutas,
    obtenerRutaPorId,
    crearRuta,
    actualizarRuta,
    asignarPresupuestos,
    cambiarEstado,
    obtenerPresupuestosDisponibles,
    eliminarRuta,
    obtenerDestinatariosInicio
} = require('../controllers/rutasController');

/**
 * @route GET /api/logistica/rutas
 * @desc Obtener todas las rutas con filtros opcionales
 * @query estado - Filtrar por estado (ARMANDO, EN_CAMINO, FINALIZADA)
 * @query id_chofer - Filtrar por chofer
 * @query fecha_desde - Filtrar por fecha desde
 * @query fecha_hasta - Filtrar por fecha hasta
 * @access Privado
 */
router.get('/', async (req, res) => {
    console.log('🔍 [RUTAS] Ruta GET / - Obteniendo rutas');
    try {
        await obtenerRutas(req, res);
    } catch (error) {
        console.error('❌ [RUTAS] Error en ruta GET /:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en la ruta de rutas',
            message: error.message
        });
    }
});

/**
 * @route POST /api/logistica/rutas
 * @desc Crear una nueva ruta
 * @body nombre_ruta - Nombre descriptivo de la ruta (requerido)
 * @body fecha_salida - Fecha y hora de salida (requerido)
 * @body id_chofer - ID del chofer asignado (requerido)
 * @body id_vehiculo - ID o patente del vehículo (opcional)
 * @access Privado
 */
router.post('/', async (req, res) => {
    console.log('🔍 [RUTAS] Ruta POST / - Creando nueva ruta');
    
    try {
        await crearRuta(req, res);
    } catch (error) {
        console.error('❌ [RUTAS] Error en ruta POST /:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al crear ruta',
            message: error.message
        });
    }
});

/**
 * @route GET /api/logistica/rutas/presupuestos-disponibles
 * @desc Obtener presupuestos disponibles para asignar a rutas
 * @access Privado
 * 
 * IMPORTANTE: Esta ruta debe ir ANTES de GET /:id para que Express la capture correctamente
 */
router.get('/presupuestos-disponibles', async (req, res) => {
    console.log('🔍 [RUTAS] Ruta GET /presupuestos-disponibles - Obteniendo presupuestos disponibles');
    
    try {
        await obtenerPresupuestosDisponibles(req, res);
    } catch (error) {
        console.error('❌ [RUTAS] Error en ruta GET /presupuestos-disponibles:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener presupuestos disponibles',
            message: error.message
        });
    }
});

/**
 * @route PUT /api/logistica/rutas/:id/asignar
 * @desc Asignar presupuestos a una ruta
 * @param id - ID de la ruta
 * @body ids_presupuestos - Array de IDs de presupuestos a asignar (requerido)
 * @access Privado
 * 
 * IMPORTANTE: Esta ruta debe ir ANTES de PUT /:id para que Express la capture correctamente
 * 
 * @example
 * {
 *   "ids_presupuestos": [1, 2, 3, 4, 5]
 * }
 */
router.put('/:id/asignar', async (req, res) => {
    const { id } = req.params;
    console.log(`🔍 [RUTAS] Ruta PUT /:id/asignar - Asignando presupuestos a ruta ID: ${id}`);
    
    try {
        await asignarPresupuestos(req, res);
    } catch (error) {
        console.error(`❌ [RUTAS] Error en ruta PUT /:id/asignar (${id}):`, error);
        res.status(500).json({
            success: false,
            error: 'Error interno al asignar presupuestos',
            message: error.message
        });
    }
});

/**
 * @route PUT /api/logistica/rutas/:id/reordenar
 * @desc Reordenar presupuestos en una ruta
 * @param id - ID de la ruta
 * @body orden - Array de IDs de presupuestos en el nuevo orden
 * @access Privado
 */
router.put('/:id/reordenar', async (req, res) => {
    const { id } = req.params;
    const { orden } = req.body;
    
    console.log(`🔍 [RUTAS] Reordenando presupuestos de ruta ${id}`);
    
    try {
        if (!Array.isArray(orden) || orden.length === 0) {
            throw new Error('Se requiere un array de IDs en el orden deseado');
        }
        
        const client = await req.db.connect();
        
        try {
            await client.query('BEGIN');
            
            // Validar que la ruta está en estado ARMANDO
            const rutaQuery = await client.query(
                'SELECT estado FROM rutas WHERE id = $1',
                [id]
            );
            
            if (rutaQuery.rows.length === 0) {
                throw new Error('Ruta no encontrada');
            }
            
            if (rutaQuery.rows[0].estado !== 'ARMANDO') {
                throw new Error('Solo se puede reordenar rutas en estado ARMANDO');
            }
            
            // Actualizar orden_entrega discriminando tipo de entidad híbrida (Pedidos vs Tratamientos vs Sobres)
            for (let i = 0; i < orden.length; i++) {
                const item = orden[i];
                if (typeof item === 'string' && item.toUpperCase().startsWith('RT-')) {
                    const idTrat = parseInt(item.toUpperCase().replace('RT-', ''));
                    if (!isNaN(idTrat)) {
                        await client.query(
                            `UPDATE ordenes_tratamiento 
                             SET orden_entrega = $1
                             WHERE id = $2 AND id_ruta = $3`,
                            [i + 1, idTrat, id]
                        );
                    }
                } else if (typeof item === 'string' && item.toUpperCase().startsWith('SOB-')) {
                    const idSobre = parseInt(item.toUpperCase().replace('SOB-', ''));
                    if (!isNaN(idSobre)) {
                        await client.query(
                            `UPDATE public.factura_pagos_efectivo 
                             SET orden_entrega = $1, fecha_actualizacion = NOW()
                             WHERE id = $2 AND id_ruta = $3`,
                            [i + 1, idSobre, id]
                        );
                    }
                } else if (typeof item === 'string' && item.toUpperCase().startsWith('PR-')) {
                    const idProsp = parseInt(item.toUpperCase().replace('PR-', ''));
                    if (!isNaN(idProsp)) {
                        await client.query(
                            `UPDATE public.bunker_prospectos 
                             SET orden_entrega = $1, updated_at = NOW()
                             WHERE id = $2 AND id_ruta = $3`,
                            [i + 1, idProsp, id]
                        );
                    }
                } else {
                    const idPresu = parseInt(item);
                    if (!isNaN(idPresu)) {
                        await client.query(
                            `UPDATE presupuestos 
                             SET orden_entrega = $1
                             WHERE id = $2 AND id_ruta = $3`,
                            [i + 1, idPresu, id]
                        );
                    }
                }
            }
            
            await client.query('COMMIT');
            
            res.json({
                success: true,
                message: 'Orden actualizado correctamente',
                nuevo_orden: orden
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error(`❌ [RUTAS] Error al reordenar:`, error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * @route DELETE /api/logistica/rutas/:id/presupuestos/:presupuestoId
 * @desc Desasignar un presupuesto de una ruta
 * @param id - ID de la ruta
 * @param presupuestoId - ID del presupuesto a desasignar
 * @access Privado
 */
router.delete('/:id/presupuestos/:presupuestoId', async (req, res) => {
    const { id, presupuestoId } = req.params;
    console.log(`🔍 [RUTAS] Ruta DELETE /:id/presupuestos/:presupuestoId - Desasignando presupuesto ${presupuestoId} de ruta ${id}`);
    
    try {
        const client = await req.db.connect();
        
        try {
            await client.query('BEGIN');
            
            // Validar que la ruta está en estado ARMANDO
            const rutaQuery = await client.query(
                'SELECT estado FROM rutas WHERE id = $1',
                [id]
            );
            
            if (rutaQuery.rows.length === 0) {
                throw new Error('Ruta no encontrada');
            }
            
            if (rutaQuery.rows[0].estado !== 'ARMANDO') {
                throw new Error('Solo se pueden quitar presupuestos de rutas en estado ARMANDO');
            }
            
            // Desasignar presupuesto, retiro de inmunización o sobre de efectivo
            if (String(presupuestoId).startsWith('RT-')) {
                const idOrden = presupuestoId.replace('RT-', '');
                await client.query(
                    `UPDATE ordenes_tratamiento
                     SET id_ruta = NULL,
                         estado_logistico = CASE 
                             WHEN estado_logistico = 'PENDIENTE_DEVOLUCION_CLIENTE' THEN 'INGRESADO_LOCAL'
                             WHEN estado_logistico IN ('EN_CAMINO', 'PENDIENTE_VALIDACION') THEN 'PENDIENTE_CLIENTE'
                             ELSE estado_logistico
                         END
                     WHERE id = $1 AND id_ruta = $2 AND estado_logistico NOT IN ('ENTREGADO', 'RETIRADO', 'INGRESADO_LOCAL')`,
                    [idOrden, id]
                );
            } else if (String(presupuestoId).startsWith('SOB-')) {
                const idSobre = parseInt(String(presupuestoId).replace('SOB-', ''), 10);
                const checkSobre = await client.query(
                    `SELECT estado, codigo_sobre FROM public.factura_pagos_efectivo WHERE id = $1 AND id_ruta = $2`,
                    [idSobre, id]
                );
                if (checkSobre.rows.length > 0 && ['EN_TRANSITO', 'RECIBIDO_LOCAL', 'ACREDITADO'].includes(checkSobre.rows[0].estado)) {
                    throw new Error(`No se puede desvincular el sobre ${checkSobre.rows[0].codigo_sobre} porque ya fue retirado.`);
                }
                await client.query(
                    `UPDATE public.factura_pagos_efectivo
                     SET id_ruta = NULL,
                         orden_entrega = 999,
                         fecha_actualizacion = NOW()
                     WHERE id = $1 AND id_ruta = $2`,
                    [idSobre, id]
                );
            } else if (String(presupuestoId).toUpperCase().startsWith('PR-')) {
                const idProsp = parseInt(String(presupuestoId).toUpperCase().replace('PR-', ''), 10);
                await client.query(
                    `UPDATE public.bunker_prospectos
                     SET id_ruta = NULL,
                         en_pool_logistica = true,
                         orden_entrega = 999,
                         estado_ruta = 'PENDIENTE',
                         updated_at = NOW()
                     WHERE id = $1 AND id_ruta = $2`,
                    [idProsp, id]
                );
            } else {
                const check = await client.query(
                    `SELECT estado_logistico, estado FROM presupuestos WHERE id = $1 AND id_ruta = $2`,
                    [presupuestoId, id]
                );
                if (check.rows.length > 0) {
                    const p = check.rows[0];
                    if (p.estado_logistico === 'ENTREGADO' || p.estado_logistico === 'RETIRADO' || p.estado === 'Entregado' || p.estado === 'Retirado') {
                        throw new Error('No se puede desvincular un pedido que ya fue ENTREGADO o RETIRADO.');
                    }
                }
                await client.query(
                    `UPDATE presupuestos 
                     SET id_ruta = NULL,
                         estado_logistico = 'PENDIENTE_ASIGNAR',
                         secuencia = 'Pedido_Listo',
                         orden_entrega = NULL,
                         fecha_asignacion_ruta = NULL
                     WHERE id = $1 AND id_ruta = $2`,
                    [presupuestoId, id]
                );
            }
            
            await client.query('COMMIT');
            
            res.json({
                success: true,
                message: 'Presupuesto desasignado correctamente'
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error(`❌ [RUTAS] Error al desasignar presupuesto:`, error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * @route GET /api/logistica/rutas/:id/destinatarios-inicio
 * @desc Obtener clientes y paradas para modal de inicio de ruta en Desktop
 */
router.get('/:id/destinatarios-inicio', obtenerDestinatariosInicio);

/**
 * @route PUT /api/logistica/rutas/:id/estado
 * @desc Cambiar el estado de una ruta
 * @param id - ID de la ruta
 * @body estado - Nuevo estado (ARMANDO, EN_CAMINO, FINALIZADA)
 * @access Privado
 * 
 * IMPORTANTE: Esta ruta debe ir ANTES de PUT /:id para que Express la capture correctamente
 * 
 * @example
 * {
 *   "estado": "EN_CAMINO"
 * }
 */
router.put('/:id/estado', async (req, res) => {
    const { id } = req.params;
    const { estado } = req.body;
    console.log(`🔍 [RUTAS] Ruta PUT /:id/estado - Cambiando estado de ruta ID: ${id} a ${estado}`);
    
    try {
        await cambiarEstado(req, res);
    } catch (error) {
        console.error(`❌ [RUTAS] Error en ruta PUT /:id/estado (${id}):`, error);
        res.status(500).json({
            success: false,
            error: 'Error interno al cambiar estado',
            message: error.message
        });
    }
});

/**
 * @route DELETE /api/logistica/rutas/:id
 * @desc Eliminar una ruta con restauración automática de presupuestos
 * @param id - ID de la ruta
 * @access Privado
 * 
 * NUEVA LÓGICA: Restaura automáticamente los presupuestos a estado pendiente antes de eliminar
 */
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    console.log(`🔍 [RUTAS] Ruta DELETE /:id - Eliminando ruta ID: ${id}`);
    
    try {
        await eliminarRuta(req, res);
    } catch (error) {
        console.error(`❌ [RUTAS] Error al eliminar ruta:`, error);
        res.status(500).json({
            success: false,
            error: 'Error interno al eliminar ruta',
            message: error.message
        });
    }
});

/**
 * @route PUT /api/logistica/rutas/:id
 * @desc Actualizar una ruta existente
 * @param id - ID de la ruta
 * @body Campos a actualizar (todos opcionales)
 * @access Privado
 * 
 * IMPORTANTE: Esta ruta debe ir DESPUÉS de las rutas específicas (/:id/asignar, /:id/estado)
 */
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    console.log(`🔍 [RUTAS] Ruta PUT /:id - Actualizando ruta ID: ${id}`);
    
    try {
        await actualizarRuta(req, res);
    } catch (error) {
        console.error(`❌ [RUTAS] Error en ruta PUT /:id (${id}):`, error);
        res.status(500).json({
            success: false,
            error: 'Error interno al actualizar ruta',
            message: error.message
        });
    }
});

/**
 * @route GET /api/logistica/rutas/:id/manifiesto
 * @desc Generar PDF con el manifiesto (hoja de reparto consolidada) de la ruta.
 * @access Privado
 */
router.get('/:id/manifiesto', async (req, res) => {
    const { id } = req.params;
    console.log(`🔍 [RUTAS] Generando manifiesto PDF para ruta ID: ${id}`);
    
    try {
        const client = await req.db.connect();
        try {
            // 1. Obtener datos de la ruta
            const queryRuta = `
                SELECT 
                    r.id,
                    r.nombre_ruta,
                    r.fecha_salida,
                    r.estado,
                    r.id_vehiculo,
                    u.nombre_completo as chofer_nombre
                FROM public.rutas r
                LEFT JOIN public.usuarios u ON r.id_chofer = u.id
                WHERE r.id = $1
                LIMIT 1
            `;
            const resRuta = await client.query(queryRuta, [id]);
            if (resRuta.rowCount === 0) {
                return res.status(404).send('La ruta especificada no existe.');
            }
            const ruta = resRuta.rows[0];

            // 2. Obtener entregas comerciales de la ruta
            const queryEntregas = `
                SELECT 
                    p.id as id_presupuesto,
                    p.id_presupuesto_ext,
                    p.estado_logistico,
                    p.id_cliente,
                    COALESCE(c.nombre || ' ' || c.apellido, c.nombre, c.apellido, c.otros, 'Sin nombre') as cliente_nombre,
                    cd.direccion as domicilio_direccion,
                    cd.localidad as domicilio_localidad,
                    COALESCE(
                        (SELECT ROUND(SUM(pd.cantidad * COALESCE(pd.precio1, 0)), 2)
                         FROM public.presupuestos_detalles pd
                         WHERE pd.id_presupuesto_ext = p.id_presupuesto_ext),
                        0
                    ) as total
                FROM public.presupuestos p
                INNER JOIN public.clientes c ON ltrim(p.id_cliente::text, '0') = c.cliente_id::text
                LEFT JOIN public.clientes_domicilios cd ON p.id_domicilio_entrega = cd.id
                WHERE p.id_ruta = $1
                ORDER BY COALESCE(p.orden_entrega, 999) ASC
            `;
            const resEntregas = await client.query(queryEntregas, [id]);

            // 3. Obtener retiros de mantenimiento de la ruta
            const queryRetiros = `
                SELECT 
                    o.id as id_orden,
                    o.estado_logistico,
                    o.id_cliente,
                    COALESCE(c.nombre || ' ' || c.apellido, c.nombre, c.apellido, c.otros, 'Sin nombre') as cliente_nombre,
                    cd.direccion as domicilio_direccion,
                    cd.localidad as domicilio_localidad
                FROM public.ordenes_tratamiento o
                LEFT JOIN public.clientes c ON o.id_cliente = c.cliente_id
                LEFT JOIN public.clientes_domicilios cd ON o.id_domicilio_entrega = cd.id
                WHERE o.id_ruta = $1
                ORDER BY COALESCE(o.orden_entrega, 999) ASC
            `;
            const resRetiros = await client.query(queryRetiros, [id]);

            // 3b. Obtener sobres de efectivo asignados a la ruta
            const querySobres = `
                SELECT 
                    p.id as id_sobre,
                    p.codigo_sobre,
                    p.estado,
                    p.monto_declarado,
                    COALESCE(c.cliente_id::text, NULLIF(LTRIM(TRIM(bc.lomas_soft_id), '0'), ''), p.cliente_id) as id_cliente,
                    COALESCE(c.nombre, bc.cliente_nombre, bc.razon_social, p.cliente_id) as cliente_nombre,
                    cd.direccion as domicilio_direccion,
                    COALESCE(cd.localidad, c.localidad) as domicilio_localidad
                FROM public.factura_pagos_efectivo p
                LEFT JOIN public.bunker_clientes bc ON bc.codigo_bunker_cliente = p.cliente_id OR bc.lomas_soft_id = p.cliente_id
                LEFT JOIN public.clientes c ON (bc.lomas_soft_id IS NOT NULL AND c.cliente_id::text = ltrim(bc.lomas_soft_id, '0'))
                                            OR (bc.id IS NULL AND c.cliente_id::text = ltrim(p.cliente_id, '0'))
                LEFT JOIN public.clientes_domicilios cd ON p.id_domicilio_entrega = cd.id
                WHERE p.id_ruta = $1
                ORDER BY COALESCE(p.orden_entrega, 999) ASC
            `;
            const resSobres = await client.query(querySobres, [id]);

            // 4. Agrupar y unificar por paradas (clientes en común) o listado secuencial
            const paradas = [];
            
            resEntregas.rows.forEach(e => {
                paradas.push({
                    tipo: 'ENTREGA',
                    referencia: `#${e.id_presupuesto}`,
                    cliente_id: e.id_cliente,
                    cliente_nombre: e.cliente_nombre,
                    direccion: `${e.domicilio_direccion || 'S/D'}, ${e.domicilio_localidad || 'S/L'}`,
                    total: `$${parseFloat(e.total || 0).toFixed(2)}`,
                    estado: e.estado_logistico
                });
            });

            resRetiros.rows.forEach(r => {
                paradas.push({
                    tipo: 'RETIRO',
                    referencia: `RT-${r.id_orden}`,
                    cliente_id: r.id_cliente,
                    cliente_nombre: r.cliente_nombre,
                    direccion: `${r.domicilio_direccion || 'S/D'}, ${r.domicilio_localidad || 'S/L'}`,
                    total: 'N/A (Retiro)',
                    estado: r.estado_logistico
                });
            });

            resSobres.rows.forEach(s => {
                paradas.push({
                    tipo: 'SOBRE',
                    referencia: s.codigo_sobre,
                    cliente_id: s.id_cliente,
                    cliente_nombre: s.cliente_nombre,
                    direccion: `${s.domicilio_direccion || 'S/D'}, ${s.domicilio_localidad || 'S/L'}`,
                    total: 'Retiro Sobre',
                    estado: s.estado
                });
            });

            // 5. Iniciar la generación del PDF con PDFKit
            const PDFDocument = require('pdfkit');
            const path = require('path');
            const fs = require('fs');

            const dateStr = new Date(ruta.fecha_salida).toLocaleDateString('es-AR');
            const filename = `Manifiesto_${ruta.nombre_ruta.replace(/\s+/g, '_')}_${dateStr.replace(/\//g, '-')}.pdf`;

            const doc = new PDFDocument({ margin: 40, size: 'A4', info: { Title: filename } });

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

            doc.pipe(res);

            // Logo o Cabecera
            const logoPath = path.join(__dirname, '../img/logo_LAMDA_grande.png');
            if (fs.existsSync(logoPath)) {
                doc.image(logoPath, 40, 40, { width: 110 });
                doc.y = 80;
            } else {
                doc.fontSize(22).font('Helvetica-Bold').fillColor('#2563eb').text('LAMDA LOGISTICA', 40, 40);
            }

            // Datos de la ruta
            doc.fontSize(10).fillColor('#64748b').text(`Fecha de Emisión: ${new Date().toLocaleString('es-AR')}`, 350, 45, { align: 'right' });
            
            doc.moveDown(2);
            doc.fontSize(14).fillColor('#1e3a8a').font('Helvetica-Bold').text(`MANIFIESTO DE REPARTO: ${ruta.nombre_ruta || `Ruta #${ruta.id}`}`);
            doc.moveTo(40, doc.y).lineTo(550, doc.y).strokeColor('#cbd5e1').stroke();
            doc.moveDown(0.5);

            doc.fontSize(10).fillColor('#334155');
            doc.font('Helvetica-Bold').text('Chofer: ', { continued: true }).font('Helvetica').text(ruta.chofer_nombre || 'No asignado');
            doc.font('Helvetica-Bold').text('Vehículo/Patente: ', { continued: true }).font('Helvetica').text(ruta.id_vehiculo || 'No asignado');
            doc.font('Helvetica-Bold').text('Fecha Planificada: ', { continued: true }).font('Helvetica').text(dateStr);
            doc.font('Helvetica-Bold').text('Total Paradas: ', { continued: true }).font('Helvetica').text(paradas.length.toString());
            doc.moveDown(1);

            // Tabla de paradas
            const tableTop = doc.y;
            doc.font('Helvetica-Bold').fontSize(9);
            
            // Header de tabla
            doc.text('Parada', 40, tableTop, { width: 30 });
            doc.text('Tipo', 75, tableTop, { width: 55 });
            doc.text('Cliente', 135, tableTop, { width: 130 });
            doc.text('Dirección / Destino', 270, tableTop, { width: 135 });
            doc.text('Monto/Ref', 410, tableTop, { width: 75 });
            doc.text('Control / Firma', 490, tableTop, { width: 65 });

            doc.moveTo(40, tableTop + 14).lineTo(555, tableTop + 14).strokeColor('#94a3b8').stroke();
            
            let rowY = tableTop + 20;
            doc.font('Helvetica').fontSize(8);

            paradas.forEach((parada, idx) => {
                // Chequear si necesitamos saltar de página
                if (rowY > 740) {
                    doc.addPage();
                    rowY = 50;
                    
                    // Reimprimir encabezado en nueva página
                    doc.font('Helvetica-Bold').fontSize(9);
                    doc.text('Parada', 40, rowY, { width: 30 });
                    doc.text('Tipo', 75, rowY, { width: 55 });
                    doc.text('Cliente', 135, rowY, { width: 130 });
                    doc.text('Dirección / Destino', 270, rowY, { width: 135 });
                    doc.text('Monto/Ref', 410, rowY, { width: 75 });
                    doc.text('Control / Firma', 490, rowY, { width: 65 });
                    doc.moveTo(40, rowY + 14).lineTo(555, rowY + 14).strokeColor('#94a3b8').stroke();
                    rowY += 20;
                    doc.font('Helvetica').fontSize(8);
                }

                // Renderizar fila
                doc.text((idx + 1).toString(), 40, rowY, { width: 30 });
                
                // Tipo de parada
                if (parada.tipo === 'RETIRO') {
                    doc.fillColor('#d35400').font('Helvetica-Bold').text('RETIRO', 75, rowY, { width: 55 });
                } else if (parada.tipo === 'SOBRE') {
                    doc.fillColor('#7c3aed').font('Helvetica-Bold').text('SOBRE', 75, rowY, { width: 55 });
                } else {
                    doc.fillColor('#059669').font('Helvetica-Bold').text('ENTREGA', 75, rowY, { width: 55 });
                }
                doc.fillColor('#000000').font('Helvetica');

                // Datos cliente
                const clientLabel = `[Cli #${parada.cliente_id}] ${parada.cliente_nombre.slice(0, 22)}`;
                doc.text(clientLabel, 135, rowY, { width: 130 });

                // Dirección
                doc.text(parada.direccion.slice(0, 28), 270, rowY, { width: 135 });

                // Referencia e importe
                const refLabel = `${parada.referencia} (${parada.total})`;
                doc.text(refLabel, 410, rowY, { width: 75 });

                // Línea de firma / casillero de control
                doc.moveTo(490, rowY + 8).lineTo(550, rowY + 8).strokeColor('#cbd5e1').stroke();

                rowY += 26; // Salto de fila con espaciado amplio para anotaciones
            });

            // Footer / Firmas de conformidad del Chofer
            doc.moveDown(3);
            const footerY = doc.y > 660 ? 50 : doc.y + 40;
            if (doc.y > 660) doc.addPage();

            doc.moveTo(40, footerY + 50).lineTo(180, footerY + 50).strokeColor('#94a3b8').stroke();
            doc.text('Firma Chofer', 40, footerY + 55, { width: 140, align: 'center' });

            doc.moveTo(200, footerY + 50).lineTo(340, footerY + 50).strokeColor('#94a3b8').stroke();
            doc.text('Aclaración', 200, footerY + 55, { width: 140, align: 'center' });

            doc.moveTo(360, footerY + 50).lineTo(510, footerY + 50).strokeColor('#94a3b8').stroke();
            doc.text('Firma Responsable Carga', 360, footerY + 55, { width: 150, align: 'center' });

            doc.end();

        } catch (error) {
            throw error;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('❌ [RUTAS] Error al generar manifiesto PDF:', error);
        res.status(500).send(`Error al generar manifiesto PDF: ${error.message}`);
    }
});

/**
 * @route GET /api/logistica/rutas/:id
 * @desc Obtener una ruta específica por ID con sus presupuestos
 * @param id - ID de la ruta
 * @access Privado
 * 
 * IMPORTANTE: Esta ruta debe ir DESPUÉS de las rutas específicas
 */
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    console.log(`🔍 [RUTAS] Ruta GET /:id - Obteniendo ruta ID: ${id}`);
    
    try {
        await obtenerRutaPorId(req, res);
    } catch (error) {
        console.error(`❌ [RUTAS] Error en ruta GET /:id (${id}):`, error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener ruta',
            message: error.message
        });
    }
});

// Middleware para rutas no encontradas específico del módulo
router.use('*', (req, res) => {
    console.log(`⚠️ [RUTAS] Ruta no encontrada: ${req.method} ${req.originalUrl}`);
    
    res.status(404).json({
        success: false,
        error: 'Ruta no encontrada en el módulo de rutas',
        path: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString()
    });
});

console.log('✅ [RUTAS] Rutas configuradas exitosamente');
console.log('📋 [RUTAS] Rutas disponibles:');
console.log('   - GET    /api/logistica/rutas');
console.log('   - GET    /api/logistica/rutas/:id');
console.log('   - POST   /api/logistica/rutas');
console.log('   - PUT    /api/logistica/rutas/:id');
console.log('   - PUT    /api/logistica/rutas/:id/asignar');
console.log('   - PUT    /api/logistica/rutas/:id/reordenar');
console.log('   - DELETE /api/logistica/rutas/:id/presupuestos/:presupuestoId');
console.log('   - DELETE /api/logistica/rutas/:id');
console.log('   - PUT    /api/logistica/rutas/:id/estado');

module.exports = router;
