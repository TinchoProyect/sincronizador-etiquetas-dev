-- Verificar si la tabla ingredientes_ajustes existe y su estructura
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
