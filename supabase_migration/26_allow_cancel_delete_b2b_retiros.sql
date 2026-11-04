-- =====================================================================
-- 26_allow_cancel_delete_b2b_retiros.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Permite a los clientes anular/cancelar o eliminar sus propios retiros pendientes
-- =====================================================================

-- 1. Actualizar Política de UPDATE para permitir estado_logistico = 'CANCELADO'
DROP POLICY IF EXISTS "Clientes pueden completar el checkin de sus retiros" ON public.clientes_b2b_retiros;
CREATE POLICY "Clientes pueden completar el checkin de sus retiros" ON public.clientes_b2b_retiros
    FOR UPDATE
    TO authenticated
    USING (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND estado_logistico IN ('PENDIENTE_CLIENTE', 'PENDIENTE_VALIDACION')
    )
    WITH CHECK (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND estado_logistico IN ('PENDIENTE_CLIENTE', 'PENDIENTE_VALIDACION', 'CANCELADO')
    );

-- 2. Política de DELETE (Opcional: permitir al cliente eliminar físicamente retiros en PENDIENTE_CLIENTE)
DROP POLICY IF EXISTS "Clientes pueden eliminar sus retiros pendientes" ON public.clientes_b2b_retiros;
CREATE POLICY "Clientes pueden eliminar sus retiros pendientes" ON public.clientes_b2b_retiros
    FOR DELETE
    TO authenticated
    USING (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND estado_logistico IN ('PENDIENTE_CLIENTE', 'PENDIENTE_VALIDACION', 'CANCELADO')
    );
