/**
 * Servicio Compartido de Auditoría de Operaciones Huérfanas (Local PcAlmacen ↔ Nube Cloud)
 * -----------------------------------------------------------------------------------------
 * Inspecciona las 11 tablas operativas clave desde una fecha de corte (por defecto 2026-11-09),
 * compara el inventario local contra `etiquetas` en la Nube (100% solo lectura sobre datos de negocio),
 * detecta tanto registros ausentes en Nube como colisiones de secuencia (`COLISION_ID_DIVERGENTE`),
 * y persiste alertas visibles en la Pizarra de Cloud (`public.sistema_auditoria_huerfanas_local`).
 */

const os = require('os');
let defaultPool = null;
function getDefaultPool() {
    if (!defaultPool) {
        defaultPool = require('../config/db');
    }
    return defaultPool;
}

const TABLAS_OPERATIVAS_AUDITABLES = [
    {
        tabla: 'bunker_lotes_vinculos',
        etiqueta: 'Vínculos de Lotes Búnker',
        pk: 'lote_id_supabase',
        dateCols: ['fecha_vinculacion'],
        summaryCols: ['lote_codigo_corto', 'proveedor_nombre', 'producto_codigo', 'articulo_descripcion', 'numero_remito'],
        altCols: ['lote_id_supabase']
    },
    {
        tabla: 'stock_ventas_movimientos',
        etiqueta: 'Movimientos Stock / Ventas / Lotes',
        pk: 'id',
        dateCols: ['fecha'],
        summaryCols: ['articulo_numero', 'tipo', 'cantidad', 'kilos', 'origen_ingreso', 'carro_id', 'observaciones'],
        altCols: ['articulo_numero', 'tipo', 'cantidad', 'origen_ingreso']
    },
    {
        tabla: 'articulos_ajustes',
        etiqueta: 'Ajustes de Artículos',
        pk: 'id',
        dateCols: ['fecha', 'created_at'],
        summaryCols: ['articulo_numero', 'cantidad', 'diferencia', 'motivo', 'observaciones'],
        altCols: ['articulo_numero', 'cantidad', 'diferencia']
    },
    {
        tabla: 'ingredientes_movimientos',
        etiqueta: 'Movimientos de Ingredientes',
        pk: 'id',
        dateCols: ['fecha'],
        summaryCols: ['ingrediente_id', 'tipo', 'kilos', 'bultos', 'carro_id', 'observaciones'],
        altCols: ['ingrediente_id', 'tipo', 'kilos', 'bultos']
    },
    {
        tabla: 'ingredientes_ajustes',
        etiqueta: 'Ajustes de Ingredientes',
        pk: 'id',
        dateCols: ['fecha', 'created_at'],
        summaryCols: ['ingrediente_id', 'kilos', 'diferencia', 'motivo', 'observaciones'],
        altCols: ['ingrediente_id', 'kilos', 'diferencia']
    },
    {
        tabla: 'carros_produccion',
        etiqueta: 'Carros de Producción',
        pk: 'id',
        dateCols: ['fecha_inicio', 'fecha_creacion', 'fecha'],
        summaryCols: ['usuario_id', 'tipo_carro', 'linea_negocio', 'nombre_linea_negocio', 'fecha_confirmacion'],
        altCols: ['usuario_id', 'tipo_carro', 'linea_negocio']
    },
    {
        tabla: 'presupuestos',
        etiqueta: 'Presupuestos',
        pk: 'id',
        dateCols: ['fecha', 'created_at'],
        summaryCols: ['id_cliente', 'estado', 'tipo_comprobante', 'fecha_actualizacion'],
        altCols: ['id_cliente', 'tipo_comprobante']
    },
    {
        tabla: 'factura_facturas',
        etiqueta: 'Facturas ARCA',
        pk: 'id',
        dateCols: ['fecha_emision', 'created_at'],
        summaryCols: ['tipo_cbte', 'pto_vta', 'cbte_nro', 'cae', 'importe_total', 'cliente_id'],
        altCols: ['tipo_cbte', 'pto_vta', 'cbte_nro', 'cae']
    },
    {
        tabla: 'factura_pagos_efectivo',
        etiqueta: 'Cobros / Pagos Efectivo',
        pk: 'id',
        dateCols: ['fecha_auditoria', 'created_at', 'fecha_pago'],
        summaryCols: ['monto', 'cliente_id', 'estado_auditoria', 'observaciones'],
        altCols: ['monto', 'cliente_id']
    },
    {
        tabla: 'colaboradores_jornadas',
        etiqueta: 'Jornadas Colaboradores',
        pk: 'id',
        dateCols: ['fecha_ingreso', 'creado_en'],
        summaryCols: ['usuario_id', 'fecha_egreso', 'horas_totales', 'monto_total', 'estado'],
        altCols: ['usuario_id', 'monto_total']
    },
    {
        tabla: 'ordenes_tratamiento',
        etiqueta: 'Órdenes de Tratamiento / Mixes Externos',
        pk: 'id',
        dateCols: ['fecha_creacion', 'created_at'],
        summaryCols: ['cliente_id', 'estado', 'total_kilos', 'observaciones'],
        altCols: ['cliente_id', 'estado']
    }
];

