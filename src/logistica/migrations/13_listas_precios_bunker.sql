-- 1. Tabla de Listas de Precios Búnker
CREATE TABLE IF NOT EXISTS public.bunker_listas_precios (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL UNIQUE,
    descripcion TEXT,
    activa BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabla Intermedia: Artículos por Lista Búnker
-- Hace referencia a bunker_articulos(articulo_id) para garantizar integridad referencial en el búnker.
CREATE TABLE IF NOT EXISTS public.bunker_lista_articulos (
    id SERIAL PRIMARY KEY,
    lista_id INTEGER NOT NULL REFERENCES public.bunker_listas_precios(id) ON DELETE CASCADE,
    articulo_numero VARCHAR(50) NOT NULL REFERENCES public.bunker_articulos(articulo_id) ON DELETE CASCADE,
    margen_ganancia NUMERIC(10,4) NOT NULL DEFAULT 0.0000, -- Margen de ganancia en porcentaje (ej: 35.00)
    costo_base_sobrescrito NUMERIC(15,4) DEFAULT NULL, -- NULL indica que hereda del lote/receta activo
    costo_tiempo NUMERIC(15,4) NOT NULL DEFAULT 0.0000, -- Costo de mano de obra/operativo
    iva NUMERIC(5,2) NOT NULL DEFAULT 21.00, -- Alícuota aplicable (ej: 21.00 o 10.50)
    precio_final NUMERIC(15,4) NOT NULL DEFAULT 0.0000, -- Precio final calculado o fijado manualmente
    modo_calculo VARCHAR(20) NOT NULL DEFAULT 'AUTOMATIC', -- 'AUTOMATIC' o 'MANUAL' (sobrescrito)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_lista_articulo UNIQUE (lista_id, articulo_numero)
);

-- 3. Tabla de Insumos Adicionales de Artículo Búnker
-- Mapea artículos adicionales del búnker/artículos generales sin FK estricta para evitar bloqueos del catálogo legacy.
CREATE TABLE IF NOT EXISTS public.bunker_lista_insumos (
    id SERIAL PRIMARY KEY,
    lista_articulo_id INTEGER NOT NULL REFERENCES public.bunker_lista_articulos(id) ON DELETE CASCADE,
    insumo_articulo_numero VARCHAR(50) NOT NULL, -- Cantidad física requerida
    cantidad NUMERIC(12,4) NOT NULL DEFAULT 1.0000, -- Cantidad física requerida
    costo_unitario_capturado NUMERIC(15,4) NOT NULL, -- Congela el costo unitario de compra al momento del guardado
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices de Rendimiento para consultas elásticas rápidas
CREATE INDEX IF NOT EXISTS idx_bunker_lista_articulos_lista ON public.bunker_lista_articulos(lista_id);
CREATE INDEX IF NOT EXISTS idx_bunker_lista_articulos_art ON public.bunker_lista_articulos(articulo_numero);
CREATE INDEX IF NOT EXISTS idx_bunker_lista_insumos_la ON public.bunker_lista_insumos(lista_articulo_id);

-- Insertar una lista de simulación por defecto si la tabla está vacía
INSERT INTO public.bunker_listas_precios (nombre, descripcion, activa)
SELECT 'Simulación Base', 'Lienzo inicial para simulaciones comerciales', true
WHERE NOT EXISTS (SELECT 1 FROM public.bunker_listas_precios);
