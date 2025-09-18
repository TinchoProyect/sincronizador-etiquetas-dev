// src/estadisticas/api/controllers/articulos.controller.js
const svc = require('../services/articulos.service');

async function ultimos(req, res, next) {
  try {
    const { desde, hasta, limit } = req.query;
    const data = await svc.ultimos({ desde, hasta, limit: Number(limit) || 50 });
    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
}

async function resumen(req, res, next) {
  try {
    const { desde, hasta, limit } = req.query;
    const data = await svc.resumen({ desde, hasta, limit: Number(limit) || 50 });
    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
}

module.exports = { ultimos, resumen };
