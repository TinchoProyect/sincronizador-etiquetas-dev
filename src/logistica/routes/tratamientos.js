const express = require('express');
const router = express.Router();

// Middleware base y Controlador
const auth = require('../middleware/auth');
const tratamientosController = require('../controllers/tratamientosController');

/**
 * ====================================================
 * ENDPOINTS: RETIROS ESPECIALES (TRATAMIENTOS / INMUNIZACIÓN)
 * ====================================================
 */

// 1. Desktop / Chofer: Búsqueda dinámica de Clientes
router.get('/clientes', tratamientosController.buscarClientes);

// 1. Desktop: Generar QR anónimo o con ruta = null
router.post('/generar-qr', tratamientosController.generarQR);

// 1. Chofer: Generar QR anclando de inmediato su id_ruta 
router.post('/generar-qr-chofer', tratamientosController.generarQRChofer);

// 2. WebApp Ligera: Validación inicial (Mostrar Nombre Cliente)
router.get('/sesion/:hash', tratamientosController.obtenerSesion);

// 3. WebApp Ligera: Endpoint PUERTAS AFUERA (Sin Auth Requerida)
// El cliente envía datos usando el hash proporcionado en el QR.
router.post('/precheckin/:hash', tratamientosController.procesarPreCheckin);


/**
 * Fase 3 (Pendiente de implementación tras validar la base local)
 * Aquí irán:
 * - GET /pendientes/:id_ruta
 * - POST /validar-retiro/:id
 * - Integración con POST /rutas/finalizar
 */

module.exports = router;
