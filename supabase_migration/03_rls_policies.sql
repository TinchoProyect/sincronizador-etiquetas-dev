-- =====================================================================
-- 03_rls_policies.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Políticas de Seguridad a Nivel de Fila (RLS) con soporte para Roles, Permisos y Multi-Listas
-- =====================================================================

-- =====================================================================
-- Helper para chequear si el usuario es el Dueño de la cuenta
-- =====================================================================
-- (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'

-- =====================================================================
-- Helper para chequear si el usuario tiene un permiso específico
-- =====================================================================
-- (auth.jwt() -> 'app_metadata' -> 'permisos') ? 'compras'

-- =====================================================================
-- 1. Políticas para 'clientes_b2b_perfiles'
-- =====================================================================
DROP POLICY IF EXISTS "Usuarios pueden leer perfiles de su misma empresa" ON public.clientes_b2b_perfiles;
CREATE POLICY "Usuarios pueden leer perfiles de su misma empresa" ON public.clientes_b2b_perfiles
    FOR SELECT
    TO authenticated
    USING (cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id'));

DROP POLICY IF EXISTS "Duenos pueden gestionar colaboradores de su empresa" ON public.clientes_b2b_perfiles;
CREATE POLICY "Duenos pueden gestionar colaboradores de su empresa" ON public.clientes_b2b_perfiles
    FOR ALL
    TO authenticated
    USING (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'
    );

-- =====================================================================
-- 1b. Políticas para 'clientes_b2b_perfiles_listas'
-- =====================================================================
DROP POLICY IF EXISTS "Usuarios pueden leer listas de su empresa" ON public.clientes_b2b_perfiles_listas;
CREATE POLICY "Usuarios pueden leer listas de su empresa" ON public.clientes_b2b_perfiles_listas
    FOR SELECT
    TO authenticated
    USING (cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id'));

-- =====================================================================
-- 2. Políticas para 'clientes_b2b_cuentas_corrientes' (Requiere permiso de 'pagos' o ser 'Dueno')
-- =====================================================================
DROP POLICY IF EXISTS "Clientes pueden leer su propia cuenta corriente" ON public.clientes_b2b_cuentas_corrientes;
CREATE POLICY "Clientes pueden leer su propia cuenta corriente" ON public.clientes_b2b_cuentas_corrientes
    FOR SELECT
    TO authenticated
    USING (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND (
            (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'
            OR (auth.jwt() -> 'app_metadata' -> 'permisos') ? 'pagos'
        )
    );

-- =====================================================================
-- 3. Políticas para 'clientes_b2b_pedidos_cabecera' (Requiere permiso de 'compras' o ser 'Dueno')
-- =====================================================================
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

DROP POLICY IF EXISTS "Clientes pueden crear sus propios pedidos" ON public.clientes_b2b_pedidos_cabecera;
CREATE POLICY "Clientes pueden crear sus propios pedidos" ON public.clientes_b2b_pedidos_cabecera
    FOR INSERT
    TO authenticated
    WITH CHECK (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND (
            (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'
            OR (auth.jwt() -> 'app_metadata' -> 'permisos') ? 'compras'
        )
    );

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

-- =====================================================================
-- 4. Políticas para 'clientes_b2b_pedidos_items'
-- =====================================================================
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

DROP POLICY IF EXISTS "Clientes pueden agregar items a sus pedidos en borrador" ON public.clientes_b2b_pedidos_items;
CREATE POLICY "Clientes pueden agregar items a sus pedidos en borrador" ON public.clientes_b2b_pedidos_items
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 
            FROM public.clientes_b2b_pedidos_cabecera c 
            WHERE c.id = pedido_id 
              AND c.cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
              AND (
                  (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'
                  OR (auth.jwt() -> 'app_metadata' -> 'permisos') ? 'compras'
              )
              AND c.estado = 'Borrador'
        )
    );

DROP POLICY IF EXISTS "Clientes pueden modificar items de sus pedidos en borrador" ON public.clientes_b2b_pedidos_items;
CREATE POLICY "Clientes pueden modificar items de sus pedidos en borrador" ON public.clientes_b2b_pedidos_items
    FOR UPDATE
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
              AND c.estado = 'Borrador'
        )
    );

DROP POLICY IF EXISTS "Clientes pueden eliminar items de sus pedidos en borrador" ON public.clientes_b2b_pedidos_items;
CREATE POLICY "Clientes pueden eliminar items de sus pedidos en borrador" ON public.clientes_b2b_pedidos_items
    FOR DELETE
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
              AND c.estado = 'Borrador'
        )
    );

-- =====================================================================
-- 5. Políticas para 'clientes_b2b_catalogo_precios' (Requiere compras y listas)
-- =====================================================================
DROP POLICY IF EXISTS "Clientes pueden ver articulos de sus listas asignadas" ON public.clientes_b2b_catalogo_precios;
CREATE POLICY "Clientes pueden ver articulos de sus listas asignadas" ON public.clientes_b2b_catalogo_precios
    FOR SELECT
    TO authenticated
    USING (
        (
            (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'
            OR (auth.jwt() -> 'app_metadata' -> 'permisos') ? 'compras'
        )
        AND (auth.jwt() -> 'app_metadata' -> 'listas_precios') @> jsonb_build_array(lista_id)
    );
