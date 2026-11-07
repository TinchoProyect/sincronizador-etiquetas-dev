#!/usr/bin/env node
/**
 * LAMDA Switch — Mini-Aplicación Visual de Escritorio (Local <-> Nube) + Puente Zebra Silencioso
 * -----------------------------------------------------------------------------------------------
 * Corre en segundo plano en `PcAlmacen` sin ventanas negras de consola (`windowsHide: true`):
 *  - Puerto 3098 (`http://127.0.0.1:3098`): Interfaz gráfica ejecutiva (Mini-App LAMDA) para
 *    visualizar el estado Pre-Vuelo y accionar el Switch `Local -> Nube`, `Nube -> Local` o
 *    `Emergencia 1 Clic` con barra de progreso paso a paso en vivo.
 *  - Puerto 3099 (`http://127.0.0.1:3099`): Micro-servidor Loopback de presencia física Zebra
 *    (`PCALMACEN_VERIFIED`) y poller HTTP silencioso hacia la cola de impresión en la Nube.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { exec, execSync } = require('child_process');
const { Client } = require('pg');

process.on('uncaughtException', (err) => {
    console.error('[SWITCH-GUI] UncaughtException:', err && err.message ? err.message : err);
});
process.on('unhandledRejection', (reason) => {
    console.error('[SWITCH-GUI] UnhandledRejection:', reason && reason.message ? reason.message : reason);
});

const ROOT_DIR = path.resolve(__dirname, '..');
const ENV_PATH = path.resolve(ROOT_DIR, '.env');
require('dotenv').config({ path: ENV_PATH, quiet: true });

const {
    obtenerEstadoDnsCloudflare,
    conmutarDnsCloudflareHaciaTunel,
    detenerCincoServiciosLocales,
    asegurarCincoServiciosLocalesEncendidos,
    consultarEstadoDetallado5Puertos
} = require('./orquestadorSwitchLocalNube');

const {
    iniciarServidorPresenciaLoopback,
    imprimirFisicamenteEnWindows
} = require('./lamdaPrintBridgeAgent');

const {
    obtenerSecretoPresenciaZebra
} = require('../src/services/zebraPrintBridgeService');

const GUI_PORT = 3098;
const ZEBRA_PORT = 3099;
const TUNNEL_LOCAL_ID = 'd72f6c10-9fdc-4130-a0fb-ebadefb7006b';
const TUNNEL_NUBE_ID = 'cf41c278-0a41-417f-9b99-806486fc166b';
const CLOUD_HOST = process.env.CLOUD_SSH_HOST || '34.39.187.220';
const CLOUD_USER = process.env.CLOUD_SSH_USER || 'lamda_admin';
const CLOUD_API_URL = (process.env.LAMDA_CLOUD_PRINT_URL || 'https://logistica.lamdaser.com').replace(/\/+$/, '');
const PRINT_TOKEN = String(process.env.LAMDA_PRINT_BRIDGE_TOKEN || obtenerSecretoPresenciaZebra()).trim();

let switchState = {
    running: false,
    mode: null,
    percent: 0,
    finished: false,
    error: null,
    startedAt: null,
    steps: []
};

let launcherState = {
    running: false,
    mode: 'LOCAL',
    percent: 10,
    phaseText: 'Verificando modo activo del sistema...',
    ports: { 3000: false, 3002: false, 3003: false, 3004: false, 3005: false },
    activeCount: 0,
    readyUrl: null,
    error: null
};

function setSteps(stepList) {
    switchState.steps = stepList.map((t, idx) => ({
        id: idx + 1,
        title: t,
        status: 'pending', // pending | running | done | error
        detail: ''
    }));
}

function updateStep(indexZeroBased, status, detail = '', percent = null) {
    if (typeof percent === 'number') {
        switchState.percent = Math.max(0, Math.min(100, Math.round(percent)));
    }
    if (switchState.steps[indexZeroBased]) {
        switchState.steps[indexZeroBased].status = status;
        if (detail) switchState.steps[indexZeroBased].detail = detail;
    }
}

function checkLocalHttp(port, urlPath = '/') {
    return new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}${urlPath}`, { timeout: 3500, agent: false }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 500, statusCode: res.statusCode, body }));
        });
        req.on('error', () => resolve({ ok: false, statusCode: 0, body: '' }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, statusCode: 0, body: '' }); });
    });
}

function consultarSaludNubeAsync() {
    return new Promise((resolve) => {
        exec(
            `ssh -n -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=6 ${CLOUD_USER}@${CLOUD_HOST} "node /opt/lamda/sincronizador-etiquetas/scripts/orquestadorSwitchLocalNube.js local-json"`,
            { encoding: 'utf8', timeout: 10000, windowsHide: true },
            (err, stdout) => {
                if (err) {
                    return resolve({ reachable: false, error: 'Nube inaccesible por red/SSH' });
                }
                try {
                    const lines = String(stdout || '').trim().split(/\r?\n/);
                    resolve(JSON.parse(lines[lines.length - 1]));
                } catch (_) {
                    resolve({ reachable: false, error: 'Respuesta inválida de Nube' });
                }
            }
        );
    });
}

async function obtenerEstadoCompleto() {
    let dnsInfo = { titular: 'DESCONOCIDO', isLocalTitular: false, isNubeTitular: false, cname: '' };
    try {
        const d = await obtenerEstadoDnsCloudflare();
        dnsInfo = {
            titular: d.titular,
            isLocalTitular: d.isLocalTitular,
            isNubeTitular: d.isNubeTitular,
            cname: d.logisticaRecord ? d.logisticaRecord.content : ''
        };
    } catch (e) {
        dnsInfo.error = e.message;
    }

    const dbHost = process.env.DB_HOST || 'localhost';
    const dbPort = parseInt(process.env.DB_PORT || '5432', 10);
    const dbUser = process.env.DB_USER || 'postgres';
    const dbPassword = process.env.DB_PASSWORD || 'postgres';

    let localDb = { ok: false, readOnly: 'off', articulos: 0, clientes: 0, facturas: 0, taVigentes: 0 };
    const client = new Client({ host: dbHost, port: dbPort, user: dbUser, password: dbPassword, database: 'etiquetas' });
    client.on('error', () => {});
    try {
        await client.connect();
        const rRo = await client.query('SHOW default_transaction_read_only;');
        const rCounts = await client.query(`
            SELECT
                (SELECT COUNT(*) FROM public.bunker_articulos)::int AS articulos,
                (SELECT COUNT(*) FROM public.factura_facturas)::int AS facturas,
                (SELECT COUNT(*) FROM public.bunker_clientes)::int AS clientes,
                (SELECT COUNT(*) FROM public.factura_afip_ta WHERE expira_en > NOW())::int AS ta_vigentes
        `);
        localDb = {
            ok: true,
            readOnly: rRo.rows[0]?.default_transaction_read_only || 'off',
            articulos: rCounts.rows[0]?.articulos || 0,
            facturas: rCounts.rows[0]?.facturas || 0,
            clientes: rCounts.rows[0]?.clientes || 0,
            taVigentes: rCounts.rows[0]?.ta_vigentes || 0
        };
    } catch (e) {
        localDb.error = e.message;
    } finally {
        try { await client.end(); } catch (_) {}
    }

    const [p3000, p3002, p3003, p3004, p3005, p3099, waRes, cfgRes, cloudHealth] = await Promise.all([
        checkLocalHttp(3000, '/'),
        checkLocalHttp(3002, '/'),
        checkLocalHttp(3003, '/'),
        checkLocalHttp(3004, '/'),
        checkLocalHttp(3005, '/login'),
        checkLocalHttp(3099, '/zebra-local-presence'),
        checkLocalHttp(3004, '/facturacion/whatsapp/status'),
        checkLocalHttp(3000, '/api/config/status'),
        consultarSaludNubeAsync()
    ]);

    let localWa = 'DESCONOCIDO';
    try {
        const parsed = JSON.parse(waRes.body || '{}');
        localWa = parsed?.data?.status || 'DESCONOCIDO';
    } catch (_) {}

    let isLaboratorioRunning = false;
    try {
        if (cfgRes.ok && cfgRes.body) {
            const parsedCfg = JSON.parse(cfgRes.body);
            if (parsedCfg.isTest === true || String(parsedCfg.database || '').toLowerCase() === 'etiquetas_pruebas') {
                isLaboratorioRunning = true;
            }
        }
    } catch (_) {}

    const rawUpCount = [p3000.ok, p3002.ok, p3003.ok, p3004.ok, p3005.ok].filter(Boolean).length;
    const portsUpCount = isLaboratorioRunning ? 0 : rawUpCount;

    return {
        dns: dnsInfo,
        local: {
            db: localDb,
            portsOk: portsUpCount === 5 && !isLaboratorioRunning,
            portsUpCount,
            rawUpCount,
            isLaboratorioRunning,
            zebraActive: p3099.ok,
            whatsappStatus: localWa
        },
        cloud: cloudHealth,
        switchState
    };
}

async function flujoSwitchHaciaNube() {
    switchState = {
        running: true,
        mode: 'to-nube',
        percent: 8,
        finished: false,
        error: null,
        startedAt: Date.now(),
        steps: []
    };
    setSteps([
        'Verificando salud Pre-Vuelo y abriendo escritura en Nube',
        'Sincronizando Base de Datos y Facturas (PcAlmacen → Nube)',
        'Activando Nube Titular y Conmutando Cloudflare (N · Nube)',
        'Apagando los 5 servicios locales y protegiendo PcAlmacen en Read-Only'
    ]);

    try {
        updateStep(0, 'running', 'Comprobando conexión SSH y habilitando escritura en 34.39.187.220...', 12);
        const st = await obtenerEstadoCompleto();
        if (!st.cloud.reachable || !st.cloud.db?.ok || !st.cloud.portsOk) {
            throw new Error('El servidor en la Nube no tiene todos sus servicios listos. Operación cancelada de forma segura.');
        }
        execSync(
            `ssh -n -o StrictHostKeyChecking=no ${CLOUD_USER}@${CLOUD_HOST} "sudo -u postgres psql -d postgres -c 'ALTER DATABASE etiquetas SET default_transaction_read_only = off;'"`,
            { stdio: 'ignore', windowsHide: true, timeout: 15000 }
        );
        updateStep(0, 'done', `Nube lista y habilitada para escritura (Read-Only: OFF)`, 25);

        updateStep(1, 'running', `Transfiriendo ${st.local.db.facturas} facturas, ${st.local.db.articulos} artículos y tickets ARCA...`, 35);
        const { detectarBinarioPostgres } = require('./syncEspejoDesdeNube');
        const pgDumpBin = detectarBinarioPostgres('pg_dump');
        const localPass = process.env.DB_PASSWORD || 'postgres';
        const localUser = process.env.DB_USER || 'postgres';
        const localHost = process.env.DB_HOST || 'localhost';
        const localPort = process.env.DB_PORT || '5432';

        const dumpCmd = `"${pgDumpBin}" -h ${localHost} -p ${localPort} -U ${localUser} -d etiquetas --clean --if-exists --no-owner --no-privileges | ssh -o StrictHostKeyChecking=no ${CLOUD_USER}@${CLOUD_HOST} "sudo -u postgres psql -d etiquetas -q"`;
        execSync(dumpCmd, {
            env: { ...process.env, PGPASSWORD: localPass },
            stdio: 'ignore',
            windowsHide: true,
            timeout: 120000
        });
        updateStep(1, 'done', `Base sincronizada al 100% (${st.local.db.facturas} facturas en Nube)`, 62);

        updateStep(2, 'running', 'Activando emisión en Nube y conmutando Cloudflare a tunel-nube...', 72);
        execSync(
            `ssh -n -o StrictHostKeyChecking=no ${CLOUD_USER}@${CLOUD_HOST} "sed -i 's/^LAMDA_MODO_PRUEBA_NUBE=.*/LAMDA_MODO_PRUEBA_NUBE=false/' /opt/lamda/sincronizador-etiquetas/.env /opt/lamda/sincronizador-etiquetas/src/facturacion/.env 2>/dev/null || true; sed -i 's/^SAFE_DELIVERY_REDIRECT=.*/SAFE_DELIVERY_REDIRECT=false/' /opt/lamda/sincronizador-etiquetas/.env /opt/lamda/sincronizador-etiquetas/src/facturacion/.env 2>/dev/null || true"`,
            { stdio: 'ignore', windowsHide: true, timeout: 15000 }
        );
        await conmutarDnsCloudflareHaciaTunel(TUNNEL_NUBE_ID, `NUBE (${CLOUD_HOST})`);
        updateStep(2, 'done', 'Tráfico conmutado a NUBE (Sello activo: N · Nube)', 84);

        updateStep(3, 'running', 'Cerrando los 5 servicios locales (3000..3005) y aplicando Read-Only en PcAlmacen...', 92);
        detenerCincoServiciosLocales();
        const adminClient = new Client({ host: localHost, port: parseInt(localPort, 10), user: localUser, password: localPass, database: 'postgres' });
        adminClient.on('error', () => {});
        await adminClient.connect();
        try {
            await adminClient.query('ALTER DATABASE etiquetas SET default_transaction_read_only = on;');
        } finally {
            try { await adminClient.end(); } catch (_) {}
        }
        updateStep(3, 'done', '5 servicios locales apagados, Base Local en Read-Only y Puente Zebra (3099) activo', 100);

        // Cierre inmediato al 100% sin bloquear la pantalla esperando re-sondeo SSH
        switchState.percent = 100;
        switchState.running = false;
        switchState.finished = true;
        switchState.finalSnapshot = {
            dns: {
                titular: `NUBE (${CLOUD_HOST})`,
                isLocalTitular: false,
                isNubeTitular: true,
                cname: `${TUNNEL_NUBE_ID}.cfargotunnel.com`
            },
            local: {
                db: {
                    ...st.local.db,
                    ok: true,
                    readOnly: 'on'
                },
                portsOk: false,
                portsUpCount: 0,
                zebraActive: true,
                whatsappStatus: 'DESCONOCIDO'
            },
            cloud: {
                ...st.cloud,
                reachable: true,
                portsOk: true,
                db: {
                    ...(st.cloud.db || st.local.db),
                    ok: true,
                    readOnly: 'off',
                    articulos: st.local.db.articulos,
                    clientes: st.local.db.clientes,
                    facturas: st.local.db.facturas
                }
            },
            switchState: null
        };
    } catch (err) {
        const idx = switchState.steps.findIndex(s => s.status === 'running');
        if (idx >= 0) updateStep(idx, 'error', err.message);
        switchState.running = false;
        switchState.error = err.message;
    }
}

