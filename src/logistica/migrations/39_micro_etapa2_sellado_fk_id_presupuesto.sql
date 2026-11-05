-- =============================================================================
-- MIGRACIÓN 39: Micro-Etapa 2 - Sellado Relacional de presupuestos_detalles.id_presupuesto
-- y Limpieza de Índices Duplicados
-- =============================================================================
-- Propósito:
--   1. Backfill preventivo: si existiera algún renglón con id_presupuesto IS NULL
--      pero con id_presupuesto_ext coincidente en public.presupuestos, lo vincula
--      antes de sellar la restricción NOT NULL.
--   2. Sellar la columna public.presupuestos_detalles.id_presupuesto como NOT NULL
--      para que ningún proceso pueda insertar renglones huérfanos sin clave foránea entera.
--   3. Asegurar el índice sobre public.presupuestos_detalles(id_presupuesto) y
--      eliminar los 2 índices 100% duplicados en public.presupuestos_detalles:
--        - idx_detalles_fecha_actualizacion (duplicado de idx_presupuestos_detalles_fecha_actualizacion)
--        - idx_presupuestos_detalles_pext (duplicado de idx_presupuestos_detalles_ext_id)
-- =============================================================================

BEGIN;

-- 1. Backfill defensivo previo (en caso de existir alguna fila con id_presupuesto IS NULL)
UPDATE public.presupuestos_detalles pd
SET id_presupuesto = p.id
FROM public.presupuestos p
WHERE pd.id_presupuesto IS NULL
  AND pd.id_presupuesto_ext IS NOT NULL
  AND p.id_presupuesto_ext = pd.id_presupuesto_ext;

-- 2. Sellado físico de integridad relacional (NOT NULL sobre la Foreign Key entera)
ALTER TABLE public.presupuestos_detalles
    ALTER COLUMN id_presupuesto SET NOT NULL;

-- 3. Asegurar índice principal sobre la Foreign Key numérica id_presupuesto
CREATE INDEX IF NOT EXISTS idx_presupuestos_detalles_presupuesto
    ON public.presupuestos_detalles USING btree (id_presupuesto);

-- 4. Eliminación de los 2 índices 100% duplicados en presupuestos_detalles
DROP INDEX IF EXISTS public.idx_detalles_fecha_actualizacion;
DROP INDEX IF EXISTS public.idx_presupuestos_detalles_pext;

COMMIT;
