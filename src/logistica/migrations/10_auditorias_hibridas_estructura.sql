-- ==============================================================================
-- TICKET #072: Migración DDL - Expansión de Auditoría Híbrida
-- Motor: PostgreSQL
-- Uso: Añade campos JSONB y métodos para almacenar el nuevo Motor Híbrido
-- ==============================================================================

BEGIN;

-- Añadir campos para persistencia del trace empírico (polilínea) y el origen
ALTER TABLE rutas_auditorias_tramos
ADD COLUMN IF NOT EXISTS trace_empirico JSONB,
ADD COLUMN IF NOT EXISTS metodo_conciliacion VARCHAR(255);

COMMIT;
