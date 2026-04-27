-- Migración 07: Reservorio Cronológico Satelital nativo
-- Fecha: 26 de Abril de 2026

CREATE TABLE IF NOT EXISTS logistica_satelite_puntos (
    id BIGSERIAL PRIMARY KEY,
    timestamp_ms BIGINT NOT NULL,
    latitud DECIMAL(10, 7) NOT NULL,
    longitud DECIMAL(10, 7) NOT NULL,
    precision_metros INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_tiempo UNIQUE (timestamp_ms)
);

CREATE INDEX IF NOT EXISTS idx_tiempo ON logistica_satelite_puntos (timestamp_ms);

CREATE TABLE IF NOT EXISTS logistica_satelite_eventos (
    id BIGSERIAL PRIMARY KEY,
    timestamp_inicio BIGINT NOT NULL,
    timestamp_fin BIGINT NOT NULL,
    tipo_evento VARCHAR(50) NOT NULL,
    nombre_referencia VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_evento_tiempo ON logistica_satelite_eventos (timestamp_inicio);
