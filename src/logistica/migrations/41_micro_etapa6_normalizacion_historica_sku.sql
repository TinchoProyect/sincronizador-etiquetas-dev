-- =============================================================================
-- MICRO-ETAPA 6: NORMALIZACIÓN HISTÓRICA DE CÓDIGOS DE BARRAS A SKU CANÓNICO
-- Archivo: src/logistica/migrations/41_micro_etapa6_normalizacion_historica_sku.sql
-- Destino de prueba: Base de datos de laboratorio `etiquetas_pruebas`
-- =============================================================================
-- Objetivo:
--   1. Normalizar los registros históricos de `public.presupuestos_detalles.articulo`
--      (y `public.presupuestos_articulos_sin_stock.articulo`) que contienen un
--      `codigo_barras` hacia su `SKU` canónico (`bunker_articulos.articulo_id` /
--      `articulos.numero`).
--   2. Garantizar 0,00 kg de impacto en `public.colaborador_stock_satelite`
--      deshabilitando `trg_actualizar_stock_satelite_por_venta` durante el UPDATE
--      masivo y rehabilitándolo antes del COMMIT.
--   3. Preservar 100% intactos:
--      - Los renglones de insumos de `public.ingredientes` (ej. '135' Aceite de Coco
--        y '136' Miel del Kit de Matías).
--      - Los renglones que ya están expresados en SKU canónico.
--      - Los renglones históricos de 2024-2025 con códigos truncados por notación
--        científica que no poseen coincidencia exacta en el maestro de artículos.
-- =============================================================================

BEGIN;

-- 1. Deshabilitar temporalmente el trigger de stock satélite durante la normalización histórica
ALTER TABLE public.presupuestos_detalles DISABLE TRIGGER trg_actualizar_stock_satelite_por_venta;

-- 2. Actualizar únicamente renglones de presupuestos_detalles con coincidencia exacta
--    y válida por código de barras en el maestro (bunker_articulos / articulos)
WITH mapa_barras_a_sku AS (
    SELECT
        q.codigo_actual,
        COALESCE(
            NULLIF(TRIM(ba.articulo_id::text), ''),
            NULLIF(TRIM(a.numero::text), '')
        ) AS sku_canonico
    FROM (
        SELECT DISTINCT TRIM(pd.articulo::text) AS codigo_actual
        FROM public.presupuestos_detalles pd
        WHERE pd.articulo IS NOT NULL
          AND TRIM(pd.articulo::text) <> ''
          AND TRIM(pd.articulo::text) NOT IN ('135', '136')
    ) q
    LEFT JOIN LATERAL (
        SELECT a_inner.numero
        FROM public.articulos a_inner
        WHERE NULLIF(TRIM(a_inner.codigo_barras::text), '') = q.codigo_actual
        ORDER BY a_inner.numero ASC
        LIMIT 1
    ) a ON true
    LEFT JOIN LATERAL (
        SELECT ba_inner.articulo_id
        FROM public.bunker_articulos ba_inner
        WHERE NULLIF(TRIM(ba_inner.codigo_barras::text), '') = q.codigo_actual
           OR (a.numero IS NOT NULL AND TRIM(ba_inner.articulo_id::text) = TRIM(a.numero::text))
        ORDER BY
           (NULLIF(TRIM(ba_inner.codigo_barras::text), '') = q.codigo_actual) DESC,
           ba_inner.articulo_id ASC
        LIMIT 1
    ) ba ON true
    WHERE (a.numero IS NOT NULL OR ba.articulo_id IS NOT NULL)
      -- Excluir cualquier código que ya sea un SKU activo en articulos o bunker_articulos
      AND NOT EXISTS (
          SELECT 1
          FROM public.articulos a_sku
          WHERE TRIM(a_sku.numero::text) = q.codigo_actual
      )
      AND NOT EXISTS (
          SELECT 1
          FROM public.bunker_articulos ba_sku
          WHERE TRIM(ba_sku.articulo_id::text) = q.codigo_actual
      )
      -- Regla de Oro: Excluir insumos de public.ingredientes
      AND NOT EXISTS (
          SELECT 1
          FROM public.ingredientes ing
          WHERE ing.id::text = q.codigo_actual
             OR TRIM(ing.codigo::text) = q.codigo_actual
      )
)
UPDATE public.presupuestos_detalles pd
SET articulo = m.sku_canonico
FROM mapa_barras_a_sku m
WHERE TRIM(pd.articulo::text) = m.codigo_actual
  AND m.sku_canonico IS NOT NULL
  AND m.sku_canonico <> ''
  AND pd.articulo IS DISTINCT FROM m.sku_canonico;

-- 3. Normalizar también presupuestos_articulos_sin_stock si hubiera códigos de barras válidos
WITH mapa_barras_sin_stock AS (
    SELECT
        q.codigo_actual,
        COALESCE(
            NULLIF(TRIM(ba.articulo_id::text), ''),
            NULLIF(TRIM(a.numero::text), '')
        ) AS sku_canonico
    FROM (
        SELECT DISTINCT TRIM(pss.articulo::text) AS codigo_actual
        FROM public.presupuestos_articulos_sin_stock pss
        WHERE pss.articulo IS NOT NULL
          AND TRIM(pss.articulo::text) <> ''
          AND TRIM(pss.articulo::text) NOT IN ('135', '136')
    ) q
    LEFT JOIN LATERAL (
        SELECT a_inner.numero
        FROM public.articulos a_inner
        WHERE NULLIF(TRIM(a_inner.codigo_barras::text), '') = q.codigo_actual
        ORDER BY a_inner.numero ASC
        LIMIT 1
    ) a ON true
    LEFT JOIN LATERAL (
        SELECT ba_inner.articulo_id
        FROM public.bunker_articulos ba_inner
        WHERE NULLIF(TRIM(ba_inner.codigo_barras::text), '') = q.codigo_actual
           OR (a.numero IS NOT NULL AND TRIM(ba_inner.articulo_id::text) = TRIM(a.numero::text))
        ORDER BY
           (NULLIF(TRIM(ba_inner.codigo_barras::text), '') = q.codigo_actual) DESC,
           ba_inner.articulo_id ASC
        LIMIT 1
    ) ba ON true
    WHERE (a.numero IS NOT NULL OR ba.articulo_id IS NOT NULL)
      AND NOT EXISTS (
          SELECT 1
          FROM public.articulos a_sku
          WHERE TRIM(a_sku.numero::text) = q.codigo_actual
      )
      AND NOT EXISTS (
          SELECT 1
          FROM public.bunker_articulos ba_sku
          WHERE TRIM(ba_sku.articulo_id::text) = q.codigo_actual
      )
      AND NOT EXISTS (
          SELECT 1
          FROM public.ingredientes ing
          WHERE ing.id::text = q.codigo_actual
             OR TRIM(ing.codigo::text) = q.codigo_actual
      )
)
UPDATE public.presupuestos_articulos_sin_stock pss
SET articulo = m.sku_canonico
FROM mapa_barras_sin_stock m
WHERE TRIM(pss.articulo::text) = m.codigo_actual
  AND m.sku_canonico IS NOT NULL
  AND m.sku_canonico <> ''
  AND pss.articulo IS DISTINCT FROM m.sku_canonico;

-- 4. Rehabilitar el trigger de stock satélite antes de confirmar la transacción
ALTER TABLE public.presupuestos_detalles ENABLE TRIGGER trg_actualizar_stock_satelite_por_venta;

COMMIT;
