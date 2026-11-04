-- =====================================================================
-- 15_add_reclamos_columns.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Agregar columnas para control de novedades físicas (reclamos) y políticas RLS
-- =====================================================================

-- 1. Agregar columnas de reclamo a la cabecera de pedidos
ALTER TABLE public.clientes_b2b_pedidos_cabecera 
ADD COLUMN IF NOT EXISTS motivo_reclamo_recepcion TEXT,
ADD COLUMN IF NOT EXISTS foto_reclamo_1 TEXT,
ADD COLUMN IF NOT EXISTS foto_reclamo_2 TEXT,
ADD COLUMN IF NOT EXISTS comentarios_recepcion TEXT,
ADD COLUMN IF NOT EXISTS reclamado_fecha TIMESTAMPTZ;

-- 2. Agregar columnas de novedades a los ítems del pedido
ALTER TABLE public.clientes_b2b_pedidos_items
ADD COLUMN IF NOT EXISTS cantidad_recibida NUMERIC(12, 2),
ADD COLUMN IF NOT EXISTS motivo_incidencia TEXT,
ADD COLUMN IF NOT EXISTS comentarios TEXT;

-- 3. Habilitar políticas RLS para permitir que clientes anónimos y autenticados actualicen ítems de pedidos
DROP POLICY IF EXISTS "Permitir actualizacion anonima de items por UUID" ON public.clientes_b2b_pedidos_items;
CREATE POLICY "Permitir actualizacion anonima de items por UUID" ON public.clientes_b2b_pedidos_items
    FOR UPDATE
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);
