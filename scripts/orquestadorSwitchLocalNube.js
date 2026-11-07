#!/usr/bin/env node
/**
 * Orquestador Central del Switch Producción (Local <-> Nube) — Sistema LAMDA
 * --------------------------------------------------------------------------
 * Gobierna la conmutación entre:
 *   - NODO LOCAL (PcAlmacen): Túnel Cloudflare `tunel-etiquetas` (d72f6c10-9fdc-4130-a0fb-ebadefb7006b)
 *   - NODO NUBE (34.39.187.220): Túnel Cloudflare `tunel-nube` (cf41c278-0a41-417f-9b99-806486fc166b)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { execSync, spawn } = require('child_process');
const { Client } = require('pg');

const ROOT_DIR = path.resolve(__dirname, '..');
const ENV_PATH = path.resolve(ROOT_DIR, '.env');
require('dotenv').config({ path: ENV_PATH, quiet: true });

const TUNNEL_LOCAL_ID = 'd72f6c10-9fdc-4130-a0fb-ebadefb7006b';
const TUNNEL_NUBE_ID = 'cf41c278-0a41-417f-9b99-806486fc166b';
const CLOUDFLARED_BIN = 'C:\\Cloudflared\\cloudflared.exe';
const CERT_PEM_PATH = path.join(os.homedir(), '.cloudflared', 'cert.pem');
const CLOUD_HOST = process.env.CLOUD_SSH_HOST || '34.39.187.220';
const CLOUD_USER = process.env.CLOUD_SSH_USER || 'lamda_admin';
const TARGET_DOMAINS = ['logistica.lamdaser.com', 'inventario.lamdaser.com'];

function leerCredencialesCloudflare() {
    const candidates = [
        CERT_PEM_PATH,
        '/etc/cloudflared/cert.pem'
    ];
    const found = candidates.find(p => fs.existsSync(p));
    if (!found) {
        throw new Error(`No se encontró cert.pem en ${CERT_PEM_PATH}`);
    }
    const pem = fs.readFileSync(found, 'utf8');
    const m = /-----BEGIN ARGO TUNNEL TOKEN-----\s*([\s\S]*?)\s*-----END ARGO TUNNEL TOKEN-----/.exec(pem);
    if (!m) throw new Error('Token de Cloudflare no válido en cert.pem');
    return JSON.parse(Buffer.from(m[1].replace(/\s+/g, ''), 'base64').toString('utf8'));
}

function llamarApiCloudflare(method, apiPath, bodyObj = null) {
    const cred = leerCredencialesCloudflare();
    return new Promise((resolve, reject) => {
        const payload = bodyObj ? JSON.stringify(bodyObj) : null;
        const req = https.request(`https://api.cloudflare.com/client/v4/zones/${cred.zoneID}${apiPath}`, {
            method,
            headers: {
                'Authorization': `Bearer ${cred.apiToken}`,
                'Content-Type': 'application/json',
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
            },
            timeout: 10000
        }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error(`Respuesta inválida de Cloudflare: ${data.slice(0, 120)}`));
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout consultando API de Cloudflare')); });
        if (payload) req.write(payload);
        req.end();
    });
}

async function obtenerEstadoDnsCloudflare() {
    const resp = await llamarApiCloudflare('GET', '/dns_records');
    if (!resp || !resp.success) {
        throw new Error('No se pudo consultar DNS en Cloudflare');
    }
    const records = resp.result || [];
    const logisticaRec = records.find(r => r.name === 'logistica.lamdaser.com');
    const inventarioRec = records.find(r => r.name === 'inventario.lamdaser.com');
    const content = logisticaRec ? String(logisticaRec.content || '') : '';
    let titular = 'DESCONOCIDO';
    if (content.includes(TUNNEL_LOCAL_ID)) titular = 'LOCAL (PcAlmacen)';
    else if (content.includes(TUNNEL_NUBE_ID) || content === CLOUD_HOST) titular = `NUBE (${CLOUD_HOST})`;
    return {
        titular,
        isLocalTitular: content.includes(TUNNEL_LOCAL_ID),
        isNubeTitular: content.includes(TUNNEL_NUBE_ID) || content === CLOUD_HOST,
        logisticaRecord: logisticaRec || null,
        inventarioRecord: inventarioRec || null
    };
}

async function conmutarDnsCloudflareHaciaTunel(tunnelId, etiquetaDestino) {
    console.log(`☁️  [CLOUDFLARE-SWITCH] Conmutando dominios [${TARGET_DOMAINS.join(', ')}] -> ${etiquetaDestino} (${tunnelId})...`);
    const targetCname = `${tunnelId}.cfargotunnel.com`;
    const resp = await llamarApiCloudflare('GET', '/dns_records');
    const records = (resp && resp.result) ? resp.result : [];

    for (const domain of TARGET_DOMAINS) {
        const existing = records.find(r => r.name === domain);
        if (existing && existing.id) {
            const upd = await llamarApiCloudflare('PUT', `/dns_records/${existing.id}`, {
                type: 'CNAME',
                name: domain,
                content: targetCname,
                proxied: true,
                ttl: 1
            });
            if (!upd || !upd.success) {
                throw new Error(`Error actualizando DNS de ${domain} en Cloudflare: ${JSON.stringify(upd?.errors || [])}`);
            }
            console.log(`   ✅ ${domain} -> ${targetCname} (Proxied: true, cambio instantáneo)`);
        } else if (fs.existsSync(CLOUDFLARED_BIN)) {
            execSync(`"${CLOUDFLARED_BIN}" tunnel route dns --overwrite-dns ${tunnelId} ${domain}`, { stdio: 'inherit' });
        }
    }
}

function checkLocalHttp(port, urlPath = '/') {
    return new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}${urlPath}`, { timeout: 6000, agent: false }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 500, statusCode: res.statusCode, body }));
        });
        req.on('error', () => resolve({ ok: false, statusCode: 0, body: '' }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, statusCode: 0, body: '' }); });
    });
}

async function verificarSaludLocal() {
    const dbHost = process.env.DB_HOST || 'localhost';
    const dbPort = parseInt(process.env.DB_PORT || '5432', 10);
    const dbUser = process.env.DB_USER || 'postgres';
    const dbPassword = process.env.DB_PASSWORD || 'postgres';
    const dbName = 'etiquetas';

    let dbInfo = { ok: false, readOnly: 'unknown', articulos: 0, facturas: 0, clientes: 0, taVigentes: 0 };
    const client = new Client({ host: dbHost, port: dbPort, user: dbUser, password: dbPassword, database: dbName });
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
        dbInfo = {
            ok: true,
            readOnly: rRo.rows[0]?.default_transaction_read_only || 'off',
            articulos: rCounts.rows[0]?.articulos || 0,
            facturas: rCounts.rows[0]?.facturas || 0,
            clientes: rCounts.rows[0]?.clientes || 0,
            taVigentes: rCounts.rows[0]?.ta_vigentes || 0
        };
    } catch (e) {
        dbInfo.error = e.message;
    } finally {
        try { await client.end(); } catch (_) {}
    }

    const [p3000, p3002, p3003, p3004, p3005, p3099, waRes] = await Promise.all([
        checkLocalHttp(3000, '/'),
        checkLocalHttp(3002, '/'),
        checkLocalHttp(3003, '/'),
        checkLocalHttp(3004, '/'),
        checkLocalHttp(3005, '/login'),
        checkLocalHttp(3099, '/zebra-local-presence'),
        checkLocalHttp(3004, '/facturacion/whatsapp/status')
    ]);

    let waStatus = 'DESCONOCIDO';
    let modoPruebaNube = false;
    try {
        const parsedWa = JSON.parse(waRes.body || '{}');
        waStatus = parsedWa?.data?.status || 'DESCONOCIDO';
        modoPruebaNube = Boolean(parsedWa?.data?.modoPruebaNube);
        if (fs.existsSync(ENV_PATH)) {
            const rawEnv = fs.readFileSync(ENV_PATH, 'utf8');
            const mFlag = /^LAMDA_MODO_PRUEBA_NUBE=(.+)$/m.exec(rawEnv);
            if (mFlag) {
                const v = mFlag[1].trim().toLowerCase();
                modoPruebaNube = (v === 'true' || v === '1');
            }
        }
    } catch (_) {}

    return {
        reachable: true,
        db: dbInfo,
        portsOk: p3000.ok && p3002.ok && p3003.ok && p3004.ok && p3005.ok,
        zebraBridge3099Active: p3099.ok,
        whatsappStatus: waStatus,
        modoPruebaNube
    };
}

function verificarSaludNube() {
    try {
        const out = execSync(
            `ssh -n -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=8 ${CLOUD_USER}@${CLOUD_HOST} "node /opt/lamda/sincronizador-etiquetas/scripts/orquestadorSwitchLocalNube.js local-json"`,
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000, windowsHide: true }
        );
        const lines = String(out || '').trim().split(/\r?\n/);
        const lastJsonLine = lines[lines.length - 1];
        return JSON.parse(lastJsonLine);
    } catch (err) {
        return { reachable: false, error: err.message };
    }
}

function detenerCincoServiciosLocales() {
    liberarPuertosEspecificosYLocks([3000, 3002, 3003, 3004, 3005]);
}

function runHiddenPsEncoded(psScript, timeoutMs = 15000) {
    const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
    return execSync(`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`, {
        stdio: 'ignore',
        windowsHide: true,
        timeout: timeoutMs
    });
}

function lanzarProcesoNodeOcultoWmi(scriptRelPath) {
    const fullScript = path.join(ROOT_DIR, scriptRelPath);
    const nodeExe = process.execPath || 'C:\\Program Files\\nodejs\\node.exe';
    const ps = `
$si = New-CimInstance -ClassName Win32_ProcessStartup -Property @{ ShowWindow = [uint16]0 } -ClientOnly
$cmd = '"' + '${nodeExe.replace(/'/g, "''")}' + '" "' + '${fullScript.replace(/'/g, "''")}' + '"'
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $cmd
    CurrentDirectory = '${ROOT_DIR.replace(/'/g, "''")}'
    ProcessStartupInformation = $si
} | Out-Null
`;
    runHiddenPsEncoded(ps, 10000);
}

function liberarPuertosEspecificosYLocks(portsToFree = []) {
    if (!Array.isArray(portsToFree) || portsToFree.length === 0) return;
    const portsList = portsToFree.map(p => Number(p)).filter(Boolean).join(',');
    const clearPuppeteer = portsToFree.includes(3004) ? '$true' : '$false';
    const myPid = process.pid || 0;
    const ps = `
$puertos = @(${portsList})
foreach ($p in $puertos) {
    $conns = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    if ($conns) {
        foreach ($c in $conns) {
            $pidToKill = $c.OwningProcess
            if ($pidToKill -gt 4 -and $pidToKill -ne ${myPid}) {
                $wmi = Get-CimInstance Win32_Process -Filter "ProcessId = $pidToKill" -ErrorAction SilentlyContinue
                if ($wmi -and ($wmi.CommandLine -like '*lamdaSwitchGuiServer.js*')) {
                    continue
                }
                Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
Get-Process -Name "LamdaControlPanel","LamdaControlPanel_Runtime" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe' OR Name = 'msedge.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -like '*LamdaLaboratorioBrowserProfile*'
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
if (${clearPuppeteer}) {
    Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe' OR Name = 'chromium.exe'" -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -like '*session-lamda-billing*' -or $_.CommandLine -like '*\\.cache\\puppeteer\\*'
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
$cfProcs = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*runCloudflaredSafe.js*' })
if ($cfProcs.Count -gt 1) {
    for ($i = 1; $i -lt $cfProcs.Count; $i++) {
        Stop-Process -Id $cfProcs[$i].ProcessId -Force -ErrorAction SilentlyContinue
    }
}
`;
    try {
        runHiddenPsEncoded(ps, 15000);
    } catch (_) {}
}

async function consultarEstadoDetallado5Puertos() {
    const [p3000, p3002, p3003, p3004, p3005, waRes, cfgRes] = await Promise.all([
        checkLocalHttp(3000, '/'),
        checkLocalHttp(3002, '/'),
        checkLocalHttp(3003, '/'),
        checkLocalHttp(3004, '/'),
        checkLocalHttp(3005, '/login'),
        checkLocalHttp(3004, '/facturacion/whatsapp/status'),
        checkLocalHttp(3000, '/api/config/status')
    ]);
    let whatsappStatus = 'DESCONOCIDO';
    try {
        const parsed = JSON.parse(waRes.body || '{}');
        whatsappStatus = parsed?.data?.status || 'DESCONOCIDO';
    } catch (_) {}
    let isLaboratorio = false;
    try {
        if (cfgRes.ok && cfgRes.body) {
            const parsedCfg = JSON.parse(cfgRes.body);
            if (parsedCfg.isTest === true || String(parsedCfg.database || '').toLowerCase() === 'etiquetas_pruebas') {
                isLaboratorio = true;
            }
        }
    } catch (_) {}
    const ports = {
        3000: p3000.ok && !isLaboratorio,
        3002: p3002.ok && !isLaboratorio,
        3003: p3003.ok && !isLaboratorio,
        3004: p3004.ok && !isLaboratorio,
        3005: p3005.ok && !isLaboratorio
    };
    const rawUpCount = [p3000.ok, p3002.ok, p3003.ok, p3004.ok, p3005.ok].filter(Boolean).length;
    const activeCount = Object.values(ports).filter(Boolean).length;
    return {
        ports,
        activeCount,
        rawUpCount,
        isLaboratorio,
        total: 5,
        allOk: activeCount === 5 && !isLaboratorio,
        whatsappStatus
    };
}

async function asegurarCincoServiciosLocalesEncendidos(maxWaitSec = 35, onProgress = null) {
    const services = [
        { port: 3000, name: 'Pizarra / Etiquetas', script: 'src/app-etiquetas/server.js' },
        { port: 3002, name: 'Producción', script: 'src/produccion/app.js' },
        { port: 3003, name: 'Presupuestos', script: 'src/presupuestos/app.js' },
        { port: 3004, name: 'Facturación & WhatsApp', script: 'src/facturacion/app.js' },
        { port: 3005, name: 'Logística', script: 'src/logistica/app.js' }
    ];

    const initial = await consultarEstadoDetallado5Puertos();
    if (typeof onProgress === 'function') {
        onProgress({
            ...initial,
            phase: 'check',
            message: initial.allOk
                ? '5/5 servicios locales activos y verificados'
                : `Verificando puertos locales (${initial.activeCount}/5 activos)...`
        });
    }
    if (initial.allOk) return true;

    const downPorts = initial.isLaboratorio ? [3000, 3002, 3003, 3004, 3005] : services.filter(s => !initial.ports[s.port]).map(s => s.port);
    if (typeof onProgress === 'function') {
        onProgress({
            ...initial,
            phase: 'cleanup',
            message: `Liberando puertos locales (${downPorts.join(', ')}) e iniciando procesos...`
        });
    }
    liberarPuertosEspecificosYLocks(downPorts);
    await new Promise(r => setTimeout(r, 600));

    for (const svc of services) {
        if (initial.ports[svc.port]) continue;
        try {
            lanzarProcesoNodeOcultoWmi(svc.script);
        } catch (_) {}
    }

    // Asegurar 1 única instancia de runCloudflaredSafe.js
    try {
        const psCf = `
$cf = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like '*runCloudflaredSafe.js*' })
if ($cf.Count -eq 0) {
    $si = New-CimInstance -ClassName Win32_ProcessStartup -Property @{ ShowWindow = [uint16]0 } -ClientOnly
    $cmd = '"' + '${(process.execPath || 'C:\\Program Files\\nodejs\\node.exe').replace(/'/g, "''")}' + '" "' + '${path.join(ROOT_DIR, 'scripts/runCloudflaredSafe.js').replace(/'/g, "''")}' + '"'
    Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
        CommandLine = $cmd
        CurrentDirectory = '${ROOT_DIR.replace(/'/g, "''")}'
        ProcessStartupInformation = $si
    } | Out-Null
}
`;
        runHiddenPsEncoded(psCf, 8000);
    } catch (_) {}

    const deadline = Date.now() + maxWaitSec * 1000;
    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 800));
        const st = await consultarEstadoDetallado5Puertos();
        const detailStr = services.map(s => `${s.port} ${st.ports[s.port] ? '✅' : '⏳'}`).join(' · ');
        if (typeof onProgress === 'function') {
            onProgress({
                ...st,
                phase: st.allOk ? 'ready' : 'starting',
                message: st.allOk
                    ? `5/5 servicios ONLINE (${detailStr})`
                    : `Encendiendo servicios (${st.activeCount}/5): ${detailStr}`
            });
        }
        if (st.allOk) {
            return true;
        }
    }
    const finalSt = await consultarEstadoDetallado5Puertos();
    return finalSt.allOk;
}

function iniciarPuenteZebraEnBackground() {
    const agentScript = path.join(ROOT_DIR, 'scripts', 'lamdaSwitchGuiServer.js');
    const fallbackScript = path.join(ROOT_DIR, 'scripts', 'lamdaPrintBridgeAgent.js');
    const target = fs.existsSync(agentScript) ? agentScript : fallbackScript;
    if (!fs.existsSync(target)) return;
    const child = spawn(process.execPath, [target], {
        cwd: ROOT_DIR,
        env: {
            ...process.env,
            LAMDA_CLOUD_PRINT_URL: 'https://logistica.lamdaser.com'
        },
        detached: true,
        windowsHide: true,
        stdio: 'ignore'
    });
    child.unref();
}

async function mostrarDiagnosticoPreVuelo() {
    console.log('\n================================================================================');
    console.log('   🔄 CENTRO DE CONTROL DEL SWITCH (LOCAL <-> NUBE) — CHEQUEO PRE-VUELO');
    console.log('================================================================================');

    let dnsInfo = { titular: 'ERROR CONSULTANDO CLOUDFLARE' };
    try {
        dnsInfo = await obtenerEstadoDnsCloudflare();
    } catch (e) {
        dnsInfo.error = e.message;
    }

    const localHealth = await verificarSaludLocal();
    const cloudHealth = verificarSaludNube();

    console.log(`\n🌐 1. ESTADO ACTUAL EN CLOUDFLARE (logistica.lamdaser.com / inventario.lamdaser.com):`);
    console.log(`   • Servidor Titular Activo : ${dnsInfo.titular}`);
    if (dnsInfo.logisticaRecord) {
        console.log(`   • Ruta CNAME Activa       : ${dnsInfo.logisticaRecord.content} (Proxied: ${dnsInfo.logisticaRecord.proxied})`);
    }

    console.log(`\n🏢 2. SALUD DEL NODO LOCAL (PcAlmacen):`);
    console.log(`   • Base PostgreSQL Local   : ${localHealth.db.ok ? '✅ ONLINE' : '❌ ERROR'} (Modo Read-Only: ${localHealth.db.readOnly})`);
    console.log(`   • Conteo de Registros     : ${localHealth.db.articulos} Artículos | ${localHealth.db.clientes} Clientes | ${localHealth.db.facturas} Facturas`);
    console.log(`   • Tickets ARCA Vigentes   : ${localHealth.db.taVigentes}`);
    console.log(`   • 5 Servicios Web Locales : ${localHealth.portsOk ? '✅ 5/5 ONLINE (3000..3005)' : (dnsInfo.isNubeTitular ? '⚪ Apagados (Modo Nube Activo)' : '⚠️ ALGUNOS PUERTOS DETENIDOS')}`);
    console.log(`   • WhatsApp en PcAlmacen   : ${localHealth.whatsappStatus}`);
    console.log(`   • Puente Zebra (3099)     : ${localHealth.zebraBridge3099Active ? '✅ ACTIVO (Impresión ~1s)' : '⚪ En espera'}`);

    console.log(`\n☁️  3. SALUD DEL NODO NUBE (${CLOUD_HOST}):`);
    if (!cloudHealth.reachable) {
        console.log(`   • Conexión con la Nube    : ❌ NUBE INACCESIBLE (${cloudHealth.error || 'Timeout'})`);
        console.log(`   • Resguardo de Emergencia : ✅ Podés ejecutar [Volver a LOCAL] en 1 clic sin depender de la Nube.`);
    } else {
        console.log(`   • Base PostgreSQL Nube    : ${cloudHealth.db?.ok ? '✅ ONLINE' : '❌ ERROR'} (Modo Read-Only: ${cloudHealth.db?.readOnly || 'off'})`);
        console.log(`   • Conteo de Registros     : ${cloudHealth.db?.articulos || 0} Artículos | ${cloudHealth.db?.clientes || 0} Clientes | ${cloudHealth.db?.facturas || 0} Facturas`);
        console.log(`   • Tickets ARCA Vigentes   : ${cloudHealth.db?.taVigentes || 0}`);
        console.log(`   • 5 Servicios PM2 Nube    : ${cloudHealth.portsOk ? '✅ 5/5 ONLINE (3000..3005)' : '❌ ERROR EN PUERTOS'}`);
        console.log(`   • WhatsApp 4° Cupo Nube   : ${cloudHealth.whatsappStatus} (${cloudHealth.modoPruebaNube ? '🛡️ En Espejo Silencioso / Standby' : '🟢 ACTIVO TITULAR'})`);
    }
    console.log('================================================================================\n');

    return { dnsInfo, localHealth, cloudHealth };
}

async function ejecutarSwitchHaciaNube() {
    const { localHealth, cloudHealth } = await mostrarDiagnosticoPreVuelo();
    if (!cloudHealth.reachable || !cloudHealth.db?.ok || !cloudHealth.portsOk) {
        throw new Error('Pre-Flight abortado: El servidor de la Nube no tiene todos sus servicios listos. PcAlmacen sigue como Titular sin cambios.');
    }

    console.log('🚀 [PASO 1/4] Abriendo escritura en Nube y sincronizando base `etiquetas` + Tickets ARCA (PcAlmacen -> Nube)...');
    execSync(
        `ssh -n -o StrictHostKeyChecking=no ${CLOUD_USER}@${CLOUD_HOST} "sudo -u postgres psql -d postgres -c 'ALTER DATABASE etiquetas SET default_transaction_read_only = off;'"`,
        { stdio: 'ignore', windowsHide: true }
    );

    const { detectarBinarioPostgres } = require('./syncEspejoDesdeNube');
    const pgDumpBin = detectarBinarioPostgres('pg_dump');
    const localPass = process.env.DB_PASSWORD || 'postgres';
    const localUser = process.env.DB_USER || 'postgres';
    const localHost = process.env.DB_HOST || 'localhost';
    const localPort = process.env.DB_PORT || '5432';

    const dumpCmd = `"${pgDumpBin}" -h ${localHost} -p ${localPort} -U ${localUser} -d etiquetas --clean --if-exists --no-owner --no-privileges | ssh -o StrictHostKeyChecking=no ${CLOUD_USER}@${CLOUD_HOST} "sudo -u postgres psql -d etiquetas -q"`;
    execSync(dumpCmd, {
        env: { ...process.env, PGPASSWORD: localPass },
        stdio: ['ignore', 'ignore', 'inherit'],
        windowsHide: true
    });
    console.log('   ✅ Base de datos y Tickets ARCA sincronizados al 100% en la Nube.');

    console.log('🟢 [PASO 2/4] Activando Nube como Nodo Titular de Producción...');
    execSync(
        `ssh -n -o StrictHostKeyChecking=no ${CLOUD_USER}@${CLOUD_HOST} "sed -i 's/^LAMDA_MODO_PRUEBA_NUBE=.*/LAMDA_MODO_PRUEBA_NUBE=false/' /opt/lamda/sincronizador-etiquetas/.env && sed -i 's/^SAFE_DELIVERY_REDIRECT=.*/SAFE_DELIVERY_REDIRECT=false/' /opt/lamda/sincronizador-etiquetas/.env && cd /opt/lamda/sincronizador-etiquetas && pm2 restart ETIQUETAS PRODUCCION PRESUPUESTOS LOGISTICA --update-env"`,
        { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true }
    );

    console.log('☁️  [PASO 3/4] Conmutando Cloudflare hacia `tunel-nube` (Nube Titular)...');
    await conmutarDnsCloudflareHaciaTunel(TUNNEL_NUBE_ID, `NUBE (${CLOUD_HOST})`);

    console.log('🔒 [PASO 4/4] Apagando los 5 servicios locales (3000..3005), activando Read-Only en PcAlmacen y dejando Puente Zebra (3099)...');
    detenerCincoServiciosLocales();
    const adminClient = new Client({ host: localHost, port: parseInt(localPort, 10), user: localUser, password: localPass, database: 'postgres' });
    await adminClient.connect();
    try {
        await adminClient.query('ALTER DATABASE etiquetas SET default_transaction_read_only = on;');
    } finally {
        await adminClient.end();
    }
    if (!localHealth.zebraBridge3099Active) {
        iniciarPuenteZebraEnBackground();
        await new Promise(r => setTimeout(r, 1500));
    }

    console.log('\n✅ [SWITCH COMPLETADO] La Nube está ahora ACTIVA como Titular (Sello en pantalla: N · Nube).');
}

