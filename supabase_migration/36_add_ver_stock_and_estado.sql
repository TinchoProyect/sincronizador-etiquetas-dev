-- =========================================================================
-- Migración 36: Visualización de Stock y Estados en Portal B2B
-- =========================================================================

-- 1. Agregar columna ver_stock a perfiles B2B (por defecto false)
ALTER TABLE public.clientes_b2b_perfiles 
ADD COLUMN IF NOT EXISTS ver_stock BOOLEAN DEFAULT FALSE;

-- 2. Agregar columna stock_estado al catálogo B2B (disponible, requiere_produccion, sin_stock)
ALTER TABLE public.clientes_b2b_catalogo_precios 
ADD COLUMN IF NOT EXISTS stock_estado VARCHAR(30) DEFAULT 'disponible';

-- Índice para acelerar consultas filtradas o agrupadas
CREATE INDEX IF NOT EXISTS idx_b2b_catalogo_stock_estado 
ON public.clientes_b2b_catalogo_precios (stock_estado);
