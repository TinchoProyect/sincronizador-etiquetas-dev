-- src/estadisticas/api/db/sql/articulos/v_mediciones_articulo_unit_ajustada.sql

-- v_mediciones_articulo_unit_ajustada.sql
CREATE OR REPLACE VIEW v_mediciones_articulo_unit_ajustada AS
WITH
etapas AS (
  SELECT
    ec.carro_id,
    ec.etapa_num,
    COALESCE(ec.duracion_ms, EXTRACT(EPOCH FROM (ec.fin - ec.inicio)) * 1000)::bigint AS dur_ms
  FROM etapas_carro ec
  WHERE ec.etapa_num IN (1,3)
),
overhead_por_carro AS (
  SELECT carro_id, SUM(dur_ms)::bigint AS overhead_ms
  FROM etapas GROUP BY carro_id
),
unidades_por_carro AS (
  SELECT ca.carro_id, SUM(ca.cantidad_producida)::bigint AS total_uds_carro
  FROM carros_articulos ca
  GROUP BY ca.carro_id
),
base AS (
  SELECT
    ca.id                    AS medicion_id,
    ca.carro_id,
    ca.articulo_id,
    ca.articulo,
    ca.articulo_numero,
    DATE(ca.medicion_inicio) AS fecha,
    ca.cantidad_producida,
    COALESCE(ca.duracion_ms,
             EXTRACT(EPOCH FROM (ca.medicion_fin - ca.medicion_inicio)) * 1000
    )::bigint AS dur_ms_directo
  FROM carros_articulos ca
)
SELECT
  b.medicion_id,
  b.carro_id,
  b.articulo_id,
  b.articulo,
  b.articulo_numero,
  b.fecha,
  b.cantidad_producida,
  b.dur_ms_directo,
  COALESCE(o.overhead_ms, 0)::bigint AS overhead_ms_carro,
  COALESCE(u.total_uds_carro, NULL)::bigint AS total_uds_carro,
  CASE WHEN u.total_uds_carro > 0
       THEN (o.overhead_ms * (b.cantidad_producida::numeric / u.total_uds_carro))::bigint
       ELSE 0
  END AS overhead_asignado_ms,
  (
    b.dur_ms_directo
    + CASE WHEN u.total_uds_carro > 0
           THEN (o.overhead_ms * (b.cantidad_producida::numeric / u.total_uds_carro))::bigint
           ELSE 0
      END
  )::bigint AS dur_ms_ajustado,
  CASE WHEN b.cantidad_producida > 0
       THEN ((
         b.dur_ms_directo
         + CASE WHEN u.total_uds_carro > 0
                THEN (o.overhead_ms * (b.cantidad_producida::numeric / u.total_uds_carro))::bigint
                ELSE 0
           END
       ) / b.cantidad_producida)::bigint
       ELSE NULL
  END AS ms_por_unidad_ajustado
FROM base b
LEFT JOIN overhead_por_carro o ON o.carro_id = b.carro_id
LEFT JOIN unidades_por_carro u ON u.carro_id = b.carro_id;
