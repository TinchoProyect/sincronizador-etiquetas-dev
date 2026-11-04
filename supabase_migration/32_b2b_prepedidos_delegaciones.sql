-- =========================================================================
-- Migración 32: Delegación de Pre-Pedidos / Modo Mostrador en Portal B2B
-- =========================================================================

-- 1. Tabla de Delegaciones (Enlaces creados por el dueño)
CREATE TABLE IF NOT EXISTS public.clientes_b2b_delegaciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id VARCHAR(50) NOT NULL,
    token VARCHAR(64) NOT NULL UNIQUE,
    nombre_empresa VARCHAR(200),
    nombre_colaborador VARCHAR(100) NOT NULL DEFAULT 'Colaborador Mostrador',
    mostrar_precios BOOLEAN NOT NULL DEFAULT false,
    tipo_enlace VARCHAR(20) NOT NULL DEFAULT 'permanente', -- 'permanente' | 'unico'
    listas_ids INT[] DEFAULT '{}',
    activo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_b2b_delegaciones_cliente ON public.clientes_b2b_delegaciones(cliente_id);
CREATE INDEX IF NOT EXISTS idx_b2b_delegaciones_token ON public.clientes_b2b_delegaciones(token);

-- 2. Tabla de Pre-Pedidos (Borradores cargados por el empleado)
CREATE TABLE IF NOT EXISTS public.clientes_b2b_prepedidos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delegacion_id UUID REFERENCES public.clientes_b2b_delegaciones(id) ON DELETE SET NULL,
    cliente_id VARCHAR(50) NOT NULL,
    colaborador_nombre VARCHAR(100),
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    nota_colaborador TEXT,
    estado VARCHAR(30) NOT NULL DEFAULT 'pendiente_revision', -- 'pendiente_revision' | 'incorporado' | 'descartado'
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_b2b_prepedidos_cliente ON public.clientes_b2b_prepedidos(cliente_id, estado);
CREATE INDEX IF NOT EXISTS idx_b2b_prepedidos_delegacion ON public.clientes_b2b_prepedidos(delegacion_id);

-- 3. Habilitar RLS en ambas tablas
ALTER TABLE public.clientes_b2b_delegaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes_b2b_prepedidos ENABLE ROW LEVEL SECURITY;

-- Políticas para clientes_b2b_delegaciones:
-- a) Clientes autenticados gestionan sus propias delegaciones:
DROP POLICY IF EXISTS "Clientes autenticados gestionan sus delegaciones" ON public.clientes_b2b_delegaciones;
CREATE POLICY "Clientes autenticados gestionan sus delegaciones" ON public.clientes_b2b_delegaciones
    FOR ALL
    TO authenticated
    USING (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        OR cliente_id = (auth.jwt() -> 'user_metadata' ->> 'cliente_id')
    )
    WITH CHECK (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        OR cliente_id = (auth.jwt() -> 'user_metadata' ->> 'cliente_id')
    );

-- b) Acceso público anónimo para consultar delegación por token (solo si está activa):
DROP POLICY IF EXISTS "Acceso publico para validar token de delegacion" ON public.clientes_b2b_delegaciones;
CREATE POLICY "Acceso publico para validar token de delegacion" ON public.clientes_b2b_delegaciones
    FOR SELECT
    TO anon
    USING (
        activo = true
        AND (expires_at IS NULL OR expires_at > now())
    );

-- c) Rol anónimo puede desactivar delegación si era de un solo uso (actualizar activo a false):
DROP POLICY IF EXISTS "Acceso publico para cerrar delegacion de un solo uso" ON public.clientes_b2b_delegaciones;
CREATE POLICY "Acceso publico para cerrar delegacion de un solo uso" ON public.clientes_b2b_delegaciones
    FOR UPDATE
    TO anon
    USING (
        tipo_enlace = 'unico'
        AND activo = true
    )
    WITH CHECK (
        activo = false
    );

-- Políticas para clientes_b2b_prepedidos:
-- a) Clientes autenticados ven y gestionan los pre-pedidos de su comercio:
DROP POLICY IF EXISTS "Clientes autenticados gestionan sus prepedidos" ON public.clientes_b2b_prepedidos;
CREATE POLICY "Clientes autenticados gestionan sus prepedidos" ON public.clientes_b2b_prepedidos
    FOR ALL
    TO authenticated
    USING (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        OR cliente_id = (auth.jwt() -> 'user_metadata' ->> 'cliente_id')
    )
    WITH CHECK (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        OR cliente_id = (auth.jwt() -> 'user_metadata' ->> 'cliente_id')
    );

-- b) Rol anónimo puede insertar pre-pedidos (enviar el borrador desde mostrador):
DROP POLICY IF EXISTS "Acceso publico para insertar prepedidos" ON public.clientes_b2b_prepedidos;
CREATE POLICY "Acceso publico para insertar prepedidos" ON public.clientes_b2b_prepedidos
    FOR INSERT
    TO anon
    WITH CHECK (true);
