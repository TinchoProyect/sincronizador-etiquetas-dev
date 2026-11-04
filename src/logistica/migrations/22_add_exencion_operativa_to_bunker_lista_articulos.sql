-- Migración 22: Agregar columna exencion_operativa a bunker_lista_articulos
ALTER TABLE public.bunker_lista_articulos 
ADD COLUMN IF NOT EXISTS exencion_operativa BOOLEAN NOT NULL DEFAULT false;
