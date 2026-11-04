-- =========================================================================
-- Migración 35: Rediseño Conceptual del Módulo de Asistencia Financiera
-- Paradigma de 3 Ventanas Temporales (Margen Estándar, Cortesía y Asistencia Formalizada)
-- =========================================================================

-- 1. Campos de Ventanas Temporales en bunker_financiacion_config
ALTER TABLE public.bunker_financiacion_config
ADD COLUMN IF NOT EXISTS dias_ventana_estandar INTEGER NOT NULL DEFAULT 7,
ADD COLUMN IF NOT EXISTS dias_ventana_cortesia INTEGER NOT NULL DEFAULT 7,
ADD COLUMN IF NOT EXISTS tasa_servicio_financiero NUMERIC(6,3) NOT NULL DEFAULT 3.000,
ADD COLUMN IF NOT EXISTS descripcion_servicio VARCHAR(255) NOT NULL DEFAULT 'Servicio de Asistencia Financiera LAMDA - Contención y Acompañamiento';

-- Actualizar registro existente ID 1
UPDATE public.bunker_financiacion_config
SET dias_ventana_estandar = 7,
    dias_ventana_cortesia = 7,
    tasa_servicio_financiero = COALESCE(tasa_efectiva_mensual_base, 3.000),
    descripcion_servicio = 'Servicio de Asistencia Financiera LAMDA - Contención y Acompañamiento',
    descripcion_facturacion = 'Servicio de Asistencia Financiera - Prórroga Asistida'
WHERE id = 1;

-- 2. Parámetros de Ventanas por Lista de Precios
ALTER TABLE public.bunker_listas_precios
ADD COLUMN IF NOT EXISTS salvavidas_dias_estandar INTEGER DEFAULT NULL,
ADD COLUMN IF NOT EXISTS salvavidas_dias_cortesia INTEGER DEFAULT NULL;

-- 3. Parámetros de Ventanas por Cliente Búnker (Excepciones Comerciales)
ALTER TABLE public.bunker_clientes
ADD COLUMN IF NOT EXISTS salvavidas_dias_estandar INTEGER DEFAULT NULL,
ADD COLUMN IF NOT EXISTS salvavidas_dias_cortesia INTEGER DEFAULT NULL;

-- 4. Extensión de auditoría de simulaciones en modo sombra
ALTER TABLE public.factura_cc_salvavidas_simulaciones
ADD COLUMN IF NOT EXISTS ventana_actual VARCHAR(50) DEFAULT 'MARGEN_ESTANDAR',
ADD COLUMN IF NOT EXISTS dias_ventana_estandar INTEGER DEFAULT 7,
ADD COLUMN IF NOT EXISTS dias_ventana_cortesia INTEGER DEFAULT 7,
ADD COLUMN IF NOT EXISTS dias_asistencia_efectiva INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS interes_proyectado_cortesia NUMERIC(15,2) DEFAULT 0.00;
