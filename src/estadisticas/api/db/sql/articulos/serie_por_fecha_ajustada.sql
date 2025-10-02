-- src/estadisticas/api/db/sql/articulos/serie_por_fecha_ajustada.sql
WITH base AS (
  SELECT fecha, ms_por_unidad_ajustado
  FROM v_mediciones_articulo_unit_ajustada
  WHERE articulo_id = $1
    AND fecha BETWEEN $2 AND $3
    AND ms_por_unidad_ajustado IS NOT NULL
)
SELECT
  fecha,
  AVG(ms_por_unidad_ajustado)::bigint AS ms_por_unidad_prom,
  COUNT(*)                             AS mediciones
FROM base
GROUP BY fecha
ORDER BY fecha;
