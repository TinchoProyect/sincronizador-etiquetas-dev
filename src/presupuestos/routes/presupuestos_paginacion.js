const express = require('express');
const router = express.Router();
const presupuestosController = require('../controllers/presupuestos_paginacion');

console.log('🔍 [PRESUPUESTOS-PAGINACION] Configurando rutas con paginación...');

/**
 * @route GET /api/presupuestos
 * @desc Obtener presupuestos con paginación y filtro por concepto
 * @access Público (para pruebas)
 */
router.get('/', async (req, res) => {
    console.log('🔍 [PRESUPUESTOS-PAGINACION] Ruta GET / - Obteniendo presupuestos con paginación');
    try {
        await presupuestosController.obtenerPresupuestos(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-PAGINACION] Error en ruta GET /:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en la ruta de presupuestos',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/estadisticas
 * @desc Obtener estadísticas generales
 * @access Público (para pruebas)
 */
router.get('/estadisticas', async (req, res) => {
    console.log('🔍 [PRESUPUESTOS-PAGINACION] Ruta GET /estadisticas - Obteniendo estadísticas');
    try {
        await presupuestosController.obtenerEstadisticas(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-PAGINACION] Error en ruta GET /estadisticas:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en la ruta de estadísticas',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/health
 * @desc Health check del módulo
 * @access Público
 */
router.get('/health', (req, res) => {
    console.log('🔍 [PRESUPUESTOS-PAGINACION] Ruta GET /health - Health check');
    
    res.json({
        success: true,
        module: 'presupuestos-paginacion',
        status: 'active',
        timestamp: new Date().toISOString(),
        version: '2.0.0',
        features: {
            paginacion: true,
            filtro_concepto: true,
            filtro_agente: true
        }
    });
});

console.log('✅ [PRESUPUESTOS-PAGINACION] Rutas configuradas exitosamente');
console.log('📋 [PRESUPUESTOS-PAGINACION] Rutas disponibles:');
console.log('   - GET /api/presupuestos (con paginación y filtros)');
console.log('   - GET /api/presupuestos/estadisticas');
console.log('   - GET /api/presupuestos/health');

module.exports = router;
