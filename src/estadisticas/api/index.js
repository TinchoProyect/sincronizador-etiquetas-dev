/*src/estadisticas/api/index.js*/

const express = require('express');

module.exports = function mountApi(app) {
  const api = express.Router();

  // health inline (evita archivo extra)
  api.get('/health', (_req, res) => res.json({ ok: true }));

  // rutas (solo si existen los archivos)
  api.use('/carros', require('./routes/carros.routes'));
  api.use('/articulos', require('./routes/articulos.routes'));
  api.use('/grafico-barras', require('./routes/graficoBarras.routes')); // ⬅️ agregado


  // monta todo bajo /api/estadisticas
  app.use('/api/estadisticas', api);
};