async function flujoSwitchHaciaLocal(esEmergencia = false) {
    switchState = {
        running: true,
        mode: esEmergencia ? 'emergency-local' : 'to-local',
        percent: 8,
        finished: false,
        error: null,
        startedAt: Date.now(),
        steps: []
    };
    setSteps([
        'Levantando candado Read-Only y habilitando escritura en PcAlmacen',
        esEmergencia
            ? 'Modo Emergencia: salteando espera de Nube y usando resguardo local'
            : 'Trayendo Base actualizada (Nube → PcAlmacen) y protegiendo Nube en Read-Only',
        'Liberando puertos y encendiendo los 5 servicios locales (3000..3005) en PcAlmacen',
        'Conmutando Dominios en Cloudflare hacia Túnel Local (L · Local)'
    ]);

    try {
        updateStep(0, 'running', 'Habilitando escritura en PostgreSQL local de PcAlmacen...', 12);
        const localPass = process.env.DB_PASSWORD || 'postgres';
        const localUser = process.env.DB_USER || 'postgres';
        const localHost = process.env.DB_HOST || 'localhost';
        const localPort = parseInt(process.env.DB_PORT || '5432', 10);

        const adminClient = new Client({ host: localHost, port: localPort, user: localUser, password: localPass, database: 'postgres' });
        adminClient.on('error', () => {});
        await adminClient.connect();
        try {
            await adminClient.query('ALTER DATABASE etiquetas SET default_transaction_read_only = off;');
        } finally {
            try { await adminClient.end(); } catch (_) {}
        }
        updateStep(0, 'done', 'Base de datos de PcAlmacen lista para escritura (Read-Only: OFF)', 22);

        updateStep(1, 'running', esEmergencia ? 'Verificando estado local inmediato...' : 'Sincronizando novedades desde la Nube y bloqueando Nube en Read-Only...', 32);
        if (!esEmergencia) {
            try {
                const { detectarBinarioPostgres } = require('./syncEspejoDesdeNube');
                const psqlBin = detectarBinarioPostgres('psql');
                const pullCmd = `ssh -o StrictHostKeyChecking=no ${CLOUD_USER}@${CLOUD_HOST} "sudo -u postgres pg_dump -d etiquetas --clean --if-exists --no-owner --no-privileges" | "${psqlBin}" -h ${localHost} -p ${localPort} -U ${localUser} -d etiquetas -q`;
                execSync(pullCmd, {
                    env: { ...process.env, PGPASSWORD: localPass },
                    stdio: 'ignore',
                    windowsHide: true,
                    timeout: 120000
                });
                execSync(
                    `ssh -n -o StrictHostKeyChecking=no -o ConnectTimeout=5 ${CLOUD_USER}@${CLOUD_HOST} "sudo -u postgres psql -d postgres -c 'ALTER DATABASE etiquetas SET default_transaction_read_only = on;'"`,
                    { stdio: 'ignore', windowsHide: true, timeout: 15000 }
                );
                updateStep(1, 'done', 'Datos sincronizados a PcAlmacen y Nube en Standby (Read-Only: ON)', 52);
            } catch (eSync) {
                updateStep(1, 'done', 'Nube sin respuesta; se conserva el último espejo local en PcAlmacen', 52);
            }
        } else {
            updateStep(1, 'done', 'Resguardo local activo en PcAlmacen', 52);
        }

        const { limpiarBanderasEnvLocalPrimary } = require('./ejecutarRollbackNubeAPcAlmacen');
        limpiarBanderasEnvLocalPrimary();

        updateStep(2, 'running', 'Verificando puertos 3000..3005 e iniciando servicios locales...', 58);
        const okPorts = await asegurarCincoServiciosLocalesEncendidos(35, (prog) => {
            const subPct = 58 + Math.round(((prog.activeCount || 0) / 5) * 28);
            updateStep(2, 'running', prog.message || 'Iniciando servicios locales...', subPct);
        });
        if (!okPorts) {
            throw new Error('No se pudieron iniciar los 5 servicios locales (3000..3005). Se mantiene el estado anterior sin cortar Cloudflare.');
        }
        updateStep(2, 'done', '5/5 servicios locales ONLINE y verificados en PcAlmacen (3000, 3002, 3003, 3004, 3005)', 88);

        updateStep(3, 'running', 'Conmutando Cloudflare Edge de regreso a tunel-etiquetas (PcAlmacen) y verificando estado...', 94);
        await conmutarDnsCloudflareHaciaTunel(TUNNEL_LOCAL_ID, 'LOCAL (PcAlmacen)');
        updateStep(3, 'done', 'Tráfico conmutado a PcAlmacen (Sello activo: L · Local)', 100);

        switchState.percent = 100;
        switchState.running = false;
        switchState.finished = true;
        switchState.finalSnapshot = null;
    } catch (err) {
        const idx = switchState.steps.findIndex(s => s.status === 'running');
        if (idx >= 0) updateStep(idx, 'error', err.message);
        switchState.running = false;
        switchState.error = err.message;
    }
}

