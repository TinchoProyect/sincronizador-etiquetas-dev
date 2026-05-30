-- ==============================================================================
-- TICKET #074: Migración DDL - Apertura de Cajas y Trazabilidad de Lotes
-- Motor: PostgreSQL
-- Uso: Añade columna cantidad_abierta a bunker_lotes_destinos e inicializa históricos.
-- ==============================================================================

BEGIN;

-- 1. Agregar columna cantidad_abierta en la tabla de asignaciones bunker_lotes_destinos
ALTER TABLE public.bunker_lotes_destinos 
ADD COLUMN IF NOT EXISTS cantidad_abierta NUMERIC DEFAULT 0;

-- 2. Inicializar filas previas con 0
UPDATE public.bunker_lotes_destinos 
SET cantidad_abierta = 0 
WHERE cantidad_abierta IS NULL;

COMMIT;
