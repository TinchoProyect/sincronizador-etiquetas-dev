-- =====================================================================
-- 10_b2b_retiros.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Creación de la tabla de retiros y políticas RLS para check-in
-- =====================================================================

-- 1. Crear Tabla
CREATE TABLE IF NOT EXISTS public.clientes_b2b_retiros (
    id bigint PRIMARY KEY, -- Mapeado al ID de ordenes_tratamiento local
    cliente_id TEXT NOT NULL, -- Código de cliente Búnker (ej: 'CB-0034')
    codigo_qr_hash text NOT NULL UNIQUE,
    estado_logistico text NOT NULL DEFAULT 'PENDIENTE_CLIENTE',
    fecha_creacion timestamp with time zone NOT NULL DEFAULT now(),
    
    -- Datos del Check-in (Cliente)
    responsable_nombre text,
    responsable_apellido text,
    responsable_celular text,
    articulo_numero text,
    descripcion_externa text,
    kilos numeric,
    bultos integer,
    motivo text,
    
    -- Datos de Validación (Chofer / ERP)
    chofer_nombre text,
    fecha_validacion_chofer timestamp with time zone,
    id_domicilio_entrega integer,
    id_ruta integer,
    
    -- Control de Sincronización
    sincronizado_local boolean NOT NULL DEFAULT false,
    fecha_sincronizacion_local timestamp with time zone
);

-- Habilitar Seguridad a Nivel de Fila (RLS)
ALTER TABLE public.clientes_b2b_retiros ENABLE ROW LEVEL SECURITY;

-- 2. Políticas RLS
-- Política de Lectura (El cliente puede ver sus propios retiros)
DROP POLICY IF EXISTS "Clientes pueden leer sus propios retiros" ON public.clientes_b2b_retiros;
CREATE POLICY "Clientes pueden leer sus propios retiros" ON public.clientes_b2b_retiros
    FOR SELECT
    TO authenticated
    USING (cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id'));

-- Política de Check-in (El cliente puede completar los datos si está pendiente por su parte)
DROP POLICY IF EXISTS "Clientes pueden completar el checkin de sus retiros" ON public.clientes_b2b_retiros;
CREATE POLICY "Clientes pueden completar el checkin de sus retiros" ON public.clientes_b2b_retiros
    FOR UPDATE
    TO authenticated
    USING (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND estado_logistico = 'PENDIENTE_CLIENTE'
    )
    WITH CHECK (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND estado_logistico = 'PENDIENTE_VALIDACION'
    );
