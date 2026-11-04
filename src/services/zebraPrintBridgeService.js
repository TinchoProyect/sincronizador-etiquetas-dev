/**
 * LAMDA Print Bridge Service (Fase 2 — Cloud 24/7 & Seguridad Operativa de Galpón)
 * --------------------------------------------------------------------------------
 * Gestiona el despacho inteligente de etiquetas ZPL hacia la impresora térmica Zebra:
 *  1. En MODO LABORATORIO (DB_NAME=etiquetas_pruebas o LAMDA_MODO_LABORATORIO=true):
 *     Bloquea el disparo físico a la Zebra para no desperdiciar rollo térmico en pruebas,
 *     dejando constancia en `public.zebra_print_queue` con estado `BLOQUEADA_LABORATORIO`.
 *  2. En MODO NUBE / REMOTO (Linux VPS o LAMDA_CLOUD_MODE=true):
 *     Guarda la etiqueta en `public.zebra_print_queue` con estado `PENDIENTE_CONFIRMACION_GALPON`.
 *     NUNCA se dispara sola al encender la PC del depósito: requiere confirmación visual
 *     en la bandeja superior ("🖨️ Cola Zebra Retenida") para pasar a `LIBERADA_PARA_IMPRIMIR`.
 *  3. En MODO GALPÓN LOCAL WINDOWS:
 *     Envía `COPY /B ... \\localhost\Zebra`. Si la impresora está apagada o falla el puerto,
 *     retiene automáticamente la etiqueta en `PENDIENTE_CONFIRMACION_GALPON` para no perderla.
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const pool = require('../config/db');

let tablaInicializada = false;

function esModoLaboratorio() {
    const dbName = String(process.env.DB_NAME || '').trim().toLowerCase();
    const flagLab = String(process.env.LAMDA_MODO_LABORATORIO || '').trim().toLowerCase();
    return dbName === 'etiquetas_pruebas' || flagLab === 'true' || flagLab === '1';
}

function esModoCloudOLinux() {
    const flagCloud = String(process.env.LAMDA_CLOUD_MODE || '').trim().toLowerCase();
    const flagSoloEncolar = String(process.env.ZEBRA_SOLO_ENCOLAR || '').trim().toLowerCase();
    return process.platform !== 'win32' || flagCloud === 'true' || flagSoloEncolar === 'true';
}

async function asegurarTablaZebraQueue() {
    if (tablaInicializada) return;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS public.zebra_print_queue (
                id SERIAL PRIMARY KEY,
                tipo_etiqueta VARCHAR(80) NOT NULL DEFAULT 'ETIQUETA_ZPL',
                descripcion TEXT,
                zpl_payload TEXT NOT NULL,
                nombre_impresora VARCHAR(80) NOT NULL DEFAULT 'Zebra',
                estado VARCHAR(50) NOT NULL DEFAULT 'PENDIENTE_CONFIRMACION_GALPON',
                origen_entorno VARCHAR(80) DEFAULT 'local',
                error_detalle TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                printed_at TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_zebra_print_queue_estado
                ON public.zebra_print_queue (estado, created_at DESC);
        `);
        tablaInicializada = true;
    } catch (err) {
        console.warn('⚠️ [ZEBRA-BRIDGE] No se pudo verificar tabla zebra_print_queue:', err.message);
    }
}

function ejecutarCopyWindowsZebra(zplPayload, nombreImpresora = 'Zebra') {
    return new Promise((resolve, reject) => {
        const tempFile = path.join(__dirname, `../../temp_bridge_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.zpl`);
        try {
            fs.writeFileSync(tempFile, zplPayload, 'utf8');
        } catch (writeErr) {
            return reject(writeErr);
        }

        const comando = `COPY /B "${tempFile}" \\\\localhost\\${nombreImpresora}`;
        exec(comando, (error, stdout, stderr) => {
            fs.unlink(tempFile, () => {});
            if (error) {
                return reject(new Error(stderr || error.message || 'Error al ejecutar COPY /B hacia Zebra'));
            }
            resolve(stdout);
        });
    });
}

/**
 * Punto único de salida para los 7 scripts de etiquetas ZPL de LAMDA.
 */
