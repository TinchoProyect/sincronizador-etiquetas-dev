-- Migración 37: Creación de tabla de Inspección Visual de Partidas por Lote (Depósito Móvil -> Portal B2B)
-- Soporta ciclo de vida dinámico por lote/stock y extensión opcional a derivados de Línea 2.

CREATE TABLE IF NOT EXISTS public.bunker_articulos_fotos_lote (
    id SERIAL PRIMARY KEY,
    articulo_id VARCHAR(100) NOT NULL UNIQUE,
    vinculo_lote_id VARCHAR(150) DEFAULT NULL,
    lote_id_supabase VARCHAR(150) DEFAULT NULL,
    lote_codigo_corto VARCHAR(50) DEFAULT NULL,
    imagenes JSONB NOT NULL DEFAULT '[]'::jsonb,
    observacion_tecnica VARCHAR(300) DEFAULT NULL,
    extender_a_derivados BOOLEAN NOT NULL DEFAULT FALSE,
    es_permanente BOOLEAN NOT NULL DEFAULT FALSE,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    motivo_baja VARCHAR(100) DEFAULT NULL,
    usuario_captura VARCHAR(100) DEFAULT 'depósito',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.bunker_articulos_fotos_lote
    ALTER COLUMN vinculo_lote_id TYPE VARCHAR(150) USING vinculo_lote_id::text;

CREATE INDEX IF NOT EXISTS idx_bunker_fotos_lote_articulo_activo
ON public.bunker_articulos_fotos_lote (articulo_id, activo);
