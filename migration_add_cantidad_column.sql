-- Migración para agregar columna cantidad a stock_ventas_movimientos
-- Fecha: 2025-01-06
-- Propósito: Separar el registro de cantidad (unidades) de kilos (peso)

-- Agregar la nueva columna cantidad
ALTER TABLE stock_ventas_movimientos 
ADD COLUMN cantidad DECIMAL(10,2) DEFAULT NULL;

-- Comentario para documentar el cambio
COMMENT ON COLUMN stock_ventas_movimientos.cantidad IS 'Cantidad de unidades del artículo (separado de kilos que representa peso)';

-- Verificar la estructura de la tabla después del cambio
-- SELECT column_name, data_type, is_nullable, column_default 
-- FROM information_schema.columns 
-- WHERE table_name = 'stock_ventas_movimientos' 
-- ORDER BY ordinal_position;
