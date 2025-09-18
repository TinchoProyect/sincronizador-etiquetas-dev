// src/estadisticas/api/controllers/carros.controller.js
// importa el service (ajustá a `../bd/pool` dentro del service si usás carpeta "bd")
const carrosService = require('../services/carros.service');

async function list(req, res, next) {
  try {
    const { desde, hasta, limit = 50 } = req.query;
    const data = await carrosService.list({ desde, hasta, limit });
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
}

module.exports = { list };   // 👈 export SIEMPRE la función que usarás en la ruta

