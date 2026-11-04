-- =====================================================================
-- 13_add_recepcion_columns_pedidos.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Agregar columnas para control de recepción física y políticas RLS públicas
-- =====================================================================

-- 1. Agregar columnas de recepción a la tabla de cabecera de pedidos
ALTER TABLE public.clientes_b2b_pedidos_cabecera 
ADD COLUMN IF NOT EXISTS recibido_por_nombre TEXT,
ADD COLUMN IF NOT EXISTS recibido_por_apellido TEXT,
ADD COLUMN IF NOT EXISTS recibido_por_telefono TEXT,
ADD COLUMN IF NOT EXISTS recibido_fecha TIMESTAMPTZ;

-- 2. Asegurarse de que el RLS esté activo
ALTER TABLE public.clientes_b2b_pedidos_cabecera ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes_b2b_pedidos_items ENABLE ROW LEVEL SECURITY;

-- 3. Políticas RLS para lectura y actualización anónima/pública por UUID
-- Permitir seleccionar un pedido específico si se conoce su UUID
DROP POLICY IF EXISTS "Permitir lectura publica de cabecera por UUID" ON public.clientes_b2b_pedidos_cabecera;
CREATE POLICY "Permitir lectura publica de cabecera por UUID" ON public.clientes_b2b_pedidos_cabecera
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- Permitir seleccionar los ítems de un pedido específico si se conoce su UUID
DROP POLICY IF EXISTS "Permitir lectura publica de items por UUID de cabecera" ON public.clientes_b2b_pedidos_items;
CREATE POLICY "Permitir lectura publica de items por UUID de cabecera" ON public.clientes_b2b_pedidos_items
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- Permitir a usuarios anónimos o autenticados actualizar los campos de recepción de un pedido
DROP POLICY IF EXISTS "Permitir actualizacion publica de recepcion por UUID" ON public.clientes_b2b_pedidos_cabecera;
CREATE POLICY "Permitir actualizacion publica de recepcion por UUID" ON public.clientes_b2b_pedidos_cabecera
    FOR UPDATE
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);
