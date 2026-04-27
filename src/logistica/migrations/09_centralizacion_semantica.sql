-- Migración 09: Centralización Semántica de Ingesta
-- Fecha: 26 de Abril de 2026

ALTER TABLE logistica_satelite_eventos 
    ADD COLUMN IF NOT EXISTS latitud DECIMAL(10, 7) NULL,
    ADD COLUMN IF NOT EXISTS longitud DECIMAL(10, 7) NULL,
    ADD COLUMN IF NOT EXISTS raw_path TEXT NULL;