async function despacharZplAZebra({
    zplContent = null,
    zplFilePath = null,
    tipoEtiqueta = 'ETIQUETA_ZPL',
    descripcion = '',
    nombreImpresora = 'Zebra',
    forzarEncolado = false
}) {
    await asegurarTablaZebraQueue();

    let payload = zplContent;
    if (!payload && zplFilePath && fs.existsSync(zplFilePath)) {
        payload = fs.readFileSync(zplFilePath, 'utf8');
    }

    if (zplFilePath && fs.existsSync(zplFilePath)) {
        try { fs.unlinkSync(zplFilePath); } catch (_) {}
    }

    if (!payload || !String(payload).trim()) {
        throw new Error('El contenido ZPL de la etiqueta está vacío.');
    }

    const descripcionLimpia = String(descripcion || tipoEtiqueta).trim().slice(0, 300);

    // 1. MODO LABORATORIO: Nunca imprimir físicamente en pruebas
    if (esModoLaboratorio()) {
        try {
            await pool.query(
                `INSERT INTO public.zebra_print_queue
                    (tipo_etiqueta, descripcion, zpl_payload, nombre_impresora, estado, origen_entorno)
                 VALUES ($1, $2, $3, $4, 'BLOQUEADA_LABORATORIO', $5)`,
                [tipoEtiqueta, descripcionLimpia, payload, nombreImpresora, `LAB:${process.env.DB_NAME || 'etiquetas_pruebas'}`]
            );
        } catch (dbErr) {
            console.warn('⚠️ [ZEBRA-BRIDGE] Error registrando etiqueta en modo laboratorio:', dbErr.message);
        }
        console.log(`🛠️ [ZEBRA-BRIDGE] MODO LABORATORIO ACTIVO: Etiqueta "${descripcionLimpia}" simulada (NO se envió a la Zebra física).`);
        return { ok: true, mode: 'BLOQUEADA_LABORATORIO', descripcion: descripcionLimpia };
    }

    // 2. MODO CLOUD / LINUX O ENCOLADO FORZADO: Retener en bandeja de confirmación del galpón
    if (esModoCloudOLinux() || forzarEncolado) {
        const resInsert = await pool.query(
            `INSERT INTO public.zebra_print_queue
                (tipo_etiqueta, descripcion, zpl_payload, nombre_impresora, estado, origen_entorno)
             VALUES ($1, $2, $3, $4, 'PENDIENTE_CONFIRMACION_GALPON', $5)
             RETURNING id`,
            [tipoEtiqueta, descripcionLimpia, payload, nombreImpresora, process.platform === 'win32' ? 'win32-queued' : 'cloud-linux']
        );
        const jobId = resInsert.rows[0]?.id;
        console.log(`🖨️ [ZEBRA-BRIDGE] Etiqueta #${jobId} ("${descripcionLimpia}") retenida en PENDIENTE_CONFIRMACION_GALPON.`);
        return { ok: true, mode: 'PENDIENTE_CONFIRMACION_GALPON', jobId, descripcion: descripcionLimpia };
    }

    // 3. MODO GALPÓN LOCAL WINDOWS: Intentar disparo directo; si falla, retener en bandeja
    try {
        await ejecutarCopyWindowsZebra(payload, nombreImpresora);
        try {
            await pool.query(
                `INSERT INTO public.zebra_print_queue
                    (tipo_etiqueta, descripcion, zpl_payload, nombre_impresora, estado, origen_entorno, printed_at)
                 VALUES ($1, $2, $3, $4, 'IMPRESA_OK', 'win32-direct', CURRENT_TIMESTAMP)`,
                [tipoEtiqueta, descripcionLimpia, payload, nombreImpresora]
            );
        } catch (_) {}
        console.log(`✅ [ZEBRA-BRIDGE] Etiqueta "${descripcionLimpia}" enviada físicamente a \\\\localhost\\${nombreImpresora}.`);
        return { ok: true, mode: 'IMPRESA_DIRECTA_LOCAL', descripcion: descripcionLimpia };
    } catch (printErr) {
        console.warn(`⚠️ [ZEBRA-BRIDGE] Impresora Zebra no disponible (${printErr.message}). Reteniendo etiqueta en bandeja de confirmación...`);
        const resRetained = await pool.query(
            `INSERT INTO public.zebra_print_queue
                (tipo_etiqueta, descripcion, zpl_payload, nombre_impresora, estado, origen_entorno, error_detalle)
             VALUES ($1, $2, $3, $4, 'PENDIENTE_CONFIRMACION_GALPON', 'win32-fallback', $5)
             RETURNING id`,
            [tipoEtiqueta, descripcionLimpia, payload, nombreImpresora, printErr.message]
        );
        return {
            ok: true,
            mode: 'PENDIENTE_CONFIRMACION_GALPON',
            jobId: resRetained.rows[0]?.id,
            retainedBecause: printErr.message
        };
    }
}

async function obtenerResumenColaRetenida() {
    await asegurarTablaZebraQueue();
    try {
        const res = await pool.query(`
            SELECT id, tipo_etiqueta, descripcion, nombre_impresora, estado, origen_entorno, error_detalle, created_at
            FROM public.zebra_print_queue
            WHERE estado IN ('PENDIENTE_CONFIRMACION_GALPON', 'LIBERADA_PARA_IMPRIMIR')
            ORDER BY created_at DESC
            LIMIT 100
        `);
        const items = res.rows || [];
        const pendingConfirmationCount = items.filter(i => i.estado === 'PENDIENTE_CONFIRMACION_GALPON').length;
        const releasedWaitingAgentCount = items.filter(i => i.estado === 'LIBERADA_PARA_IMPRIMIR').length;
        return {
            pendingPrintCount: items.length,
            pendingConfirmationCount,
            releasedWaitingAgentCount,
            items
        };
    } catch (err) {
        return {
            pendingPrintCount: 0,
            pendingConfirmationCount: 0,
            releasedWaitingAgentCount: 0,
            items: [],
            error: err.message
        };
    }
}

