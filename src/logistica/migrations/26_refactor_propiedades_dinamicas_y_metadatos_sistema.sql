-- ============================================================================
-- MIGRACIÓN DDL: REFACTORIZACIÓN JSONB EN public.bunker_articulos
-- FASE: Separación de Atributos Comerciales y Metadatos de Sistema
-- ============================================================================

BEGIN;

-- 1. Incorporación de la columna metadatos_sistema
ALTER TABLE public.bunker_articulos 
ADD COLUMN IF NOT EXISTS metadatos_sistema JSONB DEFAULT '{}'::jsonb;

-- 2. Creación de Índices GIN y B-Tree Expresivo para Máxima Velocidad
CREATE INDEX IF NOT EXISTS idx_bunker_articulos_propiedades_dinamicas_gin 
ON public.bunker_articulos USING gin (propiedades_dinamicas);

CREATE INDEX IF NOT EXISTS idx_bunker_articulos_metadatos_sistema_gin 
ON public.bunker_articulos USING gin (metadatos_sistema);

CREATE INDEX IF NOT EXISTS idx_bunker_articulos_codigo_barras_local 
ON public.bunker_articulos ((metadatos_sistema ->> 'codigo_barras_local')) 
WHERE (metadatos_sistema ->> 'codigo_barras_local') IS NOT NULL;

-- 3. Función PL/pgSQL del Trigger Guardián con Filtro de Doble Capa (RegEx)
CREATE OR REPLACE FUNCTION public.fn_bunker_separar_propiedades_sistema()
RETURNS TRIGGER AS $$
DECLARE
    v_key TEXT;
    v_val JSONB;
    v_prop_clean JSONB := '{}'::jsonb;
    v_meta_clean JSONB := COALESCE(NEW.metadatos_sistema, '{}'::jsonb);
    
    -- RegEx Estricta para claves de sistema (Lista Negra de Prefijos y Claves Técnicas)
    v_system_regex TEXT := '^(asistente_|rendimiento_|tostadero_|codigo_barras_local$|sys_|sistema_|exencion_operativa$|_meta)';
    
    -- RegEx de Escudo Comercial (Lista Blanca de Protección Explícita)
    v_commercial_regex TEXT := '^(origen|variedad|proceso|tueste|calibre|color|presentacion|tipo|cosecha|marca|sabor|formato|calidad|certificacion)';
BEGIN
    IF NEW.propiedades_dinamicas IS NULL OR NEW.propiedades_dinamicas = '{}'::jsonb THEN
        NEW.propiedades_dinamicas := COALESCE(NEW.propiedades_dinamicas, '{}'::jsonb);
        NEW.metadatos_sistema := v_meta_clean;
        RETURN NEW;
    END IF;

    FOR v_key, v_val IN SELECT * FROM jsonb_each(NEW.propiedades_dinamicas)
    LOOP
        -- NIVEL 1: Escudo Comercial Explícito
        IF v_key ~* v_commercial_regex THEN
            v_prop_clean := jsonb_set(v_prop_clean, ARRAY[v_key], v_val);
            
        -- NIVEL 2: Intercepción de Claves de Sistema hacia metadatos_sistema
        ELSIF v_key ~* v_system_regex THEN
            v_meta_clean := jsonb_set(v_meta_clean, ARRAY[v_key], v_val);
            
        -- NIVEL 3: Regla por Defecto (Fall-through): Atributos no mapeados permanecen en propiedades_dinamicas
        ELSE
            v_prop_clean := jsonb_set(v_prop_clean, ARRAY[v_key], v_val);
        END IF;
    END LOOP;

    NEW.propiedades_dinamicas := v_prop_clean;
    NEW.metadatos_sistema := v_meta_clean;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Inyección del Trigger Guardián BEFORE INSERT OR UPDATE
DROP TRIGGER IF EXISTS trg_bunker_separar_propiedades_sistema ON public.bunker_articulos;

CREATE TRIGGER trg_bunker_separar_propiedades_sistema
BEFORE INSERT OR UPDATE ON public.bunker_articulos
FOR EACH ROW
EXECUTE FUNCTION public.fn_bunker_separar_propiedades_sistema();

-- 5. Procedimiento de Migración Background de Filas Históricas
CREATE OR REPLACE PROCEDURE public.migrar_propiedades_dinamicas_bunker(
    p_batch_size INT DEFAULT 500
)
LANGUAGE plpgsql AS $$
DECLARE
    v_migrados INT := 0;
    v_rows INT;
BEGIN
    LOOP
        WITH batch AS (
            SELECT id FROM public.bunker_articulos
            WHERE propiedades_dinamicas ~* '^(asistente_|rendimiento_|tostadero_|codigo_barras_local$|exencion_operativa$|_meta)'
            LIMIT p_batch_size
            FOR UPDATE SKIP LOCKED
        )
        UPDATE public.bunker_articulos a
        SET propiedades_dinamicas = a.propiedades_dinamicas -- Dispara el Trigger fn_bunker_separar_propiedades_sistema
        FROM batch
        WHERE a.id = batch.id;
        
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_migrados := v_migrados + v_rows;
        
        EXIT WHEN v_rows = 0;
    END LOOP;
    
    RAISE NOTICE 'Migración completada. Registros procesados: %', v_migrados;
END;
$$;

COMMIT;
