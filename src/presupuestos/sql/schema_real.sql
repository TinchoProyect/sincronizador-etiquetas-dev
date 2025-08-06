-- ===================================
-- ESQUEMA DE BASE DE DATOS REAL
-- MÓDULO DE PRESUPUESTOS - SISTEMA LAMDA
-- ===================================

-- 🔍 [PRESUPUESTOS] Script con la estructura real de base de datos
-- Basado en las tablas ya creadas en PostgreSQL

-- Tabla de configuración de hojas de Google Sheets
CREATE TABLE IF NOT EXISTS presupuestos_config (
    id SERIAL PRIMARY KEY,
    hoja_url TEXT NOT NULL,
    hoja_id TEXT NOT NULL,
    hoja_nombre TEXT NOT NULL,
    rango TEXT DEFAULT 'A:P',
    activo BOOLEAN DEFAULT TRUE,
    usuario_id INTEGER,
    fecha_creacion TIMESTAMP DEFAULT NOW()
);

-- Índices para presupuestos_config
CREATE INDEX IF NOT EXISTS idx_presupuestos_config_activo ON presupuestos_config(activo);
CREATE INDEX IF NOT EXISTS idx_presupuestos_config_hoja_id ON presupuestos_config(hoja_id);

-- Tabla principal de presupuestos
CREATE TABLE IF NOT EXISTS presupuestos (
    id SERIAL PRIMARY KEY,
    id_presupuesto_ext TEXT NOT NULL,
    id_cliente TEXT NOT NULL,
    fecha DATE,
    fecha_entrega DATE,
    agente TEXT,
    tipo_comprobante TEXT,
    nota TEXT,
    estado TEXT,
    informe_generado TEXT,
    cliente_nuevo_id TEXT,
    punto_entrega TEXT,
    descuento NUMERIC(10,2),
    activo BOOLEAN DEFAULT TRUE,
    hoja_nombre TEXT,
    hoja_url TEXT,
    usuario_id INTEGER
);

-- Índices para presupuestos
CREATE INDEX IF NOT EXISTS idx_presupuestos_ext_id ON presupuestos(id_presupuesto_ext);
CREATE INDEX IF NOT EXISTS idx_presupuestos_cliente ON presupuestos(id_cliente);
CREATE INDEX IF NOT EXISTS idx_presupuestos_estado ON presupuestos(estado);
CREATE INDEX IF NOT EXISTS idx_presupuestos_activo ON presupuestos(activo);
CREATE INDEX IF NOT EXISTS idx_presupuestos_fecha ON presupuestos(fecha);
CREATE INDEX IF NOT EXISTS idx_presupuestos_hoja_nombre ON presupuestos(hoja_nombre);

-- Constraint único para evitar duplicados
CREATE UNIQUE INDEX IF NOT EXISTS idx_presupuestos_unique 
ON presupuestos(id_presupuesto_ext, id_cliente) WHERE activo = true;

-- Tabla de detalles de presupuestos (artículos)
CREATE TABLE IF NOT EXISTS presupuestos_detalles (
    id SERIAL PRIMARY KEY,
    id_presupuesto INTEGER REFERENCES presupuestos(id) ON DELETE CASCADE,
    id_presupuesto_ext TEXT NOT NULL,
    articulo TEXT,
    cantidad NUMERIC(10,2),
    valor1 NUMERIC(10,2),
    precio1 NUMERIC(10,2),
    iva1 NUMERIC(10,2),
    diferencia NUMERIC(10,2),
    camp1 NUMERIC(10,2),
    camp2 NUMERIC(10,2),
    camp3 NUMERIC(10,2),
    camp4 NUMERIC(10,2),
    camp5 NUMERIC(10,2),
    camp6 NUMERIC(10,2)
);

-- Índices para presupuestos_detalles
CREATE INDEX IF NOT EXISTS idx_presupuestos_detalles_presupuesto ON presupuestos_detalles(id_presupuesto);
CREATE INDEX IF NOT EXISTS idx_presupuestos_detalles_ext_id ON presupuestos_detalles(id_presupuesto_ext);
CREATE INDEX IF NOT EXISTS idx_presupuestos_detalles_articulo ON presupuestos_detalles(articulo);

-- ===================================
-- TABLA DE LOGS DE SINCRONIZACIÓN
-- ===================================

-- Tabla para registrar logs de sincronización
CREATE TABLE IF NOT EXISTS presupuestos_sync_log (
    id SERIAL PRIMARY KEY,
    config_id INTEGER REFERENCES presupuestos_config(id) ON DELETE CASCADE,
    registros_procesados INTEGER DEFAULT 0,
    registros_nuevos INTEGER DEFAULT 0,
    registros_actualizados INTEGER DEFAULT 0,
    errores TEXT,
    fecha_sync TIMESTAMP DEFAULT NOW(),
    duracion_segundos INTEGER,
    exitoso BOOLEAN DEFAULT false,
    usuario_id INTEGER,
    tipo_sync VARCHAR(20) DEFAULT 'manual'
);

