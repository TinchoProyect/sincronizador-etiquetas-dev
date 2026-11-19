-- Ampliación idempotente del CHECK constraint de tipo_movimiento en mantenimiento_movimientos
-- para habilitar el destino terminal 'DESCARTE' (sin agregar tablas ni columnas nuevas).
ALTER TABLE public.mantenimiento_movimientos
    DROP CONSTRAINT IF EXISTS mantenimiento_movimientos_tipo_movimiento_check;

ALTER TABLE public.mantenimiento_movimientos
    ADD CONSTRAINT mantenimiento_movimientos_tipo_movimiento_check
    CHECK (
        tipo_movimiento::text = ANY (ARRAY[
            'ENTRADA'::character varying,
            'SALIDA'::character varying,
            'LIBERACION'::character varying,
            'AJUSTE'::character varying,
            'TRANSFERENCIA'::character varying,
            'TRANSF_INGREDIENTE'::character varying,
            'REVERSION'::character varying,
            'INGRESO'::character varying,
            'INGRESO_TRATAMIENTO'::character varying,
            'EGRESO_TRATAMIENTO'::character varying,
            'TRASLADO_INTERNO_VENTAS'::character varying,
            'TRASLADO_INTERNO_INGREDIENTES'::character varying,
            'EMISION_NC'::character varying,
            'ENVIO_TRATAMIENTO'::character varying,
            'RETORNO_TRATAMIENTO'::character varying,
            'RETIRO_TRATAMIENTO'::character varying,
            'DESCARTE'::character varying
        ]::text[])
    );
