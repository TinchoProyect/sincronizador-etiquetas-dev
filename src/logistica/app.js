if (!globalThis.WebSocket) { try { globalThis.WebSocket = require('ws'); } catch (_) {} }
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

console.log('[LOGISTICA] 🚀 Iniciando servidor del módulo de logística...');

const app = express();
const PORT = process.env.PORT_LOGISTICA || 3005;

// Importar configuraciones y middleware
const { dbMiddleware } = require('./config/database');
const {
    lamdaCloudAuthGuard,
    galponBridgeRoleLockMiddleware,
    renderLoginHtmlPage,
    limpiarCookieSesionCloud
} = require('../shared/lamdaCloudAuthGuard');

console.log('[LOGISTICA] Configurando middleware...');

/**
 * ==========================================
 * CONFIGURACIÓN CORS — TOPOLOGÍA DE RED
 * ==========================================
 * 
 * INFRAESTRUCTURA:
 *   - El sistema LAMDA está desplegado detrás de un router TP-Link con DDNS habilitado.
 *   - Dominio externo oficial: lamda-logistica.tplinkdns.com
 *   - Puerto de salida público (Port Forwarding): 3005 -> IP local del host
 *   - El host (app.listen) DEBE mantenerse siempre en '0.0.0.0' para aceptar
 *     tráfico de todas las interfaces de red (LAN, Wi-Fi, WAN vía Port Forwarding).
 *     NUNCA regresar a 'localhost' o '127.0.0.1', ya que bloquearía el acceso externo.
 * 
 * ORÍGENES PERMITIDOS:
 *   - localhost:30XX  → Comunicación inter-módulos en el mismo host
 *   - 127.0.0.1:30XX  → Alias loopback para módulos locales
 *   - lamda-logistica.tplinkdns.com:3005 → Acceso externo vía DDNS (HTTP y HTTPS)
 *   - lamda-logistica.tplinkdns.com (sin puerto) → Fallback si el router redirige al 80
 * ==========================================
 */
const allowedOrigins = [
    // --- Módulos locales (inter-proceso en el mismo servidor) ---
    'http://localhost:3000',
    'http://localhost:3002',
    'http://localhost:3003',
    'http://localhost:3004',
    'http://localhost:3005',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3002',
    'http://127.0.0.1:3003',
    'http://127.0.0.1:3004',
    'http://127.0.0.1:3005',
    'http://127.0.0.1:5173',
    // --- Acceso por IP local (dispositivos móviles en la misma red LAN) ---
    'http://192.168.1.178:3000',
    'http://192.168.1.178:3002',
    'http://192.168.1.178:3003',
    'http://192.168.1.178:3004',
    'http://192.168.1.178:3005',
    // --- Acceso externo seguro vía Cloudflare Tunnel (Dominio Oficial LAMDA) ---
    'https://lamdaser.com',
    'http://lamdaser.com',
    'https://www.lamdaser.com',
    'http://www.lamdaser.com',
    'https://proud-darkness-ac3d.miserrano75.workers.dev',
    'https://logistica.lamdaser.com',
    'https://nube.lamdaser.com',
    'http://nube.lamdaser.com',
    'https://nube-prueba.lamdaser.com',
    'http://nube-prueba.lamdaser.com',
    'http://logistica.lamdaser.com',
    // --- Acceso externo vía DDNS (router TP-Link con Port Forwarding) ---
    'http://lamda-logistica.tplinkdns.com:3005',
    'https://lamda-logistica.tplinkdns.com:3005',
    'http://lamda-logistica.tplinkdns.com'
];

