const express = require('express');
const router = express.Router();

console.log('🔍 [PRESUPUESTOS] Configurando rutas del módulo...');

// Importar controladores reales
const {
    obtenerPresupuestos,
    obtenerSugerenciasClientes,
    obtenerPresupuestoPorId,
    obtenerDetallesPresupuesto,
    actualizarEstadoPresupuesto,
    obtenerEstadisticas,
    obtenerConfiguracion,
    obtenerResumen
} = require('../controllers/presupuestos');

// Importar controladores de Google Sheets
const {
    verificarAutenticacion,
    iniciarAutenticacion,
    completarAutenticacion,
    validarHoja,
    configurarHoja,
    ejecutarSincronizacion,
    obtenerHistorial,
    obtenerEstadoSync
} = require('../controllers/gsheets');

// Importar controlador de Full Refresh Sync
const {
    executeFullRefresh,
    getSyncStatus,
    executeDryRun,
    getSyncHistory,
    getDatabaseStats
} = require('../controllers/sync_full_refresh');

// Importar controlador de Corrección de Fechas
const {
    ejecutarCorreccion,
    obtenerEstadisticasFechas,
    obtenerHistorialCorrecciones,
    validarConfiguracion
} = require('../controllers/sync_fechas_fix');

// Importar middleware
const { validateSession, validatePermissions } = require('../middleware/auth');
const {
    validarCrearPresupuesto,
    validarActualizarPresupuesto,
    validarIdPresupuesto,
    validarFiltros,
    validarResumen,
    sanitizarDatos
} = require('../middleware/validation');

// Aplicar middleware de autenticación a todas las rutas
router.use(validateSession);

/**
 * @route GET /api/presupuestos
 * @desc Obtener todos los presupuestos con filtros avanzados
 * @access Privado
 */
