-- ============================================================================
-- MIGRACIÓN DDL: 28_marcado_revision_diccionario.sql
-- OBJETIVO: Estrategia de Resaltador Visual y Marcado en Revisión para el Diccionario Búnker
-- PROTOCOLO: ESTRICTO (Ejecución en db 'etiquetas' y 'etiquetas_pruebas')
-- ============================================================================

BEGIN;

-- 1. Incorporar columnas booleanas de marcado visual
ALTER TABLE public.bunker_diccionario 
ADD COLUMN IF NOT EXISTS en_revision BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS obsoleto BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Índices parciales optimizados para el Resaltador Visual
CREATE INDEX IF NOT EXISTS idx_bunker_diccionario_en_revision 
ON public.bunker_diccionario (en_revision) 
WHERE en_revision = TRUE;

CREATE INDEX IF NOT EXISTS idx_bunker_diccionario_obsoleto 
ON public.bunker_diccionario (obsoleto) 
WHERE obsoleto = TRUE;

COMMIT;
