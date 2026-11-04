-- =========================================================================
-- Migración 33: Artículos Favoritos / Habituales en Portal B2B (.com)
-- =========================================================================

-- 1. Tabla de Artículos Habituales por Cliente
CREATE TABLE IF NOT EXISTS public.clientes_b2b_articulos_habituales (
    id BIGSERIAL PRIMARY KEY,
    cliente_id VARCHAR(50) NOT NULL,
    producto_codigo VARCHAR(100) NOT NULL,
    frecuencia_compra INTEGER NOT NULL DEFAULT 1,
    ultima_compra TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unq_b2b_habituales_cliente_prod UNIQUE (cliente_id, producto_codigo)
);

CREATE INDEX IF NOT EXISTS idx_b2b_habituales_cliente ON public.clientes_b2b_articulos_habituales(cliente_id);
CREATE INDEX IF NOT EXISTS idx_b2b_habituales_prod ON public.clientes_b2b_articulos_habituales(producto_codigo);

-- 2. Habilitar RLS
ALTER TABLE public.clientes_b2b_articulos_habituales ENABLE ROW LEVEL SECURITY;

-- 3. Políticas RLS:
-- a) Clientes autenticados leen sus propios habituales
DROP POLICY IF EXISTS "Clientes autenticados leen sus habituales" ON public.clientes_b2b_articulos_habituales;
CREATE POLICY "Clientes autenticados leen sus habituales" ON public.clientes_b2b_articulos_habituales
    FOR SELECT
    TO authenticated
    USING (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        OR cliente_id = (auth.jwt() -> 'user_metadata' ->> 'cliente_id')
    );

-- b) Acceso anónimo público de lectura (para colaboradores de pre-pedido)
DROP POLICY IF EXISTS "Acceso publico para lectura de habituales" ON public.clientes_b2b_articulos_habituales;
CREATE POLICY "Acceso publico para lectura de habituales" ON public.clientes_b2b_articulos_habituales
    FOR SELECT
    TO anon
    USING (true);