async function ejecutarSwitchHaciaLocal(esEmergencia = false) {
    console.log('\n🔙 [SWITCH NUBE -> LOCAL] Iniciando retorno de titularidad a PcAlmacen...');

    const localPass = process.env.DB_PASSWORD || 'postgres';
    const localUser = process.env.DB_USER || 'postgres';
    const localHost = process.env.DB_HOST || 'localhost';
    const localPort = parseInt(process.env.DB_PORT || '5432', 10);

    console.log('🔓 [PASO 1/4] Levantando candado Read-Only en PcAlmacen...');
    const adminClient = new Client({ host: localHost, port: localPort, user: localUser, password: localPass, database: 'postgres' });
    await adminClient.connect();
    try {
        await adminClient.query('ALTER DATABASE etiquetas SET default_transaction_read_only = off;');
    } finally {
        await adminClient.end();
    }

    const cloudHealth = !esEmergencia ? verificarSaludNube() : { reachable: false };
    if (cloudHealth.reachable) {
        console.log('🛡️  [PASO 2/4] Sincronizando base actualizada desde la Nube hacia PcAlmacen y pasando Nube a Standby (Read-Only: on)...');
        try {
            const { detectarBinarioPostgres } = require('./syncEspejoDesdeNube');
            const psqlBin = detectarBinarioPostgres('psql');
            const pullCmd = `ssh -o StrictHostKeyChecking=no ${CLOUD_USER}@${CLOUD_HOST} "sudo -u postgres pg_dump -d etiquetas --clean --if-exists --no-owner --no-privileges" | "${psqlBin}" -h ${localHost} -p ${localPort} -U ${localUser} -d etiquetas -q`;
            execSync(pullCmd, {
                env: { ...process.env, PGPASSWORD: localPass },
                stdio: ['ignore', 'ignore', 'inherit'],
                windowsHide: true,
                timeout: 120000
            });
            execSync(
                `ssh -n -o StrictHostKeyChecking=no -o ConnectTimeout=5 ${CLOUD_USER}@${CLOUD_HOST} "sed -i 's/^LAMDA_MODO_PRUEBA_NUBE=.*/LAMDA_MODO_PRUEBA_NUBE=true/' /opt/lamda/sincronizador-etiquetas/.env && sed -i 's/^SAFE_DELIVERY_REDIRECT=.*/SAFE_DELIVERY_REDIRECT=true/' /opt/lamda/sincronizador-etiquetas/.env && cd /opt/lamda/sincronizador-etiquetas && pm2 restart ETIQUETAS PRODUCCION PRESUPUESTOS LOGISTICA --update-env && sudo -u postgres psql -d postgres -c 'ALTER DATABASE etiquetas SET default_transaction_read_only = on;'"`,
                { stdio: 'ignore', windowsHide: true, timeout: 25000 }
            );
            console.log('   ✅ Base sincronizada y Nube protegida en Read-Only.');
        } catch (eSync) {
            console.warn('⚠️  Aviso durante sincronización final desde Nube:', eSync.message);
        }
    } else {
        console.log('⚠️  [PASO 2/4] Modo Emergencia / Sin Nube: procediendo con el estado local en PcAlmacen...');
    }

    const { limpiarBanderasEnvLocalPrimary } = require('./ejecutarRollbackNubeAPcAlmacen');
    limpiarBanderasEnvLocalPrimary();

    console.log('🚀 [PASO 3/4] Asegurando que los 5 servicios locales (3000..3005) estén encendidos en PcAlmacen...');
    await asegurarCincoServiciosLocalesEncendidos(28);

    console.log('☁️  [PASO 4/4] Conmutando Cloudflare hacia `tunel-etiquetas` (PcAlmacen Titular)...');
    await conmutarDnsCloudflareHaciaTunel(TUNNEL_LOCAL_ID, 'LOCAL (PcAlmacen)');

    console.log('\n✅ [SWITCH COMPLETADO] PcAlmacen está nuevamente ACTIVA como Titular (Sello en pantalla: L · Local).');
}

