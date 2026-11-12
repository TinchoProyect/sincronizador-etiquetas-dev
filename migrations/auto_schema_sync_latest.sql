-- Auto-generado por scripts/auditarDiferenciasEsquemaDb.js

-- Fecha: 2026-11-12T20:55:26.454Z

ALTER TABLE public."nodos_maestro" ADD COLUMN IF NOT EXISTS "mostrar_ingredientes_tienda" BOOLEAN DEFAULT true;

ALTER TABLE public."nodos_ofertas_gestor" ADD COLUMN IF NOT EXISTS "mostrar_ingredientes" BOOLEAN DEFAULT true;
