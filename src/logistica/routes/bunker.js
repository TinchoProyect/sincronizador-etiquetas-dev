const express = require('express');
const router = express.Router();
const bunkerController = require('../controllers/bunkerController');

console.log('🔍 [BUNKER-ROUTES] Configurando rutas del Búnker...');

// Obtener todas las listas activas
router.get('/listas', bunkerController.getListas);
router.post('/listas', bunkerController.crearLista);
router.put('/listas/:id', bunkerController.actualizarLista);
router.delete('/listas/:id', bunkerController.eliminarLista);
router.get('/exportar-pdf/:listaId', bunkerController.exportarPDFListado);

// Obtener todos los artículos para el Grid
router.get('/listado', bunkerController.obtenerTodosLosArticulos);

// Buscar en diccionario On-The-Fly
router.get('/diccionario', bunkerController.buscarDiccionario);

// Obtener estructura de plantilla inteligente
router.get('/plantilla', bunkerController.obtenerPlantillaPorTermino);

// Buscar artículos en Stock Real Consolidado
router.get('/buscar-consolidado', bunkerController.buscarConsolidado);

// Buscar insumos restringidos al entorno Búnker
router.get('/buscar-insumos', bunkerController.buscarInsumosBunker);

// Obtener detalle de artículo
router.get('/articulos/:id', bunkerController.obtenerArticulo);

// Alta de un artículo en el Búnker
router.post('/articulos', bunkerController.crearArticulo);

// Consultar un artículo consolidado del Búnker
router.get('/articulos/:id', bunkerController.obtenerArticulo);

// Actualizar valores/márgenes en el Búnker
router.put('/articulos/:id', bunkerController.actualizarArticulo);

// Eliminar un artículo exclusivamente del Búnker
router.delete('/articulos/:id', bunkerController.eliminarArticulo);

// --- GESTOR DE PRECIOS PARALELO ---
router.get('/finanzas/:id', bunkerController.obtenerRadiografiaFinanciera);
router.post('/finanzas/:id', bunkerController.actualizarEstructuraFinanciera);

// --- RUTAS DE VINCULACIÓN LOTES - BÚNKER ---
const lotesBunkerController = require('../controllers/lotesBunkerController');

// Buscar destinos unificados (Búnker + Ingredientes)
router.get('/destinos/buscar', lotesBunkerController.buscarDestinos);

// Guardar vinculación (Split Lotes)
router.post('/lotes_vinculos', lotesBunkerController.vincularLote);

// Consultar estado de asignación múltiple (Trazabilidad)
router.post('/lotes_vinculos/estados', lotesBunkerController.consultarEstadosLotes);

// Abrir una caja cerrada y pasar su peso al stock libre de ingredientes
router.post('/lotes_vinculos/abrir_caja', lotesBunkerController.abrirCajaDestino);


console.log('✅ [BUNKER-ROUTES] Rutas del Búnker configuradas exitosamente');

module.exports = router;
