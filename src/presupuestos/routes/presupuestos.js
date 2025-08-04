const express = require('express');
const router = express.Router();

console.log('🔍 [PRESUPUESTOS] Configurando rutas del módulo...');

// Importar controladores
const {
    obtenerPresupuestos,
    obtenerPresupuestosPorCategoria,
    obtenerEstadisticas,
    obtenerConfiguracion
} = require('../controllers/presupuestos');

// Importar middleware
const { validateSession, validatePermissions } = require('../middleware/auth');

// Aplicar middleware de autenticación a todas las rutas
router.use(validateSession);

/**
 * @route GET /api/presupuestos
 * @desc Obtener todos los presupuestos
 * @access Privado
 */
router.get('/', validatePermissions('presupuestos.read'), async (req, res) => {
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
 * @route GET /api/presupuestos/categoria/:categoria
 * @desc Obtener presupuestos por categoría específica
 * @access Privado
 */
router.get('/categoria/:categoria', validatePermissions('presupuestos.read'), async (req, res) => {
    const { categoria } = req.params;
    console.log(`🔍 [PRESUPUESTOS] Ruta GET /categoria/${categoria} - Obteniendo presupuestos por categoría`);
    
    try {
        await obtenerPresupuestosPorCategoria(req, res);
    } catch (error) {
        console.error(`❌ [PRESUPUESTOS] Error en ruta GET /categoria/${categoria}:`, error);
        res.status(500).json({
            success: false,
            error: 'Error interno en la ruta de categoría',
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
        version: '1.0.0'
    });
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
console.log('📋 [PRESUPUESTOS] Rutas disponibles:');
console.log('   - GET /api/presupuestos');
console.log('   - GET /api/presupuestos/categoria/:categoria');
console.log('   - GET /api/presupuestos/estadisticas');
console.log('   - GET /api/presupuestos/configuracion');
console.log('   - GET /api/presupuestos/health');

module.exports = router;
