/**
 * LAMDA Print Bridge Service (Fase 2 / Micro-Etapa 1 — Cloud 24/7 & Presencia Física Loopback)
 * --------------------------------------------------------------------------------------------
 * Gestiona el despacho inteligente de etiquetas ZPL hacia la impresora térmica Zebra:
 *  1. En MODO LABORATORIO (DB_NAME=etiquetas_pruebas o LAMDA_MODO_LABORATORIO=true):
 *     Bloquea el disparo físico a la Zebra para no desperdiciar rollo térmico en pruebas,
 *     dejando constancia en `public.zebra_print_queue` con estado `BLOQUEADA_LABORATORIO`.
 *  2. En MODO NUBE / REMOTO (Linux VPS o LAMDA_CLOUD_MODE=true):
 *     - Si la petición HTTP trae prueba criptográfica de presencia física en `PcAlmacen`
 *       (`X-Lamda-Physical-Station: PCALMACEN_VERIFIED` + `X-Lamda-Physical-Token` emitido por
 *       el micro-servidor loopback `127.0.0.1:3099/zebra-local-presence`), encola la etiqueta
 *       directamente en `LIBERADA_PARA_IMPRIMIR` (`estacion_fisica_verificada = true`) para que
 *       el agente local de `PcAlmacen` la imprima en ~1 segundo.
 *     - Si la petición proviene de la calle (celular, tablet o notebook fuera del galpón sin
 *       loopback `127.0.0.1:3099`), guarda la etiqueta en `PENDIENTE_CONFIRMACION_GALPON`
 *       (`estacion_fisica_verificada = false`) para que NUNCA se dispare sola sin confirmación
 *       visual en el galpón.
 *  3. En MODO GALPÓN LOCAL WINDOWS:
 *     Envía `COPY /B ... \\localhost\Zebra`. Si la impresora está apagada o falla el puerto,
 *     retiene automáticamente la etiqueta en `PENDIENTE_CONFIRMACION_GALPON` para no perderla.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const { exec } = cp;
const { AsyncLocalStorage } = require('async_hooks');
const pool = require('../config/db');

const zebraRequestContext = new AsyncLocalStorage();

// Propagar automáticamente el contexto de presencia física a procesos hijos lanzados vía child_process.exec / spawn
if (!cp.__lamdaZebraExecPatched) {
    const originalExec = cp.exec;
    cp.exec = function patchedLamdaExec(command, options, callback) {
        let opts = options;
        let cb = callback;
        if (typeof opts === 'function') {
            cb = opts;
            opts = {};
        } else {
            opts = opts ? Object.assign({}, opts) : {};
        }
        const store = zebraRequestContext.getStore();
        if (store) {
            opts.env = Object.assign({}, process.env, opts.env || {}, {
                LAMDA_PHYSICAL_VERIFIED: store.estacionFisicaVerificada ? 'true' : 'false',
                LAMDA_DEVICE_ORIGIN: String(store.dispositivoOrigen || ''),
                LAMDA_CLIENT_IP: String(store.ipOrigen || '')
            });
        }
        return originalExec.call(this, command, opts, cb);
    };

    if (cp.ChildProcess && cp.ChildProcess.prototype && typeof cp.ChildProcess.prototype.spawn === 'function') {
        const originalProtoSpawn = cp.ChildProcess.prototype.spawn;
        cp.ChildProcess.prototype.spawn = function patchedProtoSpawn(options) {
            try {
                const store = zebraRequestContext.getStore();
                if (store && options && Array.isArray(options.envPairs)) {
                    const verifiedPair = `LAMDA_PHYSICAL_VERIFIED=${store.estacionFisicaVerificada ? 'true' : 'false'}`;
                    const originPair = `LAMDA_DEVICE_ORIGIN=${String(store.dispositivoOrigen || '')}`;
                    const ipPair = `LAMDA_CLIENT_IP=${String(store.ipOrigen || '')}`;
                    options.envPairs = options.envPairs.filter(
                        (p) => !String(p).startsWith('LAMDA_PHYSICAL_VERIFIED=') &&
                               !String(p).startsWith('LAMDA_DEVICE_ORIGIN=') &&
                               !String(p).startsWith('LAMDA_CLIENT_IP=')
                    );
                    options.envPairs.push(verifiedPair, originPair, ipPair);
                }
            } catch (_) {}
            return originalProtoSpawn.call(this, options);
        };
    }
    cp.__lamdaZebraExecPatched = true;
}
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

function obtenerSecretoPresenciaZebra() {
    return String(
        process.env.LAMDA_PRINT_BRIDGE_TOKEN ||
        process.env.LAMDA_CLOUD_JWT_SECRET ||
        process.env.JWT_SECRET ||
        'LAMDA_ZEBRA_PHYSICAL_SECRET_2026'
    ).trim();
}

/**
 * Genera un token HMAC temporal firmado localmente por `127.0.0.1:3099/zebra-local-presence`
 * en `PcAlmacen`.
 */
