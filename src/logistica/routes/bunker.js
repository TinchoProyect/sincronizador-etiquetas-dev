const express = require('express');
const router = express.Router();
const bunkerController = require('../controllers/bunkerController');

console.log('🔍 [BUNKER-ROUTES] Configurando rutas del Búnker...');

// Obtener todas las listas activas
router.get('/listas', bunkerController.getListas);

// Obtener todos los artículos para el Grid
router.get('/listado', bunkerController.obtenerTodosLosArticulos);

// Buscar en diccionario On-The-Fly
router.get('/diccionario', bunkerController.buscarDiccionario);

// Obtener estructura de plantilla inteligente
router.get('/plantilla', bunkerController.obtenerPlantillaPorTermino);

// Buscar artículos en Stock Real Consolidado
router.get('/buscar-consolidado', bunkerController.buscarConsolidado);

// Obtener detalle de artículo
router.get('/articulos/:id', bunkerController.obtenerArticulo);

// Alta de un artículo en el Búnker
router.post('/articulos', bunkerController.crearArticulo);

// Consultar un artículo consolidado del Búnker
router.get('/articulos/:id', bunkerController.obtenerArticulo);

// Actualizar valores/márgenes en el Búnker
router.put('/articulos/:id', bunkerController.actualizarArticulo);

console.log('✅ [BUNKER-ROUTES] Rutas del Búnker configuradas exitosamente');

module.exports = router;
