/**
 * Migración estructural idempotente para habilitar el tipo de movimiento
 * terminal 'DESCARTE' en `public.mantenimiento_movimientos`.
 * Cero tablas nuevas y cero columnas nuevas: únicamente amplía el CHECK
 * constraint `mantenimiento_movimientos_tipo_movimiento_check` si aún no incluye 'DESCARTE'.
 */

let _descarteCheckVerificado = false;

async function asegurarCheckDescarteMantenimiento(db) {
    if (_descarteCheckVerificado) {
        return { verificado: true, actualizado: false };
    }

    const res = await db.query(`
        SELECT pg_get_constraintdef(oid) AS def
        FROM pg_constraint
        WHERE conrelid = 'public.mantenimiento_movimientos'::regclass
          AND conname = 'mantenimiento_movimientos_tipo_movimiento_check'
          AND contype = 'c'
    `);

    const defActual = res.rows[0]?.def || '';
    if (defActual.includes("'DESCARTE'")) {
        _descarteCheckVerificado = true;
        return { verificado: true, actualizado: false };
    }

    await db.query(`
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
    `);

    _descarteCheckVerificado = true;
    return { verificado: true, actualizado: true };
}

module.exports = { asegurarCheckDescarteMantenimiento };
