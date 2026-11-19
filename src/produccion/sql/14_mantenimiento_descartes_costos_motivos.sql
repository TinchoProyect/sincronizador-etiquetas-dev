-- Catálogo estandarizado de motivos de descarte y valorización a costo de descartes en Mantenimiento
CREATE TABLE IF NOT EXISTS public.mantenimiento_motivos_descarte (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(120) NOT NULL,
    nombre_normalizado VARCHAR(120) NOT NULL UNIQUE,
    veces_usado INTEGER NOT NULL DEFAULT 0,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.mantenimiento_motivos_descarte (nombre, nombre_normalizado, veces_usado, activo)
VALUES
    ('Deformación y aplastamiento', 'deformacion y aplastamiento', 0, TRUE),
    ('Vencimiento / Fecha pasada', 'vencimiento / fecha pasada', 0, TRUE),
    ('Envase roto / abierto', 'envase roto / abierto', 0, TRUE),
    ('Humedad / Hongos', 'humedad / hongos', 0, TRUE),
    ('Plaga / Contaminación', 'plaga / contaminacion', 0, TRUE)
ON CONFLICT (nombre_normalizado) DO NOTHING;

ALTER TABLE public.mantenimiento_movimientos
    ADD COLUMN IF NOT EXISTS motivo_descarte_id INTEGER REFERENCES public.mantenimiento_motivos_descarte(id),
    ADD COLUMN IF NOT EXISTS costo_unitario_snapshot NUMERIC(14, 2),
    ADD COLUMN IF NOT EXISTS costo_total_descarte NUMERIC(14, 2),
    ADD COLUMN IF NOT EXISTS costo_fuente VARCHAR(40);
