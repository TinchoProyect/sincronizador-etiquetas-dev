-- Migración 08: Ingesta Cinemática y Stay-Points
-- Fecha: 26 de Abril de 2026

ALTER TABLE logistica_satelite_puntos 
    ADD COLUMN IF NOT EXISTS ruido_sincronizacion BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS velocidad_calculada_kmh DECIMAL(10,2) NULL,
    ADD COLUMN IF NOT EXISTS es_parada_real BOOLEAN DEFAULT FALSE;
