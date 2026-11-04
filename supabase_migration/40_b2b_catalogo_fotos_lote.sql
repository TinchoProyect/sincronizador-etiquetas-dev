-- =========================================================================
-- 40_b2b_catalogo_fotos_lote.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Inspección Visual de Partidas en Depósito (Fotos Dinámicas por Lote)
-- =========================================================================

-- 1. Agregar columna imagenes_lote al catálogo de precios B2B
ALTER TABLE public.clientes_b2b_catalogo_precios
ADD COLUMN IF NOT EXISTS imagenes_lote JSONB DEFAULT NULL;

-- 2. Crear Bucket Público de Supabase Storage para Fotos de Partidas / Lotes
INSERT INTO storage.buckets (id, name, public)
VALUES ('b2b_lotes_fotos', 'b2b_lotes_fotos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 3. Políticas RLS para lectura pública del Bucket de Fotos de Partidas
DROP POLICY IF EXISTS "Acceso publico lectura fotos partidas b2b" ON storage.objects;
CREATE POLICY "Acceso publico lectura fotos partidas b2b" ON storage.objects
    FOR SELECT
    TO public
    USING (bucket_id = 'b2b_lotes_fotos');

DROP POLICY IF EXISTS "Service role gestion completa fotos partidas b2b" ON storage.objects;
CREATE POLICY "Service role gestion completa fotos partidas b2b" ON storage.objects
    FOR ALL
    TO service_role
    USING (bucket_id = 'b2b_lotes_fotos')
    WITH CHECK (bucket_id = 'b2b_lotes_fotos');
