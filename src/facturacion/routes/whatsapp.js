const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsappController');

// Rutas de administración y monitoreo de WhatsApp
router.get('/status', whatsappController.obtenerEstado);
router.post('/logout', whatsappController.cerrarSesion);
router.post('/conectar', whatsappController.conectar);

// Ruta para enviar factura PDF a través de WhatsApp
router.post('/facturas/:id/enviar', whatsappController.enviarFactura);

// Ruta genérica para enviar cualquier PDF en base64 por WhatsApp
router.post('/enviar-documento', whatsappController.enviarDocumento);

// Ruta genérica para enviar un mensaje de texto plano por WhatsApp
router.post('/enviar-mensaje', whatsappController.enviarMensaje);

// Ruta genérica para enviar una imagen en base64 por WhatsApp
router.post('/enviar-imagen', whatsappController.enviarImagen);

// Ruta para sincronizar conversaciones recientes de WhatsApp hacia el CRM local
router.post('/sincronizar-chats', whatsappController.sincronizarChats);

// Ruta para transcribir audios (ptt / audio) de un chat hacia el CRM local
router.post('/transcribir-audios', whatsappController.transcribirAudiosChat);

module.exports = router;
