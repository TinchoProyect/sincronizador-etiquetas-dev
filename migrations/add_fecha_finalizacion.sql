-- Agregar columna fecha_finalizacion a la tabla carros_produccion
ALTER TABLE carros_produccion 
ADD COLUMN fecha_finalizacion TIMESTAMP NULL;

-- Crear índice para consultas por estado de finalización
CREATE INDEX idx_carros_fecha_finalizacion ON carros_produccion(fecha_finalizacion);

-- Comentarios para documentación
COMMENT ON COLUMN carros_produccion.fecha_finalizacion IS 'Fecha y hora cuando se finalizó la producción del carro';
