-- ==============================================================================
-- Migración 22: Incorporación de kilos_unidad y precio_kilo en Catálogo B2B
-- ==============================================================================

ALTER TABLE public.clientes_b2b_catalogo_precios 
ADD COLUMN IF NOT EXISTS kilos_unidad NUMERIC(10, 3) DEFAULT 1.0,
ADD COLUMN IF NOT EXISTS precio_kilo NUMERIC(15, 2);

CREATE INDEX IF NOT EXISTS idx_b2b_catalogo_kilos_unidad 
ON public.clientes_b2b_catalogo_precios (kilos_unidad);
