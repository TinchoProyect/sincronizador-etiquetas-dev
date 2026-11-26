-- ============================================================================
-- Migración 44: Autogestión de Domicilios por Enlace Público + Saneamiento
--               Estructural de clientes_domicilios (bunker_cliente_id)
-- ============================================================================

-- 1. Sanear public.clientes_domicilios para soportar clientes Búnker con o sin lomas_soft_id
--    y registrar trazabilidad de autogestión del cliente.
ALTER TABLE public.clientes_domicilios
    ALTER COLUMN id_cliente DROP NOT NULL;

ALTER TABLE public.clientes_domicilios
    ADD COLUMN IF NOT EXISTS bunker_cliente_id INTEGER REFERENCES public.bunker_clientes(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS origen_carga VARCHAR(30) NOT NULL DEFAULT 'INTERNO',
    ADD COLUMN IF NOT EXISTS verificado_por_cliente BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS fecha_verificacion_cliente TIMESTAMPTZ DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS solicitud_id INTEGER DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS gps_precision_metros INTEGER DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS tipo_lugar VARCHAR(40) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_clientes_domicilios_bunker_cliente_id
    ON public.clientes_domicilios (bunker_cliente_id)
    WHERE bunker_cliente_id IS NOT NULL;

-- 2. Tabla de solicitudes tokenizadas de autogestión de domicilio
CREATE TABLE IF NOT EXISTS public.clientes_domicilios_solicitudes (
    id SERIAL PRIMARY KEY,
    token_publico VARCHAR(80) UNIQUE NOT NULL,
    bunker_cliente_id INTEGER NOT NULL REFERENCES public.bunker_clientes(id) ON DELETE CASCADE,
    codigo_bunker_cliente VARCHAR(50) NOT NULL,
    cliente_nombre_snapshot VARCHAR(255) NOT NULL,
    modo VARCHAR(30) NOT NULL DEFAULT 'ALTA_NUEVA',
    domicilio_objetivo_id INTEGER REFERENCES public.clientes_domicilios(id) ON DELETE SET NULL,
    marcar_predeterminado BOOLEAN NOT NULL DEFAULT FALSE,
    estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    nota_operador TEXT,
    creado_por VARCHAR(120),
    expires_at TIMESTAMPTZ NOT NULL,
    usado_at TIMESTAMPTZ,
    revocada_at TIMESTAMPTZ,
    revocada_por VARCHAR(120),
    domicilio_creado_id INTEGER REFERENCES public.clientes_domicilios(id) ON DELETE SET NULL,
    ultimo_envio_at TIMESTAMPTZ,
    ultimo_envio_canales JSONB,
    payload_recibido JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dom_solicitudes_bunker_estado
    ON public.clientes_domicilios_solicitudes (bunker_cliente_id, estado);

CREATE INDEX IF NOT EXISTS idx_dom_solicitudes_expires
    ON public.clientes_domicilios_solicitudes (expires_at)
    WHERE estado = 'PENDIENTE';

-- 3. Backfill conservador e idempotente de bunker_cliente_id (sin tocar filas ambiguas)
-- Pasada 1: vínculo inequívoco vía public.clientes.id -> cliente_id -> bunker_clientes.lomas_soft_id
UPDATE public.clientes_domicilios cd
SET bunker_cliente_id = bc.id
FROM public.clientes c
JOIN public.bunker_clientes bc
  ON bc.lomas_soft_id IS NOT NULL
 AND LTRIM(TRIM(bc.lomas_soft_id), '0') = c.cliente_id::text
WHERE cd.bunker_cliente_id IS NULL
  AND cd.id_cliente = c.id
  AND NOT EXISTS (
      SELECT 1
      FROM public.bunker_clientes bc2
      WHERE bc2.id = cd.id_cliente
        AND bc2.id <> bc.id
  )
  AND (
      SELECT COUNT(*)
      FROM public.bunker_clientes bc_cnt
      WHERE bc_cnt.lomas_soft_id IS NOT NULL
        AND LTRIM(TRIM(bc_cnt.lomas_soft_id), '0') = c.cliente_id::text
  ) = 1;

-- Pasada 2: vínculo directo inequívoco vía bunker_clientes.id = cd.id_cliente
UPDATE public.clientes_domicilios cd
SET bunker_cliente_id = bc.id
FROM public.bunker_clientes bc
WHERE cd.bunker_cliente_id IS NULL
  AND cd.id_cliente = bc.id
  AND NOT EXISTS (
      SELECT 1
      FROM public.clientes c2
      JOIN public.bunker_clientes bc2
        ON bc2.lomas_soft_id IS NOT NULL
       AND LTRIM(TRIM(bc2.lomas_soft_id), '0') = c2.cliente_id::text
      WHERE c2.id = cd.id_cliente
        AND bc2.id <> bc.id
  );
