// src/estadisticas/api/services/graficoBarras.service.js
const fs = require('fs');
const path = require('path');
const db = require('../db/pool');

const sqlDir = path.join(__dirname, '..', 'db', 'sql', 'articulos');

function readSQL(name, fallback) {
  const p = path.join(sqlDir, name);
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    if (fallback) return fallback;
    throw new Error(`SQL file missing: ${p}`);
  }
}

// CARGAS LAZY (se leen al primer uso)
let qSerieDirecta, qSerieAjustada, qListaBasica, qListaBasicaAj;

exports.getSeriePorFecha = async (articuloId, desde, hasta, incluirOverhead=false) => {
  qSerieDirecta  ||= readSQL('serie_por_fecha.sql');
  qSerieAjustada ||= readSQL('serie_por_fecha_ajustada.sql');

  const sql = incluirOverhead ? qSerieAjustada : qSerieDirecta;

  const { rows } = await db.query(sql, [articuloId, desde, hasta]);
  const { rows: avgRows } = await db.query(
    `
      SELECT AVG(${incluirOverhead ? 'ms_por_unidad_ajustado' : 'ms_por_unidad'})::bigint AS avg_global
      FROM ${incluirOverhead ? 'v_mediciones_articulo_unit_ajustada' : 'v_mediciones_articulo_unit'}
      WHERE articulo_id = $1 AND fecha BETWEEN $2 AND $3
        AND ${incluirOverhead ? 'ms_por_unidad_ajustado' : 'ms_por_unidad'} IS NOT NULL
    `,
    [articuloId, desde, hasta]
  );
  return { data: rows, promedioGlobal: avgRows[0]?.avg_global ?? null };
};

exports.getListaBasicaArticulos = async ({ desde, hasta, limit = 100, incluirOverhead = false }) => {
  qListaBasica   ||= readSQL('lista_basica.sql');
  qListaBasicaAj ||= readSQL('lista_basica_ajustada.sql');

  const sql = incluirOverhead ? qListaBasicaAj : qListaBasica;
  const desdeDef = desde ?? new Date(Date.now() - 29*24*3600*1000).toISOString().slice(0,10);
  const hastaDef = hasta ?? new Date().toISOString().slice(0,10);
  const lim = Math.max(1, Math.min(Number(limit) || 100, 1000));

  const { rows } = await db.query(sql, [desdeDef, hastaDef, lim]);
  return { rango: { desde: desdeDef, hasta: hastaDef }, data: rows };
};