router.get('/', validatePermissions('presupuestos.read'), sanitizarDatos, validarFiltros, async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET / - Obteniendo todos los presupuestos');
    try {
        await obtenerPresupuestos(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en la ruta de presupuestos',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/cliente/:cliente
 * @desc Obtener presupuestos por cliente específico
 * @access Privado
 */
router.get('/cliente/:cliente', validatePermissions('presupuestos.read'), async (req, res) => {
    const { cliente } = req.params;
    console.log(`🔍 [PRESUPUESTOS] Ruta GET /cliente/${cliente} - Obteniendo presupuestos por cliente`);
    
    try {
        // Usar el filtro de cliente en la función principal
        req.query.id_cliente = cliente;
        await obtenerPresupuestos(req, res);
    } catch (error) {
        console.error(`❌ [PRESUPUESTOS] Error en ruta GET /cliente/${cliente}:`, error);
        res.status(500).json({
            success: false,
            error: 'Error interno en la ruta de cliente',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/estado/:estado
 * @desc Obtener presupuestos por estado específico
 * @access Privado
 */
router.get('/estado/:estado', validatePermissions('presupuestos.read'), async (req, res) => {
    const { estado } = req.params;
    console.log(`🔍 [PRESUPUESTOS] Ruta GET /estado/${estado} - Obteniendo presupuestos por estado`);
    
    try {
        // Usar el filtro de estado en la función principal
        req.query.estado = estado;
        await obtenerPresupuestos(req, res);
    } catch (error) {
        console.error(`❌ [PRESUPUESTOS] Error en ruta GET /estado/${estado}:`, error);
        res.status(500).json({
            success: false,
            error: 'Error interno en la ruta de estado',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/clientes/sugerencias
 * @desc Obtener sugerencias de clientes para typeahead - Filtro cliente + Typeahead + Fechas – 2024-12-19
 * @access Privado
 */
router.get('/clientes/sugerencias', validatePermissions('presupuestos.read'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /clientes/sugerencias - Obteniendo sugerencias de clientes');
    
    try {
        await obtenerSugerenciasClientes(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /clientes/sugerencias:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en la ruta de sugerencias de clientes',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/estadisticas
 * @desc Obtener estadísticas generales de presupuestos
 * @access Privado
 */
router.get('/estadisticas', validatePermissions('presupuestos.read'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /estadisticas - Calculando estadísticas');
    
    try {
        await obtenerEstadisticas(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /estadisticas:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en la ruta de estadísticas',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/configuracion
 * @desc Obtener configuración actual de Google Sheets
 * @access Privado
 */
router.get('/configuracion', validatePermissions('presupuestos.config'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /configuracion - Obteniendo configuración');
    
    try {
        await obtenerConfiguracion(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /configuracion:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en la ruta de configuración',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/resumen
 * @desc Obtener resumen por categoría o fecha
 * @access Privado
 */
router.get('/resumen', validatePermissions('presupuestos.read'), sanitizarDatos, validarResumen, async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /resumen - Generando resumen');
    
    try {
        await obtenerResumen(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /resumen:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en la ruta de resumen',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/health
 * @desc Health check del módulo de presupuestos
 * @access Público
 */
router.get('/health', (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /health - Health check');
    
    res.json({
        success: true,
        module: 'presupuestos',
        status: 'active',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        features: {
            google_sheets: true,
            sync: true,
            auth: true
        }
    });
});

/**
 * @route GET /api/presupuestos/:id/detalles
 * @desc Obtener detalles de artículos de un presupuesto
 * @access Privado
 */
router.get('/:id/detalles', validatePermissions('presupuestos.read'), validarIdPresupuesto, async (req, res) => {
    const { id } = req.params;
    console.log(`🔍 [PRESUPUESTOS] Ruta GET /:id/detalles - Obteniendo detalles de presupuesto ID: ${id}`);
    
    try {
        await obtenerDetallesPresupuesto(req, res);
    } catch (error) {
        console.error(`❌ [PRESUPUESTOS] Error en ruta GET /:id/detalles (${id}):`, error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener detalles del presupuesto',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/:id
 * @desc Obtener presupuesto por ID específico
 * @access Privado
 */
router.get('/:id', validatePermissions('presupuestos.read'), validarIdPresupuesto, async (req, res) => {
    const { id } = req.params;
    console.log(`🔍 [PRESUPUESTOS] Ruta GET /:id - Obteniendo presupuesto ID: ${id}`);
    
    // Validar que no sea una ruta específica
    if (id === 'health' || id === 'estadisticas' || id === 'configuracion' || id === 'resumen' || id.startsWith('sync/')) {
        console.log(`⚠️ [PRESUPUESTOS] Ruta específica detectada como ID: ${id}`);
        return res.status(400).json({
            success: false,
            error: 'Ruta no válida como ID de presupuesto',
            timestamp: new Date().toISOString()
        });
    }
    
    try {
        await obtenerPresupuestoPorId(req, res);
    } catch (error) {
        console.error(`❌ [PRESUPUESTOS] Error en ruta GET /:id (${id}):`, error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener presupuesto por ID',
            message: error.message
        });
    }
});

/**
 * @route PUT /api/presupuestos/:id/estado
 * @desc Actualizar estado de presupuesto
 * @access Privado
 */
router.put('/:id/estado', validatePermissions('presupuestos.update'), validarIdPresupuesto, sanitizarDatos, async (req, res) => {
    const { id } = req.params;
    console.log(`🔍 [PRESUPUESTOS] Ruta PUT /:id/estado - Actualizando estado de presupuesto ID: ${id}`);
    
    try {
        await actualizarEstadoPresupuesto(req, res);
    } catch (error) {
        console.error(`❌ [PRESUPUESTOS] Error en ruta PUT /:id/estado (${id}):`, error);
        res.status(500).json({
            success: false,
            error: 'Error interno al actualizar estado',
            message: error.message
        });
    }
});


/**
 * @route GET /api/presupuestos/sync/auth/status
 * @desc Verificar estado de autenticación con Google
 * @access Privado
 */
router.get('/sync/auth/status', validatePermissions('presupuestos.sync'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /sync/auth/status - Verificando autenticación Google');
    
    try {
        await verificarAutenticacion(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /sync/auth/status:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en verificación de autenticación',
            message: error.message
        });
    }
});

/**
 * @route POST /api/presupuestos/sync/auth/iniciar
 * @desc Iniciar proceso de autenticación con Google
 * @access Privado
 */
router.post('/sync/auth/iniciar', validatePermissions('presupuestos.sync'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta POST /sync/auth/iniciar - Iniciando autenticación Google');
    
    try {
        await iniciarAutenticacion(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta POST /sync/auth/iniciar:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al iniciar autenticación',
            message: error.message
        });
    }
});

/**
 * @route POST /api/presupuestos/sync/auth/completar
 * @desc Completar autenticación con código de Google
 * @access Privado
 */
router.post('/sync/auth/completar', validatePermissions('presupuestos.sync'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta POST /sync/auth/completar - Completando autenticación Google');
    
    try {
        await completarAutenticacion(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta POST /sync/auth/completar:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al completar autenticación',
            message: error.message
        });
    }
});

/**
 * @route POST /api/presupuestos/sync/validar-hoja
 * @desc Validar acceso a hoja de Google Sheets
 * @access Privado
 */
router.post('/sync/validar-hoja', validatePermissions('presupuestos.sync'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta POST /sync/validar-hoja - Validando hoja Google Sheets');
    
    try {
        await validarHoja(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta POST /sync/validar-hoja:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al validar hoja',
            message: error.message
        });
    }
});

/**
 * @route POST /api/presupuestos/sync/configurar
 * @desc Configurar hoja de Google Sheets
 * @access Privado
 */
router.post('/sync/configurar', validatePermissions('presupuestos.config'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta POST /sync/configurar - Configurando hoja Google Sheets');
    
    try {
        await configurarHoja(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta POST /sync/configurar:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al configurar hoja',
            message: error.message
        });
    }
});

/**
 * @route POST /api/presupuestos/sync/ejecutar
 * @desc Ejecutar sincronización manual con Google Sheets
 * @access Privado
 */
router.post('/sync/ejecutar', validatePermissions('presupuestos.sync'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta POST /sync/ejecutar - Ejecutando sincronización');
    
    try {
        await ejecutarSincronizacion(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta POST /sync/ejecutar:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al ejecutar sincronización',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/sync/historial
 * @desc Obtener historial de sincronizaciones
 * @access Privado
 */
router.get('/sync/historial', validatePermissions('presupuestos.read'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /sync/historial - Obteniendo historial');
    
    try {
        await obtenerHistorial(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /sync/historial:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener historial',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/sync/estado
 * @desc Obtener estado general de sincronización
 * @access Privado
 */
router.get('/sync/estado', validatePermissions('presupuestos.read'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /sync/estado - Obteniendo estado de sincronización');
    
    try {
        await obtenerEstadoSync(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /sync/estado:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener estado',
            message: error.message
        });
    }
});

// ===== RUTAS DE FULL REFRESH SYNC =====

/**
 * @route POST /api/presupuestos/sync/full-refresh
 * @desc Ejecutar sincronización Full Refresh (borrar y recargar)
 * @access Privado
 */
router.post('/sync/full-refresh', validatePermissions('presupuestos.sync'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta POST /sync/full-refresh - Ejecutando Full Refresh');
    
    try {
        await executeFullRefresh(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta POST /sync/full-refresh:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al ejecutar Full Refresh',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/sync/status
 * @desc Obtener estado actual de sincronización Full Refresh
 * @access Privado
 */
router.get('/sync/status', validatePermissions('presupuestos.read'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /sync/status - Obteniendo estado Full Refresh');
    
    try {
        await getSyncStatus(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /sync/status:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener estado Full Refresh',
            message: error.message
        });
    }
});

/**
 * @route POST /api/presupuestos/sync/dry-run
 * @desc Ejecutar simulación de sincronización (sin cambios)
 * @access Privado
 */
router.post('/sync/dry-run', validatePermissions('presupuestos.sync'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta POST /sync/dry-run - Ejecutando Dry Run');
    
    try {
        await executeDryRun(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta POST /sync/dry-run:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al ejecutar Dry Run',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/sync/history
 * @desc Obtener historial detallado de sincronizaciones Full Refresh
 * @access Privado
 */
router.get('/sync/history', validatePermissions('presupuestos.read'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /sync/history - Obteniendo historial Full Refresh');
    
    try {
        await getSyncHistory(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /sync/history:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener historial Full Refresh',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/sync/stats
 * @desc Obtener estadísticas actuales de la base de datos
 * @access Privado
 */
router.get('/sync/stats', validatePermissions('presupuestos.read'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /sync/stats - Obteniendo estadísticas BD');
    
    try {
        await getDatabaseStats(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /sync/stats:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener estadísticas BD',
            message: error.message
        });
    }
});

// ===== RUTAS DE CORRECCIÓN DE FECHAS =====

/**
 * @route POST /api/presupuestos/sync/corregir-fechas
 * @desc Ejecutar corrección definitiva de fechas DD/MM/YYYY
 * @access Privado
 */
router.post('/sync/corregir-fechas', validatePermissions('presupuestos.sync'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta POST /sync/corregir-fechas - Ejecutando corrección de fechas');
    
    try {
        await ejecutarCorreccion(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta POST /sync/corregir-fechas:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al corregir fechas',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/sync/estadisticas-fechas
 * @desc Obtener estadísticas actuales de fechas
 * @access Privado
 */
router.get('/sync/estadisticas-fechas', validatePermissions('presupuestos.read'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /sync/estadisticas-fechas - Obteniendo estadísticas de fechas');
    
    try {
        await obtenerEstadisticasFechas(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /sync/estadisticas-fechas:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener estadísticas de fechas',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/sync/historial-correcciones
 * @desc Obtener historial de correcciones de fechas
 * @access Privado
 */
router.get('/sync/historial-correcciones', validatePermissions('presupuestos.read'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /sync/historial-correcciones - Obteniendo historial de correcciones');
    
    try {
        await obtenerHistorialCorrecciones(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /sync/historial-correcciones:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener historial de correcciones',
            message: error.message
        });
    }
});

/**
 * @route POST /api/presupuestos/sync/validar-configuracion
 * @desc Validar configuración antes de corrección
 * @access Privado
 */
router.post('/sync/validar-configuracion', validatePermissions('presupuestos.sync'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta POST /sync/validar-configuracion - Validando configuración');
    
    try {
        await validarConfiguracion(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta POST /sync/validar-configuracion:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al validar configuración',
            message: error.message
        });
    }
});

// Middleware para rutas no encontradas específico del módulo
router.use('*', (req, res) => {
    console.log(`⚠️ [PRESUPUESTOS] Ruta no encontrada: ${req.method} ${req.originalUrl}`);
    
    res.status(404).json({
        success: false,
        error: 'Ruta no encontrada en el módulo de presupuestos',
        path: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString()
    });
});

console.log('✅ [PRESUPUESTOS] Rutas configuradas exitosamente');
console.log('📋 [PRESUPUESTOS] Rutas CRUD disponibles:');
console.log('   - GET /api/presupuestos (con filtros avanzados)');
console.log('   - GET /api/presupuestos/:id');
console.log('   - GET /api/presupuestos/:id/detalles');
console.log('   - POST /api/presupuestos');
console.log('   - PUT /api/presupuestos/:id');
console.log('   - DELETE /api/presupuestos/:id');
console.log('📊 [PRESUPUESTOS] Rutas de consulta:');
console.log('   - GET /api/presupuestos/categoria/:categoria');
console.log('   - GET /api/presupuestos/estadisticas');
console.log('   - GET /api/presupuestos/resumen');
console.log('   - GET /api/presupuestos/configuracion');
console.log('   - GET /api/presupuestos/health');
console.log('🔄 [PRESUPUESTOS] Rutas de sincronización:');
console.log('   - GET /api/presupuestos/sync/auth/status');
console.log('   - POST /api/presupuestos/sync/auth/iniciar');
console.log('   - POST /api/presupuestos/sync/auth/completar');
console.log('   - POST /api/presupuestos/sync/validar-hoja');
console.log('   - POST /api/presupuestos/sync/configurar');
console.log('   - POST /api/presupuestos/sync/ejecutar');
console.log('   - GET /api/presupuestos/sync/historial');
console.log('   - GET /api/presupuestos/sync/estado');
console.log('🔄 [PRESUPUESTOS] Rutas de Full Refresh Sync:');
console.log('   - POST /api/presupuestos/sync/full-refresh');
console.log('   - GET /api/presupuestos/sync/status');
console.log('   - POST /api/presupuestos/sync/dry-run');
console.log('   - GET /api/presupuestos/sync/history');
console.log('   - GET /api/presupuestos/sync/stats');
console.log('📅 [PRESUPUESTOS] Rutas de Corrección de Fechas:');
console.log('   - POST /api/presupuestos/sync/corregir-fechas');
console.log('   - GET /api/presupuestos/sync/estadisticas-fechas');
console.log('   - GET /api/presupuestos/sync/historial-correcciones');
console.log('   - POST /api/presupuestos/sync/validar-configuracion');

module.exports = router;
