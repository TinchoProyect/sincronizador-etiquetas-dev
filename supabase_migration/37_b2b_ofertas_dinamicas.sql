-- =========================================================================
-- Migración 37: Ofertas Dinámicas y Cuotas Promocionales en Portal B2B
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.clientes_b2b_ofertas_activas (
    id SERIAL PRIMARY KEY,
    oferta_id INTEGER NOT NULL UNIQUE,
    titulo TEXT NOT NULL,
    descripcion TEXT,
    unidad_cuota TEXT NOT NULL DEFAULT 'KILOS',
    cuota_total NUMERIC(12,2) NOT NULL,
    cuota_consumida NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    cuota_disponible NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    condicion_cierre TEXT NOT NULL DEFAULT 'HASTA_AGOTAR_STOCK',
    fecha_inicio TIMESTAMPTZ,
    fecha_fin TIMESTAMPTZ,
    tipo_beneficio TEXT NOT NULL DEFAULT 'PORCENTAJE',
    descuento_porcentaje NUMERIC(5,2) NOT NULL DEFAULT 5.00,
    no_acumulable_con_politica BOOLEAN NOT NULL DEFAULT true,
    activo BOOLEAN NOT NULL DEFAULT true,
    estado TEXT NOT NULL DEFAULT 'ACTIVA',
    articulos JSONB NOT NULL DEFAULT '[]'::jsonb,
    listas_ids INTEGER[] NOT NULL DEFAULT '{}',
    excepciones JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_b2b_ofertas_activo_estado ON public.clientes_b2b_ofertas_activas(activo, estado);
CREATE INDEX IF NOT EXISTS idx_b2b_ofertas_listas_ids ON public.clientes_b2b_ofertas_activas USING GIN (listas_ids);

-- Habilitar Row Level Security (RLS)
ALTER TABLE public.clientes_b2b_ofertas_activas ENABLE ROW LEVEL SECURITY;

-- 1. Política de lectura para usuarios autenticados (solo ofertas activas)
DROP POLICY IF EXISTS "Lectura de ofertas activas para usuarios autenticados" ON public.clientes_b2b_ofertas_activas;
CREATE POLICY "Lectura de ofertas activas para usuarios autenticados"
ON public.clientes_b2b_ofertas_activas
FOR SELECT
TO authenticated
USING (
    activo = true 
    AND estado = 'ACTIVA' 
    AND cuota_disponible > 0
    AND (fecha_fin IS NULL OR fecha_fin >= NOW())
);

-- 2. Política de acceso total para service_role (sincronizador local)
DROP POLICY IF EXISTS "Acceso total para service_role en ofertas activas" ON public.clientes_b2b_ofertas_activas;
CREATE POLICY "Acceso total para service_role en ofertas activas"
ON public.clientes_b2b_ofertas_activas
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
