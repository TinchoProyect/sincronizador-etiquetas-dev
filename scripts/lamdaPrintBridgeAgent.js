#!/usr/bin/env node
/**
 * LAMDA Print Bridge Agent — Conector Local de Impresora Zebra + Loopback 127.0.0.1:3099
 * --------------------------------------------------------------------------------------
 * Corre como servicio ligero en la PC física del depósito (`PcAlmacen`).
 *
 * REGLAS DE ORO OPERATIVAS (Fase 2 / Micro-Etapa 1):
 *  1. Levanta un micro-servidor HTTP exclusivo en Loopback (`http://127.0.0.1:3099/zebra-local-presence`)
 *     que emite un token HMAC temporal (`PCALMACEN_VERIFIED`).
 *     - Solo el navegador abierto físicamente en `PcAlmacen` alcanza `127.0.0.1:3099`.
 *     - Cuando el operador hace clic en "Imprimir" desde `PcAlmacen`, el navegador inyecta
 *       `X-Lamda-Physical-Station: PCALMACEN_VERIFIED` + `X-Lamda-Physical-Token`, el VPS
 *       valida la firma HMAC y encola la etiqueta como `LIBERADA_PARA_IMPRIMIR`, saliendo
 *       impresa en ~1 segundo.
 *  2. Si un pedido o disparo proviene de un celular en la calle o una notebook externa
 *     (que no tiene `127.0.0.1:3099` de `PcAlmacen`), queda retenido en
 *     `PENDIENTE_CONFIRMACION_GALPON` y NUNCA se imprime solo hasta que alguien en el galpón
 *     presione `[▶️ Imprimir Todas Ahora]`.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const { exec } = require('child_process');
const {
    obtenerSecretoPresenciaZebra,
    generarTokenPresenciaFisicaGalpon,
    registrarHeartbeatAgenteZebra,
    obtenerTrabajosLiberadosParaAgente,
    confirmarImpresionAgente,
    obtenerResumenColaRetenida
} = require('../src/services/zebraPrintBridgeService');

const CLOUD_API_URL = (process.env.LAMDA_CLOUD_PRINT_URL || '').replace(/\/+$/, '');
const PRINT_TOKEN = String(process.env.LAMDA_PRINT_BRIDGE_TOKEN || obtenerSecretoPresenciaZebra()).trim();
const POLL_INTERVAL_MS = parseInt(process.env.ZEBRA_BRIDGE_POLL_MS || '1000', 10);
const LOCAL_PRESENCE_PORT = parseInt(process.env.ZEBRA_LOCAL_PRESENCE_PORT || '3099', 10);

function iniciarServidorPresenciaLoopback(port = LOCAL_PRESENCE_PORT) {
    const server = http.createServer((req, res) => {
        const origin = req.headers.origin || '*';
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Access-Control-Request-Private-Network');
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            return res.end();
        }

        const urlPath = String(req.url || '').split('?')[0];
        if (req.method === 'GET' && (urlPath === '/zebra-local-presence' || urlPath === '/status')) {
            const nowTs = Date.now();
            const hmacToken = generarTokenPresenciaFisicaGalpon('PCALMACEN_VERIFIED', nowTs);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
                ok: true,
                station: 'PCALMACEN_VERIFIED',
                timestamp: nowTs,
                token: hmacToken,
                printer: 'Zebra',
                pollMs: POLL_INTERVAL_MS
            }));
        }

        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Endpoint no encontrado en Zebra Loopback Agent' }));
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.warn(`⚠️ [ZEBRA-LOOPBACK] El puerto 127.0.0.1:${port} ya está activo en esta estación.`);
        } else {
            console.warn(`⚠️ [ZEBRA-LOOPBACK] Error en micro-servidor loopback:`, err.message);
        }
    });

    server.listen(port, '127.0.0.1', () => {
        console.log(`🔒 [ZEBRA-LOOPBACK] Presencia Física activa en http://127.0.0.1:${port}/zebra-local-presence`);
    });

    return server;
}

function imprimirFisicamenteEnWindows(zplPayload, nombreImpresora = 'Zebra') {
    return new Promise((resolve, reject) => {
        if (process.platform !== 'win32') {
            return reject(new Error('El Agente Físico Zebra requiere ejecutarse en Windows (PcAlmacen).'));
        }
        const tempFile = path.join(__dirname, `../temp_agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.zpl`);
        try {
            fs.writeFileSync(tempFile, zplPayload, 'utf8');
        } catch (err) {
            return reject(err);
        }
        const cmd = `COPY /B "${tempFile}" \\\\localhost\\${nombreImpresora}`;
        exec(cmd, (error, stdout, stderr) => {
            fs.unlink(tempFile, () => {});
            if (error) {
                return reject(new Error(stderr || error.message));
            }
            resolve(stdout);
        });
    });
}

async function cicloAgenteRemoto() {
    const headers = { 'Accept': 'application/json' };
    if (PRINT_TOKEN) headers['x-lamda-print-token'] = PRINT_TOKEN;

    const resp = await fetch(`${CLOUD_API_URL}/api/system/print-queue/agent-pull`, { headers });
    if (!resp.ok) return;
    const data = await resp.json();
    const jobs = (data && Array.isArray(data.jobs)) ? data.jobs : [];

    for (const job of jobs) {
        try {
            console.log(`🖨️ [ZEBRA-AGENT] Imprimiendo trabajo liberado #${job.id}: ${job.descripcion || job.tipo_etiqueta}`);
            await imprimirFisicamenteEnWindows(job.zpl_payload, job.nombre_impresora || 'Zebra');
            await fetch(`${CLOUD_API_URL}/api/system/print-queue/agent-ack/${job.id}`, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ exito: true })
            });
            console.log(`✅ [ZEBRA-AGENT] Trabajo #${job.id} impreso con éxito.`);
        } catch (err) {
            console.error(`❌ [ZEBRA-AGENT] Error en trabajo #${job.id} (${err.message}). Se devuelve a bandeja retenida.`);
            await fetch(`${CLOUD_API_URL}/api/system/print-queue/agent-ack/${job.id}`, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ exito: false, errorDetalle: err.message })
            });
        }
    }
}

async function cicloAgenteBaseLocal() {
    await registrarHeartbeatAgenteZebra({ estacionId: 'PCALMACEN', ipOrigen: '127.0.0.1', estadoImpresora: 'ONLINE' });
    const jobs = await obtenerTrabajosLiberadosParaAgente(20);
    for (const job of jobs) {
        try {
            console.log(`🖨️ [ZEBRA-AGENT] Imprimiendo trabajo liberado #${job.id}: ${job.descripcion || job.tipo_etiqueta}`);
            await imprimirFisicamenteEnWindows(job.zpl_payload, job.nombre_impresora || 'Zebra');
            await confirmarImpresionAgente(job.id, true, null);
            console.log(`✅ [ZEBRA-AGENT] Trabajo #${job.id} impreso con éxito.`);
        } catch (err) {
            console.error(`❌ [ZEBRA-AGENT] Error en trabajo #${job.id} (${err.message}). Se devuelve a bandeja retenida.`);
            await confirmarImpresionAgente(job.id, false, err.message);
        }
    }
}

async function iniciar() {
    console.log('==================================================================');
    console.log('🖨️  LAMDA PRINT BRIDGE AGENT — CONECTOR FÍSICO ZEBRA (GALPÓN)');
    console.log('==================================================================');
    console.log(`Modo de conexión : ${CLOUD_API_URL ? `Nube (${CLOUD_API_URL})` : `PostgreSQL Directo (${process.env.DB_NAME || 'etiquetas'})`}`);
    console.log(`Frecuencia Poll  : ${POLL_INTERVAL_MS} ms (~1s para clics locales desde PcAlmacen)`);
    console.log('Seguridad remota : Disparos desde celular/calle quedan en PENDIENTE_CONFIRMACION_GALPON');
    console.log('                   hasta presionar [▶️ Imprimir Todas Ahora] en el depósito.');

    iniciarServidorPresenciaLoopback(LOCAL_PRESENCE_PORT);

    if (!CLOUD_API_URL) {
        const resumen = await obtenerResumenColaRetenida();
        if (resumen.pendingConfirmationCount > 0) {
            console.log(`📌 Hay ${resumen.pendingConfirmationCount} etiqueta(s) retenida(s) esperando confirmación en pantalla.`);
        }
    }

    setInterval(async () => {
        try {
            if (CLOUD_API_URL) {
                await cicloAgenteRemoto();
            } else {
                await cicloAgenteBaseLocal();
            }
        } catch (err) {
            // Silencioso ante microcortes de red
        }
    }, POLL_INTERVAL_MS);
}

if (require.main === module) {
    iniciar();
}

module.exports = {
    iniciar,
    iniciarServidorPresenciaLoopback,
    imprimirFisicamenteEnWindows
};
