// src/estadisticas/api/controllers/articulos.controller.js
const svc = require('../services/articulos.service');
const fs   = require('fs');
const path = require('path');
const pool = require('../db/pool'); // ajustá si tu pool está en otro path

// Cargar SQL desde archivo
const sqlDir  = path.join(__dirname, '..', 'db', 'sql', 'articulos');
const qSerie  = fs.readFileSync(path.join(sqlDir, 'serie_por_fecha.sql'), 'utf8');


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

// ========== NUEVO: serie por fecha ==========
async function getSeriePorFecha(req, res) {
  try {
    const { articuloId, desde, hasta } = req.query;
    if (!articuloId) {
      return res.status(400).json({ error: 'articuloId es requerido' });
    }

    const desdeDef = desde ?? new Date(Date.now() - 29 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const hastaDef = hasta ?? new Date().toISOString().slice(0, 10);

    // Serie por fecha (AVG ms/unidad por día)
    const { rows } = await pool.query(qSerie, [articuloId, desdeDef, hastaDef]);

    // Promedio global para línea de referencia
    const { rows: avgRows } = await pool.query(
      `SELECT AVG(ms_por_unidad)::bigint AS avg_global
         FROM v_mediciones_articulo_unit
        WHERE articulo_id = $1
          AND fecha BETWEEN $2 AND $3
          AND ms_por_unidad IS NOT NULL`,
      [articuloId, desdeDef, hastaDef]
    );

    return res.json({
      data: rows,
      promedioGlobal: avgRows[0]?.avg_global ?? null,
      rango: { desde: desdeDef, hasta: hastaDef }
    });
  } catch (e) {
    console.error('[articulos] getSeriePorFecha', e);
    res.status(500).json({ error: 'Error al obtener estadísticas de artículo' });
  }
}

module.exports = {
  getUltimos,
  getResumen,
  getSeriePorFecha,
};

