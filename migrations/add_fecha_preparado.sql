-- Agregar columna fecha_preparado a la tabla carros_produccion
ALTER TABLE carros_produccion 
ADD COLUMN fecha_preparado TIMESTAMP NULL;

-- Crear índice para consultas por estado de preparación
CREATE INDEX idx_carros_fecha_preparado ON carros_produccion(fecha_preparado);

-- Comentarios para documentación
COMMENT ON COLUMN carros_produccion.fecha_preparado IS 'Fecha y hora cuando se marcó el carro como preparado para producir';
