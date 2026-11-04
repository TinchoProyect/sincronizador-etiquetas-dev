-- =========================================================================================
-- MIGRACIÓN DE ESQUEMA: MULTI-VINCULACIÓN DE ARTÍCULOS BÚNKER EN INGREDIENTES
-- =========================================================================================

CREATE TABLE IF NOT EXISTS public.ingrediente_bunker_articulos (
    ingrediente_id INTEGER NOT NULL REFERENCES public.ingredientes(id) ON DELETE CASCADE,
    bunker_articulo_id VARCHAR(50) NOT NULL REFERENCES public.bunker_articulos(articulo_id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (ingrediente_id, bunker_articulo_id)
);

-- Indexar para optimizar las consultas de unión en caliente en el mostrador
CREATE INDEX IF NOT EXISTS idx_ingrediente_bunker_articulos_ingrediente_id 
ON public.ingrediente_bunker_articulos(ingrediente_id);