let tablaAsegurada = false;

async function asegurarTablaAuditoriaHuerfanas(poolArg = null) {
    const db = poolArg || getDefaultPool();
    if (tablaAsegurada) return;
    await db.query(`
        CREATE TABLE IF NOT EXISTS public.sistema_auditoria_huerfanas_local (
            id SERIAL PRIMARY KEY,
            estacion_id VARCHAR(80) NOT NULL DEFAULT 'PCALMACEN',
            desde_fecha TIMESTAMPTZ NOT NULL,
            total_tablas_con_diferencias INT NOT NULL DEFAULT 0,
            total_registros_huerfanos INT NOT NULL DEFAULT 0,
            resumen_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
            creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            resuelto_en TIMESTAMPTZ NULL,
            resuelto_por VARCHAR(100) NULL
        )
    `);
    tablaAsegurada = true;
}

async function obtenerColumnasTabla(db, tabla) {
    const res = await db.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
        [tabla]
    );
    return new Set(res.rows.map(r => r.column_name));
}

function normalizarValorFirma(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString();
    return String(v).trim();
}

function construirResumenFila(row, summaryCols) {
    const out = {};
    for (const col of summaryCols) {
        if (Object.prototype.hasOwnProperty.call(row, col) && row[col] !== null && row[col] !== undefined && row[col] !== '') {
            out[col] = row[col] instanceof Date ? row[col].toISOString() : row[col];
        }
    }
    return out;
}

function construirFirmaAlt(row, altCols) {
    return altCols.map(c => normalizarValorFirma(row[c])).join('|');
}

/**
 * Recolecta en solo lectura los registros recientes desde `sinceDate` de todas las tablas operativas.
 */
async function recolectarInventarioOperativoLocal(poolArg, { sinceDate = '2026-11-09', limitPerTable = 2000, estacionId = null } = {}) {
    const db = poolArg || getDefaultPool();
    const fechaCorte = new Date(sinceDate);
    if (Number.isNaN(fechaCorte.getTime())) {
        throw new Error(`Fecha de corte inválida para auditoría de huérfanas: ${sinceDate}`);
    }
    const sinceIso = fechaCorte.toISOString();
    const estacion = estacionId || process.env.COMPUTERNAME || os.hostname() || 'PCALMACEN';

    const tablas = [];
    for (const def of TABLAS_OPERATIVAS_AUDITABLES) {
        const cols = await obtenerColumnasTabla(db, def.tabla);
        if (cols.size === 0 || !cols.has(def.pk)) {
            tablas.push({
                tabla: def.tabla,
                etiqueta: def.etiqueta,
                pkCol: def.pk,
                dateCol: null,
                skipped: true,
                motivo: cols.size === 0 ? 'TABLA_NO_EXISTE' : `PK_${def.pk}_AUSENTE`,
                rows: []
            });
            continue;
        }
        const dateCol = def.dateCols.find(c => cols.has(c)) || null;
        if (!dateCol) {
            tablas.push({
                tabla: def.tabla,
                etiqueta: def.etiqueta,
                pkCol: def.pk,
                dateCol: null,
                skipped: true,
                motivo: 'COLUMNA_FECHA_AUSENTE',
                rows: []
            });
            continue;
        }

        const selectColsSet = new Set([def.pk, dateCol]);
        def.summaryCols.forEach(c => { if (cols.has(c)) selectColsSet.add(c); });
        def.altCols.forEach(c => { if (cols.has(c)) selectColsSet.add(c); });

        const selectSql = Array.from(selectColsSet).map(c => `"${c}"`).join(', ');
        const q = await db.query(
            `SELECT ${selectSql} FROM public."${def.tabla}" WHERE "${dateCol}" >= $1::timestamptz ORDER BY "${dateCol}" DESC LIMIT $2`,
            [sinceIso, limitPerTable]
        );

        const activeAltCols = def.altCols.filter(c => cols.has(c));
        const rows = q.rows.map(r => ({
            pk: String(r[def.pk]),
            fecha: r[dateCol] ? new Date(r[dateCol]).toISOString() : null,
            altSig: construirFirmaAlt(r, activeAltCols),
            resumen: construirResumenFila(r, def.summaryCols)
        }));

        tablas.push({
            tabla: def.tabla,
            etiqueta: def.etiqueta,
            pkCol: def.pk,
            dateCol,
            skipped: false,
            rows
        });
    }

    return {
        estacionId: String(estacion),
        desdeFecha: sinceIso,
        generadoEn: new Date().toISOString(),
        tablas
    };
}

