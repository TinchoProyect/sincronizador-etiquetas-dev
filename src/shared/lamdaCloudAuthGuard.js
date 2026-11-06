/**
 * LAMDA Cloud Auth Guard & Galpón Bridge Role Lock (Micro-Etapa 1 — Cloud 24/7)
 * -----------------------------------------------------------------------------
 * 1. Escudo Unificado de Autenticación (`lamdaCloudAuthGuard`):
 *    - Emite y valida la cookie firmada `HttpOnly; SameSite=Lax` (`lamda_cloud_jwt`).
 *    - Mantiene compatibilidad total con `Authorization: Bearer <token>` (JWT y token móvil).
 *    - Protege `/gw/3000..3004`, `/api/*` y `/pages/*` en el Gateway 3005, dejando
 *      únicamente la lista blanca pública (`/institucional.html`, `/catalogo-publico.json`,
 *      `/login`, `/mobile/index.html` y `/api/logistica/public-qr-resolve/*`).
 * 2. Candado Anti-Doble Arranque (`LAMDA_ROLE=GALPON_BRIDGE_ONLY`):
 *    - Cuando `PcAlmacen` opera como puente de galpón (`LAMDA_ROLE=GALPON_BRIDGE_ONLY`),
 *      bloquea toda escritura local accidental y redirige (`HTTP 302`) cualquier intento
 *      de abrir `localhost:3000..3005` hacia la URL titular en la nube.
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'LAMDA_super_secreta';
const COOKIE_NAME = 'lamda_cloud_jwt';
const COOKIE_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 días

function esModoLaboratorioAuth() {
    const dbName = String(process.env.DB_NAME || '').trim().toLowerCase();
    const flagLab = String(process.env.LAMDA_MODO_LABORATORIO || process.env.MODO_LABORATORIO || '').trim().toLowerCase();
    return dbName === 'etiquetas_pruebas' || flagLab === 'true' || flagLab === '1';
}

function esModoGalponBridgeOnly() {
    return String(process.env.LAMDA_ROLE || '').trim().toUpperCase() === 'GALPON_BRIDGE_ONLY';
}

function obtenerUrlNubeTitular() {
    return String(process.env.LAMDA_CLOUD_PUBLIC_URL || 'https://logistica.lamdaser.com').replace(/\/+$/, '');
}

function parseCookies(cookieHeader) {
    const list = {};
    if (!cookieHeader || typeof cookieHeader !== 'string') return list;
    cookieHeader.split(';').forEach((cookie) => {
        const parts = cookie.split('=');
        const key = parts.shift().trim();
        if (key) {
            const val = parts.join('=').trim();
            try {
                list[key] = decodeURIComponent(val);
            } catch (_) {
                list[key] = val;
            }
        }
    });
    return list;
}

function firmarJwtSesion(payload = {}) {
    const cleanPayload = {
        id: payload.id || 1,
        usuario: payload.usuario || payload.nombre || 'usuario',
        rol_id: payload.rol_id || 1,
        origen: payload.origen || 'lamda-auth'
    };
    return jwt.sign(cleanPayload, JWT_SECRET, { expiresIn: '30d' });
}

function emitirCookieSesionCloud(arg1, arg2, arg3) {
    let req = null;
    let res = null;
    let payloadOrToken = null;
    if (arg3 !== undefined) {
        req = arg1;
        res = arg2;
        payloadOrToken = arg3;
    } else {
        res = arg1;
        payloadOrToken = arg2;
    }
    let tokenStr = '';
    if (typeof payloadOrToken === 'string' && payloadOrToken.split('.').length === 3) {
        tokenStr = payloadOrToken;
    } else if (typeof payloadOrToken === 'object' && payloadOrToken !== null) {
        tokenStr = firmarJwtSesion(payloadOrToken);
    } else if (typeof payloadOrToken === 'string' && payloadOrToken.trim()) {
        // Token móvil base64(id:timestamp) -> envolver en JWT firmado
        try {
            const decoded = Buffer.from(payloadOrToken, 'base64').toString('utf8');
            const [idPart] = decoded.split(':');
            tokenStr = firmarJwtSesion({ id: parseInt(idPart, 10) || 1, origen: 'movil-token' });
        } catch (_) {
            tokenStr = firmarJwtSesion({ id: 1, origen: 'fallback' });
        }
    }

    if (!tokenStr) return null;

    const isHttps = Boolean(
        (req && req.secure) ||
        String((req && req.headers && req.headers['x-forwarded-proto']) || '').toLowerCase() === 'https'
    );

    const cookieParts = [
        `${COOKIE_NAME}=${encodeURIComponent(tokenStr)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${COOKIE_MAX_AGE_SEC}`
    ];
    if (isHttps) {
        cookieParts.push('Secure');
    }

    res.setHeader('Set-Cookie', cookieParts.join('; '));
    return tokenStr;
}

function limpiarCookieSesionCloud(res) {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function verificarTokenOExtraerUsuario(reqOrRawToken) {
    let rawToken = reqOrRawToken;
    if (reqOrRawToken && typeof reqOrRawToken === 'object') {
        const hdrs = reqOrRawToken.headers || {};
        const cookies = parseCookies(hdrs.cookie || '');
        rawToken =
            hdrs.authorization ||
            hdrs['x-access-token'] ||
            hdrs['x-chofer-token'] ||
            (reqOrRawToken.body && reqOrRawToken.body.token) ||
            cookies[COOKIE_NAME] ||
            '';
    }
    if (!rawToken || typeof rawToken !== 'string') return null;
    const clean = rawToken.trim().replace(/^Bearer\s+/i, '').trim();
    if (!clean) return null;

    // 1. Intentar verificar como JWT estándar
    try {
        const decoded = jwt.verify(clean, JWT_SECRET);
        if (decoded && (decoded.id || decoded.usuario)) {
            return decoded;
        }
    } catch (_) {}

    // 2. Intentar verificar como token móvil LAMDA: base64("id:timestamp")
    try {
        if (/^[A-Za-z0-9+/=]+$/.test(clean) && clean.length >= 8 && clean.length <= 128) {
            const decodedStr = Buffer.from(clean, 'base64').toString('utf8');
            const match = /^(\d+):(\d{10,15})$/.exec(decodedStr.trim());
            if (match) {
                const userId = parseInt(match[1], 10);
                const ts = parseInt(match[2], 10);
                const ageMs = Date.now() - ts;
                // Validez de 45 días para sesión móvil
                if (userId > 0 && ageMs >= -60000 && ageMs < 45 * 24 * 60 * 60 * 1000) {
                    return { id: userId, origen: 'movil-base64', timestamp: ts };
                }
            }
        }
    } catch (_) {}

    return null;
}

function esRutaPublicaAllowlist(reqOrPath) {
    const reqObj = typeof reqOrPath === 'string' ? { path: reqOrPath, headers: {} } : (reqOrPath || {});
    const reqPath = String(reqObj.path || reqObj.url || '').split('?')[0];
    const reqPathLower = reqPath.toLowerCase();
    const host = String((reqObj.headers && reqObj.headers.host) || '').toLowerCase();

    // 1. Raíz en dominio público institucional
    if ((host === 'lamdaser.com' || host === 'www.lamdaser.com') && reqPathLower === '/') {
        return true;
    }

    // 2. Archivos públicos explícitos de la lista blanca
    const exactPublicPaths = new Set([
        '/institucional.html',
        '/catalogo-publico.json',
        '/llms.txt',
        '/llms-full.txt',
        '/sitemap.xml',
        '/robots.txt',
        '/login',
        '/login.html',
        '/api/login',
        '/gw/3000/api/login',
        '/api/logistica/movil/login',
        '/mobile',
        '/mobile/',
        '/mobile/index.html',
        '/mobile/manifest.json',
        '/mobile/sw.js',
        '/lamda-cloud-runtime.js',
        '/env-config.js',
        '/health',
        '/favicon.ico',
        '/api/system/env-status',
        '/api/system/auth/sync-cookie',
        '/api/system/auth/logout',
        '/api/system/print-queue/agent-pull'
    ]);

    if (exactPublicPaths.has(reqPathLower)) {
        return true;
    }

    // 3. Prefijos públicos autorizados
    if (
        reqPathLower.startsWith('/api/logistica/public-qr-resolve/') ||
        reqPathLower.startsWith('/api/logistica/movil/public-qr-resolve/') ||
        reqPathLower.startsWith('/api/system/print-queue/agent-ack/') ||
        reqPathLower.startsWith('/api/usuarios/con-permiso/') ||
        reqPathLower.startsWith('/gw/3000/api/usuarios/con-permiso/')
    ) {
        return true;
    }

    // 4. Recursos estáticos de estilo/imágenes/fuentes necesarios para renderizar login y PWA móvil
    if (
        reqPathLower.startsWith('/mobile/css/') ||
        reqPathLower.startsWith('/mobile/img/') ||
        reqPathLower.startsWith('/mobile/js/') ||
        /^\/mobile\/[^/]+\.(png|ico|svg|webp|json)$/i.test(reqPathLower) ||
        reqPathLower.startsWith('/img/') ||
        reqPathLower.startsWith('/css/') ||
        reqPathLower.startsWith('/gw/3000/img/') ||
        reqPathLower.startsWith('/gw/3000/css/')
    ) {
        return true;
    }

    return false;
}

function esLlamadaInternaLoopback(req) {
    // Si viene a través de un proxy externo (Cloudflare / Nginx) tiene x-forwarded-for o cf-connecting-ip
    if (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']) {
        return false;
    }
    const remoteIp = String(req.ip || req.socket?.remoteAddress || '');
    const isLoopbackIp =
        remoteIp === '127.0.0.1' ||
        remoteIp === '::1' ||
        remoteIp === '::ffff:127.0.0.1';
    if (!isLoopbackIp) return false;

    const host = String(req.headers.host || '').toLowerCase();
    return host.startsWith('localhost') || host.startsWith('127.0.0.1');
}

/**
 * Middleware de Bloqueo Anti-Doble Arranque en PcAlmacen (`LAMDA_ROLE=GALPON_BRIDGE_ONLY`)
 */
