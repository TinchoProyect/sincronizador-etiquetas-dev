-- 14. Agregar columna de disponibilidad en catálogo comercial a public.bunker_lista_articulos
ALTER TABLE public.bunker_lista_articulos 
ADD COLUMN IF NOT EXISTS disponible BOOLEAN DEFAULT TRUE;