/**
 * Compara el inventario enviado por una estación local contra la base destino (Cloud `etiquetas`).
 * No escribe ni modifica tablas de negocio.
 */
async function compararInventarioContraDestino(poolCloud, payloadLocal = {}) {
    const db = poolCloud || getDefaultPool();
    const desdeFecha = payloadLocal.desdeFecha || '2026-11-09T00:00:00.000Z';
    const estacionId = String(payloadLocal.estacionId || 'PCALMACEN').slice(0, 80);
    const tablasLocal = Array.isArray(payloadLocal.tablas) ? payloadLocal.tablas : [];

    const defByName = new Map(TABLAS_OPERATIVAS_AUDITABLES.map(d => [d.tabla, d]));
    const detallePorTabla = [];
    let totalRegistrosHuerfanos = 0;

    for (const tblEntry of tablasLocal) {
        if (!tblEntry || tblEntry.skipped || !Array.isArray(tblEntry.rows) || tblEntry.rows.length === 0) {
            continue;
        }
        const def = defByName.get(tblEntry.tabla);
        if (!def) continue;

        const colsCloud = await obtenerColumnasTabla(db, def.tabla);
        if (colsCloud.size === 0 || !colsCloud.has(def.pk)) continue;
        const dateCol = def.dateCols.find(c => colsCloud.has(c)) || tblEntry.dateCol;
        if (!dateCol || !colsCloud.has(dateCol)) continue;

        const activeAltCols = def.altCols.filter(c => colsCloud.has(c));
        const selectColsSet = new Set([def.pk, dateCol, ...activeAltCols]);
        const selectSql = Array.from(selectColsSet).map(c => `"${c}"`).join(', ');

        const pksLocal = tblEntry.rows.map(r => String(r.pk));
        const cloudByPk = new Map();

        // Consultar en Cloud tanto por PK exacto como por ventana temporal desde desdeFecha - 1 día
        const qCloudByPk = await db.query(
            `SELECT ${selectSql} FROM public."${def.tabla}" WHERE "${def.pk}"::text = ANY($1::text[])`,
            [pksLocal]
        );
        for (const cr of qCloudByPk.rows) {
            cloudByPk.set(String(cr[def.pk]), {
                pk: String(cr[def.pk]),
                fechaMs: cr[dateCol] ? new Date(cr[dateCol]).getTime() : 0,
                altSig: construirFirmaAlt(cr, activeAltCols)
            });
        }

        const qCloudWindow = await db.query(
            `SELECT ${selectSql} FROM public."${def.tabla}" WHERE "${dateCol}" >= ($1::timestamptz - interval '1 day') LIMIT 3000`,
            [desdeFecha]
        );
        const cloudAltSet = new Set();
        for (const cr of qCloudWindow.rows) {
            const sig = construirFirmaAlt(cr, activeAltCols);
            if (sig) cloudAltSet.add(sig);
        }

        const huerfanos = [];
        for (const lr of tblEntry.rows) {
            const matchPk = cloudByPk.get(String(lr.pk));
            if (!matchPk) {
                huerfanos.push({
                    pk: lr.pk,
                    fecha: lr.fecha,
                    motivo: 'NO_EXISTE_EN_NUBE',
                    resumen: lr.resumen || {}
                });
                continue;
            }
            // Verificar si el mismo ID serial en Cloud pertenece en realidad a otro registro distinto
            const sigMatch = !lr.altSig || !matchPk.altSig || lr.altSig === matchPk.altSig;
            const localMs = lr.fecha ? new Date(lr.fecha).getTime() : 0;
            const diffSec = (localMs && matchPk.fechaMs) ? Math.abs(localMs - matchPk.fechaMs) / 1000 : 0;
            if ((!sigMatch || diffSec > 180) && !(lr.altSig && cloudAltSet.has(lr.altSig))) {
                huerfanos.push({
                    pk: lr.pk,
                    fecha: lr.fecha,
                    motivo: 'COLISION_ID_DIVERGENTE',
                    resumen: lr.resumen || {}
                });
            }
        }

        if (huerfanos.length > 0) {
            totalRegistrosHuerfanos += huerfanos.length;
            detallePorTabla.push({
                tabla: def.tabla,
                etiqueta: def.etiqueta,
                pkCol: def.pk,
                cantidadLocalRevisada: tblEntry.rows.length,
                cantidadHuerfanos: huerfanos.length,
                registros: huerfanos.slice(0, 100)
            });
        }
    }

    return {
        ok: true,
        estacionId,
        desdeFecha,
        comparadoEn: new Date().toISOString(),
        totalTablasConDiferencias: detallePorTabla.length,
        totalRegistrosHuerfanos,
        detallePorTabla
    };
}

