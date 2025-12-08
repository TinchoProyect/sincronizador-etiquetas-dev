/**
 * Controlador de Domicilios
 * Lógica de negocio para gestión de domicilios de entrega
 */

const DomiciliosModel = require('../models/domiciliosModel');

/**
 * Obtener todos los domicilios con filtros
 * GET /api/logistica/domicilios
 */
async function obtenerDomicilios(req, res) {
    try {
        console.log('[DOMICILIOS] Obteniendo domicilios con filtros:', req.query);
        
        const filtros = {
            id_cliente: req.query.id_cliente ? parseInt(req.query.id_cliente) : undefined,
            activo: req.query.activo !== undefined ? req.query.activo === 'true' : true,
            es_predeterminado: req.query.es_predeterminado !== undefined ? req.query.es_predeterminado === 'true' : undefined
        };
        
        const domicilios = await DomiciliosModel.obtenerTodos(filtros);
        
        console.log(`[DOMICILIOS] ✅ ${domicilios.length} domicilios encontrados`);
        
        res.json({
            success: true,
            data: domicilios,
            total: domicilios.length
        });
        
    } catch (error) {
        console.error('[DOMICILIOS] ❌ Error al obtener domicilios:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener domicilios',
            message: error.message
        });
    }
}

/**
 * Obtener un domicilio por ID
 * GET /api/logistica/domicilios/:id
 */
async function obtenerDomicilioPorId(req, res) {
    try {
        const { id } = req.params;
        console.log(`[DOMICILIOS] Obteniendo domicilio ID: ${id}`);
        
        const domicilio = await DomiciliosModel.obtenerPorId(parseInt(id));
        
        if (!domicilio) {
            console.log(`[DOMICILIOS] ⚠️ Domicilio ${id} no encontrado`);
            return res.status(404).json({
                success: false,
                error: 'Domicilio no encontrado'
            });
        }
        
        console.log(`[DOMICILIOS] ✅ Domicilio ${id} encontrado`);
        
        res.json({
            success: true,
            data: domicilio
        });
        
    } catch (error) {
        console.error('[DOMICILIOS] ❌ Error al obtener domicilio:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener domicilio',
            message: error.message
        });
    }
}

/**
 * Crear un nuevo domicilio
 * POST /api/logistica/domicilios
 */
async function crearDomicilio(req, res) {
    try {
        console.log('[DOMICILIOS] Creando nuevo domicilio:', req.body);
        
        const {
            id_cliente,
            alias,
            direccion,
            localidad,
            provincia,
            codigo_postal,
            latitud,
            longitud,
            coordenadas_validadas,
            es_predeterminado,
            telefono_contacto,
            instrucciones_entrega,
            horario_atencion_desde,
            horario_atencion_hasta
        } = req.body;
        
        // Validaciones
        if (!id_cliente) {
            return res.status(400).json({
                success: false,
                error: 'El campo id_cliente es requerido'
            });
        }
        
        if (!alias) {
            return res.status(400).json({
                success: false,
                error: 'El campo alias es requerido'
            });
        }
        
        if (!direccion) {
            return res.status(400).json({
                success: false,
                error: 'El campo direccion es requerido'
            });
        }
        
        // Verificar que el cliente existe
        const clienteExiste = await DomiciliosModel.clienteExiste(id_cliente);
        if (!clienteExiste) {
            console.log(`[DOMICILIOS] ⚠️ Cliente ${id_cliente} no existe`);
            return res.status(404).json({
                success: false,
                error: 'Cliente no encontrado'
            });
        }
        
        // Validar coordenadas si están presentes
        if (latitud && longitud) {
            const coordenadasValidas = DomiciliosModel.validarCoordenadasArgentina(
                parseFloat(latitud),
                parseFloat(longitud)
            );
            
            if (!coordenadasValidas) {
                console.log('[DOMICILIOS] ⚠️ Coordenadas fuera de rango Argentina');
                return res.status(400).json({
                    success: false,
                    error: 'Las coordenadas están fuera del rango de Argentina',
                    detalle: 'Latitud debe estar entre -55 y -21, Longitud entre -73 y -53'
                });
            }
        }
        
        // Crear domicilio
        const nuevoDomicilio = await DomiciliosModel.crear({
            id_cliente: parseInt(id_cliente),
            alias,
            direccion,
            localidad,
            provincia,
            codigo_postal,
            latitud: latitud ? parseFloat(latitud) : null,
            longitud: longitud ? parseFloat(longitud) : null,
            coordenadas_validadas: coordenadas_validadas || false,
            es_predeterminado: es_predeterminado || false,
            telefono_contacto,
            instrucciones_entrega,
            horario_atencion_desde,
            horario_atencion_hasta
        });
        
        console.log(`[DOMICILIOS] ✅ Domicilio creado con ID: ${nuevoDomicilio.id}`);
        
        res.status(201).json({
            success: true,
            message: 'Domicilio creado exitosamente',
            data: nuevoDomicilio
        });
        
    } catch (error) {
        console.error('[DOMICILIOS] ❌ Error al crear domicilio:', error);
        res.status(500).json({
            success: false,
            error: 'Error al crear domicilio',
            message: error.message
        });
    }
}