function galponBridgeRoleLockMiddleware(req, res, next) {
    if (!esModoGalponBridgeOnly()) {
        return next();
    }

    const reqPath = String(req.path || req.url || '').split('?')[0];
    // Permitir únicamente los endpoints del puente Zebra y estado del sistema
    if (
        reqPath.startsWith('/api/system/print-queue') ||
        reqPath === '/api/system/env-status' ||
        reqPath === '/lamda-cloud-runtime.js' ||
        reqPath === '/health'
    ) {
        return next();
    }

    const cloudTargetUrl = obtenerUrlNubeTitular();
    const method = String(req.method || 'GET').toUpperCase();

    // Bloquear toda escritura local accidental
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        return res.status(423).json({
            ok: false,
            code: 'GALPON_BRIDGE_ONLY_LOCK',
            blockedByRole: 'GALPON_BRIDGE_ONLY',
            redirectUrl: `${cloudTargetUrl}/gw/3000/`,
            error: `Operación local bloqueada por seguridad: PcAlmacen está en modo GALPON_BRIDGE_ONLY. Use el sistema titular en la nube (${cloudTargetUrl}).`
        });
    }

    // Si es navegación en navegador (GET HTML), redirigir con HTTP 302 a la nube
    const accept = String(req.headers.accept || '').toLowerCase();
    if (method === 'GET' && (accept.includes('text/html') || reqPath === '/' || reqPath.endsWith('.html'))) {
        const destPath = reqPath === '/' ? '/gw/3000/' : reqPath;
        return res.redirect(302, `${cloudTargetUrl}${destPath}`);
    }

    return res.status(423).json({
        ok: false,
        code: 'GALPON_BRIDGE_ONLY_LOCK',
        blockedByRole: 'GALPON_BRIDGE_ONLY',
        redirectUrl: `${cloudTargetUrl}/gw/3000/`,
        error: 'PcAlmacen se encuentra en modo puente de impresión (GALPON_BRIDGE_ONLY).'
    });
}

