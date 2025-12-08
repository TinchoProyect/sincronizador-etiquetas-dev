/**
 * Controlador de Rutas
 * Lógica de negocio para gestión de rutas de reparto
 */

const RutasModel = require('../models/rutasModel');
const presupuestosModel = require('../models/presupuestosModel');

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
            fecha_hasta: req.query.fecha_hasta
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
        
        // Validar fecha de salida (debe ser futura o hoy)
        const fechaSalida = new Date(fecha_salida);
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        
        if (fechaSalida < hoy) {
            console.log('[RUTAS] ⚠️ Fecha de salida es pasada');
            return res.status(400).json({
                success: false,
                error: 'La fecha de salida no puede ser anterior a hoy'
            });
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
        
        // Validar que todos los IDs sean números
        const idsValidos = ids_presupuestos.every(id => Number.isInteger(id) && id > 0);
        if (!idsValidos) {
            return res.status(400).json({
                success: false,
                error: 'Todos los IDs de presupuestos deben ser números enteros positivos'
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

module.exports = {
    obtenerRutas,
    obtenerRutaPorId,
    crearRuta,
    actualizarRuta,
    asignarPresupuestos,
    cambiarEstado,
    obtenerPresupuestosDisponibles
};
