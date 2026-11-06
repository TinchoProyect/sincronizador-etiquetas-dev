-- ============================================================================
-- MIGRACIÓN 42 — MICRO-ETAPA 1 (CLOUD 24/7):
-- 1. Persistencia Dual del Ticket de Acceso ARCA/AFIP (public.factura_afip_ta)
--    con soporte para reconstrucción íntegra de archivo TA-*.json (@afipsdk/afip.js)
-- 2. Auditoría de Presencia Física de Estación Galpón en public.zebra_print_queue
--    y estado del Agente en public.zebra_bridge_status
-- ============================================================================

BEGIN;

-- 1. Asegurar tabla public.factura_afip_ta y extenderla con el JSON crudo del TA
CREATE TABLE IF NOT EXISTS public.factura_afip_ta (
    id BIGSERIAL PRIMARY KEY,
    entorno VARCHAR(20) NOT NULL,
    servicio VARCHAR(50) NOT NULL DEFAULT 'wsfe',
    token TEXT NOT NULL,
    sign TEXT NOT NULL,
    expira_en TIMESTAMPTZ NOT NULL,
    creado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS factura_afip_ta_entorno_servicio_key
    ON public.factura_afip_ta (entorno, servicio);

ALTER TABLE public.factura_afip_ta
    ADD COLUMN IF NOT EXISTS cuit VARCHAR(20) DEFAULT '23248921749',
    ADD COLUMN IF NOT EXISTS ta_raw_json JSONB,
    ADD COLUMN IF NOT EXISTS origen_host VARCHAR(120),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Asegurar tabla public.zebra_print_queue y columnas de trazabilidad de estación física
CREATE TABLE IF NOT EXISTS public.zebra_print_queue (
    id SERIAL PRIMARY KEY,
    tipo_etiqueta VARCHAR(80) NOT NULL DEFAULT 'ETIQUETA_ZPL',
    descripcion TEXT,
    zpl_payload TEXT NOT NULL,
    nombre_impresora VARCHAR(80) NOT NULL DEFAULT 'Zebra',
    estado VARCHAR(50) NOT NULL DEFAULT 'PENDIENTE_CONFIRMACION_GALPON',
    origen_entorno VARCHAR(80) DEFAULT 'local',
    error_detalle TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    printed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_zebra_print_queue_estado
    ON public.zebra_print_queue (estado, created_at DESC);

ALTER TABLE public.zebra_print_queue
    ADD COLUMN IF NOT EXISTS estacion_fisica_verificada BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS dispositivo_origen VARCHAR(120);

-- 3. Tabla de estado del Agente Local de Impresión Zebra (PcAlmacen)
CREATE TABLE IF NOT EXISTS public.zebra_bridge_status (
    station_id VARCHAR(80) PRIMARY KEY,
    last_heartbeat_at TIMESTAMPTZ DEFAULT NOW(),
    printer_name VARCHAR(80) DEFAULT 'Zebra',
    printer_online BOOLEAN DEFAULT TRUE,
    hostname VARCHAR(120),
    local_loopback_port INTEGER DEFAULT 3099,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMIT;
