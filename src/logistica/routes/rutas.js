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
    obtenerPresupuestosDisponibles
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
            
            // Actualizar orden_entrega de cada presupuesto
            for (let i = 0; i < orden.length; i++) {
                await client.query(
                    `UPDATE presupuestos 
                     SET orden_entrega = $1
                     WHERE id = $2 AND id_ruta = $3`,
                    [i + 1, orden[i], id]
                );
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
            
            // Desasignar presupuesto y restaurar secuencia
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
 * @desc Eliminar una ruta
 * @param id - ID de la ruta
 * @access Privado
 * 
 * IMPORTANTE: Solo se pueden eliminar rutas vacías (sin presupuestos asignados)
 */
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    console.log(`🔍 [RUTAS] Ruta DELETE /:id - Eliminando ruta ID: ${id}`);
    
    try {
        const client = await req.db.connect();
        
        try {
            await client.query('BEGIN');
            
            // Verificar que la ruta existe
            const rutaQuery = await client.query(
                'SELECT id, estado FROM rutas WHERE id = $1',
                [id]
            );
            
            if (rutaQuery.rows.length === 0) {
                throw new Error('Ruta no encontrada');
            }
            
            // Verificar que no tenga presupuestos asignados
            const presupuestosQuery = await client.query(
                'SELECT COUNT(*) as total FROM presupuestos WHERE id_ruta = $1',
                [id]
            );
            
            const totalPresupuestos = parseInt(presupuestosQuery.rows[0].total);
            
            if (totalPresupuestos > 0) {
                throw new Error('No se puede eliminar una ruta con pedidos asignados. Quítelos primero.');
            }
            
            // Eliminar ruta
            await client.query(
                'DELETE FROM rutas WHERE id = $1',
                [id]
            );
            
            await client.query('COMMIT');
            
            res.json({
                success: true,
                message: 'Ruta eliminada correctamente'
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error(`❌ [RUTAS] Error al eliminar ruta:`, error);
        res.status(500).json({
            success: false,
            error: error.message
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
