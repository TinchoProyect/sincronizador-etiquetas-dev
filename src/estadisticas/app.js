// src/estadisticas/app.js
const express = require('express');
const mountApi = require('./api');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.ESTADISTICAS_PORT || 3001;

app.use(express.json());

// logger simple (útil para ver si llegan requests)
app.use((req, _res, next) => {
  console.log(`[3001] ${req.method} ${req.url}`);
  next();
});

// monta TODAS las rutas del módulo (lo exporta ./api/index.js)
mountApi(app);

// === estáticos del módulo (sirve /estadisticas/*) ===
// si en el futuro movés a /public, cambiá baseDir = path.join(__dirname, 'public')
const baseDir = __dirname;
app.use('/estadisticas', express.static(baseDir));
app.get('/estadisticas', (_req, res) => {
  const file = path.join(baseDir, 'pages', 'estadisticas.html');
  if (!fs.existsSync(file)) return res.status(404).send('estadisticas.html no encontrado');
  res.sendFile(file);
});

// health simple fuera del API (para descartar problemas de ruteo)
app.get('/healthz', (_req, res) => res.json({ ok: true, svc: 'estadisticas' }));

// 404 del módulo (que no choque con el de 3000)
app.use((_req, res) => res.status(404).json({ ok: false, error: 'NOT_FOUND' }));

app.listen(port, () => {
  console.log(`[ESTADISTICAS] Servidor en http://localhost:${port}`);
});
