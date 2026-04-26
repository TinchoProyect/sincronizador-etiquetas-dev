-- ==============================================================================
-- TICKET #012: Migración DDL - Módulo de Conciliación de Rutas Offline
-- Motor: PostgreSQL
-- Uso: Ejecutar manualmente por Dirección (Auditoría)
-- ==============================================================================

BEGIN;

-- 1. Tabla de Puntos Base (Nodos Cero)
CREATE TABLE IF NOT EXISTS puntos_base (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    alias VARCHAR(50),
    latitud DOUBLE PRECISION NOT NULL,
    longitud DOUBLE PRECISION NOT NULL,
    radio_tolerancia_metros INTEGER DEFAULT 50,
    activo BOOLEAN DEFAULT true,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_puntos_base_activos ON puntos_base(activo);

-- 2. Tabla Cabecera de Auditorías (Rutas Conciliadas)
CREATE TABLE IF NOT EXISTS rutas_auditorias (
    id SERIAL PRIMARY KEY,
    id_ruta INTEGER NOT NULL,
    distancia_real_km DOUBLE PRECISION,
    tiempo_real_minutos INTEGER,
    desviacion_global_porcentaje DOUBLE PRECISION,
    fecha_auditoria TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    usuario_auditor VARCHAR(100),
    estado VARCHAR(50) DEFAULT 'BORRADOR', -- BORRADOR, CONFIRMADA
    CONSTRAINT fk_rutas_auditorias_ruta FOREIGN KEY (id_ruta) REFERENCES rutas(id) ON DELETE CASCADE
);

CREATE INDEX idx_rutas_auditorias_ruta ON rutas_auditorias(id_ruta);

-- 3. Tabla Detalle de Tramos (Micro-movimientos y Gestiones consolidadas)
CREATE TABLE IF NOT EXISTS rutas_auditorias_tramos (
    id SERIAL PRIMARY KEY,
    id_auditoria INTEGER NOT NULL,
    id_presupuesto INTEGER, -- Puede ser Nulo para Nodos Cero o Pausas no declaradas
    tipo_tramo VARCHAR(50) NOT NULL, -- Ej: 'TRASLADO', 'GESTION_CLIENTE', 'PAUSA_NO_DECLARADA', 'NODO_CERO'
    tiempo_duracion_minutos INTEGER,
    coordenada_real_lat DOUBLE PRECISION,
    coordenada_real_lng DOUBLE PRECISION,
    distancia_geocerca_metros DOUBLE PRECISION,
    hora_inicio TIMESTAMP,
    hora_fin TIMESTAMP,
    CONSTRAINT fk_tramos_auditoria FOREIGN KEY (id_auditoria) REFERENCES rutas_auditorias(id) ON DELETE CASCADE,
    CONSTRAINT fk_tramos_presupuesto FOREIGN KEY (id_presupuesto) REFERENCES presupuestos(id) ON DELETE SET NULL
);

CREATE INDEX idx_tramos_auditoria ON rutas_auditorias_tramos(id_auditoria);
CREATE INDEX idx_tramos_presupuesto ON rutas_auditorias_tramos(id_presupuesto);

COMMIT;
