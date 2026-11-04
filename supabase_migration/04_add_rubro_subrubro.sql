-- =====================================================================
-- 04_add_rubro_subrubro.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Agregar columnas rubro y sub_rubro a la tabla clientes_b2b_catalogo_precios
-- =====================================================================

ALTER TABLE public.clientes_b2b_catalogo_precios
ADD COLUMN IF NOT EXISTS rubro TEXT,
ADD COLUMN IF NOT EXISTS sub_rubro TEXT;
