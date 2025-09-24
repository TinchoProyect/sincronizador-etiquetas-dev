//estadisticas/api/routes/graficoBarras.routes.js
const r = require('express').Router();
const ctrl = require('../controllers/graficoBarras.controllers');

r.get('/ultimos', ctrl.getUltimos);
r.get('/resumen', ctrl.getResumen);
r.get('/mediciones/articulos', ctrl.getSeriePorFecha);
r.get('/serie/articulo', ctrl.getSeriePorFecha);   // => /api/estadisticas/graficoBarras/serie/articulo
r.get('/articulos',      ctrl.getListaBasica);     // (opcional) lista para el combo

module.exports = r;
