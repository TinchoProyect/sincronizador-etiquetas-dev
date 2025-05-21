const express = require('express');
const router = express.Router();
const { crearCarro, agregarArticulo, obtenerArticulos, obtenerArticulosDeCarro, validarPropiedadCarro, obtenerCarrosDeUsuario, eliminarCarro } = require('./carro');

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
        const { articuloNumero, descripcion, cantidad, usuarioId } = req.body;
        
        // Validar datos requeridos
        if (!articuloNumero || !descripcion || !cantidad || !usuarioId) {
            return res.status(400).json({
                error: 'Se requieren todos los campos del artículo y el ID del usuario'
            });
        }

        // Validar que cantidad sea un número positivo
        if (isNaN(cantidad) || cantidad <= 0) {
            return res.status(400).json({
                error: 'La cantidad debe ser un número positivo'
            });
        }

        // Validar que el carro pertenezca al usuario
        const esValido = await validarPropiedadCarro(carroId, usuarioId);
        if (!esValido) {
            return res.status(403).json({
                error: 'No tiene permiso para modificar este carro'
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
        const usuarioId = req.query.usuarioId;

        if (!usuarioId) {
            return res.status(400).json({
                error: 'Se requiere el ID del usuario'
            });
        }

        const articulos = await obtenerArticulosDeCarro(carroId, usuarioId);
        res.json(articulos);
    } catch (error) {
        console.error('Error al obtener artículos del carro:', error);
        res.status(500).json({
            error: 'Error al obtener la lista de artículos del carro'
        });
    }
});

/**
 * GET /api/produccion/usuario/:id/carros
 * Obtiene todos los carros de un usuario específico
 */
router.get('/usuario/:id/carros', async (req, res) => {
    try {
        const usuarioId = req.params.id;
        const carros = await obtenerCarrosDeUsuario(usuarioId);
        res.json(carros);
    } catch (error) {
        console.error('Error al obtener carros del usuario:', error);
        res.status(500).json({
            error: 'Error al obtener la lista de carros del usuario'
        });
    }
});

/**
 * DELETE /api/produccion/carro/:id
 * Elimina un carro de producción específico
 */
router.delete('/carro/:id', async (req, res) => {
    try {
        const carroId = req.params.id;
        const { usuarioId } = req.query;

        if (!usuarioId) {
            return res.status(400).json({
                error: 'Se requiere el ID del usuario'
            });
        }

        await eliminarCarro(carroId, usuarioId);
        res.json({ message: 'Carro eliminado correctamente' });
    } catch (error) {
        console.error('Error al eliminar carro:', error);
        res.status(500).json({
            error: 'Error al eliminar el carro'
        });
    }
});

module.exports = router;
