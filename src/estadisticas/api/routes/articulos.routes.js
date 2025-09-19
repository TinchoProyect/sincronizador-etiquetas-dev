// src/estadisticas/api/routes/articulos.routes.js
const r = require('express').Router();
const ctrl = require('../controllers/articulos.controller');

r.get('/ultimos',  ctrl.getUltimos);
r.get('/resumen',  ctrl.getResumen);

module.exports = r;