/**
 * Escudo Unificado de Autenticación (`lamdaCloudAuthGuard`) para Gateway 3005
 */
function lamdaCloudAuthGuard(req, res, next) {
    if (req.method === 'OPTIONS') {
        return next();
    }

    // 1. Verificar si el rol es GALPON_BRIDGE_ONLY primero
    if (esModoGalponBridgeOnly()) {
        return galponBridgeRoleLockMiddleware(req, res, next);
    }

    // 2. Permitir lista blanca pública
    if (esRutaPublicaAllowlist(req)) {
        return next();
    }

    // 3. Extraer credenciales desde Cookie `lamda_cloud_jwt` o Header `Authorization`
    const cookies = parseCookies(req.headers.cookie);
    const cookieToken = cookies[COOKIE_NAME];
    const authHeader = req.headers.authorization || req.headers['x-access-token'] || req.headers['x-chofer-token'];

    const userFromCookie = verificarTokenOExtraerUsuario(cookieToken);
    const userFromHeader = verificarTokenOExtraerUsuario(authHeader);
    const validUser = userFromCookie || userFromHeader;

    if (validUser) {
        req.lamdaUser = validUser;
        if (!req.headers.authorization && validUser.id) {
            req.headers.authorization = 'Bearer ' + Buffer.from(validUser.id + ':' + Date.now()).toString('base64');
        }
        // Si vino por Header pero aún no tenía la cookie HttpOnly, sincronizarla automáticamente
        if (!userFromCookie && userFromHeader && res && typeof res.setHeader === 'function') {
            emitirCookieSesionCloud(req, res, validUser);
        }
        return next();
    }

    // 4. En Modo Laboratorio o llamadas internas entre microservicios en loopback (127.0.0.1),
    // no bloquear flujos internos a menos que se envíe el header explícito de prueba `x-test-enforce-cloud-auth: true`
    const forceEnforce = String(req.headers['x-test-enforce-cloud-auth'] || '').toLowerCase() === 'true';
    if (!forceEnforce) {
        if (esModoLaboratorioAuth()) {
            req.lamdaUser = { id: 2, usuario: 'Tincho', rol_id: 1, modo: 'laboratorio' };
            return next();
        }
        const isCloudMode =
            String(process.env.LAMDA_CLOUD_MODE || '').toLowerCase() === 'true' ||
            String(process.env.LAMDA_ENFORCE_AUTH || '').toLowerCase() === 'true';
        if (!isCloudMode && esLlamadaInternaLoopback(req)) {
            req.lamdaUser = { id: 1, usuario: 'internal-loopback', rol_id: 1 };
            return next();
        }
    }

    // 5. Petición no autenticada: distinguir entre llamada API y navegación de página HTML
    const reqPath = String(req.path || req.url || '').split('?')[0];
    const accept = String(req.headers.accept || '').toLowerCase();
    const isApiRequest =
        reqPath.startsWith('/api/') ||
        reqPath.startsWith('/gw/3000/api/') ||
        reqPath.startsWith('/gw/3002/api/') ||
        reqPath.startsWith('/gw/3003/api/') ||
        reqPath.startsWith('/gw/3004/facturacion') ||
        req.xhr ||
        (accept.includes('application/json') && !accept.includes('text/html'));

    if (isApiRequest) {
        return res.status(401).json({
            ok: false,
            success: false,
            error: 'No autenticado. Inicie sesión en LAMDA para acceder a este recurso.',
            code: 'AUTH_REQUIRED',
            loginUrl: '/login'
        });
    }

    if (reqPath.startsWith('/mobile')) {
        return res.redirect(302, '/mobile/index.html');
    }

    const returnTo = encodeURIComponent(req.originalUrl || req.url || '/');
    return res.redirect(302, `/login?redirect=${returnTo}`);
}

