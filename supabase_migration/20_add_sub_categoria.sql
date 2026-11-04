-- ==============================================================================
-- Migración 20: Incorporación de Nivel 3 (sub_categoria) en Catálogo B2B
-- ==============================================================================

ALTER TABLE public.clientes_b2b_catalogo_precios 
ADD COLUMN IF NOT EXISTS sub_categoria TEXT;

CREATE INDEX IF NOT EXISTS idx_b2b_catalogo_sub_categoria 
ON public.clientes_b2b_catalogo_precios (sub_categoria);