async function liberarEtiquetasRetenidas(ids = null) {
    await asegurarTablaZebraQueue();
    let res;
    if (Array.isArray(ids) && ids.length > 0) {
        res = await pool.query(
            `UPDATE public.zebra_print_queue
             SET estado = 'LIBERADA_PARA_IMPRIMIR', updated_at = CURRENT_TIMESTAMP
             WHERE id = ANY($1::int[]) AND estado = 'PENDIENTE_CONFIRMACION_GALPON'
             RETURNING *`,
            [ids]
        );
    } else {
        res = await pool.query(
            `UPDATE public.zebra_print_queue
             SET estado = 'LIBERADA_PARA_IMPRIMIR', updated_at = CURRENT_TIMESTAMP
             WHERE estado = 'PENDIENTE_CONFIRMACION_GALPON'
             RETURNING *`
        );
    }

    const liberadas = res.rows || [];

    // Si estamos corriendo en Windows físicamente y no en modo Cloud ni Laboratorio,
    // podemos despacharlas en el acto a \\localhost\Zebra.
    let impresasDirecto = 0;
    if (!esModoCloudOLinux() && !esModoLaboratorio() && liberadas.length > 0) {
        for (const item of liberadas) {
            try {
                await ejecutarCopyWindowsZebra(item.zpl_payload, item.nombre_impresora || 'Zebra');
                await pool.query(
                    `UPDATE public.zebra_print_queue
                     SET estado = 'IMPRESA_OK', printed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, error_detalle = NULL
                     WHERE id = $1`,
                    [item.id]
                );
                impresasDirecto++;
            } catch (err) {
                await pool.query(
                    `UPDATE public.zebra_print_queue
                     SET estado = 'PENDIENTE_CONFIRMACION_GALPON', updated_at = CURRENT_TIMESTAMP, error_detalle = $2
                     WHERE id = $1`,
                    [item.id, err.message]
                );
            }
        }
    }

    return {
        liberadasCount: liberadas.length,
        impresasDirecto
    };
}

async function descartarEtiquetasRetenidas(ids = null) {
    await asegurarTablaZebraQueue();
    let res;
    if (Array.isArray(ids) && ids.length > 0) {
        res = await pool.query(
            `UPDATE public.zebra_print_queue
             SET estado = 'DESCARTADA', updated_at = CURRENT_TIMESTAMP
             WHERE id = ANY($1::int[]) AND estado IN ('PENDIENTE_CONFIRMACION_GALPON', 'LIBERADA_PARA_IMPRIMIR')
             RETURNING id`,
            [ids]
        );
    } else {
        res = await pool.query(
            `UPDATE public.zebra_print_queue
             SET estado = 'DESCARTADA', updated_at = CURRENT_TIMESTAMP
             WHERE estado IN ('PENDIENTE_CONFIRMACION_GALPON', 'LIBERADA_PARA_IMPRIMIR')
             RETURNING id`
        );
    }
    return { descartadasCount: res.rowCount || 0 };
}

async function obtenerTrabajosLiberadosParaAgente(limit = 20) {
    await asegurarTablaZebraQueue();
    const res = await pool.query(
        `SELECT id, tipo_etiqueta, descripcion, zpl_payload, nombre_impresora, created_at
         FROM public.zebra_print_queue
         WHERE estado = 'LIBERADA_PARA_IMPRIMIR'
         ORDER BY id ASC
         LIMIT $1`,
        [limit]
    );
    return res.rows || [];
}

async function confirmarImpresionAgente(id, exito = true, errorDetalle = null) {
    await asegurarTablaZebraQueue();
    if (exito) {
        await pool.query(
            `UPDATE public.zebra_print_queue
             SET estado = 'IMPRESA_OK', printed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, error_detalle = NULL
             WHERE id = $1`,
            [id]
        );
    } else {
        await pool.query(
            `UPDATE public.zebra_print_queue
             SET estado = 'PENDIENTE_CONFIRMACION_GALPON', updated_at = CURRENT_TIMESTAMP, error_detalle = $2
             WHERE id = $1`,
            [id, errorDetalle || 'Fallo reportado por Agente Zebra Local']
        );
    }
    return { ok: true };
}

module.exports = {
    esModoLaboratorio,
    esModoCloudOLinux,
    asegurarTablaZebraQueue,
    despacharZplAZebra,
    obtenerResumenColaRetenida,
    liberarEtiquetasRetenidas,
    descartarEtiquetasRetenidas,
    obtenerTrabajosLiberadosParaAgente,
    confirmarImpresionAgente
};
