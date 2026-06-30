-- =====================================================================
-- 09_add_busqueda_metadata.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Agregar columna busqueda_metadata a la tabla clientes_b2b_catalogo_precios
-- =====================================================================

ALTER TABLE public.clientes_b2b_catalogo_precios ADD COLUMN IF NOT EXISTS busqueda_metadata TEXT;
