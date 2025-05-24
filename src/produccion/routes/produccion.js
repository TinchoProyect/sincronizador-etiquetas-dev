const express = require('express');
const router = express.Router();
const { crearReceta, obtenerEstadoRecetas } = require('../controllers/recetas');
const { 
    crearCarro, 
    agregarArticulo, 
    obtenerArticulos,
    obtenerArticulosDeCarro,
    obtenerCarrosDeUsuario,
    eliminarCarro 
} = require('../controllers/carro');

// Rutas para artículos
router.get('/articulos', async (req, res) => {
    try {
        console.log('Recibida solicitud GET /articulos');
        const articulos = await obtenerArticulos();
        console.log(`Enviando respuesta con ${articulos.length} artículos`);
        res.json(articulos);
    } catch (error) {
        console.error('Error en ruta GET /articulos:', error);
        res.status(500).json({ 
            error: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Ruta para obtener estado de recetas
router.post('/articulos/estado-recetas', obtenerEstadoRecetas);

// Rutas para carros de producción
router.post('/carro', async (req, res) => {
    try {
        const { usuarioId, enAuditoria } = req.body;
        const carroId = await crearCarro(usuarioId, enAuditoria);
        res.json({ id: carroId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/usuario/:usuarioId/carros', async (req, res) => {
    try {
        const carros = await obtenerCarrosDeUsuario(req.params.usuarioId);
        res.json(carros);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/carro/:id/articulos', async (req, res) => {
    try {
        const articulos = await obtenerArticulosDeCarro(req.params.id, req.query.usuarioId);
        res.json(articulos);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/carro/:id/articulo', async (req, res) => {
    try {
        const { articuloNumero, descripcion, cantidad, usuarioId } = req.body;
        await agregarArticulo(req.params.id, articuloNumero, descripcion, cantidad);
        res.json({ message: 'Artículo agregado correctamente' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/carro/:id', async (req, res) => {
    try {
        const usuarioId = req.query.usuarioId;
        await eliminarCarro(req.params.id, usuarioId);
        res.json({ message: 'Carro eliminado correctamente' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rutas para recetas
router.post('/recetas', crearReceta);

module.exports = router;