async function guardarReporteAuditoriaHuerfanas(poolCloud, reporte) {
    const db = poolCloud || getDefaultPool();
    await asegurarTablaAuditoriaHuerfanas(db);

    const estacionId = String(reporte.estacionId || 'PCALMACEN').slice(0, 80);
    const totalHuerfanos = Number(reporte.totalRegistrosHuerfanos || 0);
    const totalTablas = Number(reporte.totalTablasConDiferencias || 0);

    if (totalHuerfanos === 0) {
        await db.query(
            `UPDATE public.sistema_auditoria_huerfanas_local
             SET estado = 'RESUELTO_AUTO', resuelto_en = NOW(), resuelto_por = 'AUTO_AUDITOR'
             WHERE estacion_id = $1 AND estado = 'PENDIENTE'`,
            [estacionId]
        );
        return null;
    }

    // Marcar reportes pendientes anteriores de la misma estación como reemplazados para no apilar alertas viejas
    await db.query(
        `UPDATE public.sistema_auditoria_huerfanas_local
         SET estado = 'SUPERSEDIDO', resuelto_en = NOW(), resuelto_por = 'AUTO_AUDITOR'
         WHERE estacion_id = $1 AND estado = 'PENDIENTE'`,
        [estacionId]
    );

    const ins = await db.query(
        `INSERT INTO public.sistema_auditoria_huerfanas_local (
            estacion_id, desde_fecha, total_tablas_con_diferencias, total_registros_huerfanos, resumen_json, estado
         ) VALUES ($1, $2::timestamptz, $3, $4, $5::jsonb, 'PENDIENTE')
         RETURNING id, creado_en`,
        [estacionId, reporte.desdeFecha, totalTablas, totalHuerfanos, JSON.stringify(reporte.detallePorTabla || [])]
    );
    return ins.rows[0] || null;
}

async function obtenerUltimaAlertaHuerfanasPendiente(poolCloud = null) {
    const db = poolCloud || getDefaultPool();
    await asegurarTablaAuditoriaHuerfanas(db);
    const q = await db.query(
        `SELECT id, estacion_id, desde_fecha, total_tablas_con_diferencias, total_registros_huerfanos, resumen_json, estado, creado_en
         FROM public.sistema_auditoria_huerfanas_local
         WHERE estado = 'PENDIENTE' AND total_registros_huerfanos > 0
         ORDER BY creado_en DESC
         LIMIT 1`
    );
    return q.rows[0] || null;
}

async function marcarAlertaHuerfanasRevisada(poolCloud, id, usuario = 'OPERADOR') {
    const db = poolCloud || getDefaultPool();
    await asegurarTablaAuditoriaHuerfanas(db);
    const q = await db.query(
        `UPDATE public.sistema_auditoria_huerfanas_local
         SET estado = 'REVISADO', resuelto_en = NOW(), resuelto_por = $2
         WHERE id = $1
         RETURNING id, estado, resuelto_en, resuelto_por`,
        [parseInt(id, 10), String(usuario || 'OPERADOR').slice(0, 100)]
    );
    return q.rows[0] || null;
}

module.exports = {
    TABLAS_OPERATIVAS_AUDITABLES,
    asegurarTablaAuditoriaHuerfanas,
    recolectarInventarioOperativoLocal,
    compararInventarioContraDestino,
    guardarReporteAuditoriaHuerfanas,
    obtenerUltimaAlertaHuerfanasPendiente,
    marcarAlertaHuerfanasRevisada
};
