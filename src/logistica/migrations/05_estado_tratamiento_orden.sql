-- Agrega el flag de estado_tratamiento para tracking exacto del flujo (RETIRO_PENDIENTE, EN_PLANTA, COMPLETADO)
ALTER TABLE public.ordenes_tratamiento ADD COLUMN IF NOT EXISTS estado_tratamiento VARCHAR(50) DEFAULT 'RETIRO_PENDIENTE';

-- Actualiza el estado hacia COMPLETADO si la orden ya fue devuelta a logística desde Planta
-- Esto cubre el espectro backward-compatibility.
UPDATE public.ordenes_tratamiento
SET estado_tratamiento = 'COMPLETADO'
WHERE id IN (
    SELECT DISTINCT id_orden_tratamiento
    FROM public.mantenimiento_movimientos
    WHERE tipo_movimiento = 'RETORNO_TRATAMIENTO' AND id_orden_tratamiento IS NOT NULL
);

-- Actualiza el estado hacia EN_PLANTA si la orden está en mantenimiento_movimientos pero NO FUE devuelta
UPDATE public.ordenes_tratamiento
SET estado_tratamiento = 'EN_PLANTA'
WHERE estado_tratamiento = 'RETIRO_PENDIENTE'
AND id IN (
    SELECT DISTINCT id_orden_tratamiento
    FROM public.mantenimiento_movimientos
    WHERE tipo_movimiento = 'RETIRO_TRATAMIENTO' AND id_orden_tratamiento IS NOT NULL
);