function generarTokenPresenciaFisicaGalpon(station = 'PCALMACEN_VERIFIED', timestampMs = Date.now()) {
    const ts = Number(timestampMs) || Date.now();
    const cleanStation = String(station || 'PCALMACEN_VERIFIED').trim();
    const payload = `${cleanStation}:${ts}`;
    const sig = crypto
        .createHmac('sha256', obtenerSecretoPresenciaZebra())
        .update(payload)
        .digest('hex');
    return `${ts}.${sig}`;
}

/**
 * Verifica criptográficamente el token HMAC de presencia física enviado desde el navegador
 * de `PcAlmacen`.
 */
function verificarTokenPresenciaFisicaGalpon(tokenRaw, station = 'PCALMACEN_VERIFIED', maxSkewMs = 120000) {
    try {
        const cleanStation = String(station || '').trim();
        if (cleanStation !== 'PCALMACEN_VERIFIED') {
            return { verified: false, reason: 'station_mismatch' };
        }
        const raw = String(tokenRaw || '').trim();
        if (!raw || !raw.includes('.')) {
            return { verified: false, reason: 'missing_or_malformed_token' };
        }
        const [tsStr, providedSig] = raw.split('.');
        const ts = parseInt(tsStr, 10);
        if (!Number.isFinite(ts) || !providedSig) {
            return { verified: false, reason: 'invalid_timestamp' };
        }
        const skew = Math.abs(Date.now() - ts);
        if (skew > maxSkewMs) {
            return { verified: false, reason: 'token_expired', skewMs: skew };
        }
        const expectedSig = crypto
            .createHmac('sha256', obtenerSecretoPresenciaZebra())
            .update(`${cleanStation}:${ts}`)
            .digest('hex');

        const bufProvided = Buffer.from(providedSig, 'utf8');
        const bufExpected = Buffer.from(expectedSig, 'utf8');
        if (bufProvided.length !== bufExpected.length || !crypto.timingSafeEqual(bufProvided, bufExpected)) {
            return { verified: false, reason: 'invalid_signature' };
        }
        return {
            verified: true,
            station: cleanStation,
            timestamp: ts
        };
    } catch (err) {
        return { verified: false, reason: err.message };
    }
}

/**
 * Middleware Express que propaga en AsyncLocalStorage si la petición HTTP actual proviene
 * físicamente del navegador de `PcAlmacen` (verificado por loopback `127.0.0.1:3099`).
 */
