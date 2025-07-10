const express = require('express');
const router = express.Router();
const { obtenerIngredientesBaseCarro, obtenerMixesCarro, obtenerIngredientesArticulosVinculados } = require('../controllers/carroIngredientes');

/**
 * GET /api/produccion/carro/:carroId/ingredientes
 * Obtiene todos los ingredientes base necesarios para un carro
 */
router.get('/:carroId/ingredientes', async (req, res) => {
    try {
        const carroId = parseInt(req.params.carroId);
        const usuarioId = parseInt(req.query.usuarioId);

        if (!carroId || !usuarioId) {
            return res.status(400).json({
                error: 'Se requiere ID de carro y usuario válidos'
            });
        }

        const ingredientes = await obtenerIngredientesBaseCarro(carroId, usuarioId);
        res.json(ingredientes);

    } catch (error) {
        console.error('Error en ruta de ingredientes de carro:', error);
        res.status(500).json({
            error: error.message || 'Error al obtener ingredientes del carro'
        });
    }
});

/**
 * GET /api/produccion/carro/:carroId/mixes
 * Obtiene todos los ingredientes compuestos (mixes) necesarios para un carro
 */
router.get('/:carroId/mixes', async (req, res) => {
    try {
        const carroId = parseInt(req.params.carroId);
        const usuarioId = parseInt(req.query.usuarioId);

        if (!carroId || !usuarioId) {
            return res.status(400).json({
                error: 'Se requiere ID de carro y usuario válidos'
            });
        }

        const mixes = await obtenerMixesCarro(carroId, usuarioId);
        res.json(mixes);

    } catch (error) {
        console.error('Error en ruta de mixes de carro:', error);
        res.status(500).json({
            error: error.message || 'Error al obtener mixes del carro'
        });
    }
});

/**
 * GET /api/produccion/carro/:carroId/ingredientes-vinculados
 * Obtiene todos los ingredientes de artículos vinculados para un carro de producción externa
 */
router.get('/:carroId/ingredientes-vinculados', async (req, res) => {
    try {
        const carroId = parseInt(req.params.carroId);
        const usuarioId = parseInt(req.query.usuarioId);

        if (isNaN(carroId) || isNaN(usuarioId)) {
            return res.status(400).json({ error: 'IDs inválidos' });
        }

        console.log(`🔗 Obteniendo ingredientes vinculados para carro ${carroId}, usuario ${usuarioId}`);

        // Usar la función del controlador en lugar de consulta SQL directa
        const ingredientes = await obtenerIngredientesArticulosVinculados(carroId, usuarioId);
        res.json(ingredientes);

    } catch (error) {
        console.error('❌ Error al obtener ingredientes vinculados:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

module.exports = router;
