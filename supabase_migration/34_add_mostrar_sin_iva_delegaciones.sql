-- =========================================================================
-- Migración 34: Modalidad de IVA para Enlaces de Delegación en Portal B2B
-- =========================================================================

-- Agregar columna mostrar_sin_iva a clientes_b2b_delegaciones (por defecto false = Con IVA Incluido)
ALTER TABLE public.clientes_b2b_delegaciones 
ADD COLUMN IF NOT EXISTS mostrar_sin_iva BOOLEAN NOT NULL DEFAULT false;
