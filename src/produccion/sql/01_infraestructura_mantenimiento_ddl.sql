-- =========================================================================================
-- BLOQUE 1: ESTRUCTURA DDL (DESACOPLADA)
-- =========================================================================================

-- 1. Añadir columna stock_mantenimiento
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'stock_real_consolidado' 
        AND column_name = 'stock_mantenimiento'
    ) THEN 
        ALTER TABLE public.stock_real_consolidado 
        ADD COLUMN stock_mantenimiento NUMERIC(10,3) DEFAULT 0;
        RAISE NOTICE '✅ Columna stock_mantenimiento añadida.';
    END IF;
END $$;

-- 2. Crear tabla de auditoría (SIN DEPENDENCIA EXTERNA)
-- Se elimina la tabla previa si existe para asegurar la nueva estructura limpia
DROP TABLE IF EXISTS public.mantenimiento_movimientos;

CREATE TABLE public.mantenimiento_movimientos (
    id SERIAL PRIMARY KEY,
    articulo_numero VARCHAR(50) NOT NULL, -- SIN REFERENCES (Desacoplado de tabla articulos)
    cantidad NUMERIC(10,3) NOT NULL,
    id_presupuesto_origen INTEGER, 
    fecha_movimiento TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    usuario VARCHAR(100) NOT NULL,
    tipo_movimiento VARCHAR(50) NOT NULL CHECK (tipo_movimiento IN ('INGRESO', 'LIBERACION', 'AJUSTE', 'DESCARTE')),
    observaciones TEXT,
    estado VARCHAR(20) DEFAULT 'FINALIZADO' CHECK (estado IN ('PENDIENTE', 'FINALIZADO', 'CANCELADO'))
);

COMMENT ON TABLE public.mantenimiento_movimientos IS 'Auditoría de mantenimiento. Identificador: articulo_numero (Independiente de tabla articulos).';
