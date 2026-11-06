#!/usr/bin/env node
/**
 * Orquestador Central del Switch Producción (Local <-> Nube) — Sistema LAMDA
 * --------------------------------------------------------------------------
 * Gobierna la conmutación entre:
 *   - NODO LOCAL (PcAlmacen): Túnel Cloudflare `tunel-etiquetas` (d72f6c10-9fdc-4130-a0fb-ebadefb7006b)
 *   - NODO NUBE (34.39.187.220): Túnel Cloudflare `tunel-nube` (cf41c278-0a41-417f-9b99-806486fc166b)
 *
 * Modos de uso:
 *   node scripts/orquestadorSwitchLocalNube.js status          -> Chequeo completo de salud Pre-Vuelo (Sin cambios)
 *   node scripts/orquestadorSwitchLocalNube.js to-nube         -> Conmuta Producción de Local -> Nube
 *   node scripts/orquestadorSwitchLocalNube.js to-local        -> Conmuta Producción de Nube -> Local (con o sin Nube activa)
 *   node scripts/orquestadorSwitchLocalNube.js local-json      -> Salida JSON de salud local (usado remotamente por SSH)
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
        const req = http.get(`http://127.0.0.1:${port}${urlPath}`, { timeout: 3000 }, (res) => {
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
            `ssh -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=5 ${CLOUD_USER}@${CLOUD_HOST} "node /opt/lamda/sincronizador-etiquetas/scripts/orquestadorSwitchLocalNube.js local-json"`,
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 12000 }
        );
        const lines = String(out || '').trim().split(/\r?\n/);
        const lastJsonLine = lines[lines.length - 1];
        return JSON.parse(lastJsonLine);
    } catch (err) {
        return { reachable: false, error: err.message };
    }
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
    console.log(`   • 5 Servicios Web Locales : ${localHealth.portsOk ? '✅ 5/5 ONLINE (3000..3005)' : '⚠️ ALGUNOS PUERTOS DETENIDOS'}`);
    console.log(`   • WhatsApp en PcAlmacen   : ${localHealth.whatsappStatus}`);
    console.log(`   • Puente Zebra (3099)     : ${localHealth.zebraBridge3099Active ? '✅ ACTIVO (Impresión ~1s)' : '⚪ En espera (se enciende automático al pasar a Nube)'}`);

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

function iniciarPuenteZebraEnBackground() {
    const agentScript = path.join(ROOT_DIR, 'scripts', 'lamdaPrintBridgeAgent.js');
    if (!fs.existsSync(agentScript)) return;
    const child = spawn(process.execPath, [agentScript], {
        cwd: ROOT_DIR,
        env: {
            ...process.env,
            CLOUD_BASE_URL: 'https://nube-prueba.lamdaser.com'
        },
        detached: true,
        stdio: 'ignore'
    });
    child.unref();
}

async function ejecutarSwitchHaciaNube() {
    const { localHealth, cloudHealth } = await mostrarDiagnosticoPreVuelo();
    if (!cloudHealth.reachable || !cloudHealth.db?.ok || !cloudHealth.portsOk) {
        throw new Error('Pre-Flight abortado: El servidor de la Nube no tiene todos sus servicios listos. PcAlmacen sigue como Titular sin cambios.');
    }

    console.log('🚀 [PASO 1/4] Sincronizando base `etiquetas` + Tickets ARCA de PcAlmacen -> Nube...');
    const { detectarBinarioPostgres } = require('./syncEspejoDesdeNube');
    const pgDumpBin = detectarBinarioPostgres('pg_dump');
    const localPass = process.env.DB_PASSWORD || 'postgres';
    const localUser = process.env.DB_USER || 'postgres';
    const localHost = process.env.DB_HOST || 'localhost';
    const localPort = process.env.DB_PORT || '5432';

    const dumpCmd = `"${pgDumpBin}" -h ${localHost} -p ${localPort} -U ${localUser} -d etiquetas --clean --if-exists --no-owner --no-privileges | ssh -o StrictHostKeyChecking=no ${CLOUD_USER}@${CLOUD_HOST} "PGPASSWORD=postgres psql -h localhost -U postgres -d etiquetas -q"`;
    execSync(dumpCmd, {
        env: { ...process.env, PGPASSWORD: localPass },
        stdio: 'inherit'
    });
    console.log('   ✅ Base de datos y Tickets ARCA sincronizados al 100% en la Nube.');

    console.log('🟢 [PASO 2/4] Activando Nube como Nodo Titular de Producción...');
    execSync(
        `ssh -o StrictHostKeyChecking=no ${CLOUD_USER}@${CLOUD_HOST} "sed -i 's/^LAMDA_MODO_PRUEBA_NUBE=.*/LAMDA_MODO_PRUEBA_NUBE=false/' /opt/lamda/sincronizador-etiquetas/.env && sed -i 's/^SAFE_DELIVERY_REDIRECT=.*/SAFE_DELIVERY_REDIRECT=false/' /opt/lamda/sincronizador-etiquetas/.env && cd /opt/lamda/sincronizador-etiquetas && pm2 restart ETIQUETAS PRODUCCION PRESUPUESTOS LOGISTICA --update-env"`,
        { stdio: 'inherit' }
    );

    console.log('🔒 [PASO 3/4] Activando candado Read-Only preventivo en PcAlmacen y encendiendo Puente Zebra (3099)...');
    const adminClient = new Client({ host: localHost, port: parseInt(localPort, 10), user: localUser, password: localPass, database: 'postgres' });
    await adminClient.connect();
    try {
        await adminClient.query('ALTER DATABASE etiquetas SET default_transaction_read_only = on;');
    } finally {
        await adminClient.end();
    }
    if (!localHealth.zebraBridge3099Active) {
        iniciarPuenteZebraEnBackground();
    }

    console.log('☁️  [PASO 4/4] Conmutando Cloudflare hacia `tunel-nube` (Nube Titular)...');
    await conmutarDnsCloudflareHaciaTunel(TUNNEL_NUBE_ID, `NUBE (${CLOUD_HOST})`);

    console.log('\n✅ [SWITCH COMPLETADO] La Nube está ahora ACTIVA como Titular (Sello en pantalla: N · Nube).');
}

