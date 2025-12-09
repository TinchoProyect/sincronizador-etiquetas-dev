-- ============================================================================
-- SCRIPT DE DIAGNÓSTICO: Stock Negativo en "Armar Pedido"
-- ============================================================================
-- Propósito: Verificar el origen del valor -1 en la columna "Stock Disponible"
-- Artículo Testigo: Mix/Salado 2 x 5 kg (Código: 2589631327)
-- ============================================================================

-- ============================================================================
-- 1. VERIFICAR EL ARTÍCULO TESTIGO ESPECÍFICO
-- ============================================================================
SELECT 
    '=== ARTÍCULO TESTIGO: Mix/Salado 2 x 5 kg ===' as seccion;

SELECT 
    src.codigo_barras,
    src.articulo_numero,
    src.descripcion,
    src.es_pack,
    src.pack_hijo_codigo,
    src.pack_unidades,
    src.stock_lomasoft,
    src.stock_movimientos,
    src.stock_ajustes,
    src.stock_consolidado,
    hijo.codigo_barras as hijo_codigo,
    hijo.descripcion as hijo_descripcion,
    hijo.stock_consolidado as hijo_stock,
    CASE 
        WHEN src.es_pack = true AND src.pack_hijo_codigo IS NOT NULL AND src.pack_unidades > 0 
        THEN FLOOR(COALESCE(hijo.stock_consolidado, 0) / src.pack_unidades)
        ELSE COALESCE(src.stock_consolidado, 0)
    END as stock_calculado_actual,
    CASE 
        WHEN src.es_pack = true AND src.pack_hijo_codigo IS NOT NULL AND src.pack_unidades > 0 
        THEN GREATEST(0, FLOOR(COALESCE(hijo.stock_consolidado, 0) / src.pack_unidades))
        ELSE GREATEST(0, COALESCE(src.stock_consolidado, 0))
    END as stock_calculado_corregido
FROM public.stock_real_consolidado src
LEFT JOIN public.stock_real_consolidado hijo ON hijo.codigo_barras = src.pack_hijo_codigo
WHERE src.codigo_barras = '2589631327' 
   OR src.articulo_numero = '2589631327'
   OR src.articulo_numero = 'MSx10';

-- ============================================================================
-- 2. BUSCAR TODOS LOS ARTÍCULOS CON STOCK NEGATIVO
-- ============================================================================
SELECT 
    '=== TODOS LOS ARTÍCULOS CON STOCK NEGATIVO ===' as seccion;

SELECT 
    articulo_numero,
    codigo_barras,
    descripcion,
    es_pack,
    pack_hijo_codigo,
    pack_unidades,
    stock_lomasoft,
    stock_movimientos,
    stock_ajustes,
    stock_consolidado,
    ultima_actualizacion
FROM public.stock_real_consolidado
WHERE stock_consolidado < 0
ORDER BY stock_consolidado ASC;

-- ============================================================================
-- 3. BUSCAR ARTÍCULOS PACK CON HIJOS CON STOCK NEGATIVO
-- ============================================================================
SELECT 
    '=== ARTÍCULOS PACK CON HIJOS NEGATIVOS ===' as seccion;

SELECT 
    padre.codigo_barras as padre_codigo,
    padre.articulo_numero as padre_numero,
    padre.descripcion as padre_descripcion,
    padre.pack_unidades,
    hijo.codigo_barras as hijo_codigo,
    hijo.articulo_numero as hijo_numero,
    hijo.descripcion as hijo_descripcion,
    hijo.stock_consolidado as hijo_stock,
    FLOOR(hijo.stock_consolidado / padre.pack_unidades) as stock_padre_calculado
FROM public.stock_real_consolidado padre
INNER JOIN public.stock_real_consolidado hijo ON hijo.codigo_barras = padre.pack_hijo_codigo
WHERE padre.es_pack = true
  AND hijo.stock_consolidado < 0
ORDER BY hijo.stock_consolidado ASC;

-- ============================================================================
-- 4. VERIFICAR ARTÍCULOS EN PRESUPUESTOS CON STOCK NEGATIVO
-- ============================================================================
SELECT 
    '=== ARTÍCULOS EN PRESUPUESTOS ACTIVOS CON STOCK NEGATIVO ===' as seccion;

SELECT DISTINCT
    pd.articulo as codigo_articulo,
    a.nombre as descripcion,
    src.stock_consolidado,
    src.es_pack,
    src.pack_hijo_codigo,
    hijo.stock_consolidado as hijo_stock,
    COUNT(DISTINCT p.id_presupuesto_ext) as presupuestos_afectados