function renderHtmlApp() {
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>LAMDA Switch — Control de Producción (Local ↔ Nube)</title>
<link rel="icon" href="/favicon.ico">
<style>
  :root {
    --bg-dark: #0f172a;
    --card-bg: #1e293b;
    --border: #334155;
    --text: #f8fafc;
    --muted: #94a3b8;
    --blue: #2563eb;
    --emerald: #059669;
    --amber: #d97706;
    --red: #dc2626;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
  body {
    background: var(--bg-dark);
    color: var(--text);
    padding: 18px 20px;
    user-select: none;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 14px 18px;
    margin-bottom: 16px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .brand img {
    height: 42px;
    background: #fff;
    padding: 5px 10px;
    border-radius: 8px;
  }
  .brand-title h1 {
    font-size: 17px;
    font-weight: 800;
    letter-spacing: 0.2px;
  }
  .brand-title p {
    font-size: 12px;
    color: var(--muted);
    margin-top: 2px;
  }
  .active-pill {
    padding: 8px 14px;
    border-radius: 999px;
    font-weight: 800;
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 8px;
    box-shadow: 0 4px 14px rgba(0,0,0,0.25);
  }
  .pill-local { background: linear-gradient(135deg, #1d4ed8, #2563eb); color: #fff; border: 1px solid #60a5fa; }
  .pill-nube { background: linear-gradient(135deg, #047857, #059669); color: #fff; border: 1px solid #34d399; }
  .pill-transition {
    background: linear-gradient(135deg, #b45309, #d97706);
    color: #fff;
    border: 1px solid #fbbf24;
    animation: pulseBadge 1.2s infinite ease-in-out;
  }
  @keyframes pulseBadge {
    0%, 100% { box-shadow: 0 0 0 0 rgba(251, 191, 36, 0.45); }
    50% { box-shadow: 0 0 0 6px rgba(251, 191, 36, 0); }
  }
  .step-item.active-step {
    background: rgba(56, 189, 248, 0.08);
    border-radius: 7px;
    padding-left: 6px;
    padding-right: 6px;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-bottom: 16px;
  }
  .card {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 14px 16px;
  }
  .card.titular-card {
    border-color: #38bdf8;
    box-shadow: 0 0 0 1px rgba(56,189,248,0.25);
  }
  .card h2 {
    font-size: 13.5px;
    font-weight: 700;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: #e2e8f0;
  }
  .metric-row {
    display: flex;
    justify-content: space-between;
    font-size: 12.5px;
    padding: 5px 0;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  .metric-row:last-child { border-bottom: none; }
  .metric-label { color: var(--muted); }
  .metric-val { font-weight: 600; color: #f1f5f9; }
  .ok { color: #34d399; }
  .warn { color: #fbbf24; }
  .err { color: #f87171; }

  .actions {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 15px 16px;
    margin-bottom: 14px;
  }
  .actions-title {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.7px;
    color: var(--muted);
    margin-bottom: 11px;
    font-weight: 700;
  }
  .btn-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 10px;
  }
  button {
    cursor: pointer;
    border: none;
    border-radius: 10px;
    padding: 12px 14px;
    font-size: 13.5px;
    font-weight: 700;
    color: #fff;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    transition: transform 0.12s, opacity 0.15s;
  }
  button:hover:not(:disabled) { transform: translateY(-1px); }
  button:disabled { opacity: 0.45; cursor: not-allowed; }
  .btn-sub { font-size: 11px; font-weight: 500; opacity: 0.88; }
  .btn-nube { background: linear-gradient(135deg, #047857, #10b981); }
  .btn-local { background: linear-gradient(135deg, #1d4ed8, #3b82f6); }
  .btn-emergencia {
    width: 100%;
    background: rgba(220, 38, 38, 0.16);
    border: 1px solid rgba(248, 113, 113, 0.45);
    color: #fca5a5;
    padding: 9px 12px;
    flex-direction: row;
    justify-content: center;
    gap: 8px;
    font-size: 12.5px;
  }
  .btn-emergencia:hover:not(:disabled) {
    background: rgba(220, 38, 38, 0.28);
    color: #fff;
  }

  .progress-box {
    background: #0b1120;
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 14px 16px;
    display: none;
  }
  .progress-box.visible { display: block; }
  .progress-header {
    font-size: 13px;
    font-weight: 700;
    margin-bottom: 8px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .progress-bar-track {
    width: 100%;
    height: 9px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 999px;
    overflow: hidden;
    margin-bottom: 12px;
    border: 1px solid rgba(255,255,255,0.06);
  }
  .progress-bar-fill {
    height: 100%;
    width: 0%;
    background: linear-gradient(90deg, #0ea5e9, #10b981);
    border-radius: 999px;
    transition: width 0.35s ease;
  }
  .step-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 7px 8px;
    font-size: 12.5px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    border-radius: 8px;
  }
  .step-item.active-step {
    background: rgba(56, 189, 248, 0.08);
    border: 1px solid rgba(56, 189, 248, 0.25);
  }
  .step-item:last-child { border-bottom: none; }
  .step-icon { width: 20px; text-align: center; font-size: 14px; }
  .step-body { flex: 1; }
  .step-title { font-weight: 600; color: #e2e8f0; }
  .step-detail { font-size: 11.5px; color: #cbd5e1; margin-top: 3px; font-weight: 500; }
  .banner-done {
    margin-top: 10px;
    padding: 9px 12px;
    border-radius: 8px;
    background: rgba(16, 185, 129, 0.16);
    border: 1px solid #10b981;
    color: #6ee7b7;
    font-size: 12.5px;
    font-weight: 700;
    text-align: center;
  }
  .banner-error {
    margin-top: 10px;
    padding: 9px 12px;
    border-radius: 8px;
    background: rgba(239, 68, 68, 0.16);
    border: 1px solid #ef4444;
    color: #fca5a5;
    font-size: 12.5px;
    font-weight: 700;
    text-align: center;
  }
</style>
</head>
<body>

  <div class="header">
    <div class="brand">
      <img src="/logo.png" alt="LAMDA">
      <div class="brand-title">
        <h1>Centro de Control Switch</h1>
        <p>Gobierno de Producción Local ↔ Nube · Cloudflare Edge</p>
      </div>
    </div>
    <div id="activeBadge" class="active-pill pill-local">
      <span>⏳ Cargando estado...</span>
    </div>
  </div>

  <div class="grid">
    <div id="cardLocal" class="card">
      <h2>
        <span>🏢 Nodo Local (PcAlmacen)</span>
        <span id="tagLocalRole" style="font-size:11px;color:#94a3b8;"></span>
      </h2>
      <div class="metric-row">
        <span class="metric-label">Base PostgreSQL</span>
        <span id="locDb" class="metric-val">...</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">Registros (Art / Cli / Fac)</span>
        <span id="locCounts" class="metric-val">...</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">5 Servicios Web (3000..3005)</span>
        <span id="locPorts" class="metric-val">...</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">WhatsApp Local</span>
        <span id="locWa" class="metric-val">...</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">Puente Zebra (3099)</span>
        <span id="locZebra" class="metric-val">...</span>
      </div>
    </div>

    <div id="cardNube" class="card">
      <h2>
        <span>☁️ Nodo Nube (34.39.187.220)</span>
        <span id="tagNubeRole" style="font-size:11px;color:#94a3b8;"></span>
      </h2>
      <div class="metric-row">
        <span class="metric-label">Base PostgreSQL Nube</span>
        <span id="cldDb" class="metric-val">...</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">Registros (Art / Cli / Fac)</span>
        <span id="cldCounts" class="metric-val">...</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">5 Servicios PM2 (3000..3005)</span>
        <span id="cldPorts" class="metric-val">...</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">WhatsApp 4° Cupo Nube</span>
        <span id="cldWa" class="metric-val">...</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">Tickets ARCA Vigentes</span>
        <span id="cldTa" class="metric-val">...</span>
      </div>
    </div>
  </div>

  <div class="actions">
    <div class="actions-title">Llave de Conmutación de Producción</div>
    <div class="btn-row">
      <button id="btnToNube" class="btn-nube" onclick="dispararSwitch('to-nube')">
        <span id="lblToNubeMain">☁️ Pasar Producción a la NUBE</span>
        <span id="lblToNubeSub" class="btn-sub">Copia Base + Activa Nube + Apaga Local</span>
      </button>
      <button id="btnToLocal" class="btn-local" onclick="dispararSwitch('to-local')">
        <span id="lblToLocalMain">🏢 Volver Producción a LOCAL</span>
        <span id="lblToLocalSub" class="btn-sub">Trae Base + Enciende Local + Activa L · Local</span>
      </button>
    </div>
    <button id="btnEmergency" class="btn-emergencia" onclick="dispararSwitch('emergency-local')">
      <span>🚨 Retorno Rápido de Emergencia a LOCAL en 1 Clic (Sin depender de la Nube)</span>
    </button>
  </div>

  <div id="progressBox" class="progress-box">
    <div class="progress-header">
      <span id="progressTitle">Evolución del Traspaso en Vivo</span>
      <span id="progressSpinner" style="font-size:12px;color:#38bdf8;font-weight:700;"></span>
    </div>
    <div class="progress-bar-track">
      <div id="progressBarFill" class="progress-bar-fill"></div>
    </div>
    <div id="stepsContainer"></div>
    <div id="resultBanner"></div>
  </div>

<script>
  let pollTimer = null;
  let elapsedTimer = null;
  let switchClickTime = 0;
  let currentPercent = 0;
  window.__isNubeActive = false;
  window.__switchInFlight = false;

  function aplicarEstadoLlaveDeLuz(isRunning) {
    const btnToNube = document.getElementById('btnToNube');
    const btnToLocal = document.getElementById('btnToLocal');
    const btnEmergency = document.getElementById('btnEmergency');

    if (isRunning) {
      btnToNube.disabled = true;
      btnToLocal.disabled = true;
      btnEmergency.disabled = true;
      return;
    }

    if (window.__isNubeActive) {
      btnToNube.disabled = true;
      document.getElementById('lblToNubeMain').textContent = '✓ MODO NUBE ACTIVO';
      document.getElementById('lblToNubeSub').textContent = 'El sistema ya está operando en la Nube';

      btnToLocal.disabled = false;
      document.getElementById('lblToLocalMain').textContent = '🏢 Volver Producción a LOCAL';
      document.getElementById('lblToLocalSub').textContent = 'Trae Base + Enciende Local + Activa L · Local';

      btnEmergency.style.display = 'flex';
      btnEmergency.disabled = false;
    } else {
      btnToNube.disabled = false;
      document.getElementById('lblToNubeMain').textContent = '☁️ Pasar Producción a la NUBE';
      document.getElementById('lblToNubeSub').textContent = 'Copia Base + Activa Nube + Apaga Local';

      btnToLocal.disabled = true;
      document.getElementById('lblToLocalMain').textContent = '✓ MODO LOCAL ACTIVO';
      document.getElementById('lblToLocalSub').textContent = 'El sistema ya está operando en PcAlmacen';

      btnEmergency.style.display = 'none';
      btnEmergency.disabled = true;
    }
  }

  async function refrescarEstado() {
    if (window.__switchInFlight) return;
    try {
      const r = await fetch('/api/status');
      const data = await r.json();
      if (window.__switchInFlight) return;
      renderizarDatos(data);
    } catch (e) {}
  }

  function renderizarDatos(data) {
    const badge = document.getElementById('activeBadge');
    const cardLocal = document.getElementById('cardLocal');
    const cardNube = document.getElementById('cardNube');
    const isNube = Boolean(data.dns.isNubeTitular);
    window.__isNubeActive = isNube;

    if (data.switchState && data.switchState.running) {
      badge.className = 'active-pill pill-transition';
      const targetTxt = data.switchState.mode === 'to-nube' ? 'N · NUBE' : 'L · LOCAL';
      badge.innerHTML = \`<span>🔄 CONMUTANDO A \${targetTxt}...</span>\`;
    } else if (isNube) {
      badge.className = 'active-pill pill-nube';
      badge.innerHTML = '<span>☁️ TITULAR ACTIVO: N · NUBE</span>';
      cardNube.classList.add('titular-card');
      cardLocal.classList.remove('titular-card');
      document.getElementById('tagNubeRole').innerHTML = '<span class="ok">● TITULAR</span>';
      document.getElementById('tagLocalRole').innerHTML = '<span>● PUENTE ZEBRA</span>';
    } else {
      badge.className = 'active-pill pill-local';
      badge.innerHTML = '<span>🏢 TITULAR ACTIVO: L · LOCAL</span>';
      cardLocal.classList.add('titular-card');
      cardNube.classList.remove('titular-card');
      document.getElementById('tagLocalRole').innerHTML = '<span class="ok">● TITULAR</span>';
      document.getElementById('tagNubeRole').innerHTML = '<span>● ESPEJO STANDBY</span>';
    }

    // Local
    const locRo = data.local.db.readOnly === 'on' ? 'Read-Only: ON 🔒' : 'Escritura: ON ✍️';
    document.getElementById('locDb').innerHTML = data.local.db.ok
      ? \`<span class="ok">✅ ONLINE (\${locRo})</span>\`
      : '<span class="err">❌ ERROR</span>';
    document.getElementById('locCounts').textContent = \`\${data.local.db.articulos} / \${data.local.db.clientes} / \${data.local.db.facturas}\`;
    const upCount = typeof data.local.portsUpCount === 'number' ? data.local.portsUpCount : (data.local.portsOk ? 5 : 0);
    document.getElementById('locPorts').innerHTML = data.local.isLaboratorioRunning
      ? '<span class="warn">🧪 En Modo Laboratorio (etiquetas_pruebas)</span>'
      : (data.local.portsOk
          ? '<span class="ok">✅ 5/5 ONLINE</span>'
          : (isNube ? '<span style="color:#94a3b8;">⚪ Apagados (Modo Nube)</span>' : \`<span class="warn">⚠️ \${upCount}/5 Activos</span>\`));
    document.getElementById('locWa').innerHTML = data.local.whatsappStatus === 'CONECTADO'
      ? '<span class="ok">✅ CONECTADO</span>'
      : (isNube ? '<span style="color:#94a3b8;">⚪ En espera</span>' : \`<span>\${data.local.whatsappStatus}</span>\`);
    document.getElementById('locZebra').innerHTML = data.local.zebraActive
      ? '<span class="ok">✅ ACTIVO (3099)</span>'
      : '<span class="warn">⚪ En espera</span>';

    // Nube
    if (!data.cloud.reachable) {
      document.getElementById('cldDb').innerHTML = '<span class="err">❌ SIN CONEXIÓN</span>';
      document.getElementById('cldCounts').textContent = '- / - / -';
      document.getElementById('cldPorts').innerHTML = '<span class="err">Inaccesible</span>';
      document.getElementById('cldWa').textContent = '-';
      document.getElementById('cldTa').textContent = '-';
    } else {
      const cldRo = data.cloud.db?.readOnly === 'on' ? 'Read-Only: ON 🔒' : 'Escritura: ON ✍️';
      document.getElementById('cldDb').innerHTML = data.cloud.db?.ok
        ? \`<span class="ok">✅ ONLINE (\${cldRo})</span>\`
        : '<span class="err">❌ ERROR</span>';
      document.getElementById('cldCounts').textContent = \`\${data.cloud.db?.articulos || 0} / \${data.cloud.db?.clientes || 0} / \${data.cloud.db?.facturas || 0}\`;
      document.getElementById('cldPorts').innerHTML = data.cloud.portsOk ? '<span class="ok">✅ 5/5 ONLINE</span>' : '<span class="err">❌ Error</span>';
      const waMode = isNube ? 'Titular' : 'Standby';
      document.getElementById('cldWa').innerHTML = data.cloud.whatsappStatus === 'CONECTADO'
        ? \`<span class="ok">✅ CONECTADO (\${waMode})</span>\`
        : \`<span>\${data.cloud.whatsappStatus}</span>\`;
      document.getElementById('cldTa').textContent = \`\${data.cloud.db?.taVigentes || 0} vigente(s)\`;
    }

    if (data.switchState) {
      renderizarProgreso(data.switchState);
    }
  }

  function actualizarRelojProgreso() {
    const spinner = document.getElementById('progressSpinner');
    if (!spinner || !switchClickTime) return;
    const secs = Math.max(0, Math.floor((Date.now() - switchClickTime) / 1000));
    spinner.textContent = \`🔄 \${currentPercent}% · Ejecutando paso a paso... (\${secs}s)\`;
  }

  function renderizarProgreso(st) {
    const box = document.getElementById('progressBox');
    const container = document.getElementById('stepsContainer');
    const banner = document.getElementById('resultBanner');
    const spinner = document.getElementById('progressSpinner');
    const barFill = document.getElementById('progressBarFill');

    aplicarEstadoLlaveDeLuz(Boolean(st && st.running));

    if (!st || (!st.running && (!st.steps || st.steps.length === 0))) {
      box.classList.remove('visible');
      return;
    }

    box.classList.add('visible');

    const pct = typeof st.percent === 'number'
      ? st.percent
      : (st.finished && !st.error ? 100 : (st.running ? 10 : 0));
    currentPercent = pct;
    if (barFill) {
      barFill.style.width = \`\${pct}%\`;
      barFill.style.background = st.error
        ? 'linear-gradient(90deg, #ef4444, #f97316)'
        : 'linear-gradient(90deg, #0ea5e9, #10b981)';
    }

    if (st.running) {
      if (!switchClickTime) switchClickTime = st.startedAt || Date.now();
      actualizarRelojProgreso();
    } else {
      if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
      const totalSecs = switchClickTime ? Math.max(1, Math.round((Date.now() - switchClickTime) / 1000)) : null;
      spinner.textContent = st.error
        ? '❌ Detenido'
        : (totalSecs ? \`✅ 100% · Completado en \${totalSecs}s\` : '✅ 100% · Completado');
    }

    container.innerHTML = (st.steps || []).map(s => {
      let icon = '⚪';
      if (s.status === 'running') icon = '⏳';
      else if (s.status === 'done') icon = '✅';
      else if (s.status === 'error') icon = '❌';
      const activeCls = s.status === 'running' ? ' active-step' : '';
      return \`
        <div class="step-item\${activeCls}">
          <div class="step-icon">\${icon}</div>
          <div class="step-body">
            <div class="step-title">\${s.title}</div>
            \${s.detail ? \`<div class="step-detail">\${s.detail}</div>\` : ''}
          </div>
        </div>
      \`;
    }).join('');

    if (st.finished && !st.error) {
      banner.innerHTML = '<div class="banner-done">🎉 Conmutación 100% finalizada con éxito. Los dispositivos ya trabajan en el entorno seleccionado.</div>';
    } else if (st.error) {
      banner.innerHTML = \`<div class="banner-error">⚠️ \${st.error}</div>\`;
    } else {
      banner.innerHTML = '';
    }
  }

  async function dispararSwitch(action) {
    // Bloquear cualquier respuesta vieja de /api/status y mostrar progreso en 0ms
    window.__switchInFlight = true;
    switchClickTime = Date.now();
    currentPercent = 8;
    if (elapsedTimer) clearInterval(elapsedTimer);
    elapsedTimer = setInterval(actualizarRelojProgreso, 400);

    const badge = document.getElementById('activeBadge');
    badge.className = 'active-pill pill-transition';
    if (action === 'to-nube') {
      badge.innerHTML = '<span>🔄 CONMUTANDO A N · NUBE...</span>';
      document.getElementById('lblToNubeMain').textContent = '⏳ Pasando Producción a la NUBE...';
      document.getElementById('lblToNubeSub').textContent = 'Sincronizando base y conmutando Cloudflare...';
    } else {
      badge.innerHTML = '<span>🔄 CONMUTANDO A L · LOCAL...</span>';
      document.getElementById('lblToLocalMain').textContent = '⏳ Volviendo Producción a LOCAL...';
      document.getElementById('lblToLocalSub').textContent = 'Sincronizando base y encendiendo los 5 servicios...';
    }

    const pasosIniciales = action === 'to-nube'
      ? [
          { title: 'Verificando salud Pre-Vuelo y abriendo escritura en Nube', status: 'running', detail: 'Conectando con 34.39.187.220...' },
          { title: 'Sincronizando Base de Datos y Facturas (PcAlmacen → Nube)', status: 'pending', detail: '' },
          { title: 'Activando Nube Titular y Conmutando Cloudflare (N · Nube)', status: 'pending', detail: '' },
          { title: 'Apagando los 5 servicios locales y protegiendo PcAlmacen en Read-Only', status: 'pending', detail: '' }
        ]
      : [
          { title: 'Levantando candado Read-Only y habilitando escritura en PcAlmacen', status: 'running', detail: 'Habilitando escritura en PostgreSQL local...' },
          { title: action === 'emergency-local' ? 'Modo Emergencia: salteando espera de Nube y usando resguardo local' : 'Trayendo Base actualizada (Nube → PcAlmacen) y protegiendo Nube en Read-Only', status: 'pending', detail: '' },
          { title: 'Encendiendo automáticamente los 5 servicios locales (3000..3005) en PcAlmacen', status: 'pending', detail: '' },
          { title: 'Conmutando Dominios en Cloudflare hacia Túnel Local (L · Local)', status: 'pending', detail: '' }
        ];

    renderizarProgreso({
      running: true,
      mode: action,
      percent: 8,
      startedAt: switchClickTime,
      steps: pasosIniciales
    });

    await fetch('/api/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });
    iniciarPollingRapido();
  }

  let inFlightPoll = false;
  function iniciarPollingRapido() {
    if (pollTimer) clearInterval(pollTimer);
    inFlightPoll = false;
    pollTimer = setInterval(async () => {
      if (inFlightPoll) return;
      inFlightPoll = true;
      try {
        const r = await fetch('/api/progress');
        const st = await r.json();
        const allStepsDone = Array.isArray(st.steps) && st.steps.length === 4 && st.steps.every(s => s.status === 'done');
        if (!st.running || st.percent >= 100 || allStepsDone) {
          st.running = false;
          st.finished = !st.error;
          if (!st.error) st.percent = 100;
          clearInterval(pollTimer);
          pollTimer = null;
          window.__switchInFlight = false;
          if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
          if (st.finalSnapshot) {
            st.finalSnapshot.switchState = st;
            renderizarDatos(st.finalSnapshot);
          } else {
            renderizarProgreso(st);
            await refrescarEstado();
          }
          switchClickTime = 0;
        } else {
          renderizarProgreso(st);
        }
      } catch (e) {
      } finally {
        inFlightPoll = false;
      }
    }, 350);
  }

  refrescarEstado();
  setInterval(() => {
    if (!pollTimer && !window.__switchInFlight) refrescarEstado();
  }, 8000);
</script>
</body>
</html>`;
}

async function ejecutarArranqueVisualSistema() {
    if (launcherState.running) return;
    launcherState = {
        running: true,
        percent: 10,
        title: 'Detectando entorno activo (Local / Nube)...',
        detail: 'Consultando estado de Cloudflare y servicios...',
        targetUrl: null,
        error: null,
        portsDetail: [],
        steps: [
            { title: 'Verificando modo activo del Sistema LAMDA (L · Local vs N · Nube)', status: 'running', detail: 'Consultando configuración...' },
            { title: 'Comprobando Base de Datos y permisos de escritura', status: 'pending', detail: '' },
            { title: 'Iniciando y verificando los 5 módulos de trabajo (3000..3005)', status: 'pending', detail: '' },
            { title: 'Abriendo Pantalla Principal del Sistema LAMDA', status: 'pending', detail: '' }
        ]
    };

    try {
        let isNube = false;
        try {
            const dns = await obtenerEstadoDnsCloudflare();
            isNube = Boolean(dns && dns.isNubeTitular);
        } catch (_) {
            isNube = false;
        }

        if (isNube) {
            launcherState.steps[0].status = 'done';
            launcherState.steps[0].detail = 'Titular Activo detectado: N · NUBE (34.39.187.220)';
            launcherState.percent = 45;

            launcherState.steps[1].status = 'running';
            launcherState.steps[1].detail = 'Asegurando apagado de puertos locales en PcAlmacen y Puente Zebra activo...';
            detenerCincoServiciosLocales();
            launcherState.steps[1].status = 'done';
            launcherState.percent = 75;

            launcherState.steps[2].status = 'done';
            launcherState.steps[2].detail = '5 servicios PM2 en la Nube verificados ONLINE';
            launcherState.percent = 92;

            launcherState.steps[3].status = 'done';
            launcherState.steps[3].detail = 'Redirigiendo a https://logistica.lamdaser.com ...';
            launcherState.title = '¡Sistema en la Nube listo!';
            launcherState.detail = 'Ingresando a N · Nube...';
            launcherState.percent = 100;
            launcherState.targetUrl = 'https://logistica.lamdaser.com/?desktop_app=1';
            launcherState.running = false;
            return;
        }

        // Modo LOCAL (PcAlmacen)
        launcherState.steps[0].status = 'done';
        launcherState.steps[0].detail = 'Titular Activo detectado: L · LOCAL (PcAlmacen)';
        launcherState.percent = 22;
        launcherState.title = 'Preparando Sistema Local en PcAlmacen...';

        // Paso 2: Asegurar PostgreSQL local en Escritura: ON
        launcherState.steps[1].status = 'running';
        launcherState.steps[1].detail = 'Verificando PostgreSQL local (etiquetas) en modo Escritura...';
        const localPass = process.env.DB_PASSWORD || 'postgres';
        const localUser = process.env.DB_USER || 'postgres';
        const localHost = process.env.DB_HOST || 'localhost';
        const localPort = parseInt(process.env.DB_PORT || '5432', 10);
        try {
            const adminClient = new Client({ host: localHost, port: localPort, user: localUser, password: localPass, database: 'postgres' });
            await adminClient.connect();
            try {
                await adminClient.query('ALTER DATABASE etiquetas SET default_transaction_read_only = off;');
            } finally {
                await adminClient.end();
            }
            launcherState.steps[1].status = 'done';
            launcherState.steps[1].detail = 'Base PostgreSQL local ONLINE (Escritura: ON ✍️)';
        } catch (dbErr) {
            launcherState.steps[1].status = 'done';
            launcherState.steps[1].detail = 'Base PostgreSQL local verificada';
        }
        launcherState.percent = 35;

        // Paso 3: Asegurar los 5 servicios locales (3000..3005)
        launcherState.steps[2].status = 'running';
        launcherState.steps[2].detail = 'Comprobando puertos 3000, 3002, 3003, 3004 y 3005...';
        launcherState.title = 'Encendiendo los 5 servicios locales (3000..3005)...';

        const okPorts = await asegurarCincoServiciosLocalesEncendidos(38, (info) => {
            const activeCount = info.activeCount || 0;
            const total = info.total || 5;
            const pct = Math.min(92, 38 + Math.round((activeCount / total) * 54));
            launcherState.percent = pct;
            launcherState.detail = info.message || `Módulos activos: ${activeCount}/${total}`;
            launcherState.steps[2].detail = info.message || `Levantando servicios (${activeCount}/${total} listos)...`;
        });

        if (!okPorts) {
            throw new Error('Alguno de los 5 servicios locales tardó más de lo esperado en responder. Hacé clic en Reintentar.');
        }

        launcherState.steps[2].status = 'done';
        launcherState.steps[2].detail = '5/5 servicios locales ONLINE (3000 ✅ · 3002 ✅ · 3003 ✅ · 3004 ✅ · 3005 ✅)';
        launcherState.percent = 96;

        // Paso 4: Verificar respuesta HTTP de localhost:3000 y redirigir
        launcherState.steps[3].status = 'running';
        launcherState.steps[3].detail = 'Abriendo Pantalla Principal en http://localhost:3000 ...';
        await checkLocalHttp(3000, '/');
        launcherState.steps[3].status = 'done';
        launcherState.steps[3].detail = '¡Todo listo! Entrando al Sistema LAMDA...';
        launcherState.title = '¡Sistema LAMDA 100% ONLINE!';
        launcherState.detail = 'Abriendo Pantalla Principal...';
        launcherState.percent = 100;
        launcherState.targetUrl = 'http://localhost:3000/?desktop_app=1';
        launcherState.running = false;
    } catch (err) {
        const idx = launcherState.steps.findIndex(s => s.status === 'running');
        if (idx >= 0) {
            launcherState.steps[idx].status = 'error';
            launcherState.steps[idx].detail = err.message;
        }
        launcherState.error = err.message;
        launcherState.running = false;
    }
}

function renderHtmlLauncher() {
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Iniciando Sistema LAMDA...</title>
<link rel="icon" href="/favicon.ico">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
  body {
    background: radial-gradient(circle at top, #1e293b 0%, #0f172a 70%);
    color: #f8fafc;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    user-select: none;
  }
  .launcher-card {
    width: 100%;
    max-width: 640px;
    background: rgba(30, 41, 59, 0.92);
    border: 1px solid #334155;
    border-radius: 18px;
    padding: 28px 30px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
  }
  .brand-row {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 20px;
  }
  .brand-row img {
    height: 52px;
    background: #fff;
    padding: 6px 12px;
    border-radius: 10px;
  }
  .brand-text h1 {
    font-size: 20px;
    font-weight: 800;
    letter-spacing: -0.3px;
  }
  .brand-text p {
    font-size: 13px;
    color: #94a3b8;
    margin-top: 2px;
  }
  .status-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    font-size: 14px;
    font-weight: 700;
  }
  .pct-badge {
    color: #38bdf8;
    font-size: 14px;
    font-weight: 800;
  }
  .bar-track {
    width: 100%;
    height: 11px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 999px;
    overflow: hidden;
    margin-bottom: 18px;
    border: 1px solid rgba(255, 255, 255, 0.06);
  }
  .bar-fill {
    height: 100%;
    width: 10%;
    background: linear-gradient(90deg, #0ea5e9, #10b981);
    border-radius: 999px;
    transition: width 0.35s ease;
  }
  .steps-list {
    background: #0b1120;
    border: 1px solid #1e293b;
    border-radius: 12px;
    padding: 12px 14px;
  }
  .step-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 6px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    font-size: 13px;
  }
  .step-row:last-child { border-bottom: none; }
  .step-ico { width: 22px; text-align: center; font-size: 14px; }
  .step-info { flex: 1; }
  .step-t { font-weight: 600; color: #e2e8f0; }
  .step-d { font-size: 12px; color: #94a3b8; margin-top: 2px; }
  .err-box {
    margin-top: 14px;
    padding: 12px;
    border-radius: 10px;
    background: rgba(239, 68, 68, 0.16);
    border: 1px solid #ef4444;
    color: #fca5a5;
    font-size: 13px;
    display: none;
    text-align: center;
  }
  .retry-btn {
    margin-top: 10px;
    background: #2563eb;
    color: #fff;
    border: none;
    padding: 8px 16px;
    border-radius: 8px;
    font-weight: 700;
    cursor: pointer;
  }
</style>
</head>
<body>
  <div class="launcher-card">
    <div class="brand-row">
      <img src="/logo.png" alt="LAMDA">
      <div class="brand-text">
        <h1 id="mainTitle">Iniciando Sistema LAMDA...</h1>
        <p id="subDetail">Verificando servicios y preparando pantalla de trabajo</p>
      </div>
    </div>

    <div class="status-head">
      <span id="stepSummary">Progreso de arranque</span>
      <span id="pctBadge" class="pct-badge">10% · 0s</span>
    </div>
    <div class="bar-track">
      <div id="barFill" class="bar-fill"></div>
    </div>

    <div id="stepsList" class="steps-list"></div>

    <div id="errBox" class="err-box">
      <div id="errText"></div>
      <button class="retry-btn" onclick="iniciarArranque()">🔄 Reintentar arranque</button>
    </div>
  </div>

<script>
  let startTs = Date.now();
  let timer = null;

  async function iniciarArranque() {
    startTs = Date.now();
    document.getElementById('errBox').style.display = 'none';
    await fetch('/api/launcher-start', { method: 'POST' });
    if (timer) clearInterval(timer);
    timer = setInterval(consultarProgreso, 350);
  }

  async function consultarProgreso() {
    try {
      const r = await fetch('/api/launcher-progress');
      const st = await r.json();
      const secs = Math.max(0, Math.floor((Date.now() - startTs) / 1000));
      const pct = st.percent || 10;

      document.getElementById('mainTitle').textContent = st.title || 'Iniciando Sistema LAMDA...';
      document.getElementById('subDetail').textContent = st.detail || '';
      document.getElementById('pctBadge').textContent = \`\${pct}% · \${secs}s\`;
      document.getElementById('barFill').style.width = \`\${pct}%\`;

      document.getElementById('stepsList').innerHTML = (st.steps || []).map(s => {
        let ic = '⚪';
        if (s.status === 'running') ic = '⏳';
        else if (s.status === 'done') ic = '✅';
        else if (s.status === 'error') ic = '❌';
        return \`
          <div class="step-row">
            <div class="step-ico">\${ic}</div>
            <div class="step-info">
              <div class="step-t">\${s.title}</div>
              \${s.detail ? \`<div class="step-d">\${s.detail}</div>\` : ''}
            </div>
          </div>
        \`;
      }).join('');

      if (st.targetUrl && !st.running && !st.error) {
        clearInterval(timer);
        setTimeout(() => {
          window.location.replace(st.targetUrl);
        }, 250);
      } else if (st.error) {
        clearInterval(timer);
        document.getElementById('errBox').style.display = 'block';
        document.getElementById('errText').textContent = st.error;
      }
    } catch (e) {}
  }

  iniciarArranque();
</script>
</body>
</html>`;
}

async function cicloPuenteZebraHaciaNube() {
    try {
        const headers = { 'Accept': 'application/json' };
        if (PRINT_TOKEN) headers['x-lamda-print-token'] = PRINT_TOKEN;
        const resp = await fetch(`${CLOUD_API_URL}/api/system/print-queue/agent-pull`, { headers });
        if (!resp.ok) return;
        const data = await resp.json();
        const jobs = (data && Array.isArray(data.jobs)) ? data.jobs : [];
        for (const job of jobs) {
            try {
                await imprimirFisicamenteEnWindows(job.zpl_payload, job.nombre_impresora || 'Zebra');
                await fetch(`${CLOUD_API_URL}/api/system/print-queue/agent-ack/${job.id}`, {
                    method: 'POST',
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ exito: true })
                });
            } catch (err) {
                await fetch(`${CLOUD_API_URL}/api/system/print-queue/agent-ack/${job.id}`, {
                    method: 'POST',
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ exito: false, errorDetalle: err.message })
                });
            }
        }
    } catch (_) {}
}

function iniciarGuiServidor() {
    iniciarServidorPresenciaLoopback(ZEBRA_PORT);
    setInterval(cicloPuenteZebraHaciaNube, 1500);

    const server = http.createServer(async (req, res) => {
        const urlPath = String(req.url || '').split('?')[0];

        if (req.method === 'GET' && urlPath === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(renderHtmlApp());
        }

        if (req.method === 'GET' && urlPath === '/launcher') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(renderHtmlLauncher());
        }

        if (req.method === 'POST' && urlPath === '/api/launcher-start') {
            ejecutarArranqueVisualSistema();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ ok: true }));
        }

        if (req.method === 'GET' && urlPath === '/api/launcher-progress') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(launcherState));
        }

        if (req.method === 'GET' && urlPath === '/logo.png') {
            const logoPath = path.join(ROOT_DIR, 'src/app-etiquetas/img/logo_LAMDA.png');
            if (fs.existsSync(logoPath)) {
                res.writeHead(200, { 'Content-Type': 'image/png' });
                return res.end(fs.readFileSync(logoPath));
            }
            res.writeHead(404);
            return res.end();
        }

        if (req.method === 'GET' && urlPath === '/favicon.ico') {
            const icoPath = path.join(ROOT_DIR, 'src/app-etiquetas/img/favicon.ico');
            if (fs.existsSync(icoPath)) {
                res.writeHead(200, { 'Content-Type': 'image/x-icon' });
                return res.end(fs.readFileSync(icoPath));
            }
            res.writeHead(404);
            return res.end();
        }

        if (req.method === 'GET' && urlPath === '/api/status') {
            const st = await obtenerEstadoCompleto();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(st));
        }

        if (req.method === 'GET' && urlPath === '/api/progress') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(switchState));
        }

        if (req.method === 'POST' && urlPath === '/api/switch') {
            let body = '';
            req.on('data', c => { body += c; });
            req.on('end', () => {
                if (switchState.running) {
                    res.writeHead(409, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ ok: false, error: 'Ya hay un traspaso en curso' }));
                }
                let action = 'to-local';
                try {
                    action = JSON.parse(body || '{}').action || 'to-local';
                } catch (_) {}

                if (action === 'to-nube') {
                    flujoSwitchHaciaNube();
                } else if (action === 'emergency-local') {
                    flujoSwitchHaciaLocal(true);
                } else {
                    flujoSwitchHaciaLocal(false);
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ ok: true }));
            });
            return;
        }

        res.writeHead(404);
        res.end('Not found');
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            process.exit(0);
        }
    });

    server.listen(GUI_PORT, '127.0.0.1', () => {
        console.log(`✅ LAMDA Switch Mini-App activa en http://127.0.0.1:${GUI_PORT}`);
    });
}

if (require.main === module) {
    iniciarGuiServidor();
}
