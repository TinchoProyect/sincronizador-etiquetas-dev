const express = require('express');
const router = express.Router();
const emailController = require('../controllers/emailController');

// Ruta para enviar factura PDF a través de correo electrónico
router.post('/facturas/:id/enviar', emailController.enviarFactura);

// Ruta para enviar resumen de cuenta corriente por correo electrónico
router.post('/cuentas-corrientes/enviar', emailController.enviarResumenCuenta);

// Ruta para enviar presupuesto por correo electrónico
router.post('/presupuestos/enviar', emailController.enviarPresupuesto);

// Ruta para enviar comprobante individual por correo electrónico
router.post('/comprobantes/enviar', emailController.enviarComprobante);

// Ruta para enviar cotización PDF por correo electrónico
router.post('/cotizaciones/enviar', emailController.enviarCotizacion);

// Ruta para enviar notificación general de texto por correo electrónico
router.post('/notificacion/enviar', emailController.enviarNotificacion);

module.exports = router;
