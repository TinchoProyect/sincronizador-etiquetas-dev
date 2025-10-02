-- lista_basica_ajustada.sql
SELECT
  a.id                                        AS articulo_id,
  a.nombre                                    AS articulo,
  a.codigo                                    AS articulo_numero,
  MAX(v.fecha)                                AS ultima_medicion,
  COUNT(*)                                    AS mediciones,
  SUM(v.cantidad_producida)::bigint           AS uds_total,
  SUM(v.dur_ms_ajustado)::bigint              AS tiempo_total_ms,
  AVG(v.ms_por_unidad_ajustado)::bigint       AS ms_por_ud_prom
FROM v_mediciones_articulo_unit_ajustada v
JOIN articulos a ON a.id = v.articulo_id
WHERE v.fecha BETWEEN $1 AND $2
  AND v.ms_por_unidad_ajustado IS NOT NULL
GROUP BY a.id, a.nombre, a.codigo
ORDER BY ms_por_ud_prom ASC
LIMIT $3;
