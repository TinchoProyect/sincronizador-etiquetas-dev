-- Script para verificar que la tabla ingredientes_ajustes existe y tiene la estructura correcta

-- Verificar si la tabla existe
SELECT 
    table_name,
    table_schema
FROM information_schema.tables 
WHERE table_name = 'ingredientes_ajustes';

-- Verificar la estructura de la tabla
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'ingredientes_ajustes'
ORDER BY ordinal_position;

-- Verificar constraints
SELECT 
    constraint_name,
    constraint_type
FROM information_schema.table_constraints 
WHERE table_name = 'ingredientes_ajustes';

-- Ejemplo de consulta para ver registros (si existen)
SELECT 
    id,
    ingrediente_id,
    usuario_id,
    tipo_ajuste,
    stock_anterior,
    stock_nuevo,
    diferencia,
    observacion,
    fecha
FROM ingredientes_ajustes 
ORDER BY fecha DESC 
LIMIT 5;
