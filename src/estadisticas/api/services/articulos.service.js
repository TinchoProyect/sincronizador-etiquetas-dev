// src/estadisticas/api/services/articulos.service.js
const db = require('../db/pool');

function n(v) { return (v === undefined || v === '' ? null : v); }

// 1) Últimos registros (solo los que tienen temporización hecha)
async function getUltimos({ desde, hasta, limit = 50 }) {
  const sql = `
    WITH filas AS (
      SELECT
        ca.id,
        ca.carro_id,
        ca.articulo_numero,
        COALESCE(ca.descripcion, CONCAT('Artículo ', ca.articulo_numero)) AS articulo,
        ca.cantidad,
        ca.tiempo_inicio,
        ca.tiempo_fin,
        CASE 
          WHEN ca.duracion_ms IS NOT NULL THEN (ca.duracion_ms/1000.0)
          WHEN ca.tiempo_inicio IS NOT NULL AND ca.tiempo_fin IS NOT NULL
            THEN EXTRACT(EPOCH FROM (ca.tiempo_fin - ca.tiempo_inicio))
          ELSE NULL
        END AS duracion_seg,
        COALESCE(ca.tiempo_fin, ca.tiempo_inicio, cp.fecha_inicio) AS ts
      FROM carros_articulos ca
      JOIN carros_produccion cp ON cp.id = ca.carro_id
      WHERE
        (ca.duracion_ms IS NOT NULL OR (ca.tiempo_inicio IS NOT NULL AND ca.tiempo_fin IS NOT NULL))
        AND ($1::timestamp IS NULL OR COALESCE(ca.tiempo_fin, ca.tiempo_inicio, cp.fecha_inicio) >= $1)
        AND ($2::timestamp IS NULL OR COALESCE(ca.tiempo_fin, ca.tiempo_inicio, cp.fecha_inicio) <  $2)
    )
    SELECT
      id, carro_id, articulo_numero, articulo, cantidad,
      tiempo_inicio, tiempo_fin,
      FLOOR(duracion_seg)::int AS duracion_seg,
      ts AS timestamp_medicion
    FROM filas
    ORDER BY ts DESC, id DESC
    LIMIT $3::int;
  `;
  const { rows } = await db.query(sql, [n(desde), n(hasta), limit]);
  return rows;
}

// 2) Resumen por artículo (totales, promedio por unidad)
async function getResumen({ desde, hasta, limit = 50 }) {
  const sql = `
    WITH filas AS (
      SELECT
        ca.articulo_numero,
        COALESCE(ca.descripcion, CONCAT('Artículo ', ca.articulo_numero)) AS articulo,
        ca.cantidad,
        CASE 
          WHEN ca.duracion_ms IS NOT NULL THEN (ca.duracion_ms/1000.0)
          WHEN ca.tiempo_inicio IS NOT NULL AND ca.tiempo_fin IS NOT NULL
            THEN EXTRACT(EPOCH FROM (ca.tiempo_fin - ca.tiempo_inicio))
          ELSE NULL
        END AS duracion_seg,
        COALESCE(ca.tiempo_fin, ca.tiempo_inicio, cp.fecha_inicio) AS ts
      FROM carros_articulos ca
      JOIN carros_produccion cp ON cp.id = ca.carro_id
      WHERE
        (ca.duracion_ms IS NOT NULL OR (ca.tiempo_inicio IS NOT NULL AND ca.tiempo_fin IS NOT NULL))
        AND ($1::timestamp IS NULL OR COALESCE(ca.tiempo_fin, ca.tiempo_inicio, cp.fecha_inicio) >= $1)
        AND ($2::timestamp IS NULL OR COALESCE(ca.tiempo_fin, ca.tiempo_inicio, cp.fecha_inicio) <  $2)
    )
    SELECT
      articulo_numero,
      articulo,
      SUM(cantidad)::int                        AS cantidad_total,
      FLOOR(SUM(duracion_seg))::int             AS tiempo_total_seg,
      CASE WHEN SUM(cantidad) > 0
           THEN FLOOR(SUM(duracion_seg)/SUM(cantidad))::int
           ELSE 0 END                           AS seg_por_ud,
      MAX(ts)                                   AS ultima_medicion
    FROM filas
    GROUP BY articulo_numero, articulo
    ORDER BY ultima_medicion DESC, tiempo_total_seg DESC
    LIMIT $3::int;
  `;
  const { rows } = await db.query(sql, [n(desde), n(hasta), limit]);
  return rows;
}

module.exports = {getUltimos, getResumen };
