const express = require('express');
const router = express.Router();
const { crearCarro, agregarArticulo, obtenerArticulos, obtenerArticulosDeCarro } = require('./carro');

/**
 * POST /api/produccion/carro
 * Crea un nuevo carro de producción
 */
router.post('/carro', async (req, res) => {
    try {
        const { usuarioId, enAuditoria } = req.body;
        
        if (!usuarioId) {
            return res.status(400).json({
                error: 'Se requiere el ID del usuario'
            });
        }

        const carroId = await crearCarro(usuarioId, enAuditoria);
        
        res.json({
            id: carroId
        });

    } catch (error) {
        console.error('Error en ruta crear carro:', error);
        res.status(500).json({
            error: 'Error al crear el carro de producción'
        });
    }
});

/**
 * POST /api/produccion/carro/:id/articulo
 * Agrega un artículo al carro de producción
 */
router.post('/carro/:id/articulo', async (req, res) => {
    try {
        const carroId = req.params.id;
        const { articuloNumero, descripcion, cantidad } = req.body;
        
        // Validar datos requeridos
        if (!articuloNumero || !descripcion || !cantidad) {
            return res.status(400).json({
                error: 'Se requieren todos los campos del artículo'
            });
        }

        // Validar que cantidad sea un número positivo
        if (isNaN(cantidad) || cantidad <= 0) {
            return res.status(400).json({
                error: 'La cantidad debe ser un número positivo'
            });
        }

        await agregarArticulo(carroId, articuloNumero, descripcion, cantidad);
        
        res.json({
            message: 'Artículo agregado correctamente'
        });

    } catch (error) {
        console.error('Error al agregar artículo:', error);
        res.status(500).json({
            error: 'Error al agregar el artículo al carro'
        });
    }
});


/**
 * GET /api/produccion/articulos
 * Obtiene la lista de todos los artículos disponibles
 */
router.get('/articulos', async (req, res) => {
    try {
        const articulos = await obtenerArticulos();
        res.json(articulos);
    } catch (error) {
        console.error('Error al obtener artículos:', error);
        res.status(500).json({
            error: 'Error al obtener la lista de artículos'
        });
    }
});

/**
 * GET /api/produccion/carro/:id/articulos
 * Obtiene la lista de artículos en un carro específico
 */
router.get('/carro/:id/articulos', async (req, res) => {
    try {
        const carroId = req.params.id;
        const articulos = await obtenerArticulosDeCarro(carroId);
        res.json(articulos);
    } catch (error) {
        console.error('Error al obtener artículos del carro:', error);
        res.status(500).json({
            error: 'Error al obtener la lista de artículos del carro'
        });
    }
});

module.exports = router;
