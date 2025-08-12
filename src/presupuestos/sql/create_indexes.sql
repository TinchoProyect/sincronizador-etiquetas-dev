-- =====================================================
-- ÍNDICES OPTIMIZADOS PARA SINCRONIZACIÓN GOOGLE SHEETS
-- Módulo de Presupuestos - Sistema LAMDA
-- =====================================================

-- Índice principal para presupuestos por ID externo
-- Usado en UPSERT y búsquedas por id_ext
CREATE INDEX IF NOT EXISTS idx_presupuestos_id_ext 
ON public.presupuestos(id_ext);

-- Índice para detalles por ID de presupuesto externo
-- Usado para encontrar detalles de un presupuesto específico
CREATE INDEX IF NOT EXISTS idx_detalles_presupuesto_ext 
ON public.presupuestos_detalles(id_presupuesto_ext);

-- Índice para detalles por artículo
-- Usado en búsquedas y filtros por artículo
CREATE INDEX IF NOT EXISTS idx_detalles_articulo 
ON public.presupuestos_detalles(articulo);

-- Índice compuesto para UPSERT de detalles
-- Usado en ON CONFLICT (id_presupuesto_ext, articulo)
CREATE INDEX IF NOT EXISTS idx_detalles_composite 
ON public.presupuestos_detalles(id_presupuesto_ext, articulo);

-- Índice para fecha de actualización de presupuestos
-- Usado para consultas de sincronización y auditoría
CREATE INDEX IF NOT EXISTS idx_presupuestos_fecha_actualizacion 
ON public.presupuestos(fecha_actualizacion);

-- Índice para fecha de actualización de detalles
-- Usado para consultas de sincronización y auditoría
CREATE INDEX IF NOT EXISTS idx_detalles_fecha_actualizacion 
ON public.presupuestos_detalles(fecha_actualizacion);

-- Índice para estado de presupuestos
-- Usado en filtros y estadísticas por estado
CREATE INDEX IF NOT EXISTS idx_presupuestos_estado 
ON public.presupuestos(estado);

-- Índice para fecha de presupuestos
-- Usado en consultas por rango de fechas
CREATE INDEX IF NOT EXISTS idx_presupuestos_fecha 
ON public.presupuestos(fecha);

-- Índice para cliente en presupuestos
-- Usado en consultas por cliente
CREATE INDEX IF NOT EXISTS idx_presupuestos_cliente 
ON public.presupuestos(cliente);

-- Índice para logs de sincronización por fecha
-- Usado en historial de sincronizaciones
CREATE INDEX IF NOT EXISTS idx_sync_log_fecha 
ON presupuestos_sync_log(fecha_sync DESC);

-- Índice para logs de sincronización por configuración
-- Usado para obtener logs de una configuración específica
CREATE INDEX IF NOT EXISTS idx_sync_log_config 
ON presupuestos_sync_log(config_id);

-- =====================================================
-- CONSTRAINTS ÚNICOS PARA INTEGRIDAD
-- =====================================================

-- Constraint único para id_ext en presupuestos (si no existe)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'presupuestos_id_ext_unique'
    ) THEN
        ALTER TABLE public.presupuestos 
        ADD CONSTRAINT presupuestos_id_ext_unique UNIQUE (id_ext);
    END IF;
END $$;

-- Constraint único para combinación id_presupuesto_ext + articulo en detalles
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'detalles_presupuesto_articulo_unique'
    ) THEN
        ALTER TABLE public.presupuestos_detalles 
        ADD CONSTRAINT detalles_presupuesto_articulo_unique 
        UNIQUE (id_presupuesto_ext, articulo);
    END IF;
END $$;

-- =====================================================
-- COMENTARIOS PARA DOCUMENTACIÓN
-- =====================================================

COMMENT ON INDEX idx_presupuestos_id_ext IS 
'Índice principal para búsquedas y UPSERT por ID externo de presupuestos';

COMMENT ON INDEX idx_detalles_presupuesto_ext IS 
'Índice para búsquedas de detalles por ID de presupuesto externo';

COMMENT ON INDEX idx_detalles_composite IS 
'Índice compuesto para UPSERT de detalles (id_presupuesto_ext + articulo)';

COMMENT ON INDEX idx_presupuestos_fecha_actualizacion IS 
'Índice para consultas de auditoría y sincronización por fecha de actualización';

-- =====================================================
-- VERIFICACIÓN DE ÍNDICES CREADOS
-- =====================================================

-- Consulta para verificar que los índices se crearon correctamente
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename IN ('presupuestos', 'presupuestos_detalles', 'presupuestos_sync_log')
    AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;
