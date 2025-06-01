const express = require('express');
const router = express.Router();
const { obtenerIngredientesBaseCarro } = require('../controllers/carroIngredientes');

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

module.exports = router;
