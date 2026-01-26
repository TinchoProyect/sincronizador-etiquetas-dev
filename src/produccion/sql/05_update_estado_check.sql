-- Modificar Constraint CHECK en mantenimiento_movimientos
DO $$ 
BEGIN 
    -- Intentar borrar el constraint existente (si existe con nombre default o específico)
    -- El nombre suele ser mantenimiento_movimientos_estado_check
    IF EXISTS (
        SELECT 1 
        FROM pg_constraint 
        WHERE conname = 'mantenimiento_movimientos_estado_check'
    ) THEN
        ALTER TABLE public.mantenimiento_movimientos 
        DROP CONSTRAINT mantenimiento_movimientos_estado_check;
    END IF;

    -- Crear nuevo Constraint incluyendo 'CONCILIADO'
    ALTER TABLE public.mantenimiento_movimientos 
    ADD CONSTRAINT mantenimiento_movimientos_estado_check 
    CHECK (estado IN ('PENDIENTE', 'FINALIZADO', 'CANCELADO', 'CONCILIADO')); -- Agregado 'CONCILIADO'

END $$;
