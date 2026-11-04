-- ==============================================================================
-- Migración 23: Incorporación de alícuotas de IVA y toggle condicional por lista
-- ==============================================================================

-- 1. Campos de IVA y precios netos en catálogo
ALTER TABLE public.clientes_b2b_catalogo_precios 
ADD COLUMN IF NOT EXISTS iva_porcentaje NUMERIC(5, 2) DEFAULT 21.00,
ADD COLUMN IF NOT EXISTS precio_neto NUMERIC(15, 2),
ADD COLUMN IF NOT EXISTS precio_kilo_neto NUMERIC(15, 2);

-- 2. Indicador de toggle de IVA en listas asignadas al cliente
ALTER TABLE public.clientes_b2b_perfiles_listas 
ADD COLUMN IF NOT EXISTS permitir_toggle_iva BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_b2b_catalogo_iva_porcentaje 
ON public.clientes_b2b_catalogo_precios (iva_porcentaje);
