const express = require('express');
const router = express.Router();
const {
    obtenerHistorialInventarios,
    obtenerStockRegistrado,
    obtenerDiferencias
} = require('../controllers/historialInventarios');

/**
 * @route GET /api/produccion/inventarios/historial
 * @desc Obtiene el historial completo de inventarios realizados
 * @access Public (ajustar según necesidades de autenticación)
 */
router.get('/inventarios/historial', async (req, res) => {
    console.log('🔄 [RUTA] GET /inventarios/historial - Solicitud recibida');
    await obtenerHistorialInventarios(req, res);
});

/**
 * @route GET /api/produccion/inventarios/:inventarioId/stock-registrado
 * @desc Obtiene todos los artículos registrados en un inventario específico
 * @access Public (ajustar según necesidades de autenticación)
 * @param {string} inventarioId - ID del inventario
 */
router.get('/inventarios/:inventarioId/stock-registrado', async (req, res) => {
    console.log(`🔄 [RUTA] GET /inventarios/${req.params.inventarioId}/stock-registrado - Solicitud recibida`);
    await obtenerStockRegistrado(req, res);
});

/**
 * @route GET /api/produccion/inventarios/:inventarioId/diferencias
 * @desc Obtiene solo los artículos que tuvieron diferencias en un inventario específico
 * @access Public (ajustar según necesidades de autenticación)
 * @param {string} inventarioId - ID del inventario
 */
router.get('/inventarios/:inventarioId/diferencias', async (req, res) => {
    console.log(`🔄 [RUTA] GET /inventarios/${req.params.inventarioId}/diferencias - Solicitud recibida`);
    await obtenerDiferencias(req, res);
});

// Middleware de manejo de errores específico para estas rutas
router.use((error, req, res, next) => {
    console.error('❌ [RUTA-HISTORIAL] Error en ruta de historial de inventarios:', error);
    
    if (res.headersSent) {
        return next(error);
    }
    
    res.status(500).json({
        error: 'Error interno en el servidor de historial de inventarios',
        timestamp: new Date().toISOString(),
        path: req.path
    });
});

module.exports = router;