FROM public.presupuestos p
JOIN public.presupuestos_detalles pd ON pd.id_presupuesto_ext = p.id_presupuesto_ext
LEFT JOIN public.articulos a ON a.codigo_barras = pd.articulo
LEFT JOIN public.stock_real_consolidado src ON src.codigo_barras = pd.articulo
LEFT JOIN public.stock_real_consolidado hijo ON hijo.codigo_barras = src.pack_hijo_codigo
WHERE p.activo = true
  AND p.estado = 'presupuesto/orden'
  AND (
      src.stock_consolidado < 0 
      OR (src.es_pack = true AND hijo.stock_consolidado < 0)
  )
GROUP BY pd.articulo, a.nombre, src.stock_consolidado, src.es_pack, src.pack_hijo_codigo, hijo.stock_consolidado
ORDER BY presupuestos_afectados DESC;

-- ============================================================================
-- 5. ANÁLISIS DE MOVIMIENTOS NEGATIVOS
-- ============================================================================
SELECT 
    '=== ARTÍCULOS CON MOVIMIENTOS NEGATIVOS ===' as seccion;

SELECT 
    articulo_numero,
    codigo_barras,
    descripcion,
    stock_lomasoft,
    stock_movimientos,
    stock_ajustes,
    stock_consolidado,
    ultima_actualizacion
FROM public.stock_real_consolidado
WHERE stock_movimientos < 0
ORDER BY stock_movimientos ASC
LIMIT 20;

-- ============================================================================
-- 6. ANÁLISIS DE AJUSTES NEGATIVOS
-- ============================================================================
SELECT 
    '=== ARTÍCULOS CON AJUSTES NEGATIVOS ===' as seccion;

SELECT 
    articulo_numero,
    codigo_barras,
    descripcion,
    stock_lomasoft,
    stock_movimientos,
    stock_ajustes,
    stock_consolidado,
    ultima_actualizacion
FROM public.stock_real_consolidado
WHERE stock_ajustes < 0
ORDER BY stock_ajustes ASC
LIMIT 20;

-- ============================================================================
-- 7. RESUMEN ESTADÍSTICO
-- ============================================================================
SELECT 
    '=== RESUMEN ESTADÍSTICO ===' as seccion;

SELECT 
    'Total artículos' as metrica,
    COUNT(*) as cantidad
FROM public.stock_real_consolidado
UNION ALL
SELECT 
    'Artículos con stock negativo' as metrica,
    COUNT(*) as cantidad
FROM public.stock_real_consolidado
WHERE stock_consolidado < 0
UNION ALL
SELECT 
    'Artículos pack' as metrica,
    COUNT(*) as cantidad
FROM public.stock_real_consolidado
WHERE es_pack = true
UNION ALL
SELECT 
    'Artículos pack con hijo negativo' as metrica,
    COUNT(DISTINCT padre.codigo_barras) as cantidad
FROM public.stock_real_consolidado padre
INNER JOIN public.stock_real_consolidado hijo ON hijo.codigo_barras = padre.pack_hijo_codigo
WHERE padre.es_pack = true
  AND hijo.stock_consolidado < 0
UNION ALL
SELECT 
    'Artículos con movimientos negativos' as metrica,
    COUNT(*) as cantidad
FROM public.stock_real_consolidado
WHERE stock_movimientos < 0
UNION ALL
SELECT 
    'Artículos con ajustes negativos' as metrica,
    COUNT(*) as cantidad
FROM public.stock_real_consolidado
WHERE stock_ajustes < 0;

-- ============================================================================
-- 8. VERIFICAR PEDIDOS LISTOS QUE PODRÍAN AFECTAR EL CÁLCULO
-- ============================================================================
SELECT 
    '=== ARTÍCULOS EN PEDIDOS LISTOS ===' as seccion;

SELECT 
    pd.articulo as codigo_articulo,
    a.nombre as descripcion,
    SUM(pd.cantidad) as cantidad_en_pedidos_listos,
    src.stock_consolidado as stock_actual,
    src.stock_consolidado - SUM(pd.cantidad) as stock_disponible_real
FROM public.presupuestos p
JOIN public.presupuestos_detalles pd ON pd.id_presupuesto_ext = p.id_presupuesto_ext
LEFT JOIN public.articulos a ON a.codigo_barras = pd.articulo
LEFT JOIN public.stock_real_consolidado src ON src.codigo_barras = pd.articulo
WHERE p.activo = true
  AND p.secuencia = 'Pedido_Listo'
  AND pd.articulo = '2589631327'
GROUP BY pd.articulo, a.nombre, src.stock_consolidado;

-- ============================================================================
-- FIN DEL DIAGNÓSTICO
-- ============================================================================
