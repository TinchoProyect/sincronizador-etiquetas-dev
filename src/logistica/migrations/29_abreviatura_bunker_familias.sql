-- Migración 29: Extensión de tabla bunker_familias para Abreviatura de Familia (Nomenclador Búnker)
ALTER TABLE public.bunker_familias 
ADD COLUMN IF NOT EXISTS abreviatura VARCHAR(50) DEFAULT NULL;
