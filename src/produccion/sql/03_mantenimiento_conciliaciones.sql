-- Tabla principal de conciliaciones (Cabecera)
CREATE TABLE IF NOT EXISTS public.mantenimiento_conciliaciones (
    id SERIAL PRIMARY KEY,
    id_cliente INTEGER NOT NULL, -- Para agrupar
    cliente_nombre VARCHAR(255),
    
    -- Datos del Comprobante Externo (Persistencia fiscal)
    nro_comprobante_externo VARCHAR(50) NOT NULL, -- Ej: "0004-00000122"
    tipo_comprobante VARCHAR(50), -- Ej: "N/C A"
    fecha_comprobante DATE, -- Fecha de emisión real
    
    -- Importes Persistidos
    importe_neto NUMERIC(15,2) DEFAULT 0,
    importe_iva NUMERIC(15,2) DEFAULT 0,
    importe_total NUMERIC(15,2) DEFAULT 0,
    
    -- Metadatos de Sistema
    fecha_consolidacion TIMESTAMP DEFAULT NOW(),
    usuario_consolidacion VARCHAR(100),
    observaciones TEXT
);

-- Tabla de Items Conciliados (Detalle granular para trazabilidad)
-- Vincula cada renglón de la NC con el artículo específico que estabamos esperando
CREATE TABLE IF NOT EXISTS public.mantenimiento_conciliacion_items (
    id SERIAL PRIMARY KEY,
    id_conciliacion INTEGER REFERENCES public.mantenimiento_conciliaciones(id),
    
    articulo_numero VARCHAR(50) NOT NULL,
    cantidad_conciliada NUMERIC(15,3) NOT NULL,
    
    -- Referencia cruzada (Opcional, si queremos atarlo a un movimiento específico de ingreso)
    -- id_movimiento_origen INTEGER REFERENCES public.mantenimiento_movimientos(id),
    
    fecha_registro TIMESTAMP DEFAULT NOW()
);

-- Índices para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_mantenimiento_conciliaciones_cliente ON public.mantenimiento_conciliaciones(id_cliente);
CREATE INDEX IF NOT EXISTS idx_mantenimiento_conciliaciones_nro ON public.mantenimiento_conciliaciones(nro_comprobante_externo);
