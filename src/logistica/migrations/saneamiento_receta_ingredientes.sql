-- ====================================================================
-- MIGRACIÓN DE SANEAMIENTO: VINCULACIÓN DE INGREDIENTES HUÉRFANOS EN RECETAS
-- PROYECTO: Módulo de Stock Búnker / Finanzas shadow
-- ====================================================================
-- Objetivo: Purgar los vacíos de datos (null ingrediente_id) en la tabla
-- receta_ingredientes mapeándolos por nombre a la tabla de ingredientes core.
-- ====================================================================

BEGIN;

-- 1. Actualizar Semilla de Lino (ID: 81)
UPDATE public.receta_ingredientes
SET ingrediente_id = 81
WHERE nombre_ingrediente = 'Semilla de Lino' AND ingrediente_id IS NULL;

-- 2. Actualizar Harina de Garbanzo (ID: 48)
UPDATE public.receta_ingredientes
SET ingrediente_id = 48
WHERE nombre_ingrediente = 'Harina de Garbanzo' AND ingrediente_id IS NULL;

-- 3. Actualizar Garbanzo Lechoso (ID: 112)
UPDATE public.receta_ingredientes
SET ingrediente_id = 112
WHERE nombre_ingrediente = 'Garbanzo Lechoso' AND ingrediente_id IS NULL;

-- 4. Actualizar Nuez Cuarto Extra Light (ID: 157)
UPDATE public.receta_ingredientes
SET ingrediente_id = 157
WHERE nombre_ingrediente = 'Nuez Cuarto Extra Light' AND ingrediente_id IS NULL;

-- 5. Limpieza de datos residuales o test trash ("AAAA...")
DELETE FROM public.receta_ingredientes
WHERE nombre_ingrediente LIKE 'AAAA%' AND ingrediente_id IS NULL;

COMMIT;
