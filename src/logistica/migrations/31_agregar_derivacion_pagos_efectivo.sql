-- =====================================================================
-- 31_agregar_derivacion_pagos_efectivo.sql
-- Proyecto: Sistema LAMDA / Logística
-- Agregar soporte de derivación pública a colaboradores en BD Local
-- =====================================================================

ALTER TABLE public.factura_pagos_efectivo
    ALTER COLUMN foto_frente_url DROP NOT NULL,
    ALTER COLUMN foto_dorso_url DROP NOT NULL;

ALTER TABLE public.factura_pagos_efectivo
    ADD COLUMN IF NOT EXISTS token_publico TEXT,
    ADD COLUMN IF NOT EXISTS colaborador_nombre TEXT,
    ADD COLUMN IF NOT EXISTS colaborador_telefono TEXT,
    ADD COLUMN IF NOT EXISTS derivado_por TEXT,
    ADD COLUMN IF NOT EXISTS fecha_derivacion TIMESTAMPTZ;

ALTER TABLE public.factura_pagos_efectivo
    DROP CONSTRAINT IF EXISTS factura_pagos_efectivo_estado_check;

ALTER TABLE public.factura_pagos_efectivo
    ADD CONSTRAINT factura_pagos_efectivo_estado_check
    CHECK (estado IN ('PENDIENTE_ENSOBRADO', 'PREPARADO', 'EN_TRANSITO', 'RECIBIDO_LOCAL', 'ACREDITADO', 'OBSERVADO', 'CANCELADO'));

CREATE INDEX IF NOT EXISTS idx_factura_pagos_efectivo_token ON public.factura_pagos_efectivo(token_publico);