-- Índices para logs
CREATE INDEX IF NOT EXISTS idx_presupuestos_sync_log_config ON presupuestos_sync_log(config_id);
CREATE INDEX IF NOT EXISTS idx_presupuestos_sync_log_fecha ON presupuestos_sync_log(fecha_sync);
CREATE INDEX IF NOT EXISTS idx_presupuestos_sync_log_exitoso ON presupuestos_sync_log(exitoso);

-- ===================================
-- VISTAS ÚTILES
-- ===================================

-- Vista con resumen de presupuestos por cliente
CREATE OR REPLACE VIEW presupuestos_resumen_cliente AS
SELECT 
    id_cliente,
    COUNT(*) as total_presupuestos,
    COUNT(CASE WHEN estado = 'entregado' THEN 1 END) as entregados,
    COUNT(CASE WHEN estado = 'pendiente' THEN 1 END) as pendientes,
    COUNT(CASE WHEN estado = 'armado' THEN 1 END) as armados,
    SUM(descuento) as descuento_total,
    MIN(fecha) as fecha_primer_presupuesto,
    MAX(fecha) as fecha_ultimo_presupuesto
FROM presupuestos 
WHERE activo = true 
GROUP BY id_cliente
ORDER BY total_presupuestos DESC;

-- Vista con resumen de presupuestos por estado
CREATE OR REPLACE VIEW presupuestos_resumen_estado AS
SELECT 
    estado,
    COUNT(*) as total_presupuestos,
    COUNT(DISTINCT id_cliente) as clientes_distintos,
    AVG(descuento) as descuento_promedio,
    SUM(descuento) as descuento_total
FROM presupuestos 
WHERE activo = true 
GROUP BY estado
ORDER BY total_presupuestos DESC;

-- Vista con detalles completos de presupuestos
CREATE OR REPLACE VIEW presupuestos_completos AS
SELECT 
    p.id,
    p.id_presupuesto_ext,
    p.id_cliente,
    p.fecha,
    p.fecha_entrega,
    p.agente,
    p.tipo_comprobante,
    p.nota,
    p.estado,
    p.informe_generado,
    p.cliente_nuevo_id,
    p.punto_entrega,
    p.descuento,
    p.hoja_nombre,
    p.hoja_url,
    COUNT(pd.id) as total_articulos,
    SUM(pd.cantidad) as cantidad_total,
    SUM(pd.precio1 * pd.cantidad) as valor_total_estimado
FROM presupuestos p
LEFT JOIN presupuestos_detalles pd ON p.id = pd.id_presupuesto
WHERE p.activo = true
GROUP BY p.id, p.id_presupuesto_ext, p.id_cliente, p.fecha, p.fecha_entrega, 
         p.agente, p.tipo_comprobante, p.nota, p.estado, p.informe_generado,
         p.cliente_nuevo_id, p.punto_entrega, p.descuento, p.hoja_nombre, p.hoja_url
ORDER BY p.fecha DESC;

-- ===================================
-- COMENTARIOS Y DOCUMENTACIÓN
-- ===================================

COMMENT ON TABLE presupuestos_config IS 'Configuración de hojas de Google Sheets para sincronización';
COMMENT ON TABLE presupuestos IS 'Datos principales de presupuestos sincronizados desde Google Sheets';
COMMENT ON TABLE presupuestos_detalles IS 'Detalles de artículos por presupuesto';
COMMENT ON TABLE presupuestos_sync_log IS 'Historial de sincronizaciones realizadas';

COMMENT ON COLUMN presupuestos.id_presupuesto_ext IS 'ID externo del presupuesto desde Google Sheets';
COMMENT ON COLUMN presupuestos.id_cliente IS 'Identificador del cliente';
COMMENT ON COLUMN presupuestos.estado IS 'Estado del presupuesto: entregado, pendiente, armado, etc.';
COMMENT ON COLUMN presupuestos.activo IS 'Soft delete - false para presupuestos eliminados';
COMMENT ON COLUMN presupuestos_detalles.camp1 IS 'Campo numérico personalizable 1';
COMMENT ON COLUMN presupuestos_detalles.camp2 IS 'Campo numérico personalizable 2';
COMMENT ON COLUMN presupuestos_detalles.camp3 IS 'Campo numérico personalizable 3';
COMMENT ON COLUMN presupuestos_detalles.camp4 IS 'Campo numérico personalizable 4';
COMMENT ON COLUMN presupuestos_detalles.camp5 IS 'Campo numérico personalizable 5';
COMMENT ON COLUMN presupuestos_detalles.camp6 IS 'Campo numérico personalizable 6';

-- ===================================
-- FIN DEL SCRIPT
-- ===================================

-- 🔍 [PRESUPUESTOS] Esquema real implementado
-- Para ejecutar: psql -U postgres -d etiquetas -f schema_real.sql
