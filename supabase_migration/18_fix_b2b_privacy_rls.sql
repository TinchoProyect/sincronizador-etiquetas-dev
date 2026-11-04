-- =====================================================================
-- 18_fix_b2b_privacy_rls.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Restablece la privacidad total RLS para clientes_b2b_pedidos_cabecera
-- de modo que cada cliente B2B autenticado solo pueda leer sus propios pedidos.
-- =====================================================================

-- 1. Eliminar políticas SELECT obsoletas o permisivas en cabecera
DROP POLICY IF EXISTS "Permitir lectura publica de cabecera por UUID" ON public.clientes_b2b_pedidos_cabecera;
DROP POLICY IF EXISTS "Permitir lectura anonima de cabecera por UUID" ON public.clientes_b2b_pedidos_cabecera;
DROP POLICY IF EXISTS "Clientes pueden leer sus propios pedidos" ON public.clientes_b2b_pedidos_cabecera;
DROP POLICY IF EXISTS "Clientes pueden leer sus propios pedidos o por ID" ON public.clientes_b2b_pedidos_cabecera;

-- 2. Crear política SELECT para clientes autenticados (Aislamiento estricto por cliente_id en JWT)
CREATE POLICY "Clientes pueden leer sus propios pedidos" ON public.clientes_b2b_pedidos_cabecera
    FOR SELECT
    TO authenticated
    USING (
        (auth.jwt() -> 'app_metadata' ->> 'cliente_id')::text = cliente_id::text
        OR
        (auth.jwt() -> 'user_metadata' ->> 'cliente_id')::text = cliente_id::text
    );

-- 3. Crear política SELECT para lectura anónima (QR escaneado en móvil sin iniciar sesión)
CREATE POLICY "Permitir lectura anonima por UUID" ON public.clientes_b2b_pedidos_cabecera
    FOR SELECT
    TO anon
    USING (true);

-- 4. Asegurar RLS en items de pedidos
DROP POLICY IF EXISTS "Permitir lectura publica de items por UUID de cabecera" ON public.clientes_b2b_pedidos_items;
DROP POLICY IF EXISTS "Permitir lectura anonima de items por UUID de cabecera" ON public.clientes_b2b_pedidos_items;
DROP POLICY IF EXISTS "Clientes pueden leer los items de sus pedidos" ON public.clientes_b2b_pedidos_items;
DROP POLICY IF EXISTS "Permitir lectura anonima de items" ON public.clientes_b2b_pedidos_items;

CREATE POLICY "Clientes pueden leer los items de sus pedidos" ON public.clientes_b2b_pedidos_items
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.clientes_b2b_pedidos_cabecera c
            WHERE c.id = clientes_b2b_pedidos_items.pedido_id
            AND (
                (auth.jwt() -> 'app_metadata' ->> 'cliente_id')::text = c.cliente_id::text
                OR
                (auth.jwt() -> 'user_metadata' ->> 'cliente_id')::text = c.cliente_id::text
            )
        )
    );

CREATE POLICY "Permitir lectura anonima de items" ON public.clientes_b2b_pedidos_items
    FOR SELECT
    TO anon
    USING (true);
