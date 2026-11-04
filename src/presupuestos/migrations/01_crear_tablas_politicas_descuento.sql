-- ==============================================================================
-- MIGRACIÓN: Motor de Políticas Comerciales y Descuentos Escalonados (LAMDA)
-- Ubicación: src/presupuestos/migrations/01_crear_tablas_politicas_descuento.sql
-- ==============================================================================

-- 1. Tabla Principal: Políticas de Descuento por Lista de Precios
CREATE TABLE IF NOT EXISTS public.bunker_politicas_descuento (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    descripcion TEXT,
    bunker_lista_precio_id INT UNIQUE REFERENCES public.bunker_listas_precios(id) ON DELETE CASCADE,
    activo BOOLEAN NOT NULL DEFAULT true,
    tipo_calculo VARCHAR(30) NOT NULL DEFAULT 'ESCALA_DIRECTA', -- 'ESCALA_DIRECTA' | 'TRAMOS_INCREMENTALES'
    aplica_sobre VARCHAR(30) NOT NULL DEFAULT 'NETO',          -- 'NETO' | 'BRUTO'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabla de Tramos Escalonados (Escalas por Monto)
CREATE TABLE IF NOT EXISTS public.bunker_politica_descuento_tramos (
    id SERIAL PRIMARY KEY,
    politica_id INT NOT NULL REFERENCES public.bunker_politicas_descuento(id) ON DELETE CASCADE,
    monto_minimo NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    monto_maximo NUMERIC(14,2) NULL,                           -- NULL = sin límite superior
    descuento_porcentaje NUMERIC(5,2) NOT NULL,                 -- Ej: 5.00 para 5%
    etiqueta VARCHAR(100),                                      -- Ej: 'Supera $300.000'
    orden INT NOT NULL DEFAULT 1
);

-- Índices de búsqueda para tramos
CREATE INDEX IF NOT EXISTS idx_bunker_pdt_politica_id ON public.bunker_politica_descuento_tramos(politica_id);
CREATE INDEX IF NOT EXISTS idx_bunker_pdt_montos ON public.bunker_politica_descuento_tramos(monto_minimo, monto_maximo);

-- 3. Tabla de Excepciones por Cliente
CREATE TABLE IF NOT EXISTS public.bunker_politica_descuento_excepciones (
    id SERIAL PRIMARY KEY,
    politica_id INT NOT NULL REFERENCES public.bunker_politicas_descuento(id) ON DELETE CASCADE,
    cliente_id INT NOT NULL REFERENCES public.clientes(cliente_id) ON DELETE CASCADE,
    tipo_excepcion VARCHAR(30) NOT NULL DEFAULT 'EXCLUIDO',     -- 'EXCLUIDO' | 'PORCENTAJE_FIJO'
    descuento_fijo NUMERIC(5,2) NULL,
    motivo TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unq_politica_cliente_excepcion UNIQUE (politica_id, cliente_id)
);

CREATE INDEX IF NOT EXISTS idx_bunker_pde_cliente ON public.bunker_politica_descuento_excepciones(cliente_id);

-- 4. Seed Inicial para Lista 2 ('Berisso')
-- Solo insertar si aún no existe política para la lista 2
DO $$
DECLARE
    v_politica_id INT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.bunker_politicas_descuento WHERE bunker_lista_precio_id = 2) THEN
        INSERT INTO public.bunker_politicas_descuento (
            nombre, descripcion, bunker_lista_precio_id, activo, tipo_calculo, aplica_sobre
        ) VALUES (
            'Política Comercial Berisso',
            'Bonificación por volumen del 5% para pedidos superiores a $300.000 netos',
            2,
            true,
            'ESCALA_DIRECTA',
            'NETO'
        ) RETURNING id INTO v_politica_id;

        -- Tramo 1: >= $300.000 -> 5%
        INSERT INTO public.bunker_politica_descuento_tramos (
            politica_id, monto_minimo, monto_maximo, descuento_porcentaje, etiqueta, orden
        ) VALUES (
            v_politica_id, 300000.00, NULL, 5.00, 'Bonificación por volumen Berisso > $300.000', 1
        );
    END IF;
END $$;
