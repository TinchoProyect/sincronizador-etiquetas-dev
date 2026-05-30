-- ==============================================================================
-- TICKET #073: Migración DDL - Soporte Dual de Stock en Ingredientes
-- Motor: PostgreSQL
-- Uso: Añade campos stock_bultos a ingredientes y bultos a ingredientes_movimientos.
--      Actualiza el disparador de actualización de stock para manejar duales.
-- ==============================================================================

BEGIN;

-- 1. Agregar columna stock_bultos en ingredientes (para cajas físicas)
ALTER TABLE public.ingredientes 
ADD COLUMN IF NOT EXISTS stock_bultos NUMERIC DEFAULT 0;

-- 2. Agregar columna bultos en ingredientes_movimientos
ALTER TABLE public.ingredientes_movimientos 
ADD COLUMN IF NOT EXISTS bultos NUMERIC DEFAULT 0;

-- 3. Actualizar la función trigger para recalcular stock_actual y stock_bultos en sincronía
CREATE OR REPLACE FUNCTION public.actualizar_stock_ingrediente()
RETURNS TRIGGER AS $$
BEGIN
  -- Si es un INSERT
  IF (TG_OP = 'INSERT') THEN
    UPDATE public.ingredientes
    SET stock_actual = COALESCE(stock_actual, 0) + NEW.kilos,
        stock_bultos = COALESCE(stock_bultos, 0) + COALESCE(NEW.bultos, 0)
    WHERE id = NEW.ingrediente_id;

  -- Si es un DELETE
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE public.ingredientes
    SET stock_actual = COALESCE(stock_actual, 0) - OLD.kilos,
        stock_bultos = COALESCE(stock_bultos, 0) - COALESCE(OLD.bultos, 0)
    WHERE id = OLD.ingrediente_id;

  -- Si es un UPDATE
  ELSIF (TG_OP = 'UPDATE') THEN
    -- Si cambió el ingrediente_id, actualizar ambos ingredientes
    IF (NEW.ingrediente_id <> OLD.ingrediente_id) THEN
      UPDATE public.ingredientes
      SET stock_actual = COALESCE(stock_actual, 0) - OLD.kilos,
          stock_bultos = COALESCE(stock_bultos, 0) - COALESCE(OLD.bultos, 0)
      WHERE id = OLD.ingrediente_id;

      UPDATE public.ingredientes
      SET stock_actual = COALESCE(stock_actual, 0) + NEW.kilos,
          stock_bultos = COALESCE(stock_bultos, 0) + COALESCE(NEW.bultos, 0)
      WHERE id = NEW.ingrediente_id;
    ELSE
      -- Si es el mismo ingrediente, solo ajustar la diferencia
      UPDATE public.ingredientes
      SET stock_actual = COALESCE(stock_actual, 0) + (NEW.kilos - OLD.kilos),
          stock_bultos = COALESCE(stock_bultos, 0) + (COALESCE(NEW.bultos, 0) - COALESCE(OLD.bultos, 0))
      WHERE id = NEW.ingrediente_id;
    END IF;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMIT;
