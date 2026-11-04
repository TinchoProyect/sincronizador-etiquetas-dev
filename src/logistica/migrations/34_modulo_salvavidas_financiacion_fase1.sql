-- =========================================================================
-- Migración 34: Módulo Salvavidas de Financiación Automática (Fase 1: Modo Sombra)
-- Sistema LAMDA - Cuentas Corrientes Búnker
-- =========================================================================

-- 1. Tabla de Configuración Global del Servicio de Financiación
CREATE TABLE IF NOT EXISTS public.bunker_financiacion_config (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL DEFAULT 'Configuración Estándar LAMDA',
    tasa_efectiva_mensual_base NUMERIC(6,3) NOT NULL DEFAULT 3.000, -- 3.0% TEM base
    tasa_nominal_anual_referencia NUMERIC(6,3) NOT NULL DEFAULT 36.500, -- TNA informativa
    dias_gracia_estandar INTEGER NOT NULL DEFAULT 7, -- Plazo habitual en días
    modo_calculo VARCHAR(20) NOT NULL DEFAULT 'LINEAL', -- 'LINEAL' o 'COMPUESTO'
    modo_sistema VARCHAR(20) NOT NULL DEFAULT 'SOMBRA', -- 'SOMBRA' (Simulación aislada) o 'PRODUCCION'
    descripcion_facturacion VARCHAR(255) NOT NULL DEFAULT 'Servicio de Financiación Automática - Prórroga Preferencial',
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insertar configuración inicial por defecto si la tabla está vacía
INSERT INTO public.bunker_financiacion_config (id, nombre, tasa_efectiva_mensual_base, tasa_nominal_anual_referencia, dias_gracia_estandar, modo_calculo, modo_sistema, descripcion_facturacion)
SELECT 1, 'Configuración Estándar LAMDA', 3.000, 36.500, 7, 'LINEAL', 'SOMBRA', 'Servicio de Financiación Automática - Prórroga Preferencial'
WHERE NOT EXISTS (SELECT 1 FROM public.bunker_financiacion_config WHERE id = 1);

-- 2. Parámetros por Lista de Precios Búnker (Nivel 2 de Reglas)
ALTER TABLE public.bunker_listas_precios 
ADD COLUMN IF NOT EXISTS salvavidas_habilitado BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS salvavidas_tasa_tem NUMERIC(6,3) DEFAULT NULL, -- NULL hereda de config global
ADD COLUMN IF NOT EXISTS salvavidas_dias_gracia INTEGER DEFAULT NULL;

-- 3. Parámetros por Cliente Búnker (Nivel 1: Excepciones Comerciales Granulares)
ALTER TABLE public.bunker_clientes 
ADD COLUMN IF NOT EXISTS salvavidas_modo VARCHAR(20) DEFAULT 'HEREDAR_LISTA', -- 'HEREDAR_LISTA', 'HABILITADO', 'EXCLUIDO'
ADD COLUMN IF NOT EXISTS salvavidas_tasa_tem NUMERIC(6,3) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS salvavidas_dias_gracia INTEGER DEFAULT NULL,
ADD COLUMN IF NOT EXISTS salvavidas_motivo_excepcion TEXT DEFAULT NULL;

-- 4. Tabla de Auditoría y Simulación en Modo Sombra (Aislamiento Contable 100%)
CREATE TABLE IF NOT EXISTS public.factura_cc_salvavidas_simulaciones (
    id SERIAL PRIMARY KEY,
    cuenta_corriente_id INTEGER NOT NULL REFERENCES public.factura_cuentas_corrientes(id) ON DELETE CASCADE,
    codigo_bunker_cliente VARCHAR(50) NOT NULL,
    movimiento_origen_id BIGINT,
    comprobante_descripcion VARCHAR(255),
    fecha_punto_cero TIMESTAMP NOT NULL,
    fecha_corte_calculo TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    antiguedad_total_dias INTEGER NOT NULL,
    dias_gracia_aplicados INTEGER NOT NULL,
    dias_financiados_efectivos INTEGER NOT NULL,
    capital_base_impago NUMERIC(15,2) NOT NULL,
    tasa_tem_aplicada NUMERIC(6,3) NOT NULL,
    tasa_diaria_aplicada NUMERIC(8,6) NOT NULL,
    interes_financiacion_calculado NUMERIC(15,2) NOT NULL,
    saldo_proyectado_comprobante NUMERIC(15,2) NOT NULL,
    estado_simulacion VARCHAR(20) NOT NULL DEFAULT 'SOMBRA', -- 'SOMBRA', 'SIMULADO_AUDITADO', 'APLICADO_REAL'
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_salvavidas_sim_cc ON public.factura_cc_salvavidas_simulaciones(cuenta_corriente_id);
CREATE INDEX IF NOT EXISTS idx_salvavidas_sim_cliente ON public.factura_cc_salvavidas_simulaciones(codigo_bunker_cliente);
CREATE INDEX IF NOT EXISTS idx_salvavidas_sim_fecha ON public.factura_cc_salvavidas_simulaciones(fecha_corte_calculo);
