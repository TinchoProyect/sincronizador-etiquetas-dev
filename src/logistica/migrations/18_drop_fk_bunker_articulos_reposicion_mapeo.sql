-- Migración 18: Eliminación de restricción de clave foránea en la tabla de mapeo de reposición
-- Esto permite que ingredientes que no están en el Búnker puedan vincularse directamente a ofertas de reposición.
ALTER TABLE public.bunker_articulos_reposicion_mapeo 
DROP CONSTRAINT IF EXISTS bunker_articulos_reposicion_mapeo_bunker_articulo_id_fkey;
