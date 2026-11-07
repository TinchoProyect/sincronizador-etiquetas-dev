-- Auto-generado por scripts/auditarDiferenciasEsquemaDb.js

-- Fecha: 2026-11-07T04:06:09.019Z

CREATE TABLE IF NOT EXISTS public."insumos" (
    "id" SERIAL PRIMARY KEY,
    "nombre" TEXT,
    "descripcion" TEXT,
    "unidad_medida" TEXT,
    "stock_actual" NUMERIC DEFAULT 0,
    "costo_unitario" NUMERIC,
    "activo" BOOLEAN DEFAULT true,
    "fecha_creacion" TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public."logistica_satelite_eventos" ADD COLUMN IF NOT EXISTS "chofer_id" INTEGER;

ALTER TABLE public."logistica_satelite_puntos" ADD COLUMN IF NOT EXISTS "chofer_id" INTEGER;

CREATE TABLE IF NOT EXISTS public."receta_insumos" (
    "id" SERIAL PRIMARY KEY,
    "receta_id" INTEGER,
    "nombre_insumo" TEXT,
    "unidad_medida" TEXT,
    "cantidad" NUMERIC(10,2)
);
