-- =====================================================================
-- 27_allow_anon_checkin_by_hash.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Permite a colaboradores anónimos (sin sesión) completar el check-in
-- de un retiro si cuentan con el codigo_qr_hash criptográfico válido.
-- =====================================================================

-- 1. Política de Lectura Anónima para Retiros por Hash Criptográfico
DROP POLICY IF EXISTS "Acceso anonimo para checkin publico por hash" ON public.clientes_b2b_retiros;
CREATE POLICY "Acceso anonimo para checkin publico por hash" ON public.clientes_b2b_retiros
    FOR SELECT
    TO anon
    USING (
        codigo_qr_hash IS NOT NULL 
        AND estado_logistico IN ('PENDIENTE_CLIENTE', 'PENDIENTE_VALIDACION')
    );

-- 2. Política de Modificación Anónima para Check-in por Hash Criptográfico
DROP POLICY IF EXISTS "Actualizacion anonima para checkin publico por hash" ON public.clientes_b2b_retiros;
CREATE POLICY "Actualizacion anonima para checkin publico por hash" ON public.clientes_b2b_retiros
    FOR UPDATE
    TO anon
    USING (
        codigo_qr_hash IS NOT NULL 
        AND estado_logistico IN ('PENDIENTE_CLIENTE', 'PENDIENTE_VALIDACION')
    )
    WITH CHECK (
        estado_logistico IN ('PENDIENTE_CLIENTE', 'PENDIENTE_VALIDACION')
    );

-- 3. Política de Lectura Anónima para Catálogo de Productos (Búsqueda de Artículos)
DROP POLICY IF EXISTS "Acceso anonimo para busqueda en catalogo" ON public.clientes_b2b_catalogo_precios;
CREATE POLICY "Acceso anonimo para busqueda en catalogo" ON public.clientes_b2b_catalogo_precios
    FOR SELECT
    TO anon
    USING (true);
