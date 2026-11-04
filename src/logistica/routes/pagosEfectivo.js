const express = require('express');
const router = express.Router();
const pagosEfectivoController = require('../controllers/pagosEfectivoController');

console.log('🔍 [PAGOS-EFECTIVO-ROUTES] Preparando rutas de Pagos en Efectivo...');

// Listar sobres (?estado=PREPARADO&cliente_id=CB-XXXX&modalidad=CHOFER)
router.get('/', pagosEfectivoController.listarSobres);

// Obtener un sobre por ID o Código
router.get('/:id', pagosEfectivoController.obtenerSobre);

// Aprobar y Acreditar sobre en Cuenta Corriente
router.post('/:id/acreditar', pagosEfectivoController.aprobarYAcreditar);

// Enviar invitación / derivación por correo electrónico
router.post('/enviar-email-derivacion', pagosEfectivoController.enviarEmailDerivacion);

// Crear sobre derivado de pago en efectivo (desde app móvil o panel administrativo)
router.post('/crear-sobre-derivado', pagosEfectivoController.crearSobreDerivado);

// Cambiar estado (recepción chofer, recepción mostrador, observación)
router.patch('/:id/estado', pagosEfectivoController.actualizarEstado);

console.log('✅ [PAGOS-EFECTIVO-ROUTES] Rutas de Pagos en Efectivo expuestas.');
module.exports = router;
