-- Migración 12: Métricas de Producción Temporal (3 Etapas + Prorrateo Justo)
-- Sistema LAMDA

-- 1. Asegurar columnas de métricas y pausas en carros_produccion
ALTER TABLE public.carros_produccion
    ADD COLUMN IF NOT EXISTS modo_medicion BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS tiempo_pausa_ms BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS medicion_pausada BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS medicion_pausada_inicio TIMESTAMP WITHOUT TIME ZONE DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS medicion_etapa_actual INTEGER DEFAULT 0;

-- 2. Asegurar columnas de etapas en carros_produccion (por si no estuvieran presentes en alguna instancia)
ALTER TABLE public.carros_produccion
    ADD COLUMN IF NOT EXISTS etapa1_inicio TIMESTAMP WITHOUT TIME ZONE DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS etapa1_fin TIMESTAMP WITHOUT TIME ZONE DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS etapa1_duracion_ms BIGINT DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS etapa2_inicio TIMESTAMP WITHOUT TIME ZONE DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS etapa2_fin TIMESTAMP WITHOUT TIME ZONE DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS etapa2_duracion_ms BIGINT DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS etapa3_inicio TIMESTAMP WITHOUT TIME ZONE DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS etapa3_fin TIMESTAMP WITHOUT TIME ZONE DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS etapa3_duracion_ms BIGINT DEFAULT NULL;

-- 3. Tabla histórica de métricas por artículo (Prorrateo Justo)
CREATE TABLE IF NOT EXISTS public.produccion_metricas_articulos (
    id SERIAL PRIMARY KEY,
    carro_id INTEGER NOT NULL REFERENCES public.carros_produccion(id) ON DELETE CASCADE,
    usuario_id INTEGER REFERENCES public.usuarios(id) ON DELETE SET NULL,
    usuario_nombre VARCHAR(255),
    articulo_numero VARCHAR(50) NOT NULL,
    descripcion TEXT,
    unidades_producidas NUMERIC(12, 2) NOT NULL DEFAULT 1,
    minutos_etapa1_unitario NUMERIC(10, 4) DEFAULT 0,
    minutos_etapa2_unitario NUMERIC(10, 4) DEFAULT 0,
    minutos_etapa3_unitario NUMERIC(10, 4) DEFAULT 0,
    minutos_unitarios_total NUMERIC(10, 4) NOT NULL DEFAULT 0,
    duracion_etapa1_ms BIGINT DEFAULT 0,
    duracion_etapa2_ms BIGINT DEFAULT 0,
    duracion_etapa3_ms BIGINT DEFAULT 0,
    duracion_pausa_carro_ms BIGINT DEFAULT 0,
    duracion_total_carro_ms BIGINT NOT NULL DEFAULT 0,
    fecha_medicion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Índices de consulta rápida
CREATE INDEX IF NOT EXISTS idx_pma_articulo_numero ON public.produccion_metricas_articulos(articulo_numero);
CREATE INDEX IF NOT EXISTS idx_pma_carro_id ON public.produccion_metricas_articulos(carro_id);
CREATE INDEX IF NOT EXISTS idx_pma_fecha ON public.produccion_metricas_articulos(fecha_medicion DESC);
