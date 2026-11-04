-- =====================================================================
-- 25_allow_update_b2b_retiros.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Permite la edición continua del Check-in por parte del cliente
-- mientras el retiro no haya sido validado/retirado por el chofer.
-- =====================================================================

-- Reemplazar política de UPDATE para permitir modificación continua
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
        AND estado_logistico = 'PENDIENTE_VALIDACION'
    );
