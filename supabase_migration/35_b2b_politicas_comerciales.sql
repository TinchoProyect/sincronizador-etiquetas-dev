-- =========================================================================
-- Migracion 35: Politicas Comerciales y Descuentos Escalonados en Portal B2B
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.clientes_b2b_politicas_comerciales (
    id SERIAL PRIMARY KEY,
    politica_id INTEGER NOT NULL UNIQUE,
    lista_id INTEGER NOT NULL,
    lista_nombre TEXT,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    tipo_calculo TEXT NOT NULL DEFAULT 'ESCALA_DIRECTA',
    aplica_sobre TEXT NOT NULL DEFAULT 'NETO',
    activo BOOLEAN NOT NULL DEFAULT true,
    tramos JSONB NOT NULL DEFAULT '[]'::jsonb,
    excepciones JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indices para consultas eficientes
CREATE INDEX IF NOT EXISTS idx_b2b_politicas_lista_id ON public.clientes_b2b_politicas_comerciales(lista_id);
CREATE INDEX IF NOT EXISTS idx_b2b_politicas_activo ON public.clientes_b2b_politicas_comerciales(activo);

-- Habilitar Row Level Security (RLS)
ALTER TABLE public.clientes_b2b_politicas_comerciales ENABLE ROW LEVEL SECURITY;

-- 1. Politica de lectura para clientes autenticados (solo politicas activas)
DROP POLICY IF EXISTS "Lectura de politicas activas para usuarios autenticados" ON public.clientes_b2b_politicas_comerciales;
CREATE POLICY "Lectura de politicas activas para usuarios autenticados" 
ON public.clientes_b2b_politicas_comerciales
FOR SELECT 
TO authenticated 
USING (activo = true);

-- 2. Politica completa para el rol de servicio / daemon sincronizador
DROP POLICY IF EXISTS "Acceso total para service_role en politicas comerciales" ON public.clientes_b2b_politicas_comerciales;
CREATE POLICY "Acceso total para service_role en politicas comerciales" 
ON public.clientes_b2b_politicas_comerciales
FOR ALL 
TO service_role 
USING (true)
WITH CHECK (true);