/**
 * Actualizar un domicilio existente
 * PUT /api/logistica/domicilios/:id
 */
async function actualizarDomicilio(req, res) {
    try {
        const { id } = req.params;
        console.log(`[DOMICILIOS] Actualizando domicilio ID: ${id}`, req.body);
        
        const {
            alias,
            direccion,
            localidad,
            provincia,
            codigo_postal,
            latitud,
            longitud,
            coordenadas_validadas,
            es_predeterminado,
            telefono_contacto,
            instrucciones_entrega,
            horario_atencion_desde,
            horario_atencion_hasta
        } = req.body;
        
        // Validar coordenadas si están presentes
        if (latitud && longitud) {
            const coordenadasValidas = DomiciliosModel.validarCoordenadasArgentina(
                parseFloat(latitud),
                parseFloat(longitud)
            );
            
            if (!coordenadasValidas) {
                console.log('[DOMICILIOS] ⚠️ Coordenadas fuera de rango Argentina');
                return res.status(400).json({
                    success: false,
                    error: 'Las coordenadas están fuera del rango de Argentina'
                });
            }
        }
        
        // Actualizar domicilio
        const domicilioActualizado = await DomiciliosModel.actualizar(parseInt(id), {
            alias,
            direccion,
            localidad,
            provincia,
            codigo_postal,
            latitud: latitud ? parseFloat(latitud) : undefined,
            longitud: longitud ? parseFloat(longitud) : undefined,
            coordenadas_validadas,
            es_predeterminado,
            telefono_contacto,
            instrucciones_entrega,
            horario_atencion_desde,
            horario_atencion_hasta
        });
        
        console.log(`[DOMICILIOS] ✅ Domicilio ${id} actualizado`);
        
        res.json({
            success: true,
            message: 'Domicilio actualizado exitosamente',
            data: domicilioActualizado
        });
        
    } catch (error) {
        console.error('[DOMICILIOS] ❌ Error al actualizar domicilio:', error);
        
        if (error.message === 'Domicilio no encontrado') {
            return res.status(404).json({
                success: false,
                error: error.message
            });
        }
        
        res.status(500).json({
            success: false,
            error: 'Error al actualizar domicilio',
            message: error.message
        });
    }
}

/**
 * Eliminar un domicilio (soft delete)
 * DELETE /api/logistica/domicilios/:id
 */
async function eliminarDomicilio(req, res) {
    try {
        const { id } = req.params;
        console.log(`[DOMICILIOS] Eliminando domicilio ID: ${id}`);
        
        const eliminado = await DomiciliosModel.eliminar(parseInt(id));
        
        if (!eliminado) {
            console.log(`[DOMICILIOS] ⚠️ Domicilio ${id} no encontrado`);
            return res.status(404).json({
                success: false,
                error: 'Domicilio no encontrado'
            });
        }
        
        console.log(`[DOMICILIOS] ✅ Domicilio ${id} eliminado`);
        
        res.json({
            success: true,
            message: 'Domicilio eliminado exitosamente'
        });
        
    } catch (error) {
        console.error('[DOMICILIOS] ❌ Error al eliminar domicilio:', error);
        res.status(500).json({
            success: false,
            error: 'Error al eliminar domicilio',
            message: error.message
        });
    }
}

module.exports = {
    obtenerDomicilios,
    obtenerDomicilioPorId,
    crearDomicilio,
    actualizarDomicilio,
    eliminarDomicilio
};
