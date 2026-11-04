-- ============================================================================
-- MIGRACIÓN DDL: 27_nuevo_paradigma_bunker_familias.sql
-- OBJETIVO: Tablas DDL de Familias, Moldes Posicionales y Procedimiento de Migración PL/pgSQL
-- ============================================================================

BEGIN;

-- 1. Tabla Principal de Familias / Moldes
CREATE TABLE IF NOT EXISTS public.bunker_familias (
    id SERIAL PRIMARY KEY,
    codigo_familia VARCHAR(50) UNIQUE NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    descripcion TEXT,
    activo BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 2. Tabla de Ejes de Variación por Familia (Moldes Posicionales)
CREATE TABLE IF NOT EXISTS public.bunker_familia_ejes (
    id SERIAL PRIMARY KEY,
    familia_id INTEGER NOT NULL REFERENCES public.bunker_familias(id) ON DELETE CASCADE,
    nombre_eje VARCHAR(100) NOT NULL,
    clave_jsonb VARCHAR(50) NOT NULL,
    posicion INTEGER DEFAULT 1 NOT NULL,
    modo_display VARCHAR(20) DEFAULT 'COMPLETO' NOT NULL,
    silencioso BOOLEAN DEFAULT FALSE NOT NULL,
    es_requerido BOOLEAN DEFAULT FALSE NOT NULL,
    valores_sugeridos JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_modo_display CHECK (modo_display IN ('COMPLETO', 'ABREVIADO')),
    CONSTRAINT chk_posicion_positiva CHECK (posicion > 0),
    CONSTRAINT uk_familia_clave UNIQUE (familia_id, clave_jsonb),
    CONSTRAINT uk_familia_posicion UNIQUE (familia_id, posicion)
);

-- 3. Vinculación con bunker_articulos
ALTER TABLE public.bunker_articulos 
ADD COLUMN IF NOT EXISTS familia_id INTEGER REFERENCES public.bunker_familias(id) ON DELETE SET NULL;

-- 4. Índices de Búsqueda y Optimización
CREATE INDEX IF NOT EXISTS idx_bunker_familias_codigo ON public.bunker_familias(codigo_familia);
CREATE INDEX IF NOT EXISTS idx_bunker_familia_ejes_familia ON public.bunker_familia_ejes(familia_id);
CREATE INDEX IF NOT EXISTS idx_bunker_articulos_familia_id ON public.bunker_articulos(familia_id);

-- 5. Inserción de Familias Base por Defecto
INSERT INTO public.bunker_familias (codigo_familia, nombre, descripcion) VALUES
('FAM-FRUTOS', 'Frutos Secos', 'Nueces, almendras, avellanas, castañas y derivados'),
('FAM-SEMILLAS', 'Semillas', 'Semillas de chía, girasol, sésamo, lino y afines'),
('FAM-MIXES', 'Mixes y Elaborados', 'Mezclas comerciales, granolas y frutos combinados'),
('FAM-ACEITES', 'Aceites y Especiales', 'Aceite de coco, mantecas y derivados líquidos/grasos'),
('FAM-SEMI', 'Semielaborados / Granel', 'Insumos de planta y materias primas de proceso'),
('FAM-GENERIC', 'General / Sin Clasificar', 'Familia por defecto para artículos históricos sin clasificar')
ON CONFLICT (codigo_familia) DO NOTHING;

-- 6. Procedimiento Almacenado de Trasvasado Histórico PL/pgSQL
CREATE OR REPLACE PROCEDURE public.migrar_bunker_hacia_nuevo_paradigma(
    p_batch_size INT DEFAULT 500
)
LANGUAGE plpgsql AS $$
DECLARE
    v_rec RECORD;
    v_familia_id INT;
    v_key TEXT;
    v_val JSONB;
    v_new_props JSONB;
    v_pos INT;
    v_migrados INT := 0;
BEGIN
    SELECT id INTO v_familia_id FROM public.bunker_familias WHERE codigo_familia = 'FAM-GENERIC';

    FOR v_rec IN 
        SELECT articulo_id, familia_id, rubro, sub_rubro, descripcion, propiedades_dinamicas 
        FROM public.bunker_articulos
        WHERE propiedades_dinamicas IS NOT NULL 
          AND NOT (propiedades_dinamicas ? 'posiciones')
    LOOP
        v_new_props := jsonb_build_object(
            'familia_id', COALESCE(v_rec.familia_id, v_familia_id),
            'familia_nombre', 'General / Sin Clasificar',
            'posiciones', '{}'::jsonb
        );
        
        v_pos := 1;

        FOR v_key, v_val IN SELECT * FROM jsonb_each(v_rec.propiedades_dinamicas)
        LOOP
            IF v_key ~* '^(asistente_|rendimiento_|tostadero_|codigo_barras_local$|exencion_operativa$|_meta)' THEN
                CONTINUE;
            END IF;

            v_new_props := jsonb_set(
                v_new_props, 
                ARRAY['posiciones', 'pos_' || v_pos], 
                jsonb_build_object(
                    'eje', initcap(v_key),
                    'valor', CASE WHEN jsonb_typeof(v_val) = 'object' THEN COALESCE(v_val->>'valor', '') ELSE v_val#>>'{}' END,
                    'abreviatura', CASE WHEN jsonb_typeof(v_val) = 'object' THEN COALESCE(v_val->>'abreviatura', v_val->>'valor', '') ELSE v_val#>>'{}' END,
                    'modo_display', CASE WHEN jsonb_typeof(v_val) = 'object' AND (v_val->>'modo_display') = 'ABREVIADO' THEN 'ABREVIADO' ELSE 'COMPLETO' END,
                    'silencioso', CASE WHEN jsonb_typeof(v_val) = 'object' AND (v_val->>'silencioso')::boolean THEN true ELSE false END,
                    'posicion', v_pos
                )
            );
            v_pos := v_pos + 1;
        END LOOP;

        UPDATE public.bunker_articulos 
        SET propiedades_dinamicas = v_new_props,
            familia_id = COALESCE(familia_id, v_familia_id)
        WHERE articulo_id = v_rec.articulo_id;

        v_migrados := v_migrados + 1;
    END LOOP;

    RAISE NOTICE '✅ Migración histórica completada. Registros procesados: %', v_migrados;
END;
$$;

COMMIT;
