/**
 * Rutas API para Auditorías de Rutas y Nodos Cero
 */

const express = require('express');
const router = express.Router();
const AuditoriasController = require('../controllers/auditoriasController');

// El frontend enviará el archivo JSON como un campo de texto grande o multipart. 
// Express builtin body-parser (aumentado en app.js) debe manejarlo.

// Procesamiento en frío (Preview)
router.post('/procesar', AuditoriasController.procesarAuditoriaPreview);

// Guardado definitivo
router.post('/guardar', AuditoriasController.guardarAuditoria);

// Historial
router.get('/', AuditoriasController.listarAuditorias);
router.get('/:id', AuditoriasController.detalleAuditoria);

// Configuración Nodos Cero (Puntos Base)
router.get('/puntos-base/listar', AuditoriasController.listarPuntosBase);
router.post('/puntos-base/crear', AuditoriasController.crearPuntoBase);

module.exports = router;
