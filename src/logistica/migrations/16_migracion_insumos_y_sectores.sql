-- ==============================================================================
-- TICKET: Migración de DDL - Integración de Insumos (Iteración 11)
-- Motor: PostgreSQL
-- Uso: Agrega la columna es_insumo a la tabla ingredientes y remueve tablas huérfanas.
-- ==============================================================================

BEGIN;

-- 1. Agregar columna es_insumo a la tabla ingredientes si no existe
ALTER TABLE public.ingredientes 
ADD COLUMN IF NOT EXISTS es_insumo BOOLEAN DEFAULT FALSE;

-- 2. Eliminar físicamente las tablas obsoletas/huérfanas
DROP TABLE IF EXISTS public.receta_insumos CASCADE;
DROP TABLE IF EXISTS public.insumos CASCADE;

COMMIT;
