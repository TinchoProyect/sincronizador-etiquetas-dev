-- Migración: Tabla de Historial de Cambios de Precios y Notificaciones a Clientes
CREATE TABLE IF NOT EXISTS public.bunker_historial_cambios_precios (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    articulo_numero VARCHAR(100) NOT NULL,
    codigo_barras VARCHAR(100),
    descripcion VARCHAR(255),
    kilos_unidad NUMERIC(10,2) DEFAULT 1,
    lista_id INTEGER NOT NULL,
    lista_nombre VARCHAR(100),
    costo_anterior NUMERIC(14,4),
    costo_nuevo NUMERIC(14,4),
    precio_anterior NUMERIC(14,4),
    precio_nuevo NUMERIC(14,4),
    variacion_monto NUMERIC(14,4),
    variacion_porcentaje NUMERIC(8,2),
    porcentaje_iva NUMERIC(6,2),
    origen_cambio VARCHAR(50), -- 'CONCILIACION_IA', 'APLICAR_LISTAS', 'PROPAGACION_FRACCIONES'
    usuario VARCHAR(100),
    estado_notificacion VARCHAR(50) DEFAULT 'PENDIENTE'
);

CREATE INDEX IF NOT EXISTS idx_historial_cambios_art ON public.bunker_historial_cambios_precios(articulo_numero);
CREATE INDEX IF NOT EXISTS idx_historial_cambios_barra ON public.bunker_historial_cambios_precios(codigo_barras);
CREATE INDEX IF NOT EXISTS idx_historial_cambios_fecha ON public.bunker_historial_cambios_precios(created_at);

-- Tabla de seguimiento de notificaciones a clientes afectados
CREATE TABLE IF NOT EXISTS public.bunker_notificaciones_cambios_clientes (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    historial_cambio_id INTEGER REFERENCES public.bunker_historial_cambios_precios(id) ON DELETE CASCADE,
    articulo_numero VARCHAR(100) NOT NULL,
    cliente_id INTEGER,
    codigo_bunker_cliente VARCHAR(100),
    cliente_nombre VARCHAR(255),
    estado VARCHAR(50) DEFAULT 'PENDIENTE', -- 'PENDIENTE', 'NOTIFICADO', 'OMITIDO'
    canal VARCHAR(50), -- 'WHATSAPP', 'EMAIL', 'LLAMADA', 'PORTAL_B2B'
    notificado_at TIMESTAMP WITH TIME ZONE,
    notas TEXT,
    CONSTRAINT unq_cambio_cliente UNIQUE(historial_cambio_id, cliente_id)
);

CREATE INDEX IF NOT EXISTS idx_notif_cliente ON public.bunker_notificaciones_cambios_clientes(cliente_id);
CREATE INDEX IF NOT EXISTS idx_notif_art ON public.bunker_notificaciones_cambios_clientes(articulo_numero);