const corsOptions = {
    origin: function (origin, callback) {
        // Permitir requests sin origin (ej. apps móviles nativas, Postman, curl)
        if (!origin || allowedOrigins.includes(origin) || /^https?:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|100\.\d+\.\d+\.\d+)(:\d+)?$/i.test(origin)) {
            callback(null, true);
        } else {
            console.warn(`[CORS] Origen denegado: ${origin}`);
            callback(new Error('CORS: origen no permitido'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Lamda-Physical-Station', 'X-Lamda-Physical-Token', 'X-Lamda-Print-Token'],
    credentials: true
};

app.use(cors(corsOptions));
console.log('[LOGISTICA] ✅ CORS configurado');

// CUIDADO: El Middleware json() debe ir DESPUÉS de los Proxys
// para evitar el Falso Silencioso en Peticiones POST donde el Proxy
// se queda infinito esperando un Body Stream que ya fue consumido.
// Middleware de logging personalizado
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[LOGISTICA] ${timestamp} - ${req.method} ${req.path}`);
    next();
});

// Middleware de base de datos
app.use(dbMiddleware);

// 🔒 Candado Triple Anti-Doble Arranque (LAMDA_ROLE=GALPON_BRIDGE_ONLY -> HTTP 423 / HTTP 302)
app.use(galponBridgeRoleLockMiddleware);

// 🔐 Rutas Públicas de Autenticación Unificada (/login y /logout en Gateway 3005)
app.get('/login', (req, res) => {
    const redirectUrl = req.query.redirect || '/gw/3000/';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.status(200).send(renderLoginHtmlPage(redirectUrl));
});
app.post('/login', express.json(), express.urlencoded({ extended: true }), require('../usuarios/login').login);
app.all('/logout', (req, res) => {
    limpiarCookieSesionCloud(res);
    if (req.method === 'GET') {
        return res.redirect(302, '/login');
    }
    return res.json({ ok: true, message: 'Sesión cerrada correctamente' });
});

// Configurar archivos estáticos
const staticPath = path.join(__dirname);
const { registrarAccesoServidorSitio } = require('./controllers/cloudflareAnalyticsController');
app.use((req, res, next) => {
    const host = (req.headers.host || '').toLowerCase();
    const recursosPublicos = ['/institucional.html', '/llms.txt', '/llms-full.txt', '/catalogo-publico.json', '/sitemap.xml', '/robots.txt'];
    if (recursosPublicos.includes(req.path)) {
        registrarAccesoServidorSitio(req, req.path);
    }
    if ((host === 'lamdaser.com' || host === 'www.lamdaser.com') && req.path === '/') {
        registrarAccesoServidorSitio(req, '/institucional.html');
        return res.sendFile(path.join(staticPath, 'institucional.html'));
    }
    next();
});

// 🛡️ Escudo Unificado de Autenticación Cloud 24/7 (Cookie HttpOnly lamda_cloud_jwt + Bearer)
// Protege /pages/*, /gw/3000..3004 y /api/* salvo la lista blanca pública
app.use(lamdaCloudAuthGuard);

// 🌐 Fallback por Referer para Sub-Rutas Relativas a la Raíz bajo /gw/3000..3004
// Si una página servida desde /gw/300X/... solicita /js/..., /css/..., /facturacion/... o /api/...
// sin prefijo /gw/300X, se reescribe hacia el Gateway correspondiente antes de los estáticos de 3005.
const fs = require('fs');
function resolvePageCanonicalRoute(reqPath, qs) {
    const m = /^(?:\/gw\/(300[0234]))?\/pages\/([^/?#]+\.html)$/i.exec(reqPath || '');
    if (!m) return null;
    const fileName = m[2];
    if (fs.existsSync(path.join(staticPath, 'pages', fileName))) {
        return { owner: '3005', canonicalPath: `/pages/${fileName}`, url: `/pages/${fileName}${qs || ''}` };
    }
    const moduleDirs = [
        { gw: '3000', dir: path.join(__dirname, '../app-etiquetas/pages') },
        { gw: '3002', dir: path.join(__dirname, '../produccion/pages') },
        { gw: '3003', dir: path.join(__dirname, '../presupuestos/pages') },
        { gw: '3004', dir: path.join(__dirname, '../facturacion/pages') }
    ];
    for (const mod of moduleDirs) {
        if (fs.existsSync(path.join(mod.dir, fileName))) {
            return { owner: mod.gw, canonicalPath: `/gw/${mod.gw}/pages/${fileName}`, url: `/gw/${mod.gw}/pages/${fileName}${qs || ''}` };
        }
    }
    return null;
}

app.use((req, res, next) => {
    const reqPath = req.path || '/';
    const qIdx = (req.originalUrl || req.url || '').indexOf('?');
    const qs = qIdx !== -1 ? (req.originalUrl || req.url).slice(qIdx) : '';

    if (req.method === 'GET' || req.method === 'HEAD') {
        const pageRoute = resolvePageCanonicalRoute(reqPath, qs);
        if (pageRoute) {
            if (reqPath !== pageRoute.canonicalPath) {
                return res.redirect(302, pageRoute.url);
            }
            return next();
        }
    }

    if (reqPath.startsWith('/gw/300')) return next();
    const referer = String(req.headers.referer || req.headers.referrer || '');
    const gwMatch = /\/gw\/(300[0234])(\/|$)/i.exec(referer);
    if (!gwMatch) return next();
    const gwPort = gwMatch[1];
    if (
        reqPath.startsWith('/api/logistica') ||
        reqPath.startsWith('/api/bunker') ||
        reqPath.startsWith('/api/b2b') ||
        reqPath.startsWith('/api/system') ||
        reqPath.startsWith('/api/presupuestos') ||
        reqPath.startsWith('/api/supabase') ||
        reqPath.startsWith('/api/produccion') ||
        reqPath.startsWith('/api/tiempos') ||
        reqPath.startsWith('/api/facturacion') ||
        reqPath === '/lamda-cloud-runtime.js' ||
        reqPath === '/lamda-prueba-manifest.json' ||
        reqPath === '/lamda-prueba-sw.js' ||
        reqPath === '/env-config.js' ||
        reqPath === '/login' ||
        reqPath === '/logout' ||
        reqPath === '/health' ||
        reqPath.startsWith('/mobile') ||
        reqPath === '/institucional.html' ||
        reqPath === '/catalogo-publico.json'
    ) {
        return next();
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && /^\/(js|css)\//i.test(reqPath)) {
        return res.redirect(307, `/gw/${gwPort}${req.originalUrl || req.url}`);
    }
    req.url = `/gw/${gwPort}${req.url}`;
    req.originalUrl = `/gw/${gwPort}${req.originalUrl || req.url}`;
    return next();
});

// 🧭 Normalización de barra final y entradas de módulos bajo Gateway Unificado (/gw/3000..3004 y /presupuestos)
// Evita que el navegador cargue /gw/3000 sin barra final (lo cual resolvería css/style.css hacia /gw/css/style.css -> 404).
app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const p = req.path || '';
    const qIdx = (req.originalUrl || req.url || '').indexOf('?');
    const qs = qIdx !== -1 ? (req.originalUrl || req.url).slice(qIdx) : '';

    if (/^\/gw\/3000$/i.test(p)) {
        return res.redirect(302, '/gw/3000/' + qs);
    }
    if (/^\/gw\/3002\/?$/i.test(p)) {
        return res.redirect(302, '/gw/3002/pages/produccion.html' + qs);
    }
    if (/^(\/gw\/3003|\/presupuestos)\/?$/i.test(p)) {
        return res.redirect(302, '/gw/3003/pages/presupuestos.html' + qs);
    }
    if (/^\/gw\/3004\/?$/i.test(p)) {
        return res.redirect(302, '/gw/3004/pages/facturas.html' + qs);
    }
    // Resguardo defensivo: si algún recurso relativo se pidió bajo /gw/(css|js|img|pages|documentos)/...,
    // reescribirlo hacia /gw/3000/...
    const orphanGwAsset = /^\/gw\/(css|js|img|pages|documentos|favicon\.ico)(\/.*|$)/i.exec(p);
    if (orphanGwAsset) {
        req.url = '/gw/3000/' + orphanGwAsset[1] + (orphanGwAsset[2] || '') + qs;
        req.originalUrl = req.url;
    }
    next();
});

// 🌐 GATEWAY UNIFICADO CLOUD 24/7 (/gw/3000, /gw/3002, /gw/3003, /gw/3004)
[
    { prefix: '/gw/3000', target: 'http://127.0.0.1:3000', name: 'Etiquetas (3000)' },
    { prefix: '/gw/3002', target: 'http://127.0.0.1:3002', name: 'Producción (3002)' },
    { prefix: '/gw/3003', target: 'http://127.0.0.1:3003', name: 'Presupuestos (3003)' },
    { prefix: '/gw/3004', target: 'http://127.0.0.1:3004', name: 'Facturación (3004)' }
].forEach(({ prefix, target, name }) => {
    app.use(prefix, createProxyMiddleware({
        target,
        changeOrigin: true,
        ws: true,
        pathRewrite: (pathUrl) => pathUrl.replace(new RegExp('^' + prefix), '') || '/',
        onError: (err, req, res) => {
            console.error(`[LOGISTICA-GW] ❌ Error en Gateway ${name}:`, err.message);
            if (!res.headersSent) {
                res.status(503).json({ error: `Módulo ${name} fuera de línea.` });
            }
        }
    }));
});
app.use(express.static(staticPath));
app.use('/pages', express.static(path.join(staticPath, 'pages')));
app.use('/js', express.static(path.join(staticPath, 'js')));
app.use('/css', express.static(path.join(staticPath, 'css')));
app.use('/img', express.static(path.join(staticPath, 'img')));
app.get(['/mobile', '/mobile/', '/mobile/index.html'], (req, res, next) => {
    const isLab = String(process.env.MODO_LABORATORIO).toLowerCase() === 'true' || process.env.DB_NAME === 'etiquetas_pruebas';
    if (!isLab) return next();
    return res.redirect('/mobile/home.html');
});
app.get('/mobile/manifest.json', (req, res, next) => {
    const isLab = String(process.env.MODO_LABORATORIO || process.env.LAMDA_MODO_LABORATORIO || '').toLowerCase() === 'true' || process.env.DB_NAME === 'etiquetas_pruebas';
    const flagNube = String(process.env.LAMDA_MODO_PRUEBA_NUBE || '').trim().toLowerCase();
    const flagRedirect = String(process.env.SAFE_DELIVERY_REDIRECT || '').trim().toLowerCase();
    const host = String(req.headers.host || '').toLowerCase();
    const isPruebaNube = flagNube === 'true' || flagNube === '1' || flagRedirect === 'true' || flagRedirect === '1' || host.includes('nube-prueba');
    if (!isLab && !isPruebaNube) return next();
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json({
        id: '/mobile/?app=lamda-movil-prueba',
        name: 'LAMDA Móvil Prueba',
        short_name: 'LAMDA Móvil Prueba',
        description: 'Entorno de Prueba y Desarrollo — LAMDA Móvil (Escala de Grises)',
        start_url: '/mobile/home.html',
        scope: '/mobile/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#e4e4e7',
        theme_color: '#52525b',
        icons: [
            { src: '/mobile/icon-lab-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
            { src: '/mobile/icon-lab-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
            { src: '/mobile/apple-touch-icon-lab.png', sizes: '180x180', type: 'image/png', purpose: 'any' }
        ]
    });
});
app.use('/mobile', express.static(path.join(staticPath, 'public/mobile'), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');
        res.setHeader('CDN-Cache-Control', 'no-store');
    }
}));

console.log('[LOGISTICA] 📁 Archivos estáticos configurados desde:', staticPath);

// ==========================================
// 🛡️ REVERSE PROXIES (Microservicios)
// ==========================================
console.log('[LOGISTICA] 🔗 Inicializando Reverse Proxies para Integraciones Cruzadas...');

// Proxy para la interfaz de Usuario (HTML/CSS) de Presupuestos
app.use('/presupuestos', createProxyMiddleware({
    target: 'http://localhost:3003',
    changeOrigin: true,
    pathRewrite: {
        '^/presupuestos': '', // Remueve /presupuestos cuando llega al 3003
    },
    onError: (err, req, res) => {
        console.error('[LOGISTICA] ❌ Error en Proxy de Presupuestos (UI):', err.message);
        res.status(503).send('Módulo de presupuestos fuera de línea.');
    }
}));

// Proxy para las transacciones API de Presupuestos
app.use('/api/presupuestos', createProxyMiddleware({
    target: 'http://localhost:3003',
    changeOrigin: true,
    pathRewrite: (path, req) => {
        // Restauramos el prefijo que Express elimina para que enganche al router del 3003
        return '/api/presupuestos' + req.url; 
    },
    onError: (err, req, res) => {
        console.error('[LOGISTICA] ❌ Error en Proxy de Presupuestos (API):', err.message);
        res.status(503).json({ error: 'Módulo de presupuestos fuera de línea.' });
    }
}));

// Proxy para las transacciones API de Supabase (puerto 3002)
app.use('/api/supabase', createProxyMiddleware({
    target: 'http://localhost:3002',
    changeOrigin: true,
    pathRewrite: (path, req) => {
        return '/api/supabase' + req.url; 
    },
    onError: (err, req, res) => {
        console.error('[LOGISTICA] ❌ Error en Proxy de Supabase (API):', err.message);
        res.status(503).json({ error: 'Módulo de producción/Supabase fuera de línea.' });
    }
}));

// Proxy para las transacciones API de Producción (puerto 3002)
app.use('/api/produccion', createProxyMiddleware({
    target: 'http://localhost:3002',
    changeOrigin: true,
    pathRewrite: (path, req) => {
        return '/api/produccion' + req.url; 
    },
    onError: (err, req, res) => {
        console.error('[LOGISTICA] ❌ Error en Proxy de Producción (API):', err.message);
        res.status(503).json({ error: 'Módulo de producción fuera de línea.' });
    }
}));

// Proxy para las transacciones API de Tiempos y Métricas de Producción (puerto 3002)
app.use('/api/tiempos', createProxyMiddleware({
    target: 'http://localhost:3002',
    changeOrigin: true,
    pathRewrite: (path, req) => {
        return '/api/tiempos' + req.url; 
    },
    onError: (err, req, res) => {
        console.error('[LOGISTICA] ❌ Error en Proxy de Tiempos (API):', err.message);
        res.status(503).json({ error: 'Módulo de tiempos fuera de línea.' });
    }
}));


// Proxy para las transacciones API de Facturación (puerto 3004)
app.use('/api/facturacion', createProxyMiddleware({
    target: 'http://localhost:3004',
    changeOrigin: true,
    pathRewrite: (path, req) => {
        return '/facturacion' + req.url; 
    },
    onError: (err, req, res) => {
        console.error('[LOGISTICA] ❌ Error en Proxy de Facturación (API):', err.message);
        res.status(503).json({ error: 'Módulo de facturación fuera de línea.' });
    }
}));
// ==========================================

// Middleware básico (Parseo de Body para RUTAS NATIVAS de Logística)
// Se inyecta aquí para no interferir con el parseo en crudo del Proxy.


app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

// 🛡️ Runtime Cloud 24/7 + Banner Modo Laboratorio + Bandeja Zebra
const { attachLamdaCloudRuntime } = require('../shared/lamdaCloudRuntime');
attachLamdaCloudRuntime(app, PORT);

// Ruta raíz - en Dominio Único Cloud lleva a la Página Principal (/gw/3000/); en puerto local 3005 abre el dashboard de Logística
app.get('/', (req, res) => {
    const hostHeader = String(req.headers.host || '').toLowerCase();
    const isLocalDirect3005 = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(hostHeader) && !req.headers['x-forwarded-proto'] && !req.headers['cf-connecting-ip'];
    if (!isLocalDirect3005) {
        console.log('[LOGISTICA] Acceso a ruta raíz Cloud - redirigiendo a Página Principal (/gw/3000/)');
        return res.redirect(302, '/gw/3000/');
    }
    console.log('[LOGISTICA] Acceso a ruta raíz local (3005) - redirigiendo a dashboard');
    return res.redirect('/pages/dashboard.html');
});

// Solución dinámica para inyección de IP Pública en Frontend
app.get('/env-config.js', (req, res) => {
    // Configuración que se inyecta nativamente en el window del frontend
    const publicUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3005';
    res.type('.js');
    res.send(`window.PUBLIC_BASE_URL = "${publicUrl}";`);
});

// Rutas API
console.log('[LOGISTICA] Montando rutas API...');

// Disparador reactivo automático en 2do plano hacia Portal B2B ante cambios locales
const { createB2BAutoSyncMiddleware, triggerB2BSync, esModoLaboratorioOSinCredencialesB2B } = require('../actualizaPrecios/b2bAutoSyncTrigger');
app.use(createB2BAutoSyncMiddleware('logistica'));

// Rutas de Domicilios
app.use('/api/logistica/domicilios', require('./routes/domicilios'));
console.log('[LOGISTICA] ✅ Rutas de Domicilios montadas en /api/logistica/domicilios');

// Rutas de Rutas
app.use('/api/logistica/rutas', require('./routes/rutas'));
console.log('[LOGISTICA] ✅ Rutas de Rutas montadas en /api/logistica/rutas');

// Rutas de Configuración
app.use('/api/logistica/config', require('./routes/config'));
console.log('[LOGISTICA] ✅ Rutas de Configuración montadas en /api/logistica/config');

// Rutas de Artículos
app.use('/api/logistica/articulos', require('./routes/articulos'));
console.log('[LOGISTICA] ✅ Rutas de Artículos montadas en /api/logistica/articulos');

// Rutas del Búnker (Core Financiero)
app.use('/api/logistica/bunker', require('./routes/bunker'));
app.use('/api/bunker', require('./routes/bunker'));
console.log('[LOGISTICA] ✅ Rutas del Búnker montadas en /api/logistica/bunker y /api/bunker');

// Rutas de Clientes Búnker
app.use('/api/logistica/bunker/clientes', require('./routes/clientesBunker'));
console.log('[LOGISTICA] ✅ Rutas de Clientes Búnker montadas en /api/logistica/bunker/clientes');

// Rutas de Prospectos (CRM Preventa Calle y Depósito)
app.use('/api/logistica/prospectos', require('./routes/prospectos'));
console.log('[LOGISTICA] ✅ Rutas de Prospectos montadas en /api/logistica/prospectos');

// Rutas de Cuenta Corriente Búnker
app.use('/api/logistica/bunker/cuentas-corrientes', require('./routes/cuentaCorriente'));
console.log('[LOGISTICA] ✅ Rutas de Cuenta Corriente montadas en /api/logistica/bunker/cuentas-corrientes');


// Rutas del Diccionario ABM Búnker
app.use('/api/logistica/bunker-diccionario', require('./routes/bunkerDiccionario'));
console.log('[LOGISTICA] ✅ Rutas ABM de Diccionario montadas en /api/logistica/bunker-diccionario');

// Rutas de Taxonomía Búnker (Rubros/Subrubros)
app.use('/api/logistica/bunker-taxonomia', require('./routes/bunkerTaxonomia'));
console.log('[LOGISTICA] ✅ Rutas de Taxonomía montadas en /api/logistica/bunker-taxonomia');

// Rutas de Presupuestos
app.use('/api/logistica/presupuestos', require('./routes/presupuestos'));
console.log('[LOGISTICA] ✅ Rutas de Presupuestos montadas en /api/logistica/presupuestos');

// Rutas de Usuarios
app.use('/api/logistica/usuarios', require('./routes/usuarios'));
console.log('[LOGISTICA] ✅ Rutas de Usuarios montadas en /api/logistica/usuarios');

// Rutas de Móvil y Resolución QR Pública (sin exponer rutas privadas de móvil)
const movilRouter = require('./routes/movil');
app.use('/api/logistica/movil', movilRouter);
app.get('/api/logistica/public-qr-resolve/:token', movilRouter.resolverQrPublicoHandler);
console.log('[LOGISTICA] ✅ Rutas de Móvil y Resolución QR montadas');

// Rutas de Diagnóstico (desarrollo)
app.use('/api/logistica/diagnostico', require('./routes/diagnostico-secuencia'));
console.log('[LOGISTICA] ✅ Rutas de Diagnóstico montadas en /api/logistica/diagnostico');

// Rutas de Onboarding B2B
app.use('/api/logistica/b2b-onboarding', require('./routes/b2bOnboarding'));
app.use('/api/b2b', require('./routes/b2bOnboarding'));
console.log('[LOGISTICA] ✅ Rutas de Onboarding B2B montadas en /api/logistica/b2b-onboarding y /api/b2b');

// Rutas de Colaborador B2B (Exclusivo Matías)
app.use('/api/b2b/colaborador', require('./routes/b2bColaborador'));
app.use('/api/logistica/b2b-colaborador', require('./routes/b2bColaborador'));
console.log('[LOGISTICA] ✅ Rutas de Colaborador B2B montadas en /api/b2b/colaborador');

// Rutas de Telemetría Cloudflare & B2B
app.use('/api/logistica/telemetria', require('./routes/telemetria'));
console.log('[LOGISTICA] ✅ Rutas de Telemetría Cloudflare montadas en /api/logistica/telemetria');

// Rutas de Tratamientos e Inmunización (Retiros Fase 1 y 2)
app.use('/api/logistica/tratamientos', require('./routes/tratamientos'));
console.log('[LOGISTICA] ✅ Rutas de Tratamientos montadas en /api/logistica/tratamientos');

// Rutas de Auditorías de Rutas (Conciliación)
app.use('/api/logistica/auditorias', require('./routes/auditorias'));
console.log('[LOGISTICA] ✅ Rutas de Auditorías montadas en /api/logistica/auditorias');

// Rutas del Reservorio Cronológico Satelital
app.use('/api/logistica/reservorio', require('./routes/reservorioRoutes'));
console.log('[LOGISTICA] ✅ Rutas del Reservorio Satelital montadas en /api/logistica/reservorio');

// Rutas de Jerarquía y Subcategorías B2B
app.use('/api/logistica/b2b-jerarquia', require('./routes/b2bJerarquia'));
app.use('/api/bunker/portal-b2b-jerarquia', require('./routes/b2bJerarquia'));
console.log('[LOGISTICA] ✅ Rutas de Jerarquía B2B montadas en /api/logistica/b2b-jerarquia');

// Rutas de Pagos en Efectivo Ensobrados
app.use('/api/logistica/pagos-efectivo', require('./routes/pagosEfectivo'));
console.log('[LOGISTICA] ✅ Rutas de Pagos en Efectivo montadas en /api/logistica/pagos-efectivo');

// Rutas de Inspección Visual de Partidas / Fotos de Lotes B2B
app.use('/api/logistica/b2b-fotos-lotes', require('./routes/b2bFotosLotes'));
console.log('[LOGISTICA] ✅ Rutas de Fotos de Partidas B2B montadas en /api/logistica/b2b-fotos-lotes');


// Ruta de health check
app.get('/health', (req, res) => {
    console.log('[LOGISTICA] Health check del servidor');
    
    res.json({
        success: true,
        service: 'logistica-server',
        status: 'running',
        port: PORT,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: '1.0.0',
        database: {
            name: process.env.DB_NAME || 'etiquetas',
            host: process.env.DB_HOST || 'localhost'
        },
        features: {
            domicilios: true,   // ✅ Implementado
            rutas: true,        // ✅ Implementado
            movil: false,       // Pendiente
            tracking: false,    // Pendiente
            optimizacion: false // Pendiente
        },
        google_maps: {
            api_key_configured: !!process.env.GOOGLE_MAPS_API_KEY
        }
    });
});

// Middleware para rutas no encontradas
app.use('*', (req, res) => {
    console.log(`[LOGISTICA] ⚠️ Ruta no encontrada: ${req.method} ${req.originalUrl}`);
    
    res.status(404).json({
        success: false,
        error: 'Recurso no encontrado',
        path: req.originalUrl,
        method: req.method,
        service: 'logistica-server',
        timestamp: new Date().toISOString()
    });
});

// Middleware de manejo de errores (debe ir al final)
app.use((err, req, res, next) => {
    console.error('[LOGISTICA] ❌ Error no manejado:', err.message);
    console.error('[LOGISTICA] ❌ Stack:', err.stack);
    
    res.status(err.status || 500).json({
        success: false,
        error: err.message || 'Error interno del servidor',
        service: 'logistica-server',
        timestamp: new Date().toISOString()
    });
});

/**
 * ==========================================
 * INICIALIZACIÓN DEL SERVIDOR — BINDING DE RED
 * ==========================================
 * Host: '0.0.0.0' → Escucha en TODAS las interfaces de red del host.
 * Esto es OBLIGATORIO porque el sistema está detrás de un router TP-Link
 * con Port Forwarding (puerto 3005 → IP local del host) y DDNS habilitado
 * en el dominio: lamda-logistica.tplinkdns.com
 * 
 * ⚠️ NUNCA cambiar '0.0.0.0' por 'localhost' o '127.0.0.1'.
 *    Hacerlo bloquearía todo el tráfico externo (móviles, red LAN, WAN).
 * ==========================================
 */
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('[LOGISTICA] 🎉 ================================');
    console.log('[LOGISTICA] 🎉 SERVIDOR INICIADO EXITOSAMENTE');
    console.log('[LOGISTICA] 🎉 ================================');
    console.log(`[LOGISTICA] 🌐 URL Local: http://localhost:${PORT}`);
    console.log(`[LOGISTICA] 🏥 Health: http://localhost:${PORT}/health`);
    console.log(`[LOGISTICA] 📁 Archivos estáticos: ${staticPath}`);
    console.log('[LOGISTICA] 📊 Base de datos:', process.env.DB_NAME || 'etiquetas');
    console.log('[LOGISTICA] 🌍 Entorno:', process.env.NODE_ENV || 'production');
    console.log('[LOGISTICA] 🎉 ================================\n');

    // Asegurar regla de jerarquía Nivel 3 (marca) para Repostería -> Escurrida y preferencias UI
    (async () => {
        try {
            const { pool } = require('./config/database');
            await pool.query(`
                CREATE TABLE IF NOT EXISTS public.bunker_preferencias_ui (
                    clave VARCHAR(100) PRIMARY KEY,
                    valor JSONB NOT NULL DEFAULT '{}'::jsonb,
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );
            `);
            await pool.query(`
                INSERT INTO public.bunker_portal_b2b_jerarquia (familia_id, articulo_principal, eje_nivel_3, updated_at, reglas_nivel_4, reglas_nivel_5)
                VALUES (31, 'Escurrida', 'marca', NOW(), '{}'::jsonb, '{}'::jsonb)
                ON CONFLICT (familia_id, articulo_principal) DO NOTHING;
            `);
        } catch (err) {
            console.warn('[LOGISTICA] ⚠️ Aviso asegurando tablas/jerarquía inicial Búnker:', err.message);
        }

        if (!esModoLaboratorioOSinCredencialesB2B()) {
            console.log('⚡ [LOGISTICA-B2B] Programando sincronización catch-up inicial del Portal B2B (Producción Titular)...');
            triggerB2BSync('precios', 'logistica:startup-catchup', 3000);
            triggerB2BSync('listas', 'logistica:startup-catchup', 7000);
            triggerB2BSync('politicas', 'logistica:startup-catchup', 11000);
            triggerB2BSync('ofertas', 'logistica:startup-catchup', 14000);
        }
    })();
});

// Manejo de errores del servidor
server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`[LOGISTICA] ❌ Puerto ${PORT} ya está en uso`);
        console.error('[LOGISTICA] ❌ Verifique que no haya otro proceso usando este puerto');
    } else {
        console.error('[LOGISTICA] ❌ Error del servidor:', error);
    }
    process.exit(1);
});

// Manejo de cierre graceful
process.on('SIGTERM', () => {
    console.log('[LOGISTICA] 🔄 Recibida señal SIGTERM, cerrando servidor...');
    server.close(() => {
        console.log('[LOGISTICA] ✅ Servidor cerrado exitosamente');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('[LOGISTICA] 🔄 Recibida señal SIGINT (Ctrl+C), cerrando servidor...');
    server.close(() => {
        console.log('[LOGISTICA] ✅ Servidor cerrado exitosamente');
        process.exit(0);
    });
});

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
    console.error('[LOGISTICA] ❌ Error no capturado:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[LOGISTICA] ❌ Promesa rechazada no manejada:', reason);
    console.error('[LOGISTICA] ❌ En promesa:', promise);
});

module.exports = app;
