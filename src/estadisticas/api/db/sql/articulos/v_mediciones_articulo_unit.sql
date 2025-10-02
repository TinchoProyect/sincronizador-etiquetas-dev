/*src/estadisticas/api/db/sql/articulos/v_mediciones_articulo_unit.sql*/

CREATE OR REPLACE VIEW v_mediciones_articulo_unit AS
SELECT
  ca.id                           AS medicion_id,
  ca.articulo_id,
  DATE(ca.medicion_inicio)        AS fecha,
  ca.cantidad_producida           AS unidades,
  ca.duracion_ms,
  CASE WHEN ca.cantidad_producida > 0
       THEN ca.duracion_ms::numeric / ca.cantidad_producida
       ELSE NULL
  END                             AS ms_por_unidad
FROM carros_articulos ca
WHERE ca.duracion_ms IS NOT NULL;
