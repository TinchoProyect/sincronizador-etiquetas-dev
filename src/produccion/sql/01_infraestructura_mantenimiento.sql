-- =========================================================================================
-- SCRIPT DE INFRAESTRUCTURA - ALMACÉN DE MANTENIMIENTO (FASE 1) - CORREGIDO FK
-- =========================================================================================
-- Autor: Antigravity (Agente AI)
-- Fecha: 2026-01-23
-- Descripción:
-- Implementa la "zona de cuarentena" para stock en mantenimiento.
-- CORRECCIÓN: La tabla mantenimiento_movimientos referencia a articulos.id en lugar de codigo_barras.
-- =========================================================================================

-- -----------------------------------------------------------------------------------------
-- 1. MODIFICACIÓN DE ESQUEMA (DDL)
-- -----------------------------------------------------------------------------------------

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
        
        RAISE NOTICE '✅ Columna stock_mantenimiento añadida correctamente.';
    ELSE 
        RAISE NOTICE 'ℹ️ La columna stock_mantenimiento ya existe.';
    END IF;
END $$;

-- -----------------------------------------------------------------------------------------
-- 2. TABLA DE AUDITORÍA
-- -----------------------------------------------------------------------------------------

-- Crear tabla para trazabilidad de movimientos de mantenimiento
CREATE TABLE IF NOT EXISTS public.mantenimiento_movimientos (
    id SERIAL PRIMARY KEY,
    articulo_id INTEGER NOT NULL REFERENCES public.articulos(id), -- CORRECCION: Referencia a ID numérico
    cantidad NUMERIC(10,3) NOT NULL,
    id_presupuesto_origen INTEGER, 
    fecha_movimiento TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    usuario VARCHAR(100) NOT NULL,
    tipo_movimiento VARCHAR(50) NOT NULL CHECK (tipo_movimiento IN ('INGRESO', 'LIBERACION', 'AJUSTE', 'DESCARTE')),
    observaciones TEXT,
    estado VARCHAR(20) DEFAULT 'FINALIZADO' CHECK (estado IN ('PENDIENTE', 'FINALIZADO', 'CANCELADO'))
);

COMMENT ON TABLE public.mantenimiento_movimientos IS 'Auditoría de todos los movimientos de entrada y salida del almacén de mantenimiento.';

-- -----------------------------------------------------------------------------------------
-- 3. FUNCIÓN DE LIBERACIÓN DE STOCK
-- -----------------------------------------------------------------------------------------

-- Función para mover stock desde Mantenimiento hacia Stock Operativo
CREATE OR REPLACE FUNCTION public.liberar_stock_mantenimiento(
    p_articulo_numero VARCHAR, -- Recibe articulo_numero (codigo_barras) param
    p_cantidad NUMERIC,
    p_usuario VARCHAR,
    p_obs TEXT
)
RETURNS JSON AS $$
DECLARE
    v_stock_actual_mantenimiento NUMERIC;
    v_nuevo_stock_ajustes NUMERIC;
    v_nuevo_consolidado NUMERIC;
    v_articulo_id INTEGER;
BEGIN
    -- 0. Obtener ID del artículo
    SELECT id INTO v_articulo_id FROM public.articulos WHERE codigo_barras = p_articulo_numero LIMIT 1;
    
    IF v_articulo_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Articulo no encontrado: ' || p_articulo_numero);
    END IF;

    -- 1. Verificar stock suficiente en mantenimiento
    SELECT COALESCE(stock_mantenimiento, 0) INTO v_stock_actual_mantenimiento
    FROM public.stock_real_consolidado
    WHERE articulo_numero = p_articulo_numero;

    IF v_stock_actual_mantenimiento IS NULL OR v_stock_actual_mantenimiento < p_cantidad THEN
        RETURN json_build_object(
            'success', false, 
            'error', 'Stock insuficiente en mantenimiento. Disponible: ' || COALESCE(v_stock_actual_mantenimiento, 0)
        );
    END IF;

    -- 2. Registrar movimiento en auditoría (Usando ID)
    INSERT INTO public.mantenimiento_movimientos (
        articulo_id, cantidad, usuario, tipo_movimiento, observaciones, fecha_movimiento
    ) VALUES (
        v_articulo_id, p_cantidad, p_usuario, 'LIBERACION', p_obs, NOW()
    );

    -- 3. Actualizar stock_real_consolidado (Transacción Atómica)
    UPDATE public.stock_real_consolidado
    SET 
        stock_mantenimiento = stock_mantenimiento - p_cantidad,
        stock_ajustes = COALESCE(stock_ajustes, 0) + p_cantidad,
        stock_consolidado = COALESCE(stock_lomasoft, 0) + COALESCE(stock_movimientos, 0) + (COALESCE(stock_ajustes, 0) + p_cantidad),
        ultima_actualizacion = NOW()
    WHERE articulo_numero = p_articulo_numero
    RETURNING stock_ajustes, stock_consolidado INTO v_nuevo_stock_ajustes, v_nuevo_consolidado;

    -- 4. Retornar resultado
    RETURN json_build_object(
        'success', true,
        'mensaje', 'Stock liberado correctamente',
        'articulo', p_articulo_numero,
        'cantidad_liberada', p_cantidad,
        'nuevo_stock_mantenimiento', v_stock_actual_mantenimiento - p_cantidad,
        'nuevo_consolidado', v_nuevo_consolidado
    );

EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object(
        'success', false,
        'error', SQLERRM,
        'detail', SQLSTATE
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.liberar_stock_mantenimiento IS 'Mueve stock desde mantenimiento a stock operativo actualizando stock_ajustes y recalculando el consolidado.';
