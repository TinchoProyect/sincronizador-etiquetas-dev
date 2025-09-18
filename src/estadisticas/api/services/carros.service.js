// src/estadisticas/api/services/carros.service.js
const db = require('../db/pool');

async function list({ desde, hasta, limit = 50 }) {
  const sql = `
    WITH etapas AS (
      SELECT c.id AS carro_id, 1 AS etapa_num, 'Etapa 1'::text AS etapa,
             c.etapa1_inicio AS inicio, c.etapa1_fin AS fin,
             CASE 
               WHEN c.etapa1_duracion_ms IS NOT NULL THEN (c.etapa1_duracion_ms/1000)::int
               WHEN c.etapa1_inicio IS NOT NULL AND c.etapa1_fin IS NOT NULL
                 THEN EXTRACT(EPOCH FROM (c.etapa1_fin - c.etapa1_inicio))::int
               ELSE NULL
             END AS duracion_seg
      FROM carros_produccion c
      UNION ALL
      SELECT c.id, 2, 'Etapa 2 · Medición',
             c.etapa2_inicio, c.etapa2_fin,
             CASE 
               WHEN c.etapa2_duracion_ms IS NOT NULL THEN (c.etapa2_duracion_ms/1000)::int
               WHEN c.etapa2_inicio IS NOT NULL AND c.etapa2_fin IS NOT NULL
                 THEN EXTRACT(EPOCH FROM (c.etapa2_fin - c.etapa2_inicio))::int
               ELSE NULL
             END
      FROM carros_produccion c
      UNION ALL
      SELECT c.id, 3, 'Etapa 3',
             c.etapa3_inicio, c.etapa3_fin,
             CASE 
               WHEN c.etapa3_duracion_ms IS NOT NULL THEN (c.etapa3_duracion_ms/1000)::int
               WHEN c.etapa3_inicio IS NOT NULL AND c.etapa3_fin IS NOT NULL
                 THEN EXTRACT(EPOCH FROM (c.etapa3_fin - c.etapa3_inicio))::int
               ELSE NULL
             END
      FROM carros_produccion c
    ),
    etapas_ok AS (
      SELECT *
      FROM etapas
      WHERE (duracion_seg IS NOT NULL AND duracion_seg > 0)
         OR (inicio IS NOT NULL AND fin IS NOT NULL)
    ),
    comp AS (
      SELECT 
        ca.carro_id,
        jsonb_agg(
          jsonb_build_object(
            'articulo_numero', ca.articulo_numero,
            'descripcion',     ca.descripcion,
            'cantidad',        ca.cantidad,
            'tiempo_seg',      CASE 
                                 WHEN ca.duracion_ms IS NOT NULL THEN (ca.duracion_ms/1000)::int
                                 WHEN ca.tiempo_inicio IS NOT NULL AND ca.tiempo_fin IS NOT NULL
                                   THEN EXTRACT(EPOCH FROM (ca.tiempo_fin - ca.tiempo_inicio))::int
                                 ELSE NULL
                               END
          ) ORDER BY ca.articulo_numero
        ) AS composicion
      FROM carros_articulos ca
      GROUP BY ca.carro_id
    ),
    base AS (
      SELECT 
        c.id AS carro_id,
        c.fecha_inicio AS fecha_produccion,
        c.tipo_carro,
        c.en_auditoria,
        COALESCE(comp.composicion, '[]'::jsonb) AS composicion,
        jsonb_agg(
          jsonb_build_object(
            'etapa_num',    e.etapa_num,
            'etapa',        e.etapa,
            'inicio',       e.inicio,
            'fin',          e.fin,
            'duracion_seg', e.duracion_seg
          ) ORDER BY e.etapa_num
        ) AS etapas
      FROM carros_produccion c
      JOIN etapas_ok e   ON e.carro_id = c.id
      LEFT JOIN comp     ON comp.carro_id = c.id
      WHERE
        ($1::timestamp IS NULL OR c.fecha_inicio >= $1) AND
        ($2::timestamp IS NULL OR c.fecha_inicio <  $2)
      GROUP BY c.id, c.fecha_inicio, c.tipo_carro, c.en_auditoria, comp.composicion
      ORDER BY c.fecha_inicio DESC, c.id DESC
      LIMIT $3::int
    )
    SELECT
      carro_id,
      fecha_produccion,
      tipo_carro,
      en_auditoria,
      etapas,
      composicion,
      COALESCE((
        SELECT SUM( (e->>'duracion_seg')::int )
        FROM jsonb_array_elements(base.etapas) e
      ),0) AS duracion_total_seg,
      jsonb_array_length(etapas) AS etapas_count
    FROM base
    WHERE jsonb_array_length(etapas) > 0;
  `;

  const { rows } = await db.query(sql, [desde || null, hasta || null, limit]);
  return rows;
  return [];
}
module.exports = { list};

