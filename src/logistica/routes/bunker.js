const express = require('express');
const router = express.Router();
const bunkerController = require('../controllers/bunkerController');
const mermasController = require('../controllers/mermasController');

console.log('🔍 [BUNKER-ROUTES] Configurando rutas del Búnker...');

router.get('/mermas-historicas', mermasController.obtenerHistorialMermas);

// Obtener todas las listas activas
router.get('/listas', bunkerController.getListas);
router.post('/listas', bunkerController.crearLista);
router.put('/listas/:id', bunkerController.actualizarLista);
router.delete('/listas/:id', bunkerController.eliminarLista);
router.get('/exportar-pdf/:listaId', bunkerController.exportarPDFListado);
router.post('/cotizaciones/exportar-pdf', bunkerController.exportarPDFCotizacionCliente);
router.get('/ofertas-activas', bunkerController.obtenerOfertasActivas);
router.get('/mixes-composicion', bunkerController.obtenerMixesComposicion);

// Obtener todos los artículos para el Grid
router.get('/listado', bunkerController.obtenerTodosLosArticulos);

// Buscar en diccionario On-The-Fly
router.get('/diccionario', bunkerController.buscarDiccionario);

// Obtener estructura de plantilla inteligente
router.get('/plantilla', bunkerController.obtenerPlantillaPorTermino);

// Buscar artículos en Stock Real Consolidado
router.get('/buscar-consolidado', bunkerController.buscarConsolidado);
router.get('/legacy-con-stock-pendientes', bunkerController.obtenerLegacyConStockPendientes);

// Buscar cotizaciones en la Tabla Maestra de Supabase (Proveedores) en vivo
router.get('/buscar-tabla-maestra', bunkerController.buscarTablaMaestra);

// Buscar artículos candidatos para hijo
router.get('/buscar-hijos', bunkerController.buscarArticulosHijos);

// Obtener tarifa de rendimiento activa de colaborador
router.get('/colaboradores/tarifa-rendimiento', bunkerController.obtenerTarifaRendimiento);

// Obtener todas las tarifas de rendimiento activas de un colaborador (Módulo de Selección de Servicio)
router.get('/colaboradores/tarifas-rendimiento/:colaborador_id', bunkerController.obtenerTarifasRendimientoColaborador);

// Buscar insumos restringidos al entorno Búnker
router.get('/buscar-insumos', bunkerController.buscarInsumosBunker);

// Obtener catálogo maestro de packaging / empaque (Bolsas, cajas, insumos)
router.get('/catalogo-empaque', bunkerController.obtenerCatalogoPackaging);

// Obtener catálogo maestro de materias primas / ingredientes alimenticios (LDN 2)
router.get('/catalogo-ingredientes', bunkerController.obtenerCatalogoIngredientes);

// 🏭 Obtener sufijos WIP históricos para el datalist del nomenclador (Fase 50)
router.get('/sufijos-wip-historico', bunkerController.obtenerSufijosWIPHistorico);



// Pre-generación reactiva de códigos local
router.get('/generar-identidad-local', bunkerController.generarIdentidadLocal);

// Obtener detalle de artículo
router.get('/articulos/:id', bunkerController.obtenerArticulo);

// Alta de un artículo en el Búnker
router.post('/articulos', bunkerController.crearArticulo);

// Consultar un artículo consolidado del Búnker
router.get('/articulos/:id', bunkerController.obtenerArticulo);

// Actualizar valores/márgenes en el Búnker
router.put('/articulos/:id', bunkerController.actualizarArticulo);

// Actualizar márgenes en masa (Bulk Update)
router.post('/articulos/actualizar-margenes-masa', bunkerController.actualizarMargenesEnMasa);

// Actualizar disponibilidad/habilitación en masa
router.post('/articulos/actualizar-habilitacion-masa', bunkerController.actualizarHabilitacionEnMasa);

// 🗑️ Eliminar y desvincular receta de producción directamente en el Búnker
router.delete('/recetas/:articulo_numero', bunkerController.eliminarRecetaBunker);

// Eliminar un artículo exclusivamente del Búnker
router.delete('/articulos/:id', bunkerController.eliminarArticulo);

// Imprimir etiqueta doble asimétrica Zebra (Artículos)
router.post('/articulos/imprimir', bunkerController.imprimirEtiquetaDobleBunker);
router.post('/articulos/:id/imprimir', bunkerController.imprimirEtiquetaDobleBunker);
router.post('/articulos/*/imprimir', bunkerController.imprimirEtiquetaDobleBunker);

// Imprimir etiqueta doble asimétrica Zebra (Ingredientes)
router.post('/ingredientes/imprimir', bunkerController.imprimirEtiquetaDobleIngrediente);
router.post('/ingredientes/:id/imprimir', bunkerController.imprimirEtiquetaDobleIngrediente);
router.post('/ingredientes/*/imprimir', bunkerController.imprimirEtiquetaDobleIngrediente);

// --- GESTOR DE PRECIOS PARALELO ---
router.get('/finanzas/:id', bunkerController.obtenerRadiografiaFinanciera);
router.post('/finanzas/:id', bunkerController.actualizarEstructuraFinanciera);
router.post('/articulo/lista-disponibilidad', bunkerController.actualizarDisponibilidadArticulo);

// --- MAPEOS DE REPOSICION (FASE 4) ---
router.get('/reposicion/resolver-articulo', bunkerController.resolverArticuloParaMapeo);
router.get('/reposicion/mapeo/:bunker_articulo_id', bunkerController.obtenerMapeoReposicion);
router.post('/reposicion/mapeo/:bunker_articulo_id', bunkerController.guardarMapeoReposicion);


// --- RUTAS DE VINCULACIÓN LOTES - BÚNKER ---
const lotesBunkerController = require('../controllers/lotesBunkerController');

// Buscar destinos unificados (Búnker + Ingredientes)
router.get('/destinos/buscar', lotesBunkerController.buscarDestinos);

// Guardar vinculación (Split Lotes)
router.post('/lotes_vinculos', lotesBunkerController.vincularLote);
router.post('/lotes_vinculos/desvincular', lotesBunkerController.desvincularLote);

// Obtener auditoría y landed cost de un lote
router.get('/lotes/:loteId/auditoria-costos', lotesBunkerController.obtenerAuditoriaCostos);
router.post('/lotes/:loteId/sincronizar-costo', lotesBunkerController.sincronizarCostoLote);

// Consultar estado de asignación múltiple (Trazabilidad)
router.post('/lotes_vinculos/estados', lotesBunkerController.consultarEstadosLotes);

// Abrir una caja cerrada y pasar su peso al stock libre de ingredientes
router.post('/lotes_vinculos/abrir_caja', lotesBunkerController.abrirCajaDestino);


console.log('✅ [BUNKER-ROUTES] Rutas del Búnker configuradas exitosamente');

module.exports = router;