function middlewareContextoPresenciaZebra(req, res, next) {
    const stationHeader = String(req.headers['x-lamda-physical-station'] || '').trim();
    const tokenHeader = String(req.headers['x-lamda-physical-token'] || '').trim();
    const verificacion = verificarTokenPresenciaFisicaGalpon(tokenHeader, stationHeader);

    const store = {
        estacionFisicaVerificada: verificacion.verified,
        dispositivoOrigen: verificacion.verified
            ? 'PCALMACEN_LOOPBACK_3099'
            : (stationHeader ? `NO_VERIFICADO:${stationHeader}` : 'REMOTO_CALLE_O_MOVIL'),
        ipOrigen: String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || '').trim()
    };

    req.zebraPhysicalPresence = store;
    return zebraRequestContext.run(store, () => next());
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
                estacion_fisica_verificada BOOLEAN DEFAULT FALSE,
                dispositivo_origen VARCHAR(120) DEFAULT 'DESCONOCIDO',
                error_detalle TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                printed_at TIMESTAMP
            );
            ALTER TABLE public.zebra_print_queue
                ADD COLUMN IF NOT EXISTS estacion_fisica_verificada BOOLEAN DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS dispositivo_origen VARCHAR(120) DEFAULT 'DESCONOCIDO';
            CREATE INDEX IF NOT EXISTS idx_zebra_print_queue_estado
                ON public.zebra_print_queue (estado, created_at DESC);
            CREATE TABLE IF NOT EXISTS public.zebra_bridge_status (
                station_id VARCHAR(80) PRIMARY KEY,
                last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                printer_name VARCHAR(80) DEFAULT 'Zebra',
                printer_online BOOLEAN DEFAULT TRUE,
                hostname VARCHAR(120),
                ip_origen VARCHAR(80) DEFAULT '127.0.0.1',
                estado_impresora VARCHAR(40) DEFAULT 'ONLINE',
                version_agente VARCHAR(32) DEFAULT '2.0.0-loopback',
                local_loopback_port INTEGER DEFAULT 3099,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
            ALTER TABLE public.zebra_bridge_status
                ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ DEFAULT NOW(),
                ADD COLUMN IF NOT EXISTS printer_name VARCHAR(80) DEFAULT 'Zebra',
                ADD COLUMN IF NOT EXISTS printer_online BOOLEAN DEFAULT TRUE,
                ADD COLUMN IF NOT EXISTS hostname VARCHAR(120),
                ADD COLUMN IF NOT EXISTS ip_origen VARCHAR(80) DEFAULT '127.0.0.1',
                ADD COLUMN IF NOT EXISTS estado_impresora VARCHAR(40) DEFAULT 'ONLINE',
                ADD COLUMN IF NOT EXISTS version_agente VARCHAR(32) DEFAULT '2.0.0-loopback',
                ADD COLUMN IF NOT EXISTS local_loopback_port INTEGER DEFAULT 3099,
                ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
        `);
        tablaInicializada = true;
    } catch (err) {
        console.warn('⚠️ [ZEBRA-BRIDGE] No se pudo verificar tabla zebra_print_queue:', err.message);
    }
}

async function registrarHeartbeatAgenteZebra({
    estacionId = 'PCALMACEN',
    stationId = null,
    ipOrigen = '127.0.0.1',
    printerName = 'Zebra',
    estadoImpresora = 'ONLINE',
    versionAgente = '2.0.0-loopback',
    localLoopbackPort = 3099
} = {}) {
    await asegurarTablaZebraQueue();
    const finalStationId = String(stationId || estacionId || 'PCALMACEN').trim();
    const isOnline = String(estadoImpresora || 'ONLINE').toUpperCase() === 'ONLINE';
    const hostName = os.hostname();
    try {
        const res = await pool.query(
            `INSERT INTO public.zebra_bridge_status
                (station_id, last_heartbeat_at, printer_name, printer_online, hostname, ip_origen, estado_impresora, version_agente, local_loopback_port, updated_at)
             VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, NOW())
             ON CONFLICT (station_id) DO UPDATE SET
                last_heartbeat_at = NOW(),
                printer_name = EXCLUDED.printer_name,
                printer_online = EXCLUDED.printer_online,
                hostname = EXCLUDED.hostname,
                ip_origen = EXCLUDED.ip_origen,
                estado_impresora = EXCLUDED.estado_impresora,
                version_agente = EXCLUDED.version_agente,
                local_loopback_port = EXCLUDED.local_loopback_port,
                updated_at = NOW()
             RETURNING *`,
            [finalStationId, printerName, isOnline, hostName, ipOrigen, estadoImpresora, versionAgente, localLoopbackPort]
        );
        return { ok: true, status: res.rows[0] || null };
    } catch (err) {
        console.warn('⚠️ [ZEBRA-BRIDGE] Error registrando heartbeat en zebra_bridge_status:', err.message);
        return { ok: false, error: err.message };
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
    forzarEncolado = false,
    estacionFisicaVerificada = null,
    dispositivoOrigen = null
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
    const ctxStore = zebraRequestContext.getStore() || {};
    const envPhysicalRaw = process.env.LAMDA_PHYSICAL_VERIFIED;
    const envOriginRaw = process.env.LAMDA_DEVICE_ORIGIN;
    const isPhysicalVerified = estacionFisicaVerificada !== null
        ? Boolean(estacionFisicaVerificada)
        : (ctxStore.estacionFisicaVerificada !== undefined
            ? Boolean(ctxStore.estacionFisicaVerificada)
            : String(envPhysicalRaw || '').trim().toLowerCase() === 'true');
    const origenDispositivo =
        dispositivoOrigen ||
        ctxStore.dispositivoOrigen ||
        (envOriginRaw ? String(envOriginRaw).trim() : '') ||
        (isPhysicalVerified ? 'PCALMACEN_LOOPBACK_3099' : 'REMOTO_SIN_LOOPBACK');

    // 1. MODO LABORATORIO: Nunca imprimir físicamente en pruebas
    if (esModoLaboratorio()) {
        try {
            await pool.query(
                `INSERT INTO public.zebra_print_queue
                    (tipo_etiqueta, descripcion, zpl_payload, nombre_impresora, estado, origen_entorno, estacion_fisica_verificada, dispositivo_origen)
                 VALUES ($1, $2, $3, $4, 'BLOQUEADA_LABORATORIO', $5, $6, $7)`,
                [tipoEtiqueta, descripcionLimpia, payload, nombreImpresora, `LAB:${process.env.DB_NAME || 'etiquetas_pruebas'}`, isPhysicalVerified, origenDispositivo]
            );
        } catch (dbErr) {
            console.warn('⚠️ [ZEBRA-BRIDGE] Error registrando etiqueta en modo laboratorio:', dbErr.message);
        }
        console.log(`🛠️ [ZEBRA-BRIDGE] MODO LABORATORIO ACTIVO: Etiqueta "${descripcionLimpia}" simulada (NO se envió a la Zebra física).`);
        return {
            ok: true,
            mode: 'BLOQUEADA_LABORATORIO',
            descripcion: descripcionLimpia,
            estacionFisicaVerificada: isPhysicalVerified
        };
    }

    // 2. MODO CLOUD / LINUX O ENCOLADO REMOTO:
    //    - Si el clic vino físicamente del navegador de PcAlmacen (verificado por loopback 127.0.0.1:3099)
    //      y no se forzó encolado manual, se libera directamente (`LIBERADA_PARA_IMPRIMIR`) para salir en ~1s.
    //    - Si vino de un celular/calle/notebook externa, se retiene en `PENDIENTE_CONFIRMACION_GALPON`.
    if (esModoCloudOLinux() || forzarEncolado) {
        const liberarInmediatoPorPresencia = isPhysicalVerified && !forzarEncolado;
        const estadoInicial = liberarInmediatoPorPresencia
            ? 'LIBERADA_PARA_IMPRIMIR'
            : 'PENDIENTE_CONFIRMACION_GALPON';
        const entornoOrigen = liberarInmediatoPorPresencia
            ? 'cloud-pcalmacen-verified-1s'
            : (process.platform === 'win32' ? 'win32-queued' : 'cloud-remote-retained');

        const resInsert = await pool.query(
            `INSERT INTO public.zebra_print_queue
                (tipo_etiqueta, descripcion, zpl_payload, nombre_impresora, estado, origen_entorno, estacion_fisica_verificada, dispositivo_origen)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id`,
            [tipoEtiqueta, descripcionLimpia, payload, nombreImpresora, estadoInicial, entornoOrigen, isPhysicalVerified, origenDispositivo]
        );
        const jobId = resInsert.rows[0]?.id;
        if (liberarInmediatoPorPresencia) {
            console.log(`⚡ [ZEBRA-BRIDGE] Etiqueta #${jobId} ("${descripcionLimpia}") disparada desde PcAlmacen verificada (127.0.0.1:3099) -> LIBERADA_PARA_IMPRIMIR (~1s).`);
        } else {
            console.log(`🖨️ [ZEBRA-BRIDGE] Etiqueta #${jobId} ("${descripcionLimpia}") desde origen remoto (${origenDispositivo}) -> retenida en PENDIENTE_CONFIRMACION_GALPON.`);
        }
        return {
            ok: true,
            mode: estadoInicial,
            jobId,
            descripcion: descripcionLimpia,
            estacionFisicaVerificada: isPhysicalVerified
        };
    }

    // 3. MODO GALPÓN LOCAL WINDOWS: Intentar disparo directo; si falla, retener en bandeja
    try {
        await ejecutarCopyWindowsZebra(payload, nombreImpresora);
        try {
            await pool.query(
                `INSERT INTO public.zebra_print_queue
                    (tipo_etiqueta, descripcion, zpl_payload, nombre_impresora, estado, origen_entorno, estacion_fisica_verificada, dispositivo_origen, printed_at)
                 VALUES ($1, $2, $3, $4, 'IMPRESA_OK', 'win32-direct', TRUE, 'PCALMACEN_WIN32_DIRECT', CURRENT_TIMESTAMP)`,
                [tipoEtiqueta, descripcionLimpia, payload, nombreImpresora]
            );
        } catch (_) {}
        console.log(`✅ [ZEBRA-BRIDGE] Etiqueta "${descripcionLimpia}" enviada físicamente a \\\\localhost\\${nombreImpresora}.`);
        return { ok: true, mode: 'IMPRESA_DIRECTA_LOCAL', descripcion: descripcionLimpia, estacionFisicaVerificada: true };
    } catch (printErr) {
        console.warn(`⚠️ [ZEBRA-BRIDGE] Impresora Zebra no disponible (${printErr.message}). Reteniendo etiqueta en bandeja de confirmación...`);
        const resRetained = await pool.query(
            `INSERT INTO public.zebra_print_queue
                (tipo_etiqueta, descripcion, zpl_payload, nombre_impresora, estado, origen_entorno, estacion_fisica_verificada, dispositivo_origen, error_detalle)
             VALUES ($1, $2, $3, $4, 'PENDIENTE_CONFIRMACION_GALPON', 'win32-fallback', $5, $6, $7)
             RETURNING id`,
            [tipoEtiqueta, descripcionLimpia, payload, nombreImpresora, isPhysicalVerified, origenDispositivo, printErr.message]
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
            SELECT id, tipo_etiqueta, descripcion, nombre_impresora, estado, origen_entorno,
                   estacion_fisica_verificada, dispositivo_origen, error_detalle, created_at
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
    obtenerSecretoPresenciaZebra,
    generarTokenPresenciaFisicaGalpon,
    verificarTokenPresenciaFisicaGalpon,
    middlewareContextoPresenciaZebra,
    registrarHeartbeatAgenteZebra,
    asegurarTablaZebraQueue,
    despacharZplAZebra,
    obtenerResumenColaRetenida,
    liberarEtiquetasRetenidas,
    descartarEtiquetasRetenidas,
    obtenerTrabajosLiberadosParaAgente,
    confirmarImpresionAgente
};
