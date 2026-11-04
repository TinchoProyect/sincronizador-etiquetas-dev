-- ==============================================================================
-- MIGRACIÓN: Motor de Ofertas Dinámicas y Cuotas de Stock Promocional (LAMDA)
-- Ubicación: src/presupuestos/migrations/02_crear_tablas_ofertas_dinamicas.sql
-- ==============================================================================

-- 1. Cabecera Principal de Ofertas Dinámicas
CREATE TABLE IF NOT EXISTS public.bunker_ofertas_dinamicas (
    id SERIAL PRIMARY KEY,
    titulo VARCHAR(150) NOT NULL,
    descripcion TEXT,
    unidad_cuota VARCHAR(20) NOT NULL DEFAULT 'KILOS', -- 'KILOS' | 'UNIDADES'
    cuota_total NUMERIC(12,2) NOT NULL,                -- ej: 40.00 kg
    cuota_consumida NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    condicion_cierre VARCHAR(30) NOT NULL DEFAULT 'HASTA_AGOTAR_STOCK', -- 'HASTA_AGOTAR_STOCK' | 'FECHA_LIMITE' | 'AMBAS'
    fecha_inicio TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fecha_fin TIMESTAMPTZ NULL,
    tipo_beneficio VARCHAR(30) NOT NULL DEFAULT 'PORCENTAJE',           -- 'PORCENTAJE' | 'PRECIO_FIJO'
    descuento_porcentaje NUMERIC(5,2) NOT NULL DEFAULT 5.00,
    no_acumulable_con_politica BOOLEAN NOT NULL DEFAULT true,           -- Blindaje contra doble bonificación del 5% de $300k
    activo BOOLEAN NOT NULL DEFAULT true,
    estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVA',                       -- 'ACTIVA' | 'PAUSADA' | 'AGOTADA' | 'VENCIDA'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices de búsqueda y estado
CREATE INDEX IF NOT EXISTS idx_bunker_od_estado ON public.bunker_ofertas_dinamicas(estado);
CREATE INDEX IF NOT EXISTS idx_bunker_od_activo ON public.bunker_ofertas_dinamicas(activo);
CREATE INDEX IF NOT EXISTS idx_bunker_od_fechas ON public.bunker_ofertas_dinamicas(fecha_inicio, fecha_fin);

-- 2. Artículos y Presentaciones Afectadas por la Oferta
CREATE TABLE IF NOT EXISTS public.bunker_oferta_articulos (
    id SERIAL PRIMARY KEY,
    oferta_id INT NOT NULL REFERENCES public.bunker_ofertas_dinamicas(id) ON DELETE CASCADE,
    articulo_numero VARCHAR(50) NOT NULL,
    factor_conversion_cuota NUMERIC(10,2) NOT NULL DEFAULT 1.00, -- Kilos por unidad (ej: 20 para MCVX20, 5 para MCVX5, 2 para MCVX2)
    precio_fijo_oferta NUMERIC(14,2) NULL,                       -- Opcional si se fija precio manual en vez de porcentaje
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unq_oferta_articulo UNIQUE (oferta_id, articulo_numero)
);

CREATE INDEX IF NOT EXISTS idx_bunker_oa_articulo ON public.bunker_oferta_articulos(articulo_numero);
CREATE INDEX IF NOT EXISTS idx_bunker_oa_oferta_id ON public.bunker_oferta_articulos(oferta_id);

-- 3. Listas de Precios Destino
CREATE TABLE IF NOT EXISTS public.bunker_oferta_listas (
    id SERIAL PRIMARY KEY,
    oferta_id INT NOT NULL REFERENCES public.bunker_ofertas_dinamicas(id) ON DELETE CASCADE,
    bunker_lista_precio_id INT NOT NULL REFERENCES public.bunker_listas_precios(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unq_oferta_lista UNIQUE (oferta_id, bunker_lista_precio_id)
);

CREATE INDEX IF NOT EXISTS idx_bunker_ol_oferta_id ON public.bunker_oferta_listas(oferta_id);
CREATE INDEX IF NOT EXISTS idx_bunker_ol_lista_id ON public.bunker_oferta_listas(bunker_lista_precio_id);

-- 4. Excepciones de Clientes (Exclusiones o Inclusiones exclusivas)
CREATE TABLE IF NOT EXISTS public.bunker_oferta_excepciones (
    id SERIAL PRIMARY KEY,
    oferta_id INT NOT NULL REFERENCES public.bunker_ofertas_dinamicas(id) ON DELETE CASCADE,
    cliente_id INT NOT NULL,
    tipo_excepcion VARCHAR(30) NOT NULL DEFAULT 'EXCLUIDO', -- 'EXCLUIDO' | 'INCLUIDO_EXCLUSIVO'
    motivo TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unq_oferta_cliente_excepcion UNIQUE (oferta_id, cliente_id)
);

CREATE INDEX IF NOT EXISTS idx_bunker_oe_cliente ON public.bunker_oferta_excepciones(cliente_id);
CREATE INDEX IF NOT EXISTS idx_bunker_oe_oferta ON public.bunker_oferta_excepciones(oferta_id);

-- 5. Trazabilidad de Consumo de Cuota de Oferta
CREATE TABLE IF NOT EXISTS public.bunker_oferta_consumos (
    id SERIAL PRIMARY KEY,
    oferta_id INT NOT NULL REFERENCES public.bunker_ofertas_dinamicas(id) ON DELETE CASCADE,
    articulo_numero VARCHAR(50) NOT NULL,
    cantidad_unidades NUMERIC(10,2) NOT NULL,
    cuota_debitada NUMERIC(12,2) NOT NULL,                   -- cantidad * factor_conversion_cuota
    pedido_id VARCHAR(100) NULL,
    presupuesto_id INT NULL,
    cliente_id VARCHAR(100) NULL,
    origen VARCHAR(30) NOT NULL DEFAULT 'SISTEMA_LOCAL',     -- 'SISTEMA_LOCAL' | 'PORTAL_B2B' | 'CRM'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bunker_oc_oferta_id ON public.bunker_oferta_consumos(oferta_id);
CREATE INDEX IF NOT EXISTS idx_bunker_oc_created_at ON public.bunker_oferta_consumos(created_at);
