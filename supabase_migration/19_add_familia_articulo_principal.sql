-- =====================================================================
-- 19_add_familia_articulo_principal.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Objetivo: Agregar columnas de taxonomía jerárquica (Familia y Atributo Principal)
--           a la tabla de catálogo de precios de clientes B2B.
-- =====================================================================

-- 1. Agregar columnas para la jerarquía del Nomenclador Búnker
ALTER TABLE public.clientes_b2b_catalogo_precios 
ADD COLUMN IF NOT EXISTS familia TEXT,
ADD COLUMN IF NOT EXISTS articulo_principal TEXT;

-- 2. Crear índices para optimización de consultas agrupadas por familia y atributo
CREATE INDEX IF NOT EXISTS idx_b2b_catalogo_familia ON public.clientes_b2b_catalogo_precios(familia);
CREATE INDEX IF NOT EXISTS idx_b2b_catalogo_art_principal ON public.clientes_b2b_catalogo_precios(articulo_principal);
