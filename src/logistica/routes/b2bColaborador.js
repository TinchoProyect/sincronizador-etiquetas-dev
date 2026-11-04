const express = require('express');
const router = express.Router();
const colabController = require('../controllers/b2bColaboradorController');

// Obtener tablero general del colaborador
router.get('/dashboard', colabController.obtenerDashboardColaborador);

// Actualizar tarifa por hora
router.post('/actualizar-tarifa-hora', colabController.actualizarTarifaHora);

// Actualizar tarifa por rendimiento de artículo
router.post('/actualizar-tarifa-rendimiento', colabController.actualizarTarifaRendimiento);

module.exports = router;
