// src/estadisticas/app.js
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.ESTADISTICAS_PORT || 3001;

app.use(express.json());

// === estáticos del módulo (sirve /estadisticas/*) ===
const baseDir = __dirname; // espera: src/estadisticas/
app.use('/estadisticas', express.static(baseDir));
app.get('/estadisticas', (req, res) => {
  const file = path.join(baseDir, 'pages', 'estadisticas.html');
  if (!fs.existsSync(file)) return res.status(404).send('estadisticas.html no encontrado');
  res.sendFile(file);
});

// === API read-only (ejemplos) ===
app.get('/api/estadisticas/health', (req, res) => res.json({ ok: true }));
// app.get('/api/estadisticas/produccion/resumen', ...);

app.listen(port, () => {
  console.log(`[ESTADISTICAS] Servidor en http://localhost:${port}`);
});
