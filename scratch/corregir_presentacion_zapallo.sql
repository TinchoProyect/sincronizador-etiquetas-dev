-- =============================================================================
-- SCRIPT DE CORRECCIÓN TRANSACCIONAL (SQL) - SISTEMA LAMDA
-- ASUNTO: Corrección de Factor de Conversión para Semilla de Zapallo Pelada "AA"
-- LOTE: CB60CCA3 | SKU: 45559 | Proveedor: Villares
-- =============================================================================

BEGIN;

-- 1. Actualizar la tabla maestra operativa en la nube (Supabase) para corregir el factor de conversión a 1 x 25
UPDATE tabla_maestra_operativa
SET datos_maestros = jsonb_set(
    jsonb_set(datos_maestros, '{cant_bult}', '"1"'),
    '{cant_valor}', '"25"'
)
WHERE proveedor_id = '5515e04d-248d-416c-8cb2-d36e006d549d'
  AND (datos_maestros->>'codigo' = '45559' OR datos_maestros->>'descripcion' ILIKE '%Zapallo Pelada (Cruda)%AA%');

-- Nota de Integridad: Si el lote ya hubiese sido vinculado erróneamente en el histórico local (bunker_lotes_vinculos),
-- se recalcula el costo_kilo_calculado dividiendo el costo_bruto_ingresado por el total de kg (cant_bultos * 25).
UPDATE bunker_lotes_vinculos
SET cantidad_total_lote = 25.00,
    costo_kilo_calculado = costo_bruto_ingresado / 25.00
WHERE lote_id_supabase = 'cb60cca3-26a7-4208-b684-1dc08f20ae1e';

-- Si existen destinos asignados a Ingredientes, corregir los kilos correspondientes
UPDATE bunker_lotes_destinos
SET kilos_asignados = cantidad_asignada * 25.00,
    costo_kilo_al_momento = (
        SELECT costo_kilo_calculado 
        FROM bunker_lotes_vinculos 
        WHERE bunker_lotes_vinculos.id = bunker_lotes_destinos.vinculo_id
    )
WHERE vinculo_id IN (
    SELECT id FROM bunker_lotes_vinculos WHERE lote_id_supabase = 'cb60cca3-26a7-4208-b684-1dc08f20ae1e'
);

COMMIT;
