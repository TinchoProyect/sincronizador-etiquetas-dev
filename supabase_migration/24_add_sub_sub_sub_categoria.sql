-- ==============================================================================
-- Migración 24: Incorporación de sub_sub_sub_categoria (Nivel 5) en Catálogo B2B
-- ==============================================================================

ALTER TABLE public.clientes_b2b_catalogo_precios 
ADD COLUMN IF NOT EXISTS sub_sub_sub_categoria TEXT;

CREATE INDEX IF NOT EXISTS idx_b2b_catalogo_sub_sub_sub_categoria 
ON public.clientes_b2b_catalogo_precios (sub_sub_sub_categoria);
