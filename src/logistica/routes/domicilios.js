/**
 * Rutas de Domicilios
 * Endpoints para gestión de domicilios de entrega
 */

const express = require('express');
const router = express.Router();

console.log('🔍 [DOMICILIOS] Configurando rutas del módulo...');

// Importar controladores
const {
    obtenerDomicilios,
    obtenerDomicilioPorId,
    crearDomicilio,
    actualizarDomicilio,
    eliminarDomicilio
} = require('../controllers/domiciliosController');

const {
    listarSolicitudes,
    crearSolicitud,
    revocarSolicitud,
    enviarSolicitudOmnicanal
} = require('../controllers/domicilioSolicitudesController');

// Rutas de solicitudes públicas de autogestión (DEBEN ir antes de GET /:id)
router.get('/solicitudes', listarSolicitudes);
router.post('/solicitudes', crearSolicitud);
router.post('/solicitudes/:id/revocar', revocarSolicitud);
router.post('/solicitudes/:id/enviar-omnicanal', enviarSolicitudOmnicanal);

/**
 * @route GET /api/logistica/domicilios
 * @desc Obtener todos los domicilios con filtros opcionales
 * @query id_cliente - Filtrar por cliente
 * @query activo - Filtrar por estado activo (true/false)
 * @query es_predeterminado - Filtrar por domicilio predeterminado (true/false)
 * @access Privado
 */
router.get('/', async (req, res) => {
    console.log('🔍 [DOMICILIOS] Ruta GET / - Obteniendo domicilios');
    try {
        await obtenerDomicilios(req, res);
    } catch (error) {
        console.error('❌ [DOMICILIOS] Error en ruta GET /:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en la ruta de domicilios',
            message: error.message
        });
    }
});

/**
 * @route GET /api/logistica/domicilios/:id
 * @desc Obtener un domicilio específico por ID
 * @param id - ID del domicilio
 * @access Privado
 */
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    console.log(`🔍 [DOMICILIOS] Ruta GET /:id - Obteniendo domicilio ID: ${id}`);
    
    try {
        await obtenerDomicilioPorId(req, res);
    } catch (error) {
        console.error(`❌ [DOMICILIOS] Error en ruta GET /:id (${id}):`, error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener domicilio',
            message: error.message
        });
    }
});

/**
 * @route POST /api/logistica/domicilios
 * @desc Crear un nuevo domicilio
 * @body id_cliente - ID del cliente (requerido)
 * @body alias - Nombre del domicilio (requerido)
 * @body direccion - Dirección completa (requerido)
 * @body localidad - Localidad
 * @body provincia - Provincia
 * @body codigo_postal - Código postal
 * @body latitud - Latitud (opcional)
 * @body longitud - Longitud (opcional)
 * @body coordenadas_validadas - Si las coordenadas fueron validadas
 * @body es_predeterminado - Si es el domicilio predeterminado
 * @body telefono_contacto - Teléfono de contacto
 * @body instrucciones_entrega - Instrucciones especiales
 * @body horario_atencion_desde - Horario de atención desde
 * @body horario_atencion_hasta - Horario de atención hasta
 * @access Privado
 */
router.post('/', async (req, res) => {
    console.log('🔍 [DOMICILIOS] Ruta POST / - Creando nuevo domicilio');
    
    try {
        await crearDomicilio(req, res);
    } catch (error) {
        console.error('❌ [DOMICILIOS] Error en ruta POST /:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al crear domicilio',
            message: error.message
        });
    }
});

/**
 * @route PUT /api/logistica/domicilios/:id
 * @desc Actualizar un domicilio existente
 * @param id - ID del domicilio
 * @body Campos a actualizar (todos opcionales)
 * @access Privado
 */
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    console.log(`🔍 [DOMICILIOS] Ruta PUT /:id - Actualizando domicilio ID: ${id}`);
    
    try {
        await actualizarDomicilio(req, res);
    } catch (error) {
        console.error(`❌ [DOMICILIOS] Error en ruta PUT /:id (${id}):`, error);
        res.status(500).json({
            success: false,
            error: 'Error interno al actualizar domicilio',
            message: error.message
        });
    }
});

/**
 * @route DELETE /api/logistica/domicilios/:id
 * @desc Eliminar un domicilio (soft delete)
 * @param id - ID del domicilio
 * @access Privado
 */
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    console.log(`🔍 [DOMICILIOS] Ruta DELETE /:id - Eliminando domicilio ID: ${id}`);
    
    try {
        await eliminarDomicilio(req, res);
    } catch (error) {
        console.error(`❌ [DOMICILIOS] Error en ruta DELETE /:id (${id}):`, error);
        res.status(500).json({
            success: false,
            error: 'Error interno al eliminar domicilio',
            message: error.message
        });
    }
});

// Middleware para rutas no encontradas específico del módulo
router.use('*', (req, res) => {
    console.log(`⚠️ [DOMICILIOS] Ruta no encontrada: ${req.method} ${req.originalUrl}`);
    
    res.status(404).json({
        success: false,
        error: 'Ruta no encontrada en el módulo de domicilios',
        path: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString()
    });
});

console.log('✅ [DOMICILIOS] Rutas configuradas exitosamente');
console.log('📋 [DOMICILIOS] Rutas disponibles:');
console.log('   - GET    /api/logistica/domicilios');
console.log('   - GET    /api/logistica/domicilios/:id');
console.log('   - POST   /api/logistica/domicilios');
console.log('   - PUT    /api/logistica/domicilios/:id');
console.log('   - DELETE /api/logistica/domicilios/:id');

module.exports = router;
