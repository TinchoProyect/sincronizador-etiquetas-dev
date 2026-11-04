-- Migración 17: Módulo de Valorización y Control de Costo Patrón
-- Agrega el campo costo_patron a la tabla ingredientes. La valorización total se calcula dinámicamente en las consultas.

ALTER TABLE public.ingredientes
ADD COLUMN IF NOT EXISTS costo_patron NUMERIC(10, 2) DEFAULT 0.00;
