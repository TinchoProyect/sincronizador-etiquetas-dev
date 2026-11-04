-- Migración 33: Incorporación de columna updated_at en tabla bunker_articulos
-- Permite registrar timestamps de actualización para sincronización y actualización de costos/precios base.

ALTER TABLE public.bunker_articulos 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

COMMENT ON COLUMN public.bunker_articulos.updated_at IS 'Fecha y hora de última modificación del registro del artículo en Búnker.';
