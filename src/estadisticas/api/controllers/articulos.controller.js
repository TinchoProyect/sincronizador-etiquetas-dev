// src/estadisticas/api/controllers/articulos.controller.js
const svc = require('../services/articulos.service');

async function getUltimos(req, res, next) {
  try {
    const { desde, hasta, limit } = req.query;
     const data = await svc.getUltimos({
      desde: desde || null,
      hasta: hasta || null,
      limit: Number(limit) || 50,});
    return res.json({ ok: true, data });
  } catch (err) {
    console.error('[ARTICULOS] getUltimos', err);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
}

async function getResumen(req, res, next) {
  try {
    const { desde, hasta, limit } = req.query;
    const data = await svc.getResumen({
      desde: desde || null,
      hasta: hasta || null,
      limit: Number(limit) || 50, });
    return res.json({ ok: true, data });
  } catch (err) {
    console.error('[ARTICULOS] getResumen', err);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
}

module.exports = { getUltimos, getResumen };

