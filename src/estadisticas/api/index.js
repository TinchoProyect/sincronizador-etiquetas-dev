const express = require('express');

module.exports = function mountApi(app) {
  const api = express.Router();

  // health simple
  api.get('/health', (req, res) => res.json({ ok: true }));

  // rutas
  api.use('/carros', require('./routes/carros.routes'));
  api.use('/articulos', require('./routes/articulos.routes')); // si existe

  // monta TODO el módulo bajo /api/estadisticas
  app.use('/api/estadisticas', api);
};
