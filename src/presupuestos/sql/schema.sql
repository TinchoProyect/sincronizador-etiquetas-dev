-- ===================================
-- ESQUEMA DE BASE DE DATOS
-- MÓDULO DE PRESUPUESTOS - SISTEMA LAMDA
-- ===================================

-- 🔍 [PRESUPUESTOS] Script de creación de tablas para el módulo de presupuestos
-- Este archivo contiene la estructura de base de datos necesaria para el funcionamiento del módulo

-- Tabla principal de presupuestos
-- Almacena los datos sincronizados desde Google Sheets
CREATE TABLE IF NOT EXISTS presupuestos_datos (
    id SERIAL PRIMARY KEY,
    sheet_id VARCHAR(255) NOT NULL,
    sheet_name VARCHAR(255) NOT NULL DEFAULT 'Hoja1',
    categoria VARCHAR(100),
    concepto VARCHAR(255) NOT NULL,
    monto DECIMAL(12,2) NOT NULL DEFAULT 0,
    fecha_registro TIMESTAMP DEFAULT NOW(),
    fecha_sincronizacion TIMESTAMP DEFAULT NOW(),
    activo BOOLEAN DEFAULT true,
    
    -- Índices para mejorar rendimiento
    CONSTRAINT unique_presupuesto UNIQUE (sheet_id, concepto, categoria)
);

-- Índices adicionales para optimización
CREATE INDEX IF NOT EXISTS idx_presupuestos_datos_categoria ON presupuestos_datos(categoria);
CREATE INDEX IF NOT EXISTS idx_presupuestos_datos_activo ON presupuestos_datos(activo);
CREATE INDEX IF NOT EXISTS idx_presupuestos_datos_fecha_sync ON presupuestos_datos(fecha_sincronizacion);

-- Tabla de configuración de Google Sheets
-- Almacena las configuraciones de conexión con Google Sheets
CREATE TABLE IF NOT EXISTS presupuestos_config (
    id SERIAL PRIMARY KEY,
    sheet_url TEXT NOT NULL,
    sheet_id VARCHAR(255) NOT NULL,
    sheet_name VARCHAR(255) DEFAULT 'Hoja1',
    range_datos VARCHAR(50) DEFAULT 'A:D',
    ultima_sincronizacion TIMESTAMP,
    activo BOOLEAN DEFAULT true,
    creado_por INTEGER, -- Referencias usuarios(id) del sistema principal
    fecha_creacion TIMESTAMP DEFAULT NOW(),
    fecha_modificacion TIMESTAMP DEFAULT NOW(),
    
    -- Solo una configuración activa a la vez
    CONSTRAINT unique_active_config EXCLUDE (activo WITH =) WHERE (activo = true)
);

-- Índices para configuración
CREATE INDEX IF NOT EXISTS idx_presupuestos_config_activo ON presupuestos_config(activo);
CREATE INDEX IF NOT EXISTS idx_presupuestos_config_sheet_id ON presupuestos_config(sheet_id);

-- Tabla de logs de sincronización
-- Registra el historial de todas las sincronizaciones realizadas
CREATE TABLE IF NOT EXISTS presupuestos_sync_log (
    id SERIAL PRIMARY KEY,
    config_id INTEGER REFERENCES presupuestos_config(id) ON DELETE CASCADE,
    registros_procesados INTEGER DEFAULT 0,
    registros_nuevos INTEGER DEFAULT 0,
    registros_actualizados INTEGER DEFAULT 0,
    registros_eliminados INTEGER DEFAULT 0,
    errores TEXT,
    fecha_sync TIMESTAMP DEFAULT NOW(),
    duracion_segundos INTEGER,
    exitoso BOOLEAN DEFAULT false,
    
    -- Metadatos adicionales
    usuario_ejecutor INTEGER, -- Referencias usuarios(id) del sistema principal
    tipo_sync VARCHAR(20) DEFAULT 'manual', -- 'manual', 'automatico', 'programado'
    version_api VARCHAR(10) DEFAULT '1.0'
);

