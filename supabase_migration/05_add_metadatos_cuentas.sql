-- =====================================================================
-- 05_add_metadatos_cuentas.sql
-- Agrega la columna 'metadatos' para almacenar la forma de cobro en Supabase
-- =====================================================================

ALTER TABLE public.clientes_b2b_cuentas_corrientes 
ADD COLUMN IF NOT EXISTS metadatos JSONB DEFAULT NULL;
