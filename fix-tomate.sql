-- ==============================================================================
-- O.T. 2a ("El Destornillador") - Rescate de Orden de Tomate Triturado
-- ==============================================================================

-- 1. Forzamos el estado de los movimientos de Ingreso originales trabados
-- que hayan quedado en 'CONCILIADO' (porque falló la liberación total).
UPDATE public.mantenimiento_movimientos
SET estado = 'LIBERADO_VENTAS',
    observaciones = COALESCE(observaciones, '') || ' [FIX MANUAL: Rescate Tomate Triturado - Enviado a Ventas]'
WHERE tipo_movimiento = 'INGRESO'
  AND estado = 'CONCILIADO'
  AND articulo_numero IN (
      SELECT articulo_numero 
      FROM public.stock_real_consolidado 
      WHERE descripcion ILIKE '%tomate triturado%'
  );

-- 2. Limpiamos cualquier remanente fantasma en la tabla de cuarentena. 
-- Como ya sabemos que el primer clic en "Enviar a Ventas" descontó 1kg,
-- y queremos sacar el artículo de la bandeja de pendientes visualmente.
UPDATE public.stock_real_consolidado
SET stock_consolidado = stock_consolidado - stock_mantenimiento, -- si quedara algo real
    stock_ajustes = COALESCE(stock_ajustes, 0) + stock_mantenimiento,
    stock_mantenimiento = 0,
    ultima_actualizacion = NOW()
WHERE descripcion ILIKE '%tomate triturado%'
  AND stock_mantenimiento > 0;

-- Mensaje: Ejecuta este script en DBeaver o pgAdmin y refrescá la página.
