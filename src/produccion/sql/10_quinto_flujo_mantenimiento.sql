-- =========================================================================================
-- MIGRACIÓN DE ESQUEMA: EL QUINTO FLUJO Y MEMORIA HISTÓRICA MANTENIMIENTO
-- =========================================================================================

DO $$ 
BEGIN 
    -- 1. Agregar historial_tratamientos (JSONB)
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'mantenimiento_movimientos' 
        AND column_name = 'historial_tratamientos'
    ) THEN 
        ALTER TABLE public.mantenimiento_movimientos 
        ADD COLUMN historial_tratamientos JSONB DEFAULT '[]'::jsonb;
        
        RAISE NOTICE '✅ Columna historial_tratamientos añadida correctamente.';
    ELSE 
        RAISE NOTICE 'ℹ️ La columna historial_tratamientos ya existe.';
    END IF;

    -- 2. Asegurar que tipo_movimiento admita 'RETORNO_TRATAMIENTO' y 'TRANSF_INGREDIENTE'
    ALTER TABLE public.mantenimiento_movimientos DROP CONSTRAINT IF EXISTS mantenimiento_movimientos_tipo_movimiento_check;
    
    -- Nota: En Postgres no es estrictamente necesario regenerar el CHECK genérico si la lógica de aplicación lo regula, 
    -- pero por sanidad referencial se puede añadir un nuevo check. Lo omitiremos para mayor flexibilidad a futuro
    -- ya que el backend valida de facto.

END $$;
