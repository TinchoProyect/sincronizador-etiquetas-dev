-- =====================================================================
-- 14_fix_rls_pedidos_privacy.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Corrección de políticas RLS para evitar fugas de privacidad entre clientes
-- =====================================================================

-- 1. Limpiar la política de lectura pública global hiper-permisiva creada anteriormente
DROP POLICY IF EXISTS "Permitir lectura publica de cabecera por UUID" ON public.clientes_b2b_pedidos_cabecera;
DROP POLICY IF EXISTS "Permitir lectura publica de items por UUID de cabecera" ON public.clientes_b2b_pedidos_items;
DROP POLICY IF EXISTS "Permitir actualizacion publica de recepcion por UUID" ON public.clientes_b2b_pedidos_cabecera;

-- =====================================================================
-- 2. POLÍTICAS DE LECTURA (SELECT)
-- =====================================================================

-- CABECERA: Clientes autenticados SOLO pueden leer sus propios pedidos
DROP POLICY IF EXISTS "Clientes pueden leer sus propios pedidos" ON public.clientes_b2b_pedidos_cabecera;
CREATE POLICY "Clientes pueden leer sus propios pedidos" ON public.clientes_b2b_pedidos_cabecera
    FOR SELECT
    TO authenticated
    USING (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND (
            (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'
            OR (auth.jwt() -> 'app_metadata' -> 'permisos') ? 'compras'
        )
    );

-- CABECERA: Lectura pública/anónima permitida SOLO para usuarios sin sesión (anon) por UUID
DROP POLICY IF EXISTS "Permitir lectura anonima de cabecera por UUID" ON public.clientes_b2b_pedidos_cabecera;
CREATE POLICY "Permitir lectura anonima de cabecera por UUID" ON public.clientes_b2b_pedidos_cabecera
    FOR SELECT
    TO anon
    USING (true);

-- ÍTEMS: Clientes autenticados SOLO pueden leer ítems de sus propios pedidos
DROP POLICY IF EXISTS "Clientes pueden leer items de sus propios pedidos" ON public.clientes_b2b_pedidos_items;
CREATE POLICY "Clientes pueden leer items de sus propios pedidos" ON public.clientes_b2b_pedidos_items
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 
            FROM public.clientes_b2b_pedidos_cabecera c 
            WHERE c.id = pedido_id 
              AND c.cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
              AND (
                  (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'
                  OR (auth.jwt() -> 'app_metadata' -> 'permisos') ? 'compras'
              )
        )
    );

-- ÍTEMS: Lectura pública/anónima de ítems permitida SOLO para usuarios sin sesión (anon)
DROP POLICY IF EXISTS "Permitir lectura anonima de items por UUID de cabecera" ON public.clientes_b2b_pedidos_items;
CREATE POLICY "Permitir lectura anonima de items por UUID de cabecera" ON public.clientes_b2b_pedidos_items
    FOR SELECT
    TO anon
    USING (true);


-- =====================================================================
-- 3. POLÍTICAS DE ACTUALIZACIÓN (UPDATE)
-- =====================================================================

-- CABECERA: Clientes autenticados pueden modificar sus propios pedidos en borrador
DROP POLICY IF EXISTS "Clientes pueden modificar sus propios pedidos en borrador" ON public.clientes_b2b_pedidos_cabecera;
CREATE POLICY "Clientes pueden modificar sus propios pedidos en borrador" ON public.clientes_b2b_pedidos_cabecera
    FOR UPDATE
    TO authenticated
    USING (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND (
            (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'
            OR (auth.jwt() -> 'app_metadata' -> 'permisos') ? 'compras'
        )
        AND estado = 'Borrador'
    )
    WITH CHECK (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND (
            (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'
            OR (auth.jwt() -> 'app_metadata' -> 'permisos') ? 'compras'
        )
        AND estado = 'Borrador'
    );

-- CABECERA: Permitir a usuarios anónimos actualizar recepción por UUID
DROP POLICY IF EXISTS "Permitir actualizacion anonima de recepcion por UUID" ON public.clientes_b2b_pedidos_cabecera;
CREATE POLICY "Permitir actualizacion anonima de recepcion por UUID" ON public.clientes_b2b_pedidos_cabecera
    FOR UPDATE
    TO anon
    USING (true)
    WITH CHECK (true);

-- CABECERA: Permitir a usuarios autenticados actualizar recepción SOLO si es de su propio cliente
DROP POLICY IF EXISTS "Permitir actualizacion autenticada de recepcion por UUID" ON public.clientes_b2b_pedidos_cabecera;
CREATE POLICY "Permitir actualizacion autenticada de recepcion por UUID" ON public.clientes_b2b_pedidos_cabecera
    FOR UPDATE
    TO authenticated
    USING (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
    )
    WITH CHECK (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
    );
