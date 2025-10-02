-- FIX "DOBLE CLICK" EN ANULADOS
-- Basado en estructura actual de tablas (ya tienen fecha_actualizacion y triggers)
-- Solo agregamos la columna necesita_sync_sheets y trigger específico para cambios de activo

-- Agregar columna necesita_sync_sheets si no existe
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'presupuestos' 
        AND column_name = 'necesita_sync_sheets'
    ) THEN
        ALTER TABLE presupuestos 
        ADD COLUMN necesita_sync_sheets BOOLEAN DEFAULT false;
        
        -- Marcar todos los inactivos existentes para sync
        UPDATE presupuestos 
        SET necesita_sync_sheets = true 
        WHERE activo = false;
        
        RAISE NOTICE 'Columna necesita_sync_sheets agregada y % presupuestos inactivos marcados para sync', 
                     (SELECT COUNT(*) FROM presupuestos WHERE activo = false);
    ELSE
        RAISE NOTICE 'Columna necesita_sync_sheets ya existe';
    END IF;
END $$;

-- Crear función específica para marcar cambios de activo
CREATE OR REPLACE FUNCTION marcar_cambio_activo_para_sync()
RETURNS TRIGGER AS $$
BEGIN
    -- Si activo cambió (anulación o reactivación)
    IF OLD.activo IS DISTINCT FROM NEW.activo THEN
        NEW.necesita_sync_sheets = true;
        -- fecha_actualizacion ya se actualiza por el trigger existente set_fecha_actualizacion_presupuestos
        
        -- Log para debugging
        IF NEW.activo = false THEN
            RAISE NOTICE 'Presupuesto anulado: ID=% - marcado para sync', NEW.id_presupuesto_ext;
        ELSE
            RAISE NOTICE 'Presupuesto reactivado: ID=% - marcado para sync', NEW.id_presupuesto_ext;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Crear trigger específico para cambios de activo (se ejecuta DESPUÉS del trigger existente)
DROP TRIGGER IF EXISTS trigger_marcar_cambio_activo_sync ON presupuestos;

CREATE TRIGGER trigger_marcar_cambio_activo_sync
    BEFORE UPDATE ON presupuestos
    FOR EACH ROW
    WHEN (OLD.activo IS DISTINCT FROM NEW.activo)
    EXECUTE FUNCTION marcar_cambio_activo_para_sync();

-- Crear índice para mejorar performance de las consultas de sync
CREATE INDEX IF NOT EXISTS idx_presupuestos_sync_anulados 
ON presupuestos (activo, necesita_sync_sheets, fecha_actualizacion) 
WHERE activo = false OR necesita_sync_sheets = true;

-- Verificar que todo se creó correctamente
SELECT 
    'Columna necesita_sync_sheets' as elemento,
    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'presupuestos' AND column_name = 'necesita_sync_sheets'
    ) THEN '✅ Existe' ELSE '❌ No existe' END as estado

UNION ALL

SELECT 
    'Trigger marcar_cambio_activo_sync' as elemento,
    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.triggers 
        WHERE trigger_name = 'trigger_marcar_cambio_activo_sync'
    ) THEN '✅ Existe' ELSE '❌ No existe' END as estado

UNION ALL

SELECT 
    'Índice sync_anulados' as elemento,
    CASE WHEN EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'idx_presupuestos_sync_anulados'
    ) THEN '✅ Existe' ELSE '❌ No existe' END as estado;

-- Mostrar triggers actuales en la tabla presupuestos
SELECT 
    trigger_name,
    event_manipulation,
    action_timing,
    action_statement
FROM information_schema.triggers 
WHERE event_object_table = 'presupuestos'
ORDER BY trigger_name;

COMMENT ON TRIGGER trigger_marcar_cambio_activo_sync ON presupuestos IS 
'FIX DOBLE CLICK: Marca necesita_sync_sheets=true cuando activo cambia (anulación/reactivación)';

COMMENT ON FUNCTION marcar_cambio_activo_para_sync() IS 
'FIX DOBLE CLICK: Función del trigger para detectar cambios en el campo activo y marcar para sync';

COMMENT ON INDEX idx_presupuestos_sync_anulados IS 
'FIX DOBLE CLICK: Índice para optimizar consultas de sincronización de anulados';
