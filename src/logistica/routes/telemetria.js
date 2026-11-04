const express = require('express');
const router = express.Router();

function getController() {
  const resolved = require.resolve('../controllers/cloudflareAnalyticsController');
  delete require.cache[resolved];
  return require('../controllers/cloudflareAnalyticsController');
}

/**
 * GET /api/logistica/telemetria/cloudflare
 * Retorna las métricas reales de red de la API GraphQL de Cloudflare
 */
router.get('/cloudflare', (req, res, next) => getController().obtenerTelemetriaCloudflare(req, res, next));

/**
 * GET /api/logistica/telemetria/entregas-qr
 * Retorna las lecturas de QR y asentamientos de recepción de pedidos en la calle
 */
router.get('/entregas-qr', (req, res, next) => getController().obtenerAuditoriaEntregasQR(req, res, next));

/**
 * POST /api/logistica/telemetria/registrar
 * Registra un evento pasivo de telemetría de aplicación
 */
router.post('/registrar', (req, res, next) => getController().registrarPingTelemetria(req, res, next));

/**
 * POST /api/logistica/telemetria/sitio-evento
 * Registra visitas, búsquedas, cambios de idioma y clics a WhatsApp en la página institucional
 */
router.post('/sitio-evento', (req, res, next) => getController().registrarEventoSitioInstitucional(req, res, next));

/**
 * GET /api/logistica/telemetria/sitio-estadisticas
 * Retorna el tablero completo de estadísticas de la página pública y rastreo de IAs
 */
router.get('/sitio-estadisticas', (req, res, next) => getController().obtenerEstadisticasSitioInstitucional(req, res, next));

module.exports = router;
