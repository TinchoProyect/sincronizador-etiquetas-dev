-- =============================================================================
-- MIGRACIÓN: Vista Centralizada de Detalles de Presupuestos Resueltos
-- Micro-Etapa 1 (Lectura Dual: codigo_barras OR numero SKU + bunker_articulos + ingredientes 135/136)
-- =============================================================================
-- Propósito:
--   Resolver la dualidad de identificadores en presupuestos_detalles.articulo
--   (donde conviven códigos de barras EAN y códigos alfanuméricos de artículo/SKU,
--    además de IDs de insumos/ingredientes como '135' Aceite de Coco y '136' Miel).
--   Centraliza los JOINs con bunker_articulos, articulos, stock_real_consolidado
--   e ingredientes (solo cuando no colisiona con un artículo comercial) para
--   exponer siempre:
--     - articulo_numero (SKU canónico o ID de ingrediente)
--     - codigo_barras (código de barras real resuelto, no el texto crudo de pd.articulo)
--     - descripcion (priorizando Búnker -> Artículos -> Stock -> Ingredientes -> fallback código)
-- =============================================================================

CREATE OR REPLACE VIEW public.v_presupuestos_detalles_resueltos AS
SELECT
    pd.id,
    pd.id_presupuesto,
    pd.id_presupuesto_ext,
    pd.articulo,
    COALESCE(
        NULLIF(TRIM(a.codigo_barras), ''),
        NULLIF(TRIM(ba.codigo_barras::text), ''),
        NULLIF(TRIM(src.codigo_barras), ''),
        CASE WHEN ing.id IS NOT NULL THEN ing.id::text ELSE NULL END,
        pd.articulo
    )::text AS codigo_barras,
    pd.cantidad,
    pd.cantidad_original,
    pd.precio1,
    pd.valor1,
    pd.iva1,
    pd.diferencia,
    pd.fecha_actualizacion,
    COALESCE(
        ba.articulo_id,
        a.numero::character varying,
        src.articulo_numero::character varying,
        CASE WHEN ing.id IS NOT NULL THEN ing.id::text::character varying ELSE NULL END,
        pd.articulo::character varying
    ) AS articulo_numero,
    COALESCE(
        NULLIF(TRIM(ba.descripcion_generada::text), ''),
        NULLIF(TRIM(ba.descripcion::text), ''),
        NULLIF(TRIM(a.nombre), ''),
        NULLIF(TRIM(src.descripcion), ''),
        NULLIF(TRIM(ing.nombre), ''),
        pd.articulo
    ) AS descripcion,
    COALESCE(NULLIF(TRIM(ba.descripcion_generada::text), ''), NULLIF(TRIM(ba.descripcion::text), '')) AS descripcion_bunker,
    NULLIF(TRIM(a.nombre), '') AS descripcion_legacy,
    NULLIF(TRIM(src.descripcion), '') AS descripcion_stock,
    CASE WHEN ing.id IS NOT NULL THEN true ELSE false END AS es_ingrediente,
    ing.id AS ingrediente_id,
    NULLIF(TRIM(ing.nombre), '') AS descripcion_ingrediente
FROM public.presupuestos_detalles pd
LEFT JOIN LATERAL (
    SELECT a_inner.numero, a_inner.codigo_barras, a_inner.nombre
    FROM public.articulos a_inner
    WHERE a_inner.codigo_barras = pd.articulo OR a_inner.numero = pd.articulo
    ORDER BY (a_inner.codigo_barras = pd.articulo) DESC
    LIMIT 1
) a ON true
LEFT JOIN LATERAL (
    SELECT ba_inner.articulo_id, ba_inner.codigo_barras, ba_inner.descripcion_generada, ba_inner.descripcion
    FROM public.bunker_articulos ba_inner
    WHERE ba_inner.articulo_id::text = pd.articulo
       OR ba_inner.codigo_barras::text = pd.articulo
       OR (a.numero IS NOT NULL AND ba_inner.articulo_id::text = a.numero)
    ORDER BY
       (ba_inner.articulo_id::text = pd.articulo) DESC,
       (ba_inner.codigo_barras::text = pd.articulo) DESC
    LIMIT 1
) ba ON true
LEFT JOIN LATERAL (
    SELECT src_inner.articulo_numero, src_inner.codigo_barras, src_inner.descripcion
    FROM public.stock_real_consolidado src_inner
    WHERE src_inner.codigo_barras = pd.articulo
       OR src_inner.articulo_numero = pd.articulo
       OR (a.numero IS NOT NULL AND src_inner.articulo_numero = a.numero)
       OR (ba.articulo_id IS NOT NULL AND src_inner.articulo_numero = ba.articulo_id::text)
    ORDER BY (src_inner.codigo_barras = pd.articulo) DESC
    LIMIT 1
) src ON true
LEFT JOIN LATERAL (
    SELECT ing_inner.id, ing_inner.codigo, ing_inner.nombre
    FROM public.ingredientes ing_inner
    WHERE a.numero IS NULL
      AND ba.articulo_id IS NULL
      AND src.articulo_numero IS NULL
      AND (ing_inner.id::text = pd.articulo OR ing_inner.codigo::text = pd.articulo)
    ORDER BY (ing_inner.id::text = pd.articulo) DESC
    LIMIT 1
) ing ON true;
