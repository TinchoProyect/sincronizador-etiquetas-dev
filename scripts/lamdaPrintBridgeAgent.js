#!/usr/bin/env node
/**
 * LAMDA Print Bridge Agent — Conector Local de Impresora Zebra (Galpón Windows)
 * -----------------------------------------------------------------------------
 * Corre como servicio ligero en la PC física del depósito (`PcAlmacen`).
 * REGLA DE ORO OPERATIVA:
 *  - Al arrancar Windows, NUNCA imprime etiquetas viejas ni retenidas en
 *    estado `PENDIENTE_CONFIRMACION_GALPON`.
 *  - Únicamente despacha hacia `\\localhost\Zebra` aquellas etiquetas que
 *    el operador del galpón haya liberado explícitamente desde el cartel
 *    superior ("▶️ Imprimir Todas Ahora" -> estado `LIBERADA_PARA_IMPRIMIR`).
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const {
    obtenerTrabajosLiberadosParaAgente,
    confirmarImpresionAgente,
    obtenerResumenColaRetenida
} = require('../src/services/zebraPrintBridgeService');

const CLOUD_API_URL = (process.env.LAMDA_CLOUD_PRINT_URL || '').replace(/\/+$/, '');
const PRINT_TOKEN = process.env.LAMDA_PRINT_BRIDGE_TOKEN || '';
const POLL_INTERVAL_MS = parseInt(process.env.ZEBRA_BRIDGE_POLL_MS || '3000', 10);

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
    console.log('Seguridad de arranque: Las etiquetas en PENDIENTE_CONFIRMACION_GALPON');
    console.log('permanecen RETENIDAS hasta que se presione [▶️ Imprimir Todas Ahora].');

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

iniciar();
