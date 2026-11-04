-- =========================================================================
-- Migración 38: Módulo Exclusivo Colaborador (Servicios, Tarifario y Jornadas)
-- Cliente VIP: Matías (CB-0006) / Rol Híbrido Cliente + Prestador de Servicios
-- =========================================================================

-- 1. Tabla de Tarifas Sincronizadas (Horaria y Rendimiento)
CREATE TABLE IF NOT EXISTS public.clientes_b2b_colaboradores_tarifas (
    id SERIAL PRIMARY KEY,
    cliente_id TEXT NOT NULL,
    usuario_id INTEGER NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('HORA', 'RENDIMIENTO')),
    articulo_codigo TEXT,
    articulo_descripcion TEXT,
    unidad_medida TEXT NOT NULL DEFAULT 'kg',
    valor NUMERIC(12, 2) NOT NULL,
    fecha_desde TIMESTAMPTZ,
    fecha_hasta TIMESTAMPTZ,
    activo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices de consulta rápida
CREATE INDEX IF NOT EXISTS idx_b2b_colab_tarifas_cliente ON public.clientes_b2b_colaboradores_tarifas(cliente_id, activo);

-- 2. Tabla de Jornadas de Depósito / Taller
CREATE TABLE IF NOT EXISTS public.clientes_b2b_colaboradores_jornadas (
    id SERIAL PRIMARY KEY,
    local_jornada_id INTEGER UNIQUE NOT NULL,
    cliente_id TEXT NOT NULL,
    usuario_id INTEGER NOT NULL,
    fecha_ingreso TIMESTAMPTZ NOT NULL,
    fecha_egreso TIMESTAMPTZ,
    horas_totales NUMERIC(6, 2) DEFAULT 0.00,
    minutos_totales INTEGER DEFAULT 0,
    valor_hora_aplicado NUMERIC(12, 2) NOT NULL,
    monto_total NUMERIC(12, 2) NOT NULL,
    estado TEXT NOT NULL CHECK (estado IN ('EN_CURSO', 'FINALIZADA', 'LIQUIDADA')),
    liquidada_en TIMESTAMPTZ,
    cuenta_corriente_movimiento_id INTEGER,
    observacion_ingreso TEXT,
    observacion_egreso TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_b2b_colab_jornadas_cliente_estado ON public.clientes_b2b_colaboradores_jornadas(cliente_id, estado);
CREATE INDEX IF NOT EXISTS idx_b2b_colab_jornadas_fecha ON public.clientes_b2b_colaboradores_jornadas(fecha_ingreso DESC);

-- 3. Tabla de Producciones Externas / Carros
CREATE TABLE IF NOT EXISTS public.clientes_b2b_colaboradores_producciones (
    id SERIAL PRIMARY KEY,
    local_produccion_id INTEGER UNIQUE NOT NULL,
    cliente_id TEXT NOT NULL,
    usuario_id INTEGER NOT NULL,
    carro_id INTEGER,
    articulo_padre_id TEXT,
    articulo_padre_descripcion TEXT,
    articulo_fraccionado_id TEXT,
    articulo_fraccionado_descripcion TEXT,
    kilos_entrada NUMERIC(10, 3) NOT NULL DEFAULT 0.000,
    kilos_salida NUMERIC(10, 3) NOT NULL DEFAULT 0.000,
    kilos_producidos NUMERIC(10, 3) NOT NULL DEFAULT 0.000,
    porcentaje_merma NUMERIC(6, 2) NOT NULL DEFAULT 0.00,
    fecha_registro TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_b2b_colab_prod_cliente ON public.clientes_b2b_colaboradores_producciones(cliente_id, fecha_registro DESC);

-- 4. Tabla de Solicitudes y Propuestas de Ajuste de Tarifas
CREATE TABLE IF NOT EXISTS public.clientes_b2b_colaboradores_solicitudes (
    id SERIAL PRIMARY KEY,
    cliente_id TEXT NOT NULL,
    usuario_id INTEGER NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('TARIFA_HORA', 'TARIFA_RENDIMIENTO')),
    articulo_codigo TEXT,
    articulo_descripcion TEXT,
    valor_propuesto NUMERIC(12, 2) NOT NULL,
    valor_anterior NUMERIC(12, 2),
    unidad_medida TEXT,
    motivo TEXT,
    estado TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'APROBADA', 'RECHAZADA')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    revisado_en TIMESTAMPTZ,
    revisado_por TEXT
);

CREATE INDEX IF NOT EXISTS idx_b2b_colab_solicitudes_cliente ON public.clientes_b2b_colaboradores_solicitudes(cliente_id, estado);

-- =========================================================================
-- SEGURIDAD: Habilitar RLS en todas las tablas expuestas
-- =========================================================================
ALTER TABLE public.clientes_b2b_colaboradores_tarifas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes_b2b_colaboradores_jornadas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes_b2b_colaboradores_producciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes_b2b_colaboradores_solicitudes ENABLE ROW LEVEL SECURITY;

-- Políticas SELECT: Solo el colaborador autenticado con su cliente_id puede leer sus registros
DROP POLICY IF EXISTS "Colaborador lee sus propias tarifas" ON public.clientes_b2b_colaboradores_tarifas;
CREATE POLICY "Colaborador lee sus propias tarifas" ON public.clientes_b2b_colaboradores_tarifas
    FOR SELECT TO authenticated
    USING (cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id'));

DROP POLICY IF EXISTS "Colaborador lee sus propias jornadas" ON public.clientes_b2b_colaboradores_jornadas;
CREATE POLICY "Colaborador lee sus propias jornadas" ON public.clientes_b2b_colaboradores_jornadas
    FOR SELECT TO authenticated
    USING (cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id'));

DROP POLICY IF EXISTS "Colaborador lee sus producciones" ON public.clientes_b2b_colaboradores_producciones;
CREATE POLICY "Colaborador lee sus producciones" ON public.clientes_b2b_colaboradores_producciones
    FOR SELECT TO authenticated
    USING (cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id'));

DROP POLICY IF EXISTS "Colaborador lee sus solicitudes" ON public.clientes_b2b_colaboradores_solicitudes;
CREATE POLICY "Colaborador lee sus solicitudes" ON public.clientes_b2b_colaboradores_solicitudes
    FOR SELECT TO authenticated
    USING (cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id'));

DROP POLICY IF EXISTS "Colaborador inserta solicitudes de tarifas" ON public.clientes_b2b_colaboradores_solicitudes;
CREATE POLICY "Colaborador inserta solicitudes de tarifas" ON public.clientes_b2b_colaboradores_solicitudes
    FOR INSERT TO authenticated
    WITH CHECK (cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id'));

-- Políticas ALL: Service role (backend local) tiene acceso total
DROP POLICY IF EXISTS "Service role gestiona tarifas" ON public.clientes_b2b_colaboradores_tarifas;
CREATE POLICY "Service role gestiona tarifas" ON public.clientes_b2b_colaboradores_tarifas FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role gestiona jornadas" ON public.clientes_b2b_colaboradores_jornadas;
CREATE POLICY "Service role gestiona jornadas" ON public.clientes_b2b_colaboradores_jornadas FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role gestiona producciones" ON public.clientes_b2b_colaboradores_producciones;
CREATE POLICY "Service role gestiona producciones" ON public.clientes_b2b_colaboradores_producciones FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role gestiona solicitudes" ON public.clientes_b2b_colaboradores_solicitudes;
CREATE POLICY "Service role gestiona solicitudes" ON public.clientes_b2b_colaboradores_solicitudes FOR ALL TO service_role USING (true) WITH CHECK (true);
