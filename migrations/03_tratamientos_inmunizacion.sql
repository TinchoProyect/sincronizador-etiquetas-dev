-- Migración para el Módulo de Tratamientos/Inmunización
-- ATENCIÓN CRÍTICA: Debe ejecutarse tanto en el Entorno de PRUEBA como en PRODUCCIÓN.
-- Genera el esquema aislado comercialmente para el manejo de "Retiros de Tratamiento".

BEGIN;

CREATE TABLE IF NOT EXISTS ordenes_tratamiento (
    id SERIAL PRIMARY KEY,
    id_cliente INTEGER NOT NULL,
    id_ruta INTEGER,
    id_chofer INTEGER,
    estado_logistico VARCHAR(50) DEFAULT 'PENDIENTE_CLIENTE',
    orden_entrega INTEGER DEFAULT 999,
    codigo_qr_hash VARCHAR(128) UNIQUE,
    responsable_nombre VARCHAR(100),
    responsable_apellido VARCHAR(100),
    responsable_celular VARCHAR(50),
    chofer_nombre VARCHAR(100),
    fecha_creacion TIMESTAMP DEFAULT NOW(),
    fecha_validacion_chofer TIMESTAMP,
    fecha_ingreso_mantenimiento TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ordenes_tratamiento_detalles (
    id SERIAL PRIMARY KEY,
    id_orden_tratamiento INTEGER NOT NULL REFERENCES ordenes_tratamiento(id) ON DELETE CASCADE,
    articulo_numero VARCHAR(50), 
    descripcion_externa VARCHAR(255), 
    kilos NUMERIC(10,2) NOT NULL,
    bultos INTEGER NOT NULL,
    motivo VARCHAR(255) NOT NULL,
    estado VARCHAR(50) DEFAULT 'PENDIENTE',
    CONSTRAINT chk_articulo_or_descripcion CHECK (articulo_numero IS NOT NULL OR descripcion_externa IS NOT NULL)
);

-- Alteración de almacenamiento en tabla historial (mantenimiento_movimientos)
ALTER TABLE mantenimiento_movimientos 
ADD COLUMN IF NOT EXISTS id_orden_tratamiento INTEGER REFERENCES ordenes_tratamiento(id);

-- Ajuste de Restricción del DOMINIO de Movimientos Histórico
ALTER TABLE mantenimiento_movimientos 
DROP CONSTRAINT IF EXISTS mantenimiento_movimientos_tipo_movimiento_check;

ALTER TABLE mantenimiento_movimientos 
ADD CONSTRAINT mantenimiento_movimientos_tipo_movimiento_check 
CHECK (tipo_movimiento IN ('ENTRADA', 'SALIDA', 'LIBERACION', 'AJUSTE', 'TRANSFERENCIA', 'TRANSF_INGREDIENTE', 'REVERSION', 'INGRESO', 'INGRESO_TRATAMIENTO', 'EGRESO_TRATAMIENTO', 'TRASLADO_INTERNO_VENTAS', 'TRASLADO_INTERNO_INGREDIENTES', 'EMISION_NC', 'ENVIO_TRATAMIENTO', 'RETORNO_TRATAMIENTO'));

COMMIT;
