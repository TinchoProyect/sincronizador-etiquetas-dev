/**
 * Migración estructural idempotente + backfill valorizado para Registro de Descartes en Mantenimiento.
 * 1. Crea `public.mantenimiento_motivos_descarte` y realiza seed de los 5 motivos estándar.
 * 2. Agrega las 4 columnas nullable en `public.mantenimiento_movimientos`
 *    (`motivo_descarte_id`, `costo_unitario_snapshot`, `costo_total_descarte`, `costo_fuente`).
 * 3. Backfill idempotente sobre movimientos `tipo_movimiento = 'DESCARTE'` que aún no tengan
 *    costo congelado o motivo vinculado (incluyendo el RT-40 Mov #435 en Producción).
 */

const { calcularCostoIntegradoArticulo } = require('../../facturacion/services/costoIntegradoService');

const MOTIVOS_BASE = [
    'Deformación y aplastamiento',
    'Vencimiento / Fecha pasada',
    'Envase roto / abierto',
    'Humedad / Hongos',
    'Plaga / Contaminación'
];

let _esquemaDescartesVerificado = false;

function normalizarMotivoDescarte(texto) {
    return String(texto || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

async function resolverMotivoParaTexto(db, textoRaw) {
    const limpio = String(textoRaw || '')
        .replace(/^\[DESCARTE\]\s*/i, '')
        .trim();

    let nombreObjetivo = null;
    if (/aplastad|deform|desarmad/i.test(limpio)) {
        nombreObjetivo = 'Deformación y aplastamiento';
    } else if (/vencid|fecha/i.test(limpio)) {
        nombreObjetivo = 'Vencimiento / Fecha pasada';
    } else if (/rot[oa]|abiert|envase/i.test(limpio)) {
        nombreObjetivo = 'Envase roto / abierto';
    } else if (/humed|hongo|moho/i.test(limpio)) {
        nombreObjetivo = 'Humedad / Hongos';
    } else if (/plaga|gorgoj|bicho|contam/i.test(limpio)) {
        nombreObjetivo = 'Plaga / Contaminación';
    } else if (limpio.length >= 3) {
        nombreObjetivo = limpio.slice(0, 120);
    } else {
        nombreObjetivo = 'Deformación y aplastamiento';
    }

    const norm = normalizarMotivoDescarte(nombreObjetivo);
    const res = await db.query(`
        INSERT INTO public.mantenimiento_motivos_descarte (nombre, nombre_normalizado, veces_usado, activo)
        VALUES ($1, $2, 0, TRUE)
        ON CONFLICT (nombre_normalizado)
        DO UPDATE SET activo = TRUE
        RETURNING id, nombre
    `, [nombreObjetivo, norm]);
    return res.rows[0];
}

async function calcularCostoDescarteParaMovimiento(db, mov) {
    const cant = parseFloat(mov.cantidad) || 0;
    if (cant <= 0) {
        return { costoUnitario: 0, costoTotal: 0, fuente: 'CANTIDAD_CERO' };
    }

    // 1. Si provino de devolución con NC ARCA aprobada por la misma cantidad y con costo congelado, tomar ese costo exacto
    if (mov.articulo_numero && (mov.id_presupuesto_origen || mov.id_orden_tratamiento)) {
        try {
            const resNC = await db.query(`
                SELECT ff.costo_estimado_total, mm_nc.cantidad AS nc_cantidad
                FROM public.mantenimiento_movimientos mm_nc
                JOIN public.factura_facturas ff
                  ON ff.id = (SUBSTRING(mm_nc.observaciones FROM '\\[NC Generada ID: (\\d+)\\]'))::int
                WHERE mm_nc.tipo_movimiento = 'EMISION_NC'
                  AND mm_nc.estado NOT IN ('ANULADO', 'REVERTIDO')
                  AND ff.estado IN ('APROBADA', 'APROBADA_LOCAL')
                  AND ff.costo_estimado_total IS NOT NULL
                  AND ff.costo_estimado_total > 0
                  AND (
                      ($1::int IS NOT NULL AND mm_nc.id_presupuesto_origen = $1::int)
                      OR ($2::int IS NOT NULL AND mm_nc.observaciones LIKE '%[MovID: ' || (
                          SELECT id FROM public.mantenimiento_movimientos
                          WHERE id_orden_tratamiento = $2::int AND tipo_movimiento = 'RETIRO_TRATAMIENTO'
                          ORDER BY id DESC LIMIT 1
                      )::text || ']%')
                  )
                  AND (
                      mm_nc.articulo_numero = $3
                      OR mm_nc.articulo_numero = (SELECT numero FROM public.articulos WHERE codigo_barras = $3 LIMIT 1)
                      OR mm_nc.articulo_numero = (SELECT codigo_barras FROM public.articulos WHERE numero = $3 LIMIT 1)
                  )
                ORDER BY ff.id DESC
                LIMIT 1
            `, [mov.id_presupuesto_origen || null, mov.id_orden_tratamiento || null, mov.articulo_numero]);

            if (resNC.rows.length > 0) {
                const ncCostoTot = parseFloat(resNC.rows[0].costo_estimado_total) || 0;
                const ncCant = parseFloat(resNC.rows[0].nc_cantidad) || 0;
                if (ncCostoTot > 0 && ncCant > 0) {
                    const costoUnit = Math.round((ncCostoTot / ncCant) * 100) / 100;
                    const costoTot = Math.abs(ncCant - cant) < 0.0005
                        ? Math.round(ncCostoTot * 100) / 100
                        : Math.round((costoUnit * cant) * 100) / 100;
                    return { costoUnitario: costoUnit, costoTotal: costoTot, fuente: 'NC_ORIGEN' };
                }
            }
        } catch (errNc) {
            console.warn('⚠️ [COSTO-DESCARTE] No se pudo consultar costo en NC origen, usando motor integrado:', errNc.message);
        }
    }

    // 2. Motor canónico oficial de Costo Integrado LAMDA (artículos Búnker/Receta e ingredientes costo_patron)
    const identificador = (mov.articulo_numero && String(mov.articulo_numero).trim() !== '')
        ? String(mov.articulo_numero).trim()
        : (mov.ingrediente_id ? String(mov.ingrediente_id) : null);

    if (!identificador) {
        return { costoUnitario: 0, costoTotal: 0, fuente: 'SIN_IDENTIFICADOR' };
    }

    const resCosto = await calcularCostoIntegradoArticulo(db, identificador, 1);
    const costoUnit = Math.round((parseFloat(resCosto.costo_unitario) || 0) * 100) / 100;
    const costoTot = Math.round((costoUnit * cant) * 100) / 100;
    return {
        costoUnitario: costoUnit,
        costoTotal: costoTot,
        fuente: resCosto.fuente || 'COSTO_INTEGRADO'
    };
}

async function ejecutarBackfillDescartes(db) {
    const pendientes = await db.query(`
        SELECT id, id_presupuesto_origen, id_orden_tratamiento, articulo_numero, ingrediente_id,
               cantidad, observaciones, motivo_descarte_id, costo_total_descarte
        FROM public.mantenimiento_movimientos
        WHERE tipo_movimiento = 'DESCARTE'
          AND estado IS DISTINCT FROM 'REVERTIDO'
          AND estado IS DISTINCT FROM 'ANULADO'
          AND (costo_total_descarte IS NULL OR motivo_descarte_id IS NULL)
        ORDER BY id ASC
    `);

    let actualizados = 0;
    for (const mov of pendientes.rows) {
        let motivoId = mov.motivo_descarte_id;
        if (!motivoId) {
            const motivoRes = await resolverMotivoParaTexto(db, mov.observaciones);
            motivoId = motivoRes.id;
        }

        let costoUnit = null;
        let costoTot = null;
        let costoFuente = null;
        if (mov.costo_total_descarte === null || mov.costo_total_descarte === undefined) {
            const c = await calcularCostoDescarteParaMovimiento(db, mov);
            costoUnit = c.costoUnitario;
            costoTot = c.costoTotal;
            costoFuente = c.fuente;
        }

        await db.query(`
            UPDATE public.mantenimiento_movimientos
            SET motivo_descarte_id = COALESCE(motivo_descarte_id, $2),
                costo_unitario_snapshot = COALESCE(costo_unitario_snapshot, $3),
                costo_total_descarte = COALESCE(costo_total_descarte, $4),
                costo_fuente = COALESCE(costo_fuente, $5)
            WHERE id = $1
        `, [mov.id, motivoId, costoUnit, costoTot, costoFuente]);

        actualizados++;
    }

    // Recalcular veces_usado de forma exacta e idempotente a partir de los descartes reales
    if (actualizados > 0) {
        await db.query(`
            UPDATE public.mantenimiento_motivos_descarte m
            SET veces_usado = COALESCE(sub.cnt, 0)
            FROM (
                SELECT motivo_descarte_id, COUNT(*)::int AS cnt
                FROM public.mantenimiento_movimientos
                WHERE tipo_movimiento = 'DESCARTE'
                  AND motivo_descarte_id IS NOT NULL
                  AND estado IS DISTINCT FROM 'REVERTIDO'
                  AND estado IS DISTINCT FROM 'ANULADO'
                GROUP BY motivo_descarte_id
            ) sub
            WHERE m.id = sub.motivo_descarte_id
        `);
    }

    return actualizados;
}

async function asegurarEsquemaDescartesMantenimiento(db, { forzarBackfill = false } = {}) {
    if (_esquemaDescartesVerificado && !forzarBackfill) {
        return { verificado: true, backfill_actualizados: 0 };
    }

    await db.query(`
        CREATE TABLE IF NOT EXISTS public.mantenimiento_motivos_descarte (
            id SERIAL PRIMARY KEY,
            nombre VARCHAR(120) NOT NULL,
            nombre_normalizado VARCHAR(120) NOT NULL UNIQUE,
            veces_usado INTEGER NOT NULL DEFAULT 0,
            activo BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    for (const nombre of MOTIVOS_BASE) {
        await db.query(`
            INSERT INTO public.mantenimiento_motivos_descarte (nombre, nombre_normalizado, veces_usado, activo)
            VALUES ($1, $2, 0, TRUE)
            ON CONFLICT (nombre_normalizado) DO NOTHING
        `, [nombre, normalizarMotivoDescarte(nombre)]);
    }

    await db.query(`
        ALTER TABLE public.mantenimiento_movimientos
            ADD COLUMN IF NOT EXISTS motivo_descarte_id INTEGER REFERENCES public.mantenimiento_motivos_descarte(id),
            ADD COLUMN IF NOT EXISTS costo_unitario_snapshot NUMERIC(14, 2),
            ADD COLUMN IF NOT EXISTS costo_total_descarte NUMERIC(14, 2),
            ADD COLUMN IF NOT EXISTS costo_fuente VARCHAR(40);
    `);

    const backfillActualizados = await ejecutarBackfillDescartes(db);
    _esquemaDescartesVerificado = true;
    return { verificado: true, backfill_actualizados: backfillActualizados };
}

module.exports = {
    asegurarEsquemaDescartesMantenimiento,
    ejecutarBackfillDescartes,
    normalizarMotivoDescarte,
    calcularCostoDescarteParaMovimiento
};