-- Índices para logs
CREATE INDEX IF NOT EXISTS idx_presupuestos_sync_log_config ON presupuestos_sync_log(config_id);
CREATE INDEX IF NOT EXISTS idx_presupuestos_sync_log_fecha ON presupuestos_sync_log(fecha_sync);
CREATE INDEX IF NOT EXISTS idx_presupuestos_sync_log_exitoso ON presupuestos_sync_log(exitoso);

-- Tabla de mapeo de columnas (opcional para configuraciones avanzadas)
-- Permite mapear columnas de Google Sheets a campos específicos
CREATE TABLE IF NOT EXISTS presupuestos_column_mapping (
    id SERIAL PRIMARY KEY,
    config_id INTEGER REFERENCES presupuestos_config(id) ON DELETE CASCADE,
    campo_destino VARCHAR(50) NOT NULL, -- 'categoria', 'concepto', 'monto', etc.
    columna_origen VARCHAR(10) NOT NULL, -- 'A', 'B', 'C', etc. o nombre de columna
    tipo_dato VARCHAR(20) DEFAULT 'text', -- 'text', 'number', 'date'
    transformacion TEXT, -- Reglas de transformación (JSON)
    activo BOOLEAN DEFAULT true,
    
    CONSTRAINT unique_mapping UNIQUE (config_id, campo_destino)
);

-- Tabla de auditoría (opcional)
-- Registra cambios importantes en las configuraciones
CREATE TABLE IF NOT EXISTS presupuestos_auditoria (
    id SERIAL PRIMARY KEY,
    tabla_afectada VARCHAR(50) NOT NULL,
    registro_id INTEGER NOT NULL,
    accion VARCHAR(20) NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE'
    datos_anteriores JSONB,
    datos_nuevos JSONB,
    usuario_id INTEGER, -- Referencias usuarios(id) del sistema principal
    fecha_accion TIMESTAMP DEFAULT NOW(),
    ip_address INET,
    user_agent TEXT
);

-- Índices para auditoría
CREATE INDEX IF NOT EXISTS idx_presupuestos_auditoria_tabla ON presupuestos_auditoria(tabla_afectada);
CREATE INDEX IF NOT EXISTS idx_presupuestos_auditoria_fecha ON presupuestos_auditoria(fecha_accion);

-- ===================================
-- TRIGGERS Y FUNCIONES
-- ===================================

-- Función para actualizar fecha_modificacion automáticamente
CREATE OR REPLACE FUNCTION update_fecha_modificacion()
RETURNS TRIGGER AS $$
BEGIN
    NEW.fecha_modificacion = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para presupuestos_config
DROP TRIGGER IF EXISTS trigger_update_fecha_modificacion ON presupuestos_config;
CREATE TRIGGER trigger_update_fecha_modificacion
    BEFORE UPDATE ON presupuestos_config
    FOR EACH ROW
    EXECUTE FUNCTION update_fecha_modificacion();

-- Función para logging automático de auditoría
CREATE OR REPLACE FUNCTION log_presupuestos_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO presupuestos_auditoria (
            tabla_afectada, registro_id, accion, datos_anteriores, fecha_accion
        ) VALUES (
            TG_TABLE_NAME, OLD.id, TG_OP, row_to_json(OLD), NOW()
        );
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO presupuestos_auditoria (
            tabla_afectada, registro_id, accion, datos_anteriores, datos_nuevos, fecha_accion
        ) VALUES (
            TG_TABLE_NAME, NEW.id, TG_OP, row_to_json(OLD), row_to_json(NEW), NOW()
        );
        RETURN NEW;
    ELSIF TG_OP = 'INSERT' THEN
        INSERT INTO presupuestos_auditoria (
            tabla_afectada, registro_id, accion, datos_nuevos, fecha_accion
        ) VALUES (
            TG_TABLE_NAME, NEW.id, TG_OP, row_to_json(NEW), NOW()
        );
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Triggers de auditoría (comentados por defecto para evitar overhead)
-- Descomentar si se requiere auditoría completa

