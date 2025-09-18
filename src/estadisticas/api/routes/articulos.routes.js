// src/estadisticas/api/routes/articulos.routes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/articulos.controller');

router.get('/ultimos', ctrl.ultimos);
router.get('/resumen', ctrl.resumen);

module.exports = router;

