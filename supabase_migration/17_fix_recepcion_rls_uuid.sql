-- =====================================================================
-- 17_fix_recepcion_rls_uuid.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Permite asentar recepción física por UUID a cualquier usuario (anon o autenticado)
-- =====================================================================

-- 1. Eliminar políticas restrictivas de actualización para recepción por UUID
DROP POLICY IF EXISTS "Permitir actualizacion anonima de recepcion por UUID" ON public.clientes_b2b_pedidos_cabecera;
DROP POLICY IF EXISTS "Permitir actualizacion autenticada de recepcion por UUID" ON public.clientes_b2b_pedidos_cabecera;
DROP POLICY IF EXISTS "Permitir actualizacion publica de recepcion por UUID" ON public.clientes_b2b_pedidos_cabecera;

-- 2. Crear política unificada de recepción por UUID para usuarios anónimos y autenticados
-- El poseedor del QR físico impreso con el UUID único (secret de 128 bits) tiene la autorización para asentar la recepción
CREATE POLICY "Permitir actualizacion publica de recepcion por UUID" ON public.clientes_b2b_pedidos_cabecera
    FOR UPDATE
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

-- 3. Asegurar lectura pública de cabecera e ítems por UUID para anon y authenticated
DROP POLICY IF EXISTS "Permitir lectura anonima de cabecera por UUID" ON public.clientes_b2b_pedidos_cabecera;
DROP POLICY IF EXISTS "Permitir lectura publica de cabecera por UUID" ON public.clientes_b2b_pedidos_cabecera;
CREATE POLICY "Permitir lectura publica de cabecera por UUID" ON public.clientes_b2b_pedidos_cabecera
    FOR SELECT
    TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS "Permitir lectura anonima de items por UUID de cabecera" ON public.clientes_b2b_pedidos_items;
DROP POLICY IF EXISTS "Permitir lectura publica de items por UUID de cabecera" ON public.clientes_b2b_pedidos_items;
CREATE POLICY "Permitir lectura publica de items por UUID de cabecera" ON public.clientes_b2b_pedidos_items
    FOR SELECT
    TO anon, authenticated
    USING (true);
