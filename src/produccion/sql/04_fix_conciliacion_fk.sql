-- Agregar columna de relación en Items para trazabilidad fuerte (Strong Link)
ALTER TABLE public.mantenimiento_conciliacion_items 
ADD COLUMN IF NOT EXISTS id_movimiento_origen INTEGER;

-- Crear Constraint FK para asegurar integridad referencia
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_conciliacion_items_movimiento') THEN
        ALTER TABLE public.mantenimiento_conciliacion_items
        ADD CONSTRAINT fk_conciliacion_items_movimiento
        FOREIGN KEY (id_movimiento_origen) 
        REFERENCES public.mantenimiento_movimientos(id);
    END IF;
END $$;