-- DROP TRIGGER IF EXISTS trigger_audit_presupuestos_config ON presupuestos_config;
-- CREATE TRIGGER trigger_audit_presupuestos_config
--     AFTER INSERT OR UPDATE OR DELETE ON presupuestos_config
--     FOR EACH ROW
--     EXECUTE FUNCTION log_presupuestos_changes();

-- ===================================
-- VISTAS ÚTILES
-- ===================================

-- Vista con estadísticas por categoría
CREATE OR REPLACE VIEW presupuestos_stats_categoria AS
SELECT 
    categoria,
    COUNT(*) as total_registros,
    SUM(monto) as monto_total,
    AVG(monto) as monto_promedio,
    MIN(monto) as monto_minimo,
    MAX(monto) as monto_maximo,
    MAX(fecha_sincronizacion) as ultima_actualizacion
FROM presupuestos_datos 
WHERE activo = true 
GROUP BY categoria
ORDER BY monto_total DESC;

-- Vista con resumen de sincronizaciones
CREATE OR REPLACE VIEW presupuestos_sync_summary AS
SELECT 
    psl.id,
    psl.fecha_sync,
    psl.exitoso,
    psl.registros_procesados,
    psl.registros_nuevos,
    psl.registros_actualizados,
    psl.duracion_segundos,
    pc.sheet_url,
    pc.sheet_id,
    CASE 
        WHEN psl.errores IS NOT NULL THEN 'Con errores'
        WHEN psl.exitoso THEN 'Exitoso'
        ELSE 'Fallido'
    END as estado_sync
FROM presupuestos_sync_log psl
LEFT JOIN presupuestos_config pc ON pc.id = psl.config_id
ORDER BY psl.fecha_sync DESC;

-- ===================================
-- DATOS INICIALES (OPCIONAL)
-- ===================================

-- Insertar configuración de ejemplo (comentado por defecto)
-- INSERT INTO presupuestos_config (
--     sheet_url, 
--     sheet_id, 
--     range_datos, 
--     activo, 
--     creado_por
-- ) VALUES (
--     'https://docs.google.com/spreadsheets/d/EJEMPLO_ID/edit',
--     'EJEMPLO_ID',
--     'A:D',
--     false,
--     1
-- );

-- ===================================
-- COMENTARIOS Y DOCUMENTACIÓN
-- ===================================

COMMENT ON TABLE presupuestos_datos IS 'Tabla principal que almacena los datos de presupuestos sincronizados desde Google Sheets';
COMMENT ON TABLE presupuestos_config IS 'Configuraciones de conexión con Google Sheets';
COMMENT ON TABLE presupuestos_sync_log IS 'Historial de sincronizaciones realizadas';
COMMENT ON TABLE presupuestos_column_mapping IS 'Mapeo personalizado de columnas de Google Sheets';
COMMENT ON TABLE presupuestos_auditoria IS 'Registro de auditoría para cambios en configuraciones';

COMMENT ON COLUMN presupuestos_datos.sheet_id IS 'ID único de la hoja de Google Sheets';
COMMENT ON COLUMN presupuestos_datos.concepto IS 'Descripción o concepto del presupuesto';
COMMENT ON COLUMN presupuestos_datos.monto IS 'Monto del presupuesto en formato decimal';
COMMENT ON COLUMN presupuestos_config.range_datos IS 'Rango de celdas a sincronizar (ej: A:D, A1:D100)';
COMMENT ON COLUMN presupuestos_sync_log.duracion_segundos IS 'Tiempo que tardó la sincronización en segundos';

-- ===================================
-- FIN DEL SCRIPT
-- ===================================

-- 🔍 [PRESUPUESTOS] Script completado
-- Para ejecutar este script:
-- psql -U postgres -d etiquetas -f schema.sql
