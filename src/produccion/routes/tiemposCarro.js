// routes/tiemposCarro.js
const express = require('express');
const router = express.Router();
const tiemposCtrl = require('../controllers/tiemposCarro');

// =========================================================================
// ENDPOINTS MODERNOS: MODO MEDICIÓN TEMPORAL (3 ETAPAS, PAUSAS, PRORRATEO)
// =========================================================================

// Activar/desactivar modo voluntario de medición
router.post('/carro/:carroId/modo-medicion', tiemposCtrl.setModoMedicion);

// Pausar/reanudar cronómetro
router.post('/carro/:carroId/pausa', tiemposCtrl.togglePausaMedicion);

// Avanzar etapas guiadas (1: Preparación, 2: Producción, 3: Etiquetado/Cierre, 4: Finalizar y calcular)
router.post('/carro/:carroId/avanzar-etapa', tiemposCtrl.avanzarEtapaMedicion);

// Cancelar medición sin afectar el carro
router.post('/carro/:carroId/cancelar-medicion', tiemposCtrl.cancelarMedicion);

// Estado integral de medición para alimentar el HUD flotante
router.get('/carro/:carroId/estado-medicion', tiemposCtrl.obtenerEstadoMedicion);

// Consulta de métricas para Gestor de Precios Búnker (Finanzas)
router.get('/articulo/:articuloNumero/metricas-campo', tiemposCtrl.obtenerMetricasCampoArticulo);
router.get('/articulos/metricas-disponibles', tiemposCtrl.obtenerMetricasDisponiblesBatch);

// Estimación predictiva de tiempo para carros y artículos
router.get('/carro/:carroId/estimacion', tiemposCtrl.obtenerEstimacionCarro);
router.post('/estimacion-articulos', tiemposCtrl.calcularEstimacionArticulosPost);

// =========================================================================
// ENDPOINTS PREVIOS (COMPATIBILIDAD REGRESIVA)
// =========================================================================
router.post('/carro/:carroId/articulo/:numero/iniciar', tiemposCtrl.iniciarTemporizadorArticulo);
router.post('/carro/:carroId/articulo/:numero/finalizar', tiemposCtrl.finalizarTemporizadorArticulo);
router.get('/carro/:carroId/tiempo-total', tiemposCtrl.obtenerTiempoTotalCarro);

router.post('/carro/:carroId/etapa/:etapa/iniciar', tiemposCtrl.iniciarEtapaCarro);
router.post('/carro/:carroId/etapa/:etapa/finalizar', tiemposCtrl.finalizarEtapaCarro);
router.get('/carro/:carroId/etapas/estado', tiemposCtrl.estadoEtapasCarro);
router.get('/carro/:carroId/articulos/estado', tiemposCtrl.estadoTemporizadoresArticulos);

module.exports = router;