async function main() {
    const action = String(process.argv[2] || 'status').trim().toLowerCase();
    if (action === 'local-json') {
        const h = await verificarSaludLocal();
        console.log(JSON.stringify(h));
        return;
    }
    if (action === 'status') {
        await mostrarDiagnosticoPreVuelo();
    } else if (action === 'to-nube') {
        await ejecutarSwitchHaciaNube();
    } else if (action === 'to-local') {
        await ejecutarSwitchHaciaLocal(false);
    } else if (action === 'emergency-local') {
        await ejecutarSwitchHaciaLocal(true);
    } else {
        console.log('Uso: node scripts/orquestadorSwitchLocalNube.js [status | to-nube | to-local | emergency-local]');
    }
}

if (require.main === module) {
    main().catch((err) => {
        console.error('\n❌ [ERROR SWITCH]:', err.message);
        process.exit(1);
    });
}

module.exports = {
    obtenerEstadoDnsCloudflare,
    conmutarDnsCloudflareHaciaTunel,
    detenerCincoServiciosLocales,
    asegurarCincoServiciosLocalesEncendidos,
    consultarEstadoDetallado5Puertos,
    mostrarDiagnosticoPreVuelo,
    ejecutarSwitchHaciaNube,
    ejecutarSwitchHaciaLocal
};
