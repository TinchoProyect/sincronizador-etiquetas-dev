-- =====================================================================
-- 16_add_chofer_delivery_columns.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Agregar columnas para registrar por separado la entrega del chofer
-- =====================================================================

ALTER TABLE public.clientes_b2b_pedidos_cabecera 
ADD COLUMN IF NOT EXISTS entregado_chofer_nombre TEXT,
ADD COLUMN IF NOT EXISTS entregado_chofer_fecha TIMESTAMPTZ;
