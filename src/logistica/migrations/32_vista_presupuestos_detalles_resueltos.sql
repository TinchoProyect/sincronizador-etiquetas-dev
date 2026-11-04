-- Migración 32: Vista Determinista para Resolución Estructural de Artículos en Presupuestos y Entregas
-- Garantiza que cada artículo de un pedido resuelva prioritariamente la descripción canónica generada de Búnker,
-- unificando códigos de barras, códigos de búnker y números de artículo internos de forma 100% determinista.

CREATE INDEX IF NOT EXISTS idx_articulos_codigo_barras ON public.articulos(codigo_barras);
CREATE INDEX IF NOT EXISTS idx_articulos_numero ON public.articulos(numero);
CREATE INDEX IF NOT EXISTS idx_presupuestos_detalles_articulo ON public.presupuestos_detalles(articulo);
CREATE INDEX IF NOT EXISTS idx_presupuestos_detalles_pext ON public.presupuestos_detalles(id_presupuesto_ext);
CREATE INDEX IF NOT EXISTS idx_stock_real_art_num ON public.stock_real_consolidado(articulo_numero);
CREATE INDEX IF NOT EXISTS idx_stock_real_cod_bar ON public.stock_real_consolidado(codigo_barras);

CREATE OR REPLACE VIEW public.v_presupuestos_detalles_resueltos AS
SELECT 
    pd.id,
    pd.id_presupuesto,
    pd.id_presupuesto_ext,
    pd.articulo,
    pd.articulo AS codigo_barras,
    pd.cantidad,
    pd.cantidad_original,
    pd.precio1,
    pd.valor1,
    pd.iva1,
    pd.diferencia,
    pd.fecha_actualizacion,
    COALESCE(ba.articulo_id, a.numero, src.articulo_numero, pd.articulo) AS articulo_numero,
    COALESCE(
        NULLIF(TRIM(ba.descripcion_generada), ''),
        NULLIF(TRIM(ba.descripcion), ''),
        NULLIF(TRIM(a.nombre), ''),
        NULLIF(TRIM(src.descripcion), ''),
        pd.articulo
    ) AS descripcion,
    COALESCE(
        NULLIF(TRIM(ba.descripcion_generada), ''),
        NULLIF(TRIM(ba.descripcion), '')
    ) AS descripcion_bunker,
    NULLIF(TRIM(a.nombre), '') AS descripcion_legacy,
    NULLIF(TRIM(src.descripcion), '') AS descripcion_stock
FROM public.presupuestos_detalles pd
LEFT JOIN LATERAL (
    SELECT nombre, numero, codigo_barras 
    FROM public.articulos 
    WHERE codigo_barras = pd.articulo OR numero = pd.articulo 
    ORDER BY (codigo_barras = pd.articulo) DESC 
    LIMIT 1
) a ON true
LEFT JOIN LATERAL (
    SELECT descripcion_generada, descripcion, articulo_id
    FROM public.bunker_articulos
    WHERE articulo_id = pd.articulo 
       OR (a.numero IS NOT NULL AND articulo_id = a.numero)
    ORDER BY (articulo_id = pd.articulo) DESC
    LIMIT 1
) ba ON true
LEFT JOIN LATERAL (
    SELECT descripcion, articulo_numero, codigo_barras
    FROM public.stock_real_consolidado
    WHERE articulo_numero = pd.articulo OR codigo_barras = pd.articulo
    ORDER BY (codigo_barras = pd.articulo) DESC
    LIMIT 1
) src ON true;
