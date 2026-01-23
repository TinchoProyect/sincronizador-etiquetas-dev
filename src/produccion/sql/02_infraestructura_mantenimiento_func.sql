-- =========================================================================================
-- BLOQUE 2: LÓGICA DE FUNCIÓN (DESACOPLADA)
-- =========================================================================================

CREATE OR REPLACE FUNCTION public.liberar_stock_mantenimiento(
    p_articulo_numero VARCHAR, 
    p_cantidad NUMERIC,
    p_usuario VARCHAR,
    p_obs TEXT
)
RETURNS JSON AS $$
DECLARE
    v_stock_actual_mantenimiento NUMERIC;
    v_nuevo_stock_ajustes NUMERIC;
    v_nuevo_consolidado NUMERIC;
BEGIN
    -- 1. Verificar stock suficiente en mantenimiento
    -- Se busca directamente en stock_real_consolidado, sin validar contra la tabla articulos volátil
    SELECT COALESCE(stock_mantenimiento, 0) INTO v_stock_actual_mantenimiento
    FROM public.stock_real_consolidado
    WHERE articulo_numero = p_articulo_numero;

    IF v_stock_actual_mantenimiento IS NULL THEN
         RETURN json_build_object('success', false, 'error', 'Articulo no encontrado en stock consolidado: ' || p_articulo_numero);
    END IF;

    IF v_stock_actual_mantenimiento < p_cantidad THEN
        RETURN json_build_object(
            'success', false, 
            'error', 'Stock insuficiente en mantenimiento. Disponible: ' || COALESCE(v_stock_actual_mantenimiento, 0)
        );
    END IF;

    -- 2. Registrar movimiento en auditoría (Usando articulo_numero)
    INSERT INTO public.mantenimiento_movimientos (
        articulo_numero, cantidad, usuario, tipo_movimiento, observaciones, fecha_movimiento
    ) VALUES (
        p_articulo_numero, p_cantidad, p_usuario, 'LIBERACION', p_obs, NOW()
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

COMMENT ON FUNCTION public.liberar_stock_mantenimiento IS 'Mueve stock desde mantenimiento a stock operativo (Versión Desacoplada - Sin FK).';
