// src/estadisticas/api/services/graficoBarras.service.js
const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');

const sqlDir = path.join(__dirname, '..', 'db', 'sql', 'articulos');
const qSerie = fs.readFileSync(path.join(sqlDir, 'serie_por_fecha.sql'), 'utf8');

exports.getSeriePorFecha = async (articuloId, desde, hasta) => {
  const { rows } = await pool.query(qSerie, [articuloId, desde, hasta]);
  const { rows: avgRows } = await pool.query(
    `SELECT AVG(ms_por_unidad)::bigint AS avg_global
       FROM v_mediciones_articulo_unit
      WHERE articulo_id = $1 AND fecha BETWEEN $2 AND $3 AND ms_por_unidad IS NOT NULL`,
    [articuloId, desde, hasta]
  );
  return { data: rows, promedioGlobal: avgRows[0]?.avg_global ?? null };
};

// opcional
exports.getListaBasicaArticulos = async () => {
  const { rows } = await pool.query(
    `SELECT id, nombre, codigo FROM articulos
     WHERE activo IS DISTINCT FROM FALSE
     ORDER BY nombre ASC`
  );
  return rows;
};