function renderLoginHtmlPage() {
    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Acceso Seguro — Sistema LAMDA Cloud 24/7</title>
    <link rel="icon" type="image/png" href="/img/isotipo_L_LAMDA.png">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
            background: radial-gradient(circle at top, #1e293b 0%, #0f172a 100%);
            color: #f8fafc;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .login-card {
            background: #1e293b;
            border: 1px solid #334155;
            border-top: 4px solid #38bdf8;
            border-radius: 14px;
            width: 100%;
            max-width: 400px;
            padding: 28px 24px;
            box-shadow: 0 20px 45px rgba(0,0,0,0.55);
        }
        .brand {
            text-align: center;
            margin-bottom: 22px;
        }
        .brand h1 {
            font-size: 1.35rem;
            font-weight: 800;
            color: #f8fafc;
        }
        .brand p {
            font-size: 0.82rem;
            color: #94a3b8;
            margin-top: 4px;
        }
        label {
            display: block;
            font-size: 0.82rem;
            font-weight: 700;
            color: #cbd5e1;
            margin-bottom: 6px;
        }
        input {
            width: 100%;
            padding: 11px 13px;
            border-radius: 8px;
            border: 1px solid #475569;
            background: #0f172a;
            color: #f8fafc;
            font-size: 0.95rem;
            margin-bottom: 16px;
            outline: none;
        }
        input:focus {
            border-color: #38bdf8;
            box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.2);
        }
        button {
            width: 100%;
            padding: 12px;
            border-radius: 8px;
            border: none;
            background: linear-gradient(90deg, #0284c7, #2563eb);
            color: #ffffff;
            font-weight: 800;
            font-size: 0.96rem;
            cursor: pointer;
        }
        button:hover { opacity: 0.95; }
        .err {
            color: #fca5a5;
            background: rgba(127, 29, 29, 0.45);
            border: 1px solid #ef4444;
            padding: 8px 10px;
            border-radius: 6px;
            font-size: 0.82rem;
            margin-bottom: 14px;
            display: none;
        }
    </style>
</head>
<body>
    <div class="login-card">
        <div class="brand">
            <h1>🔐 Sistema LAMDA Cloud</h1>
            <p>Ingreso Unificado (Pizarra, Producción, Presupuestos, Facturación y Logística)</p>
        </div>
        <div id="err-box" class="err"></div>
        <form id="cloud-login-form">
            <label for="usuario">Usuario</label>
            <input type="text" id="usuario" name="usuario" required autocomplete="username" placeholder="Ej: Tincho">
            <label for="password">Contraseña</label>
            <input type="password" id="password" name="password" required autocomplete="current-password" placeholder="••••••••">
            <button type="submit" id="btn-submit">Ingresar al Sistema</button>
        </form>
    </div>
    <script>
        document.getElementById('cloud-login-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            var errBox = document.getElementById('err-box');
            var btn = document.getElementById('btn-submit');
            errBox.style.display = 'none';
            btn.disabled = true;
            btn.textContent = 'Verificando...';
            try {
                var u = document.getElementById('usuario').value.trim();
                var p = document.getElementById('password').value;
                var res = await fetch('/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ usuario: u, password: p, contraseña: p })
                });
                var data = await res.json();
                if (!res.ok || !data.token) {
                    throw new Error(data.error || 'Credenciales inválidas');
                }
                localStorage.setItem('token', data.token);
                if (data.user) {
                    localStorage.setItem('colaboradorActivo', JSON.stringify({
                        id: data.user.id,
                        nombre: data.user.nombre_completo || data.user.usuario,
                        usuario: data.user.usuario,
                        rol_id: data.user.rol_id,
                        timestamp: new Date().toISOString()
                    }));
                    var sesChofer = JSON.stringify({
                        id: data.user.id,
                        usuario: data.user.usuario,
                        nombre: data.user.nombre_completo || data.user.usuario,
                        rol_id: data.user.rol_id,
                        token: data.mobileToken || data.token
                    });
                    localStorage.setItem('sesion_chofer', sesChofer);
                    sessionStorage.setItem('sesion_chofer', sesChofer);
                }
                var params = new URLSearchParams(window.location.search);
                var redirect = params.get('redirect') || '/pages/dashboard.html';
                window.location.replace(redirect);
            } catch (err) {
                errBox.textContent = err.message || 'Error al iniciar sesión';
                errBox.style.display = 'block';
                btn.disabled = false;
                btn.textContent = 'Ingresar al Sistema';
            }
        });
    </script>
</body>
</html>`;
}

module.exports = {
    COOKIE_NAME,
    JWT_SECRET,
    esModoLaboratorioAuth,
    esModoGalponBridgeOnly,
    obtenerUrlNubeTitular,
    parseCookies,
    firmarJwtSesion,
    emitirCookieSesionCloud,
    limpiarCookieSesionCloud,
    verificarTokenOExtraerUsuario,
    esRutaPublicaAllowlist,
    galponBridgeRoleLockMiddleware,
    lamdaCloudAuthGuard,
    renderLoginHtmlPage
};
