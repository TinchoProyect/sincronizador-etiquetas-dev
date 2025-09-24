// src/estadisticas/api/routes/articulos.routes.js
const r = require('express').Router();
const ctrl = require('../controllers/articulos.controller');

// Rutas que ya tenías
r.get('/ultimos',  ctrl.getUltimos);
r.get('/resumen',  ctrl.getResumen);

// ⬇️ Nueva ruta: serie de tiempo (promedio ms/unidad por fecha)
r.get('/mediciones/articulos', ctrl.getSeriePorFecha);

module.exports = r;
