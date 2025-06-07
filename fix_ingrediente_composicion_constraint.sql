-- Script para agregar restricción única a la tabla ingrediente_composicion
-- Esto permitirá que funcione la cláusula ON CONFLICT en el código

-- Primero, verificar si ya existe la restricción
DO $$
BEGIN
    -- Intentar agregar la restricción única
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'ingrediente_composicion_mix_ingrediente_unique'
    ) THEN
        -- Eliminar duplicados si existen antes de agregar la restricción
        DELETE FROM ingrediente_composicion a USING (
            SELECT MIN(id) as id, mix_id, ingrediente_id 
            FROM ingrediente_composicion 
            GROUP BY mix_id, ingrediente_id 
            HAVING COUNT(*) > 1
        ) b
        WHERE a.mix_id = b.mix_id 
        AND a.ingrediente_id = b.ingrediente_id 
        AND a.id <> b.id;
        
        -- Agregar la restricción única
        ALTER TABLE ingrediente_composicion 
        ADD CONSTRAINT ingrediente_composicion_mix_ingrediente_unique 
        UNIQUE (mix_id, ingrediente_id);
        
        RAISE NOTICE 'Restricción única agregada exitosamente';
    ELSE
        RAISE NOTICE 'La restricción única ya existe';
    END IF;
END
$$;
