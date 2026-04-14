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


const pdfTratamientosController = require('../controllers/pdfTratamientosController');

/**
 * Fase 3 (Flujo Híbrido Avanzado)
 */
// 4. Chofer (Móvil): Completar o modificar un check-in in-situ — requiere token JWT de chofer
router.put('/chofer/checkin/:hash', auth.verificarTokenChofer, tratamientosController.checkInChofer);

// 4b. Dashboard (PC): Misma operación — usa validateSession (sin token Bearer de chofer)
router.put('/dashboard/checkin/:hash', auth.validateSession, tratamientosController.checkInChofer);

// 5. Trazabilidad: Exportación a PDF de la Orden de Tratamiento
router.get('/print/:hash', pdfTratamientosController.imprimirPDF);

module.exports = router;
