-- =========================================================================
-- SCRIPT DDL: 04_bunker_taxonomia.sql
-- OBJETIVO: Implementación de la Taxonomía Dinámica (Rubro/Subrubros)
-- PROTOCOLO: ESTRICTO (Debe ser ejecutado en ambos entornos manualmente)
--
-- ENTORNOS OBJETIVO: 
-- 1. Base 'etiquetas' (Producción)
-- 2. Base 'etiquetas_pruebas' (Staging)
-- =========================================================================

BEGIN;

-- 1. Creación de la Tabla Principal (Rubros Búnker)
CREATE TABLE IF NOT EXISTS public.bunker_rubros (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE
);

-- 2. Creación de la Tabla Hija (Subrubros Búnker) enlazada
CREATE TABLE IF NOT EXISTS public.bunker_subrubros (
    id SERIAL PRIMARY KEY,
    rubro_id INTEGER NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    CONSTRAINT fk_rubro
      FOREIGN KEY(rubro_id) 
	  REFERENCES public.bunker_rubros(id)
	  ON DELETE CASCADE,
    UNIQUE(rubro_id, nombre)
);

-- 3. Índices de Búsqueda
CREATE INDEX IF NOT EXISTS idx_bunker_rubro_nombre ON public.bunker_rubros(nombre);
CREATE INDEX IF NOT EXISTS idx_bunker_subrubro_nombre ON public.bunker_subrubros(nombre);

COMMIT;

-- Query de Verificación:
-- SELECT r.nombre as rubro, s.nombre as subrubro 
-- FROM public.bunker_rubros r 
-- LEFT JOIN public.bunker_subrubros s ON r.id = s.rubro_id;
