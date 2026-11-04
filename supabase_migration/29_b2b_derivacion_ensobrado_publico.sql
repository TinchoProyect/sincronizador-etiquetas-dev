-- =====================================================================
-- 29_b2b_derivacion_ensobrado_publico.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Derivación Pública de Gestión de Ensobrado a Colaboradores
-- =====================================================================

-- 1. Modificar restricciones de clientes_b2b_pagos_efectivo
ALTER TABLE public.clientes_b2b_pagos_efectivo
    ALTER COLUMN foto_frente_url DROP NOT NULL,
    ALTER COLUMN foto_dorso_url DROP NOT NULL;

-- 2. Agregar columnas de derivación y token público
ALTER TABLE public.clientes_b2b_pagos_efectivo
    ADD COLUMN IF NOT EXISTS token_publico TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS colaborador_nombre TEXT,
    ADD COLUMN IF NOT EXISTS colaborador_telefono TEXT,
    ADD COLUMN IF NOT EXISTS derivado_por TEXT,
    ADD COLUMN IF NOT EXISTS fecha_derivacion TIMESTAMPTZ;

-- 3. Actualizar CHECK de estado para admitir PENDIENTE_ENSOBRADO
ALTER TABLE public.clientes_b2b_pagos_efectivo
    DROP CONSTRAINT IF EXISTS clientes_b2b_pagos_efectivo_estado_check;

ALTER TABLE public.clientes_b2b_pagos_efectivo
    ADD CONSTRAINT clientes_b2b_pagos_efectivo_estado_check
    CHECK (estado IN ('PENDIENTE_ENSOBRADO', 'PREPARADO', 'EN_TRANSITO', 'RECIBIDO_LOCAL', 'ACREDITADO', 'OBSERVADO', 'CANCELADO'));

-- 4. Índice para búsquedas por token público
CREATE INDEX IF NOT EXISTS idx_b2b_pagos_efectivo_token ON public.clientes_b2b_pagos_efectivo(token_publico);

-- 5. Políticas RLS Públicas para el Colaborador Anónimo
DROP POLICY IF EXISTS "Colaborador publico puede consultar su sobre por token" ON public.clientes_b2b_pagos_efectivo;
CREATE POLICY "Colaborador publico puede consultar su sobre por token" ON public.clientes_b2b_pagos_efectivo
    FOR SELECT
    TO anon, public
    USING (token_publico IS NOT NULL);

DROP POLICY IF EXISTS "Colaborador publico puede completar el ensobrado por token" ON public.clientes_b2b_pagos_efectivo;
CREATE POLICY "Colaborador publico puede completar el ensobrado por token" ON public.clientes_b2b_pagos_efectivo
    FOR UPDATE
    TO anon, public
    USING (token_publico IS NOT NULL AND estado = 'PENDIENTE_ENSOBRADO')
    WITH CHECK (token_publico IS NOT NULL AND estado IN ('PREPARADO', 'PENDIENTE_ENSOBRADO'));

-- 6. Política de subida pública de fotos al bucket sobres_efectivo para colaboradores
DROP POLICY IF EXISTS "Colaboradores publicos pueden subir fotos de sobres" ON storage.objects;
CREATE POLICY "Colaboradores publicos pueden subir fotos de sobres" ON storage.objects
    FOR INSERT
    TO anon, public
    WITH CHECK (bucket_id = 'sobres_efectivo');