async function ejecutarSwitchHaciaLocal() {
    console.log('\n🔙 [SWITCH NUBE -> LOCAL] Iniciando retorno de titularidad a PcAlmacen...');
    const cloudHealth = verificarSaludNube();

    if (cloudHealth.reachable) {
        console.log('🛡️  [PASO 1/3] Poniendo Nube en Modo Espejo Silencioso / Standby y descargando última foto de la base...');
        try {
            execSync(
                `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 ${CLOUD_USER}@${CLOUD_HOST} "sed -i 's/^LAMDA_MODO_PRUEBA_NUBE=.*/LAMDA_MODO_PRUEBA_NUBE=true/' /opt/lamda/sincronizador-etiquetas/.env && sed -i 's/^SAFE_DELIVERY_REDIRECT=.*/SAFE_DELIVERY_REDIRECT=true/' /opt/lamda/sincronizador-etiquetas/.env && cd /opt/lamda/sincronizador-etiquetas && pm2 restart ETIQUETAS PRODUCCION PRESUPUESTOS LOGISTICA --update-env"`,
                { stdio: 'inherit', timeout: 15000 }
            );
            const { sincronizarEspejo } = require('./syncEspejoDesdeNube');
            await sincronizarEspejo();
        } catch (eSync) {
            console.warn('⚠️  Aviso durante sincronización final desde Nube:', eSync.message);
        }
    } else {
        console.log('⚠️  [MODO EMERGENCIA SIN NUBE] La Nube no responde; procediendo directamente con el estado local / último espejo en PcAlmacen...');
    }

    console.log('🔓 [PASO 2/3] Levantando candado Read-Only en PcAlmacen y asegurando Tickets ARCA...');
    const localPass = process.env.DB_PASSWORD || 'postgres';
    const localUser = process.env.DB_USER || 'postgres';
    const localHost = process.env.DB_HOST || 'localhost';
    const localPort = parseInt(process.env.DB_PORT || '5432', 10);

    const adminClient = new Client({ host: localHost, port: localPort, user: localUser, password: localPass, database: 'postgres' });
    await adminClient.connect();
    try {
        await adminClient.query('ALTER DATABASE etiquetas SET default_transaction_read_only = off;');
    } finally {
        await adminClient.end();
    }

    try {
        const { reconstruirTaAfipDesdeBase } = require('./syncEspejoDesdeNube');
        await reconstruirTaAfipDesdeBase({
            host: localHost,
            port: localPort,
            user: localUser,
            password: localPass,
            database: 'etiquetas'
        }, ROOT_DIR);
    } catch (_) {}

    const { limpiarBanderasEnvLocalPrimary } = require('./ejecutarRollbackNubeAPcAlmacen');
    limpiarBanderasEnvLocalPrimary();

    console.log('☁️  [PASO 3/3] Conmutando Cloudflare hacia `tunel-etiquetas` (PcAlmacen Titular)...');
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
    } else if (action === 'to-local' || action === 'emergency-local') {
        await ejecutarSwitchHaciaLocal();
    } else {
        console.log('Uso: node scripts/orquestadorSwitchLocalNube.js [status | to-nube | to-local]');
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
    mostrarDiagnosticoPreVuelo,
    ejecutarSwitchHaciaNube,
    ejecutarSwitchHaciaLocal
};
