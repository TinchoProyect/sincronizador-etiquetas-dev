if (!globalThis.WebSocket) { try { globalThis.WebSocket = require('ws'); } catch (_) {} }
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { createProxyMiddleware } = require('http-proxy-middleware');
const produccionRoutes = require('./routes/produccion');
const usuariosRoutes = require('../usuarios/rutas');
const { supabaseFetch } = require('./utils/supabaseHelper');
const db = require('./config/database');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});


// Almacén de sesiones de inventario activas
const inventarioSesiones = new Map();

const NODOS_PUBLIC_HOST_CONFIG = String(process.env.NODOS_PUBLIC_HOST || 'tienda.lamdaser.com')
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '');

function extraerHostSinPuertoNodos(req) {
    const rawHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
    return rawHost.replace(/:\d+$/, '');
}

function esAccesoExternoNodos(req) {
    const hostSinPuerto = extraerHostSinPuertoNodos(req);
    if (!hostSinPuerto) return false;
    if (hostSinPuerto.includes('.trycloudflare.com')) return true;
    if (NODOS_PUBLIC_HOST_CONFIG && hostSinPuerto === NODOS_PUBLIC_HOST_CONFIG) return true;
    if (hostSinPuerto === 'tienda.lamdaser.com' || hostSinPuerto.startsWith('tienda.')) return true;
    return false;
}

// 🔒 Blindaje de aislamiento para accesos móviles externos (Dominio público HTTPS o túnel trycloudflare):
// Se ejecuta ANTES de cualquier proxy (/api/presupuestos, /api/logistica) o middleware interno.
app.use((req, res, next) => {
    if (!esAccesoExternoNodos(req)) return next();

    const p = String(req.path || '');
    const pLower = p.toLowerCase();
    const esMediaFotoPublicaNodo =
        (req.method === 'GET' || req.method === 'HEAD') &&
        !pLower.endsWith('_orig.webp') &&
        !pLower.endsWith('_tmp.mp4') &&
        (
            /^\/media\/nodos\/\d+\/(?:\d+|bienvenida)\/[a-z0-9_-]+\.(?:webp|mp4)$/i.test(p) ||
            /^\/media\/nodos\/catalogo-base\/(?:ancla_principal|ingrediente|producto_base|articulo_sku)\/[a-z0-9_-]+\/[a-z0-9_-]+\.webp$/i.test(p) ||
            /^\/media\/nodos\/biblioteca-lamda\/[a-z0-9_-]+\/[a-z0-9_-]+\.webp$/i.test(p) ||
            /^\/media\/nodos\/grupos\/\d+\/[a-z0-9_-]+\/[a-z0-9_-]+\.webp$/i.test(p)
        );

    const esImagenMarcaPublicaNodo =
        (req.method === 'GET' || req.method === 'HEAD') &&
        /^\/img\/nodos\/[^/]+\/[a-z0-9._-]+\.(?:png|jpe?g|webp|svg|ico)$/i.test(p);

    const esVistaPermitida =
        esMediaFotoPublicaNodo ||
        esImagenMarcaPublicaNodo ||
        /^\/(gestor|gestor-nodo|tienda)(\/[^/]+)?(\/mi-cuenta\/[^/]+)?\/?$/i.test(p) ||
        /^\/seguimiento(\/[^/]+)?\/?$/i.test(p) ||
        /^\/sw-nodo-pwa\.js$/i.test(p) ||
        /^\/(favicon\.ico|robots\.txt)$/i.test(p);

    const esBeaconTelemetriaTienda =
        req.method === 'POST' &&
        /^\/api\/produccion\/nodos\/tienda\/[^/]+\/telemetria\/?$/i.test(p);

    const esRecursoPwaNodo =
        (req.method === 'GET' || req.method === 'HEAD') &&
        /^\/api\/produccion\/nodos\/pwa\/[^/]+\/(?:(?:tienda|gestor)\.webmanifest|icon-(?:tienda|gestor)-(?:180|192|512)\.png)$/i.test(p);

    const esApiNodoPermitida =
        esBeaconTelemetriaTienda ||
        esRecursoPwaNodo ||
        (req.method !== 'PATCH' && /^\/api\/produccion\/nodos\/(ping-movil|portal\/[^/]+|seguimiento\/[^/]+|comprobante-pago\/\d+|ofertas-gestor\/\d+(\/fotos(\/preview|\/importar-sugerida|\/[a-z0-9_-]+)?|\/fotos-orden|\/videos(\/[a-z0-9_-]+)?|\/portada)?|gestor\/\d+\/(config-logistica|perfil-contacto|sumar-catalogo|compartir-kit|compradores|geocodificar|grupos\/(publicacion|config|foto)|lotes\/\d+\/confirmar-recepcion|pedidos\/\d+\/(estado-entrega|reenviar-recibo-whatsapp)|reparto\/(sugerir-orden|orden|seleccion|iniciar|radar|pedidos\/\d+\/coordenadas))|propuestas(?:-combos)?(\/\d+\/anular)?|tienda\/[^/]+\/(pedido|pedidos\/[^/]+\/(aviso-pago|estado-pago)|cotizar-cp|seguimiento\/[^/]+|seguimiento-whatsapp|buscar-seguimiento|mi-cuenta\/[^/]+)|pedidos\/\d+\/(etiqueta|recibo-marca-blanca\.png)|liquidacion\/tablero|liquidacion\/pedidos\/\d+\/conciliar-pago)\/?$/i.test(p));

    if (esVistaPermitida || esApiNodoPermitida) {
        return next();
    }

    if (p.startsWith('/api/')) {
        return res.status(403).json({
            ok: false,
            error: 'Acceso restringido. Recurso no habilitado para el portal público.'
        });
    }

    return res.status(403).send(`<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Acceso Restringido</title></head>
<body style="font-family:sans-serif;background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:90vh;margin:0;padding:20px;text-align:center;">
  <div style="max-width:420px;background:#1e293b;border:1px solid #334155;border-radius:14px;padding:24px;">
    <div style="font-size:2.2rem;margin-bottom:8px;">🔒</div>
    <h2 style="margin:0 0 8px 0;font-size:1.15rem;">Sección Restringida</h2>
    <p style="color:#94a3b8;font-size:0.88rem;line-height:1.5;margin:0;">
      Este dominio está habilitado únicamente para la tienda online y la gestión comercial autorizada.
    </p>
  </div>
</body></html>`);
});

// ✅ Middleware para interpretar JSON en los requests
// NOTA: El proxy debe ir ANTES del body parser para que funcione correctamente el stream
app.use('/api/presupuestos', createProxyMiddleware({
    target: 'http://127.0.0.1:3003/api/presupuestos',
    changeOrigin: true,
    logLevel: 'debug'
}));

// Proxy hacia el módulo de logística
app.use('/api/logistica', createProxyMiddleware({
    target: 'http://127.0.0.1:3005/api/logistica',
    changeOrigin: true,
    logLevel: 'debug'
}));

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// 🛡️ Runtime Cloud 24/7 + Banner Modo Laboratorio + Bandeja Zebra
const { attachLamdaCloudRuntime } = require('../shared/lamdaCloudRuntime');
attachLamdaCloudRuntime(app, 3002);

//Temporizacion -Mari
const tiemposRouter = require('./routes/tiemposCarro');
const nodosBarrialesRouter = require('./routes/nodosBarrialesRoutes');
const costosGrafoRouter = require('./routes/costosGrafoRoutes');
app.use('/api/tiempos', tiemposRouter);
app.use('/api/produccion/tiempos', tiemposRouter);
app.use('/api/produccion/nodos', nodosBarrialesRouter);
app.use('/api/nodos', nodosBarrialesRouter);
app.use('/api/produccion/costos-grafo', costosGrafoRouter);
app.use('/api/produccion', produccionRoutes);

function escHtmlAttrNodos(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function construirBaseUrlAbsolutaNodos(req) {
    const hostHeader = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const rawProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const isLocalHost = !hostHeader || /^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.)/i.test(hostHeader);
    const proto = rawProto || (req.secure || !isLocalHost ? 'https' : (req.protocol || 'http'));
    return hostHeader ? `${proto}://${hostHeader}` : '';
}

function aUrlAbsolutaNodos(baseUrl, rutaOUrl) {
    const raw = String(rutaOUrl || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (!baseUrl) return raw;
    return `${baseUrl}${raw.startsWith('/') ? '' : '/'}${raw}`;
}

function renderizarHtmlMarcaBlancaConMeta(fileName, nodo, req, extraContext = {}) {
    const htmlPath = path.join(__dirname, 'pages', fileName);
    let html = fs.readFileSync(htmlPath, 'utf8');

    const baseUrl = construirBaseUrlAbsolutaNodos(req);
    const { enriquecerTemaVisualConVersionAssets } = require('./services/nodosBarrialesService');
    const tv = enriquecerTemaVisualConVersionAssets(nodo?.tema_visual);
    const logosTv = (tv.logos && typeof tv.logos === 'object') ? tv.logos : {};
    const nombreMarca = String(nodo?.nombre_marca || 'Tienda').trim();
    const bajada = String(nodo?.bajada_marca || nodo?.subtitulo_marca || '').trim();
    const esGestor = fileName === 'nodo-panel-gestor.html';

    const tituloDoc = esGestor
        ? `Gestión ${nombreMarca}`
        : nombreMarca;

    const ogTitle = extraContext.codigoPedido
        ? `${nombreMarca} · Pedido #${extraContext.codigoPedido}`
        : (bajada ? `${nombreMarca} · ${bajada}` : nombreMarca);

    const ogDesc = extraContext.codigoPedido
        ? `Seguimiento en vivo de tu pedido #${extraContext.codigoPedido} en ${nombreMarca}${nodo?.barrio_zona ? ` (${nodo.barrio_zona})` : ''}.`
        : `${bajada || 'Pedidos comunitarios del barrio'}${nodo?.barrio_zona ? ` · ${nodo.barrio_zona}` : ''}.`;

    const ogImagePath = logosTv.og_share || logosTv.vertical_png || logosTv.vertical || logosTv.horizontal_png || logosTv.horizontal || '';
    const ogImageAbs = aUrlAbsolutaNodos(baseUrl, ogImagePath);
    const faviconSvgPath = logosTv.favicon_svg || '';
    const favicon32Path = logosTv.favicon_32 || '';
    const faviconPath = logosTv.isotipo_png || logosTv.isotipo || '';
    const ogUrl = aUrlAbsolutaNodos(baseUrl, req.originalUrl || req.path || '');
    const paletaTv = (tv.paleta && typeof tv.paleta === 'object') ? tv.paleta : {};
    const slugCanonico = String(nodo?.slug || '').trim();
    const slugEnc = encodeURIComponent(slugCanonico);

    const tokQueryRaw = String(req.query?.t || req.query?.gestor_token || '').trim();
    const tokRealNodo = String(nodo?.gestor_token || '').trim();
    const tokGestorValido = (esGestor && tokQueryRaw && tokRealNodo && tokQueryRaw === tokRealNodo)
        ? tokRealNodo
        : '';

    const { calcularVersionPwaNodo } = require('./services/nodosPwaService');
    const pwaV = slugCanonico ? calcularVersionPwaNodo(nodo) : '5';

    const metaTags = [];
    if (slugCanonico) {
        const rolIcon = esGestor ? 'gestor' : 'tienda';
        const manifestHref = esGestor
            ? `/api/produccion/nodos/pwa/${slugEnc}/gestor.webmanifest?${tokGestorValido ? `t=${encodeURIComponent(tokGestorValido)}&` : ''}v=${encodeURIComponent(pwaV)}`
            : `/api/produccion/nodos/pwa/${slugEnc}/tienda.webmanifest?v=${encodeURIComponent(pwaV)}`;
        const appShortTitle = esGestor ? `Gestión ${nombreMarca}` : nombreMarca;
        const themeColor = esGestor
            ? String(paletaTv.primario || '#654830').trim()
            : String(paletaTv.fondo || '#FBF8F3').trim();

        const conVersionSiFalta = (u, v) => (String(u || '').includes('?v=') || String(u || '').includes('&v=')) ? u : `${u}?v=${encodeURIComponent(v)}`;
        metaTags.push(`<link id="nodo-pwa-manifest" rel="manifest" href="${escHtmlAttrNodos(manifestHref)}">`);
        if (!esGestor && faviconSvgPath) {
            metaTags.push(`<link id="nodo-favicon-svg" rel="icon" type="image/svg+xml" href="${escHtmlAttrNodos(conVersionSiFalta(faviconSvgPath, pwaV))}">`);
        }
        if (!esGestor && favicon32Path) {
            metaTags.push(`<link id="nodo-favicon-32" rel="icon" type="image/png" sizes="32x32" href="${escHtmlAttrNodos(conVersionSiFalta(favicon32Path, pwaV))}">`);
        }
        metaTags.push(`<link id="nodo-favicon-png" rel="icon" type="image/png" sizes="192x192" href="/api/produccion/nodos/pwa/${slugEnc}/icon-${rolIcon}-192.png?v=${encodeURIComponent(pwaV)}">`);
        metaTags.push(`<link id="nodo-apple-touch-icon" rel="apple-touch-icon" sizes="180x180" href="/api/produccion/nodos/pwa/${slugEnc}/icon-${rolIcon}-180.png?v=${encodeURIComponent(pwaV)}">`);
        metaTags.push(`<meta name="theme-color" content="${escHtmlAttrNodos(themeColor)}">`);
        metaTags.push(`<meta name="mobile-web-app-capable" content="yes">`);
        metaTags.push(`<meta name="apple-mobile-web-app-capable" content="yes">`);
        metaTags.push(`<meta name="apple-mobile-web-app-status-bar-style" content="${esGestor ? 'black-translucent' : 'default'}">`);
        metaTags.push(`<meta name="apple-mobile-web-app-title" content="${escHtmlAttrNodos(appShortTitle)}">`);
    } else if (faviconSvgPath || faviconPath) {
        if (faviconSvgPath) {
            metaTags.push(`<link id="nodo-favicon-svg" rel="icon" type="image/svg+xml" href="${escHtmlAttrNodos(faviconSvgPath)}">`);
        }
        if (faviconPath) {
            metaTags.push(`<link id="nodo-favicon-png" rel="icon" type="image/png" href="${escHtmlAttrNodos(faviconPath)}">`);
            metaTags.push(`<link rel="apple-touch-icon" href="${escHtmlAttrNodos(faviconPath)}">`);
        }
    }
    if (!esGestor) {
        metaTags.push(`<meta name="description" content="${escHtmlAttrNodos(ogDesc)}">`);
        metaTags.push(`<meta property="og:type" content="website">`);
        metaTags.push(`<meta property="og:title" content="${escHtmlAttrNodos(ogTitle)}">`);
        metaTags.push(`<meta property="og:description" content="${escHtmlAttrNodos(ogDesc)}">`);
        if (ogUrl) metaTags.push(`<meta property="og:url" content="${escHtmlAttrNodos(ogUrl)}">`);
        if (ogImageAbs) {
            metaTags.push(`<meta property="og:image" content="${escHtmlAttrNodos(ogImageAbs)}">`);
            if (logosTv.og_share) {
                metaTags.push(`<meta property="og:image:type" content="image/png">`);
                metaTags.push(`<meta property="og:image:width" content="1200">`);
                metaTags.push(`<meta property="og:image:height" content="630">`);
            }
        }
        metaTags.push(`<meta name="twitter:card" content="${ogImageAbs ? 'summary_large_image' : 'summary'}">`);
    }

    const bootstrapPayload = {
        slug: nodo?.slug || '',
        tracking_token: extraContext.trackingToken || '',
        pwa_v: pwaV
    };
    const bootstrapScript = `<script>window.__NODOS_BOOTSTRAP__ = ${JSON.stringify(bootstrapPayload).replace(/</g, '\\u003c')};</script>`;

    html = html.replace(/<title([^>]*)>[\s\S]*?<\/title>/i, `<title$1>${escHtmlAttrNodos(tituloDoc)}</title>\n  ${metaTags.join('\n  ')}\n  ${bootstrapScript}`);
    return html;
}

function construirUrlRedireccionSlugCanonico(req, slugSolicitado, slugCanonico) {
    const qIdx = String(req.originalUrl || '').indexOf('?');
    const querySuffix = qIdx !== -1 ? String(req.originalUrl).slice(qIdx) : '';
    const reqPath = String(req.path || '/');
    if (req.params?.nodoSlug) {
        const segEsc = req.params.nodoSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const nuevoPath = reqPath.replace(new RegExp(`/(${segEsc})(?=/|$)`, 'i'), `/${encodeURIComponent(slugCanonico)}`);
        return `${nuevoPath}${querySuffix}`;
    }
    if (req.query?.nodo) {
        const u = new URL(req.originalUrl || reqPath, 'http://local');
        u.searchParams.set('nodo', slugCanonico);
        return u.pathname + u.search;
    }
    return `/tienda/${encodeURIComponent(slugCanonico)}${querySuffix}`;
}

async function validarYServirVistaNodoPublica(req, res, fileName) {
    const slugSolicitado = String(req.params.nodoSlug || req.query.nodo || '').trim();
    const esExterno = esAccesoExternoNodos(req);

    if (!slugSolicitado) {
        if (esExterno) {
            return res.status(404).send(`<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tienda no encontrada</title></head>
<body style="font-family:sans-serif;background:#faf8f5;color:#1e293b;display:flex;align-items:center;justify-content:center;min-height:90vh;margin:0;padding:20px;text-align:center;">
  <div style="max-width:420px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:26px;box-shadow:0 8px 24px rgba(15,23,42,0.06);">
    <div style="font-size:2.2rem;margin-bottom:8px;">📍</div>
    <h2 style="margin:0 0 8px 0;font-size:1.15rem;">Tienda no encontrada</h2>
    <p style="color:#64748b;font-size:0.9rem;line-height:1.5;margin:0;">
      Verificá el enlace recibido o escaneá nuevamente el código QR compartido por el referente de tu barrio.
    </p>
  </div>
</body></html>`);
        }
        return res.sendFile(path.join(__dirname, 'pages', fileName));
    }

    let nodoRow = null;
    try {
        const { rows } = await db.query(
            `SELECT id, slug, slug_historico, nombre_marca, bajada_marca, subtitulo_marca,
                    barrio_zona, color_primario, tema_visual, gestor_token,
                    LENGTH(COALESCE(logo_original_base64, '')) AS logo_b64_len
             FROM public.nodos_maestro
             WHERE (LOWER(slug) = LOWER($1) OR LOWER(COALESCE(slug_historico, '')) = LOWER($1))
               AND COALESCE(activo, true) = true
             ORDER BY CASE WHEN LOWER(slug) = LOWER($1) THEN 0 ELSE 1 END, id ASC
             LIMIT 1`,
            [slugSolicitado]
        );
        if (rows.length === 0) {
            return res.status(404).send(`<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tienda no encontrada</title></head>
<body style="font-family:sans-serif;background:#faf8f5;color:#1e293b;display:flex;align-items:center;justify-content:center;min-height:90vh;margin:0;padding:20px;text-align:center;">
  <div style="max-width:420px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:26px;box-shadow:0 8px 24px rgba(15,23,42,0.06);">
    <div style="font-size:2.2rem;margin-bottom:8px;">📍</div>
    <h2 style="margin:0 0 8px 0;font-size:1.15rem;">Tienda no encontrada</h2>
    <p style="color:#64748b;font-size:0.9rem;line-height:1.5;margin:0;">
      No existe un punto de retiro activo para este enlace. Verificá la dirección o solicitá nuevamente el acceso QR.
    </p>
  </div>
</body></html>`);
        }
        nodoRow = rows[0];
    } catch (err) {
        console.error('❌ [NODOS] Error validando slug público:', err.message);
        return res.status(404).send('Tienda no encontrada.');
    }

    if (nodoRow.slug && String(nodoRow.slug).toLowerCase() !== slugSolicitado.toLowerCase()) {
        const destino = construirUrlRedireccionSlugCanonico(req, slugSolicitado, nodoRow.slug);
        return res.redirect(302, destino);
    }

    const html = renderizarHtmlMarcaBlancaConMeta(fileName, nodoRow, req);
    res.set('Cache-Control', 'no-cache, must-revalidate');
    return res.type('text/html').send(html);
}

app.use('/img/nodos', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return res.status(405).end();
    }
    if (req.query && req.query.v) {
        res.setHeader('Cache-Control', 'public, max-age=604800');
    } else {
        res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
    }
    return next();
}, express.static(path.join(__dirname, 'img', 'nodos'), {
    dotfiles: 'deny',
    index: false,
    setHeaders: (res, _filePath) => {
        if (!res.getHeader('Cache-Control')) {
            res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
        }
    }
}));

// 🖼️ Servidor estático blindado para galerías WebP + MP4 publicadas de Nodos Barriales
// (Bloquea traversal, listado de directorios y archivos internos `*_orig.webp` / `*_tmp.mp4`; habilita Range HTTP 206)
const { obtenerDirectorioMediaNodos } = require('./services/nodosFotosService');
app.use('/media/nodos', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return res.status(405).end();
    }
    const subPath = String(req.path || '');
    const subLower = subPath.toLowerCase();
    const esRutaMediaValida =
        /^\/\d+\/(?:\d+|bienvenida)\/[a-z0-9_-]+\.(?:webp|mp4)$/i.test(subPath) ||
        /^\/catalogo-base\/(?:ancla_principal|ingrediente|producto_base|articulo_sku)\/[a-z0-9_-]+\/[a-z0-9_-]+\.webp$/i.test(subPath) ||
        /^\/biblioteca-lamda\/[a-z0-9_-]+\/[a-z0-9_-]+\.webp$/i.test(subPath) ||
        /^\/grupos\/\d+\/[a-z0-9_-]+\/[a-z0-9_-]+\.webp$/i.test(subPath);
    if (subLower.endsWith('_orig.webp') || subLower.endsWith('_tmp.mp4') || !esRutaMediaValida) {
        return res.status(403).json({ ok: false, error: 'Acceso restringido al recurso multimedia.' });
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    const mediaRoot = obtenerDirectorioMediaNodos();
    return express.static(mediaRoot, {
        dotfiles: 'deny',
        index: false,
        fallthrough: false,
        acceptRanges: true
    })(req, res, (err) => {
        if (err) {
            return res.status(err.statusCode || err.status || 404).end();
        }
        return next();
    });
});
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /\n'));
app.get('/sw-nodo-pwa.js', (req, res) => {
    const nodosPwaService = require('./services/nodosPwaService');
    res.set('Service-Worker-Allowed', '/');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.type('application/javascript; charset=utf-8');
    return res.status(200).send(nodosPwaService.generarCodigoServiceWorkerNodo());
});

app.get('/seguimiento/:trackingToken', async (req, res) => {
    const cleanTok = String(req.params.trackingToken || '').trim();
    try {
        const { rows } = await db.query(
            `SELECT npv.codigo_pedido, npv.tracking_token,
                    nm.id, nm.slug, nm.slug_historico, nm.nombre_marca, nm.bajada_marca,
                    nm.subtitulo_marca, nm.barrio_zona, nm.color_primario, nm.tema_visual
             FROM public.nodos_pedidos_vecinos npv
             JOIN public.nodos_maestro nm ON nm.id = npv.nodo_id
             WHERE npv.tracking_token = $1
               AND COALESCE(nm.activo, true) = true
             LIMIT 1`,
            [cleanTok]
        );
        if (rows.length === 0) {
            return res.status(404).send(`<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Seguimiento no encontrado</title></head>
<body style="font-family:sans-serif;background:#faf8f5;color:#1e293b;display:flex;align-items:center;justify-content:center;min-height:90vh;margin:0;padding:20px;text-align:center;">
  <div style="max-width:420px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:26px;">
    <div style="font-size:2.2rem;margin-bottom:8px;">📦</div>
    <h2 style="margin:0 0 8px 0;font-size:1.15rem;">Enlace de seguimiento no encontrado</h2>
    <p style="color:#64748b;font-size:0.9rem;margin:0;">Verificá el enlace compartido o consultá desde la tienda de tu barrio.</p>
  </div>
</body></html>`);
        }
        const row = rows[0];
        const html = renderizarHtmlMarcaBlancaConMeta('nodo-tienda-vecino.html', row, req, {
            trackingToken: row.tracking_token,
            codigoPedido: row.codigo_pedido
        });
        return res.type('text/html').send(html);
    } catch (err) {
        console.error('❌ [NODOS] Error sirviendo /seguimiento/:token:', err.message);
        return res.status(500).send('Error cargando seguimiento.');
    }
});

// 🏘️ Rutas amigables Etapas 2, 3 y 4: Tienda Vecino, Mi Cuenta Vecino, Panel Gestor, Mesa de Armado y Liquidación Cta. Cte.
app.get(['/tienda', '/tienda/:nodoSlug', '/tienda/:nodoSlug/mi-cuenta/:portalToken'], (req, res) => {
    return validarYServirVistaNodoPublica(req, res, 'nodo-tienda-vecino.html');
});
app.get(['/gestor', '/gestor/:nodoSlug', '/gestor-nodo', '/gestor-nodo/:nodoSlug'], (req, res) => {
    return validarYServirVistaNodoPublica(req, res, 'nodo-panel-gestor.html');
});
app.get(['/deposito-nodos', '/deposito-nodos/:nodoSlug'], (req, res) => {
    res.sendFile(path.join(__dirname, 'pages', 'nodo-mesa-armado.html'));
});
app.get(['/liquidacion-nodos', '/liquidacion-nodos/:nodoSlug'], (req, res) => {
    res.sendFile(path.join(__dirname, 'pages', 'nodo-liquidacion-cobros.html'));
});
app.get(['/centro-nodos', '/centro-nodos/:nodoSlug'], (req, res) => {
    if (esAccesoExternoNodos(req)) {
        return res.status(403).send('Acceso restringido al entorno interno de LAMDA.');
    }
    return res.sendFile(path.join(__dirname, 'pages', 'centro-nodos-analitica.html'));
});

// ✅ PROXY A SUPABASE (BYPASS DE CORS)
// Para que el frontend pueda leer los datos sin que Supabase rechace la key de servicio
app.get('/api/supabase/lotes', async (req, res) => {
    try {
        const key = (process.env.SUPABASE_SERVICE_KEY || '').trim();
        if (!key || key === 'MISSING_ENV_KEY') {
            return res.status(500).json({
                success: false,
                code: 'SUPABASE_KEY_MISSING',
                error: 'Falta configurar SUPABASE_SERVICE_KEY en el .env raíz del servidor.'
            });
        }

        const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };
        let lotes = null;
        let fallbackReason = null;

        try {
            const collected = [];
            let offset = 0;
            const pageSize = 250;
            while (collected.length < 500) {
                const url = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/recepciones_fisicas_items?select=id,created_at,cantidad_recibida,cantidad_esperada,costo_unitario,recepciones_fisicas_cabecera(id,fecha_recepcion,numero_remito,pedido_id,estado,envio_tipo,costo_logistico_estado,pedidos_b2b_cabecera(id,proveedor_id,proveedores(id,nombre))),pedidos_b2b_items(id,producto_codigo,producto_descripcion,unidad_ref,valor_unitario_ref,cant_bult,cant_valor)&order=created_at.desc&limit=${pageSize}&offset=${offset}`;
                const response = await supabaseFetch(url, { headers }, 1, 300, 6000);
                const rows = await response.json();
                if (!Array.isArray(rows) || rows.length === 0) break;
                collected.push(...rows);
                if (rows.length < pageSize) break;
                offset += pageSize;
            }
            lotes = collected;
        } catch (supaErr) {
            const isAuthErr = supaErr.code === 'SUPABASE_AUTH_ERROR' || supaErr.statusCode === 401 || supaErr.statusCode === 403;
            if (isAuthErr) {
                console.error(`🔒 [Supabase Proxy] Rechazo HTTP ${supaErr.statusCode || 401} en /api/supabase/lotes:`, supaErr.message);
                return res.status(502).json({
                    success: false,
                    code: 'SUPABASE_AUTH_ERROR',
                    upstream_status: supaErr.statusCode || 401,
                    error: 'Error de autenticación con Supabase Proveedores',
                    message: `Supabase rechazó SUPABASE_SERVICE_KEY (HTTP ${supaErr.statusCode || 401}). Verificá el .env raíz del servidor.`
                });
            }
            fallbackReason = supaErr.message || 'NETWORK_ERROR';
            console.warn(`⚠️ [Supabase Proxy] Fallback a bunker_lotes_vinculos local por corte de red: ${fallbackReason}`);
        }

        if (!Array.isArray(lotes)) {
            const fbRes = await db.query(`
                SELECT id, lote_id_supabase, costo_bruto_ingresado, costo_kilo_calculado, cantidad_total_lote,
                       impuesto_iva, fecha_vinculacion, lote_codigo_corto, proveedor_nombre,
                       articulo_descripcion, producto_codigo, numero_remito
                FROM public.bunker_lotes_vinculos
                WHERE id::text <> COALESCE(lote_id_supabase::text, '')
                  AND proveedor_nombre IS NOT NULL
                  AND TRIM(proveedor_nombre) <> ''
                  AND COALESCE(cantidad_total_lote, 0) > 0
                ORDER BY fecha_vinculacion DESC
                LIMIT 100
            `);
            const fbMapped = fbRes.rows.map(r => ({
                id: r.lote_id_supabase || r.id,
                lote_codigo_corto: r.lote_codigo_corto,
                cantidad_recibida: parseFloat(r.cantidad_total_lote) || 1,
                cantidad_esperada: parseFloat(r.cantidad_total_lote) || 1,
                recepciones_fisicas_cabecera: {
                    id: r.id,
                    fecha_recepcion: r.fecha_vinculacion,
                    numero_remito: r.numero_remito || 'S/R',
                    pedido_id: null,
                    estado: 'RECIBIDO',
                    envio_tipo: 'DEPOSITO',
                    costo_logistico_estado: 'CONCILIADO',
                    pedidos_b2b_cabecera: {
                        id: null,
                        proveedor_id: null,
                        proveedores: { id: null, nombre: r.proveedor_nombre || 'Proveedor' }
                    }
                },
                pedidos_b2b_items: {
                    id: r.id,
                    producto_codigo: r.producto_codigo || '',
                    producto_descripcion: r.articulo_descripcion || '',
                    unidad_ref: 'Kilogramo',
                    valor_unitario_ref: parseFloat(r.costo_kilo_calculado || r.costo_bruto_ingresado) || 0,
                    cant_bult: 1,
                    cant_valor: parseFloat(r.cantidad_total_lote) || 1,
                    iva_porcentaje: parseFloat(r.impuesto_iva) || 21
                }
            }));
            res.setHeader('X-Lamda-Supabase-Fallback', 'LOCAL_BUNKER_LOTES');
            res.setHeader(
                'X-Lamda-Supabase-Fallback-Reason',
                String(fallbackReason || 'NETWORK_ERROR').replace(/[^\x20-\x7E]+/g, ' ').trim().slice(0, 160)
            );
            return res.json(fbMapped);
        }
        
        // Filtro de bultos cero (bultos <= 0)
        lotes = lotes.filter(l => (parseFloat(l.cantidad_recibida) || 0) > 0);
        
        // Extraer IDs únicos de proveedores y pedidos
        const proveedoresIds = [...new Set(lotes.map(l => l.recepciones_fisicas_cabecera?.pedidos_b2b_cabecera?.proveedor_id).filter(Boolean))];
        const pedidosIds = [...new Set(lotes.map(l => l.recepciones_fisicas_cabecera?.pedido_id).filter(Boolean))];
        
        // 1. Obtener Tabla Maestra para cant_bult y cant_valor (Paginación en Bucle para evitar límite de 1000 de Supabase)
        let masterMap = {};
        if (proveedoresIds.length > 0) {
            let masterData = [];
            let offset = 0;
            let hasMore = true;
            while (hasMore) {
                const masterUrl = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/tabla_maestra_operativa?select=datos_maestros&proveedor_id=in.(${proveedoresIds.join(',')})&limit=1000&offset=${offset}`;
                try {
                    const masterRes = await supabaseFetch(masterUrl, { headers }, 1, 300, 6000);
                    if (masterRes.ok) {
                        const rows = await masterRes.json();
                        masterData = masterData.concat(rows);
                        if (rows.length < 1000) {
                            hasMore = false;
                        } else {
                            offset += 1000;
                        }
                    } else {
                        hasMore = false;
                    }
                } catch (_) {
                    hasMore = false;
                }
            }

            masterData.forEach(row => {
                if (row.datos_maestros && row.datos_maestros.codigo) {
                    const cod = String(row.datos_maestros.codigo).trim().toLowerCase();
                    masterMap[cod] = {
                        cantBult: row.datos_maestros.cant_bult,
                        cantValor: row.datos_maestros.cant_valor,
                        iva: row.datos_maestros.iva || row.datos_maestros.IVA || null
                    };
                }
            });
        }
        
        // 2. Obtener Facturas para IVA Real (Heurística de Alícuotas)
        let facturasMap = {};
        if (pedidosIds.length > 0) {
            const facturasUrl = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/facturas_raw?select=pedido_b2b_id,importe_iva_21,importe_iva_105,match_report&pedido_b2b_id=in.(${pedidosIds.join(',')})`;
            try {
                const facturasRes = await supabaseFetch(facturasUrl, { headers }, 1, 300, 6000);
                if (facturasRes.ok) {
                    const facturasData = await facturasRes.json();
                    facturasData.forEach(fac => {
                        if (fac.pedido_b2b_id && fac.match_report) {
                            const i21 = Number(fac.importe_iva_21) || 0;
                            const i105 = Number(fac.importe_iva_105) || 0;
                            
                            let ivaBase = null;
                            if (i21 === 0 && i105 === 0) ivaBase = 0;
                            else if (i105 > 0 && i21 === 0) ivaBase = 10.5;
                            else if (i21 > 0 && i105 === 0) ivaBase = 21;
                            
                            if (!facturasMap[fac.pedido_b2b_id]) facturasMap[fac.pedido_b2b_id] = {};
                            
                            const matchItems = Array.isArray(fac.match_report)
                                ? fac.match_report
                                : (typeof fac.match_report === 'object' && fac.match_report !== null
                                    ? Object.values(fac.match_report)
                                    : []);

                            matchItems.forEach(mr => {
                                if (!mr || typeof mr !== 'object') return;
                                const cod = String(mr.pedido?.codigo || '').trim().toLowerCase();
                                if (cod && ivaBase !== null) {
                                    facturasMap[fac.pedido_b2b_id][cod] = ivaBase;
                                }
                            });
                        }
                    });
                }
            } catch (_) {}
        }

        // 3. Deduplicación conservando cada recepción e ítem de pedido distinto (sin colapsar fechas+SKU)
        const uniqueMap = new Map();
        lotes.forEach(lote => {
            const cabId = lote.recepciones_fisicas_cabecera?.id || '';
            const itemId = lote.pedidos_b2b_items?.id || '';
            const dedupeKey = (cabId && itemId) ? `${cabId}_${itemId}` : String(lote.id);
            
            if (!uniqueMap.has(dedupeKey)) {
                uniqueMap.set(dedupeKey, { ...lote });
            } else {
                const existing = uniqueMap.get(dedupeKey);
                existing.cantidad_recibida = Number(existing.cantidad_recibida || 0) + Number(lote.cantidad_recibida || 0);
            }
        });
        const dedupedLotes = Array.from(uniqueMap.values());

        // 0. Obtener overrides locales de presentación
        let overridesMap = {};
        try {
            const overridesRes = await db.query('SELECT lote_id_supabase, cant_bult, cant_valor FROM public.lotes_presentacion_overrides');
            overridesRes.rows.forEach(row => {
                overridesMap[row.lote_id_supabase] = {
                    cantBult: parseFloat(row.cant_bult),
                    cantValor: parseFloat(row.cant_valor)
                };
            });
        } catch (dbErr) {
            console.error("❌ Error leyendo overrides locales:", dbErr.message);
        }

        // 4. Enriquecer los lotes consolidados
        const enrichedLotes = dedupedLotes.map(lote => {
            const item = lote.pedidos_b2b_items || {};
            const cabecera = lote.recepciones_fisicas_cabecera || {};
            const cod = String(item.producto_codigo || '').trim().toLowerCase();
            const masterInfo = masterMap[cod] || { cantBult: null, cantValor: null, iva: null };
            
            let ivaReal = masterInfo.iva;
            if (cabecera.pedido_id && facturasMap[cabecera.pedido_id] && facturasMap[cabecera.pedido_id][cod] !== undefined) {
                ivaReal = facturasMap[cabecera.pedido_id][cod];
            }
            if (ivaReal === null || ivaReal === undefined) {
                ivaReal = 21;
            }
            
            const override = overridesMap[lote.id];
            const finalCantBult = override ? override.cantBult : (item.cant_bult !== undefined && item.cant_bult !== null ? item.cant_bult : masterInfo.cantBult);
            const finalCantValor = override ? override.cantValor : (item.cant_valor !== undefined && item.cant_valor !== null ? item.cant_valor : masterInfo.cantValor);
            const valUnitarioFinal = (item.valor_unitario_ref !== undefined && item.valor_unitario_ref !== null && Number(item.valor_unitario_ref) > 0)
                ? item.valor_unitario_ref
                : (lote.costo_unitario ?? item.valor_unitario_ref ?? 0);

            return {
                ...lote,
                pedidos_b2b_items: {
                    ...item,
                    valor_unitario_ref: valUnitarioFinal,
                    cant_bult: finalCantBult,
                    cant_valor: finalCantValor,
                    iva_porcentaje: ivaReal
                }
            };
        });
        
        res.json(enrichedLotes);
    } catch (e) {
        console.error("Error proxy Supabase:", e.message);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/supabase/lotes/:id_corto', async (req, res) => {
    try {
        const id_corto = req.params.id_corto.trim();
        const key = (process.env.SUPABASE_SERVICE_KEY || '').trim();
        if (!key || key === 'MISSING_ENV_KEY') {
            return res.status(500).json({
                success: false,
                code: 'SUPABASE_KEY_MISSING',
                error: 'Falta configurar SUPABASE_SERVICE_KEY en el .env raíz del servidor.'
            });
        }
        // Generar rango mínimo y máximo del UUID para evitar usar ilike que falla en Postgres para tipos uuid
        const minUuid = id_corto + '-0000-0000-0000-000000000000';
        const maxUuid = id_corto + '-ffff-ffff-ffff-ffffffffffff';
        
        const url = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/recepciones_fisicas_items?select=id,cantidad_recibida,cantidad_esperada,recepciones_fisicas_cabecera(id,fecha_recepcion,numero_remito,pedido_id,estado,pedidos_b2b_cabecera(id,proveedor_id,proveedores(id,nombre))),pedidos_b2b_items(id,producto_codigo,producto_descripcion,unidad_ref,cant_bult,cant_valor)&id=gte.${minUuid}&id=lte.${maxUuid}&limit=1`;
        let data = [];
        try {
            const response = await supabaseFetch(url, { headers: { 'apikey': key, 'Authorization': `Bearer ${key}` } }, 1, 300, 6000);
            if (response.ok) {
                data = await response.json();
            }
        } catch (supaErr) {
            if (supaErr.code === 'SUPABASE_AUTH_ERROR' || supaErr.statusCode === 401 || supaErr.statusCode === 403) {
                return res.status(502).json({
                    success: false,
                    code: 'SUPABASE_AUTH_ERROR',
                    upstream_status: supaErr.statusCode || 401,
                    error: 'Error de autenticación con Supabase Proveedores',
                    message: `Supabase rechazó SUPABASE_SERVICE_KEY (HTTP ${supaErr.statusCode || 401}).`
                });
            }
        }
        if (!Array.isArray(data) || data.length === 0) {
            const fbRes = await db.query(
                `SELECT id, lote_id_supabase, costo_bruto_ingresado, costo_kilo_calculado, cantidad_total_lote,
                        impuesto_iva, fecha_vinculacion, lote_codigo_corto, proveedor_nombre,
                        articulo_descripcion, producto_codigo, numero_remito
                 FROM public.bunker_lotes_vinculos
                 WHERE UPPER(COALESCE(lote_codigo_corto, '')) = UPPER($1)
                    OR LOWER(COALESCE(lote_id_supabase::text, '')) LIKE LOWER($2)
                    OR LOWER(id::text) LIKE LOWER($2)
                 ORDER BY fecha_vinculacion DESC
                 LIMIT 1`,
                [id_corto, id_corto + '%']
            );
            if (fbRes.rows.length > 0) {
                const r = fbRes.rows[0];
                return res.json({
                    id: r.lote_id_supabase || r.id,
                    lote_codigo_corto: r.lote_codigo_corto,
                    cantidad_recibida: parseFloat(r.cantidad_total_lote) || 1,
                    cantidad_esperada: parseFloat(r.cantidad_total_lote) || 1,
                    recepciones_fisicas_cabecera: {
                        id: r.id,
                        fecha_recepcion: r.fecha_vinculacion,
                        numero_remito: r.numero_remito || 'S/R',
                        pedido_id: null,
                        estado: 'RECIBIDO',
                        pedidos_b2b_cabecera: {
                            id: null,
                            proveedor_id: null,
                            proveedores: { id: null, nombre: r.proveedor_nombre || 'Proveedor' }
                        }
                    },
                    pedidos_b2b_items: {
                        id: r.id,
                        producto_codigo: r.producto_codigo || '',
                        producto_descripcion: r.articulo_descripcion || '',
                        unidad_ref: 'Kilogramo',
                        cant_bult: 1,
                        cant_valor: parseFloat(r.cantidad_total_lote) || 1,
                        iva_porcentaje: parseFloat(r.impuesto_iva) || 21
                    }
                });
            }
        }
        if (data.length > 0) {
            const lote = data[0];
            const item = lote.pedidos_b2b_items || {};
            const provId = lote.recepciones_fisicas_cabecera?.pedidos_b2b_cabecera?.proveedor_id;
            const cod = String(item.producto_codigo || '').trim().toLowerCase();
            
            let masterInfo = { cantBult: null, cantValor: null, iva: null };
            if (provId && cod) {
                const masterUrl = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/tabla_maestra_operativa?select=datos_maestros&proveedor_id=eq.${provId}`;
                const masterRes = await supabaseFetch(masterUrl, { headers: { 'apikey': key, 'Authorization': `Bearer ${key}` } }, 1, 300, 6000);
                if (masterRes.ok) {
                    const rows = await masterRes.json();
                    const matchingRow = rows.find(r => r.datos_maestros && String(r.datos_maestros.codigo).trim().toLowerCase() === cod);
                    if (matchingRow && matchingRow.datos_maestros) {
                        masterInfo = {
                            cantBult: matchingRow.datos_maestros.cant_bult,
                            cantValor: matchingRow.datos_maestros.cant_valor,
                            iva: matchingRow.datos_maestros.iva || matchingRow.datos_maestros.IVA || null
                        };
                    }
                }
            }
            
            let ivaReal = masterInfo.iva || 21;
            
            // Buscar override local para el lote específico
            let override = null;
            try {
                const overrideRes = await db.query('SELECT cant_bult, cant_valor FROM public.lotes_presentacion_overrides WHERE lote_id_supabase = $1', [lote.id]);
                if (overrideRes.rows.length > 0) {
                    override = {
                        cantBult: parseFloat(overrideRes.rows[0].cant_bult),
                        cantValor: parseFloat(overrideRes.rows[0].cant_valor)
                    };
                }
            } catch (dbErr) {
                console.error("❌ Error leyendo override local para lote:", dbErr.message);
            }

            const finalCantBult = override ? override.cantBult : (item.cant_bult !== undefined && item.cant_bult !== null ? item.cant_bult : masterInfo.cantBult);
            const finalCantValor = override ? override.cantValor : (item.cant_valor !== undefined && item.cant_valor !== null ? item.cant_valor : masterInfo.cantValor);

            lote.pedidos_b2b_items = {
                ...item,
                cant_bult: finalCantBult,
                cant_valor: finalCantValor,
                iva_porcentaje: ivaReal
            };
            res.json(lote);
        } else {
            res.json(null);
        }
    } catch (e) {
        console.error("Error proxy Supabase ID:", e.message);
        res.status(500).json({ error: e.message });
    }
});

// ✅ ENDPOINT PARA REGISTRAR OVERRIDES MANUALES DE PRESENTACIÓN DESDE EL LOCAL
app.post('/api/supabase/lotes/override', async (req, res) => {
    const { lote_id_supabase, cant_bult, cant_valor } = req.body;
    
    if (!lote_id_supabase || cant_bult === undefined || cant_valor === undefined) {
        return res.status(400).json({ error: "Faltan campos requeridos: lote_id_supabase, cant_bult, cant_valor" });
    }
    
    try {
        await db.query(`
            INSERT INTO public.lotes_presentacion_overrides (lote_id_supabase, cant_bult, cant_valor, updated_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (lote_id_supabase)
            DO UPDATE SET cant_bult = EXCLUDED.cant_bult, cant_valor = EXCLUDED.cant_valor, updated_at = NOW()
        `, [lote_id_supabase, parseFloat(cant_bult), parseFloat(cant_valor)]);
        
        res.json({ success: true });
    } catch (e) {
        console.error("❌ Error registrando override de presentación:", e.message);
        res.status(500).json({ error: e.message });
    }
});

// Caché en memoria para optimizar el vinculador de ofertas y evitar caídas en reintentos rápidos (TTL 30s)
let cacheTodasReposicion = null;
let cacheTodasReposicionTimestamp = 0;
const CACHE_TTL_MS = 30000;

// ✅ PROXY A SUPABASE PARA TODAS LAS OFERTAS DE REPOSICIÓN VIVAS (FASE 4 - REGISTRADO ANTES POR PRECEDENCIA DE WILDCARD)
app.get('/api/supabase/reposicion/todas', async (req, res) => {
    try {
        const now = Date.now();
        if (cacheTodasReposicion && (now - cacheTodasReposicionTimestamp < CACHE_TTL_MS)) {
            if (cacheTodasReposicion.length === 0 || (
                cacheTodasReposicion[0].procedencia !== undefined &&
                cacheTodasReposicion[0].pallet !== undefined &&
                cacheTodasReposicion[0].precio_neto !== undefined &&
                cacheTodasReposicion[0].regla !== undefined
            )) {
                console.log("⚡ [Proxy Supabase] Retornando cotizaciones desde caché en memoria (Evitando cuello de botella HTTPS)");
                return res.json(cacheTodasReposicion);
            } else {
                console.log("⚡ [Proxy Supabase] Caché en memoria invalidada por actualización de esquema.");
                cacheTodasReposicion = null;
            }
        }

        const key = (process.env.SUPABASE_SERVICE_KEY || 'MISSING_ENV_KEY').trim();
        const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };

        // Obtener cotizaciones de forma paginada en bucle para evitar el límite de 1000 de Supabase y barrer el mercado real (2728+ registros)
        let cotizaciones = [];
        let offset = 0;
        let hasMore = true;
        
        while (hasMore && cotizaciones.length < 5000) {
            const url = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/tabla_maestra_operativa?select=id,proveedor_id,nombre_proveedor,timestamp_extraccion,datos_maestros&limit=1000&offset=${offset}`;
            const response = await supabaseFetch(url, { headers });
            if (!response.ok) throw new Error(await response.text());
            
            const rows = await response.json();
            cotizaciones = cotizaciones.concat(rows);
            
            if (rows.length < 1000) {
                hasMore = false;
            } else {
                offset += 1000;
            }
        }

        if (cotizaciones.length === 0) {
            return res.json([]);
        }

        // Obtener la curaduría humana de unidades para normalizar posibles ambigüedades
        const proveedoresIds = [...new Set(cotizaciones.map(c => c.proveedor_id).filter(Boolean))];
        let excepciones = [];
        if (proveedoresIds.length > 0) {
            const excUrl = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/curaduria_excepciones?select=proveedor_id,producto_codigo,unidad_fijada&proveedor_id=in.(${proveedoresIds.join(',')})`;
            const excRes = await supabaseFetch(excUrl, { headers });
            if (excRes.ok) {
                excepciones = await excRes.json();
            }
        }

        // Crear mapa O(N) para indexación
        const curaduriaMap = new Map();
        excepciones.forEach(exc => {
            const keyMap = `${exc.proveedor_id}_${String(exc.producto_codigo).trim().toLowerCase()}`;
            curaduriaMap.set(keyMap, exc.unidad_fijada);
        });

        // Normalizar y estructurar tarifas de forma homogénea y determinista
        const cotizacionesNormalizadas = cotizaciones.map(row => {
            const dm = { ...row.datos_maestros };
            const skuProveedorRaw = dm.codigo || dm.sku || dm.código || "";
            const skuClean = String(skuProveedorRaw).trim().toLowerCase();
            const keyMap = `${row.proveedor_id}_${skuClean}`;
            
            // Intercepción por Curaduría de Unidad
            if (curaduriaMap.has(keyMap) && curaduriaMap.get(keyMap)) {
                dm.unidad = curaduriaMap.get(keyMap);
            }
            
            // Eje C: Algoritmo de Recencia y Semáforo de Envejecimiento (Tabla Maestra V4.1)
            const now = new Date();
            
            // 1. Antigüedad Precio: Días corridos de fecha_modificacion_precio
            const fechaPrecioRaw = dm.fecha_modificacion_precio || row.timestamp_extraccion;
            const diasAntiguedad = Math.max(0, Math.floor((now - new Date(fechaPrecioRaw)) / (1000 * 60 * 60 * 24)));
            
            // 2. Última Actualización: Días corridos de ultima_actualizacion_origen
            const fechaActualizacionRaw = dm.ultima_actualizacion_origen || row.timestamp_extraccion;
            const diasActualizacion = Math.max(0, Math.floor((now - new Date(fechaActualizacionRaw)) / (1000 * 60 * 60 * 24)));
            
            // Convertir precio String Argentino a Float (ej: "3.423,77" -> 3423.77)
            let precioUnitarioVal = 0;
            if (dm.precio) {
                const cleanPrice = String(dm.precio).replace(/\./g, '').replace(',', '.');
                precioUnitarioVal = parseFloat(cleanPrice) || 0;
            }

            return {
                oferta_id: row.id,
                proveedor_id: row.proveedor_id,
                nombre_proveedor: row.nombre_proveedor,
                sku_proveedor: skuProveedorRaw,
                descripcion: dm.descripcion,
                precio_unitario: precioUnitarioVal,
                unidad_medida: dm.unidad || dm.unidad_medida || dm.uom || "",
                dias_antiguedad: diasAntiguedad,
                dias_actualizacion: diasActualizacion,
                valido_hasta: dm.ultima_actualizacion_origen || row.timestamp_extraccion,
                rubro: dm.rubro || "",
                cant_bult: dm.cant_bult !== undefined && dm.cant_bult !== null ? dm.cant_bult : "",
                cant_valor: dm.cant_valor !== undefined && dm.cant_valor !== null ? dm.cant_valor : "",
                procedencia: dm['país_de_origen'] || dm.pais_de_origen || dm.procedencia || dm.pais_origen || dm.origen || "",
                marca: dm.marca || dm.marca_producto || dm.brand || "",
                tipo_envase: dm.tipo_envase || dm.envase || dm.empaque || "",
                presentacion: dm.presentacion || dm.formato || "",
                iva: dm.iva || dm.IVA || dm.alicuota_iva || "",
                promo: dm.promo || dm.precio_promo || dm.precio_promocional || "",
                descuento: dm.descuento || dm.bonificacion || "",
                ean_unidad: dm['ean-unidad'] || dm.ean_unidad || dm.ean || "",
                dun_bulto: dm['dun-bulto'] || dm.dun_bulto || dm.dun || "",
                certificado: dm.certificado || "",
                pallet: dm.pallet || "",
                sector: dm.sector || "",
                precio_neto: dm['precio_s/iva_s/desc'] || "",
                regla: dm.regla || dm.regla_negocio || "",
                _estado_delta: dm._estado_delta || "INTACTO",
                _timestamp: row.timestamp_extraccion || dm.ultima_actualizacion_origen || new Date().toISOString(),
                _proveedor: row.nombre_proveedor
            };
        });

        // Guardar en la caché global en memoria con timestamp actual
        cacheTodasReposicion = cotizacionesNormalizadas;
        cacheTodasReposicionTimestamp = now;

        console.log("⚡ [PROXY-SUPABASE-REPOSICION] Cotizaciones mapeadas con Fuzzy Getters oficiales B4.1. Total:", cotizacionesNormalizadas.length);

        res.json(cotizacionesNormalizadas);
    } catch (e) {
        console.error("Error en proxy de todas las ofertas de reposición:", e.message);
        res.status(500).json({ error: e.message });
    }
});

// ✅ PROXY A SUPABASE PARA OFERTAS DE REPOSICIÓN VIVAS POR SKU (WILDCARD)
app.get('/api/supabase/reposicion/:sku', async (req, res) => {
    try {
        const sku = String(req.params.sku || '').trim().toLowerCase();
        if (!sku) {
            return res.json([]);
        }

        const key = (process.env.SUPABASE_SERVICE_KEY || 'MISSING_ENV_KEY').trim();
        const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };

        // 1. Obtener registros de la tabla maestra filtrando por SKU (liberado de bajas estáticas)
        const url = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/tabla_maestra_operativa?select=id,proveedor_id,nombre_proveedor,timestamp_extraccion,datos_maestros&or=(datos_maestros->>codigo.eq.${sku},datos_maestros->>sku.eq.${sku},datos_maestros->>c\u00f3digo.eq.${sku})`;
        
        const response = await supabaseFetch(url, { headers });
        if (!response.ok) throw new Error(await response.text());
        const cotizaciones = await response.json();

        if (cotizaciones.length === 0) {
            return res.json([]);
        }

        // 2. Obtener la curaduría humana de unidades para normalizar posibles ambigüedades
        const proveedoresIds = [...new Set(cotizaciones.map(c => c.proveedor_id).filter(Boolean))];
        let excepciones = [];
        if (proveedoresIds.length > 0) {
            const excUrl = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/curaduria_excepciones?select=proveedor_id,producto_codigo,unidad_fijada&proveedor_id=in.(${proveedoresIds.join(',')})`;
            const excRes = await supabaseFetch(excUrl, { headers });
            if (excRes.ok) {
                excepciones = await excRes.json();
            }
        }

        // 3. Crear mapa O(N) para indexación
        const curaduriaMap = new Map();
        excepciones.forEach(exc => {
            const keyMap = `${exc.proveedor_id}_${String(exc.producto_codigo).trim().toLowerCase()}`;
            curaduriaMap.set(keyMap, exc.unidad_fijada);
        });

        // 4. Normalizar y estructurar tarifas de forma homogénea y determinista
        const cotizacionesNormalizadas = cotizaciones.map(row => {
            const dm = { ...row.datos_maestros };
            const skuProveedorRaw = dm.codigo || dm.sku || dm.código || "";
            const skuClean = String(skuProveedorRaw).trim().toLowerCase();
            const keyMap = `${row.proveedor_id}_${skuClean}`;
            
            // Intercepción por Curaduría de Unidad
            if (curaduriaMap.has(keyMap) && curaduriaMap.get(keyMap)) {
                dm.unidad = curaduriaMap.get(keyMap);
            }
            
            // Eje C: Algoritmo de Recencia y Semáforo de Envejecimiento (Tabla Maestra V4.1)
            const now = new Date();
            
            // 1. Antigüedad Precio: Días corridos de fecha_modificacion_precio
            const fechaPrecioRaw = dm.fecha_modificacion_precio || row.timestamp_extraccion;
            const diasAntiguedad = Math.max(0, Math.floor((now - new Date(fechaPrecioRaw)) / (1000 * 60 * 60 * 24)));
            
            // 2. Última Actualización: Días corridos de ultima_actualizacion_origen
            const fechaActualizacionRaw = dm.ultima_actualizacion_origen || row.timestamp_extraccion;
            const diasActualizacion = Math.max(0, Math.floor((now - new Date(fechaActualizacionRaw)) / (1000 * 60 * 60 * 24)));
            
            // Convertir precio String Argentino a Float (ej: "3.423,77" -> 3423.77)
            let precioUnitarioVal = 0;
            if (dm.precio) {
                const cleanPrice = String(dm.precio).replace(/\./g, '').replace(',', '.');
                precioUnitarioVal = parseFloat(cleanPrice) || 0;
            }

            return {
                oferta_id: row.id,
                proveedor_id: row.proveedor_id,
                nombre_proveedor: row.nombre_proveedor,
                sku_proveedor: skuProveedorRaw,
                descripcion: dm.descripcion,
                precio_unitario: precioUnitarioVal,
                unidad_medida: dm.unidad || dm.unidad_medida || dm.uom || "",
                dias_antiguedad: diasAntiguedad,
                dias_actualizacion: diasActualizacion,
                valido_hasta: dm.ultima_actualizacion_origen || row.timestamp_extraccion,
                rubro: dm.rubro || "",
                cant_bult: dm.cant_bult !== undefined && dm.cant_bult !== null ? dm.cant_bult : "",
                cant_valor: dm.cant_valor !== undefined && dm.cant_valor !== null ? dm.cant_valor : "",
                procedencia: dm['país_de_origen'] || dm.pais_de_origen || dm.procedencia || dm.pais_origen || dm.origen || "",
                marca: dm.marca || dm.marca_producto || dm.brand || "",
                tipo_envase: dm.tipo_envase || dm.envase || dm.empaque || "",
                presentacion: dm.presentacion || dm.formato || "",
                iva: dm.iva || dm.IVA || dm.alicuota_iva || "",
                promo: dm.promo || dm.precio_promo || dm.precio_promocional || "",
                descuento: dm.descuento || dm.bonificacion || "",
                ean_unidad: dm['ean-unidad'] || dm.ean_unidad || dm.ean || "",
                dun_bulto: dm['dun-bulto'] || dm.dun_bulto || dm.dun || "",
                certificado: dm.certificado || "",
                pallet: dm.pallet || "",
                sector: dm.sector || "",
                precio_neto: dm['precio_s/iva_s/desc'] || "",
                regla: dm.regla || dm.regla_negocio || "",
                _estado_delta: dm._estado_delta || "INTACTO",
                _timestamp: row.timestamp_extraccion || dm.ultima_actualizacion_origen || new Date().toISOString(),
                _proveedor: row.nombre_proveedor
            };
        });

        console.log("⚡ [PROXY-SUPABASE-REPOSICION] Cotizaciones mapeadas con Fuzzy Getters oficiales B4.1. Total:", cotizacionesNormalizadas.length);

        res.json(cotizacionesNormalizadas);
    } catch (e) {
        console.error("Error en proxy de ofertas de reposición:", e.message);
        res.status(500).json({ error: e.message });
    }
});


// Middleware para deshabilitar caché en archivos HTML y JS
app.use((req, res, next) => {
    if (req.url.endsWith('.html') || req.url.endsWith('.js') || req.url.endsWith('.css')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    next();
});

// Configuración de archivos estáticos y rutas base
app.use(express.static(__dirname));
app.use('/pages', express.static(path.join(__dirname, 'pages')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/css', express.static(path.join(__dirname, 'css')));


// Redirigir la raíz a la página principal de producción
app.get('/', (req, res) => {
    res.redirect('/pages/produccion.html');
});

// Endpoint para obtener la IP local del servidor
app.get('/api/config/network-ip', (req, res) => {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    let networkIp = 'localhost';

    // Buscar una dirección IPv4 de red local válida (excluyendo Tailscale/APIPA 169.254.x.x)
    Object.keys(interfaces).forEach((ifname) => {
        if (/tailscale|loopback|vethernet|wsl/i.test(ifname)) return;
        interfaces[ifname].forEach((iface) => {
            // Saltar direcciones internas (127.0.0.1) y no-IPv4
            if ('IPv4' !== iface.family || iface.internal) {
                return;
            }
            if (String(iface.address).startsWith('169.254.')) {
                return;
            }
            networkIp = iface.address;
        });
    });

    res.json({
        ip: networkIp,
        publicUrl: 'https://inventario.lamdaser.com'
    });
});

// Ruta para la vista móvil de inventario
app.get('/inventario-movil', (req, res) => {
    res.redirect('/pages/inventario-movil.html');
});

// Middleware para logging detallado
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    next();
});

// Disparador reactivo automático en 2do plano hacia Portal B2B ante ajustes de stock y producción
const { createB2BAutoSyncMiddleware, triggerB2BSync } = require('../actualizaPrecios/b2bAutoSyncTrigger');
app.use(createB2BAutoSyncMiddleware('produccion'));

// ✅ Middleware para ajustar solo si es necesario (solo si no se rompe)
app.use('/api/produccion', produccionRoutes); // ← Registro completo sin manipular req.url

// Otras rutas de usuarios
app.use('/api', usuariosRoutes);

/**
 * CONFIGURACIÓN CORS — TOPOLOGÍA DE RED
 * Dominio externo oficial: lamda-logistica.tplinkdns.com (DDNS TP-Link)
 * Puerto de salida público: 3005 (Port Forwarding en router)
 * Host binding: 0.0.0.0 (NUNCA cambiar a localhost, bloquearía acceso externo)
 * 
 * NOTA: Este módulo usa cors() abierto porque recibe requests desde múltiples
 * orígenes dinámicos (inventario móvil, WebSocket, módulos internos).
 */
app.use(cors());

// Manejo de errores global
app.use((err, req, res, next) => {
    console.error('Error:', err.message);
    console.error('Stack:', err.stack);
    res.status(500).json({
        error: 'Error interno del servidor',
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

// Configuración de WebSocket
io.on('connection', (socket) => {
    console.log('🔌 [WS] Cliente conectado - Socket ID:', socket.id);
    console.log('📊 [WS] Sesiones activas:', inventarioSesiones.size);

    // Detectar tipo de inventario por sessionId y manejar de forma unificada
    function detectarTipoInventario(sessionId) {
        return sessionId && sessionId.startsWith('inv_ing_') ? 'ingredientes' : 'articulos';
    }

    // PC inicia una sesión de inventario (UNIFICADO para artículos e ingredientes)
    socket.on('iniciar_inventario', (data) => {
        const tiempoInicio = Date.now();
        const sessionId = data.sessionId;
        const usuario = data.usuario || null; // Ahora es un objeto {id, nombre}
        const sectores = data.sectores || null; // Para ingredientes
        const tipoInventario = detectarTipoInventario(sessionId);

        console.log(`🚀 [WS] ===== NUEVA SESIÓN DE INVENTARIO (${tipoInventario.toUpperCase()}) =====`);
        console.log('🆔 [WS] Session ID:', sessionId);
        console.log('👤 [WS] Usuario recibido:', JSON.stringify(usuario));
        console.log('🏷️ [WS] Sectores:', sectores);
        console.log('🔌 [WS] Socket PC:', socket.id);
        console.log('⏱️ [WS] Timestamp inicio:', new Date(tiempoInicio).toISOString());

        // Verificar si ya existe la sesión
        if (inventarioSesiones.has(sessionId)) {
            console.log('⚠️ [WS] Sesión existente, actualizando datos...');
            const sesionExistente = inventarioSesiones.get(sessionId);
            sesionExistente.pcSocketId = socket.id;
            sesionExistente.usuario = usuario; // Guardar objeto completo
            sesionExistente.timestampActualizacion = tiempoInicio;
            if (tipoInventario === 'ingredientes') {
                sesionExistente.sectores = sectores;
                sesionExistente.tipo = 'ingredientes';
            }
        } else {
            console.log('✨ [WS] Creando nueva sesión...');
            const sesionData = {
                pcSocketId: socket.id,
                usuario: usuario, // Guardar objeto completo {id, nombre}
                items: new Map(),
                fechaInicio: new Date(),
                timestampCreacion: tiempoInicio,
                estado: 'activa'
            };

            // Agregar datos específicos para ingredientes
            if (tipoInventario === 'ingredientes') {
                sesionData.sectores = sectores;
                sesionData.ingredientes = data.ingredientes || []; // Guardar lista maestra
                sesionData.tipo = 'ingredientes';
            }

            inventarioSesiones.set(sessionId, sesionData);
        }

        const tiempoGuardado = Date.now() - tiempoInicio;
        console.log(`⏱️ [WS] Sesión guardada en ${tiempoGuardado}ms`);

        // CORRECCIÓN CRÍTICA: Usar setImmediate para asegurar que la sesión 
        // esté completamente persistida antes de notificar a la PC
        setImmediate(() => {
            // Emitir respuesta unificada con datos específicos según el tipo
            const respuesta = { sessionId, usuario }; // Enviar objeto usuario completo
            if (tipoInventario === 'ingredientes') {
                respuesta.sectores = sectores;
            }

            socket.emit('inventario_iniciado', respuesta);

            const tiempoTotal = Date.now() - tiempoInicio;
            console.log(`✅ [WS] Sesión de ${tipoInventario} iniciada exitosamente en ${tiempoTotal}ms`);
            console.log('📊 [WS] Total sesiones activas:', inventarioSesiones.size);
        });
    });

    // Móvil se une a una sesión (UNIFICADO)
    socket.on('unirse_inventario', (data) => {
        const tiempoUnion = Date.now();
        const sessionId = data.sessionId;
        const intentoNumero = data.intento || 1;

        console.log('📱 [WS] ===== MÓVIL INTENTANDO UNIRSE =====');
        console.log('🆔 [WS] Session ID solicitado:', sessionId);
        console.log('🔌 [WS] Socket Móvil:', socket.id);
        console.log('🔢 [WS] Intento número:', intentoNumero);
        console.log('⏱️ [WS] Timestamp unión:', new Date(tiempoUnion).toISOString());
        console.log('📊 [WS] Sesiones activas:', Array.from(inventarioSesiones.keys()));
        console.log('🔍 [WS] Datos completos recibidos del móvil:', JSON.stringify(data, null, 2));

        const session = inventarioSesiones.get(sessionId);

        if (session) {
            const tiempoDesdeCreacion = tiempoUnion - (session.timestampCreacion || tiempoUnion);
            console.log('✅ [WS] Datos de la sesión encontrada:');
            console.log('- Usuario:', session.usuario);
            console.log('- Estado:', session.estado);
            console.log('- Fecha inicio:', session.fechaInicio);
            console.log('- PC Socket:', session.pcSocketId);
            console.log('- Tipo:', session.tipo || 'articulos');
            console.log('- Sectores:', session.sectores);
            console.log(`⏱️ [WS] Tiempo desde creación de sesión: ${tiempoDesdeCreacion}ms`);

            // ADVERTENCIA: Detectar posibles race conditions
            if (tiempoDesdeCreacion < 100) {
                console.warn(`⚠️ [WS] ADVERTENCIA: Unión muy rápida (${tiempoDesdeCreacion}ms) - Posible race condition evitada`);
            }
        }

        if (!session) {
            console.error('❌ [WS] Error: Sesión no encontrada');
            console.log('🔍 [WS] Sesiones disponibles:', Array.from(inventarioSesiones.keys()));
            socket.emit('error_conexion', {
                mensaje: 'Sesión no encontrada o expirada',
                sessionId: sessionId
            });
            return;
        }

        if (session.estado !== 'activa') {
            console.error('❌ [WS] Error: Sesión no está activa');
            socket.emit('error_conexion', {
                mensaje: 'La sesión ya no está activa',
                sessionId: sessionId
            });
            return;
        }

        console.log('✅ [WS] Sesión encontrada y válida');
        console.log('👤 [WS] Usuario de la sesión:', JSON.stringify(session.usuario));

        // Registrar el móvil en la sesión
        session.mobileSocketId = socket.id;

        // CORRECCIÓN: Confirmar conexión al móvil con objeto usuario completo
        const respuestaConexion = {
            sessionId,
            usuario: session.usuario, // Enviar objeto completo {id, nombre}
            sectores: session.sectores, // Enviar sectores también
            ingredientes: session.ingredientes, // Enviar Lista Maestra para auditoría
            fechaInicio: session.fechaInicio,
            timestampCreacion: session.timestampCreacion
        };

        // Para ingredientes, incluir información de sectores
        if (session.tipo === 'ingredientes' && session.sectores) {
            respuestaConexion.sectores = session.sectores;
            console.log('🏢 [WS] Incluyendo sectores en respuesta:', session.sectores);
        } else if ((!session.tipo || session.tipo === 'articulos') && session.items) {
            // Para artículos, enviar los ya escaneados para tolerancia a fallos
            respuestaConexion.articulosContados = Array.from(session.items.values());
            console.log(`📦 [WS] Incluyendo ${respuestaConexion.articulosContados.length} artículos contados para sincronización móvil`);
        }

        console.log('📤 [WS] Enviando conexion_exitosa con datos:', JSON.stringify(respuestaConexion));
        socket.emit('conexion_exitosa', respuestaConexion);

        // Notificar a la PC
        io.to(session.pcSocketId).emit('movil_conectado', {
            mensaje: 'Dispositivo móvil conectado',
            socketId: socket.id
        });

        console.log('🎉 [WS] Móvil conectado exitosamente a la sesión');
    });

    // Móvil envía un item escaneado (UNIFICADO para artículos e ingredientes)
    socket.on('articulo_escaneado', (data) => {
        const { sessionId, articulo, ingrediente, cantidad } = data;
        const item = articulo || ingrediente; // Puede ser artículo o ingrediente
        const tipoInventario = detectarTipoInventario(sessionId);

        console.log(`📦 [WS] ===== NUEVO ${tipoInventario.toUpperCase().slice(0, -1)} ESCANEADO =====`);
        console.log('🆔 [WS] Session ID:', sessionId);
        console.log('📝 [WS] Item:', item?.nombre);
        console.log('🔢 [WS] Cantidad:', cantidad);
        console.log('🏷️ [WS] Tipo detectado:', tipoInventario);

        const session = inventarioSesiones.get(sessionId);

        if (!session) {
            console.error(`❌ [WS] Error: Sesión no encontrada para ${tipoInventario.slice(0, -1)}`);
            socket.emit('error_conexion', { mensaje: 'Sesión no válida' });
            return;
        }

        if (session.estado !== 'activa') {
            console.error(`❌ [WS] Error: Sesión no activa para ${tipoInventario.slice(0, -1)}`);
            socket.emit('error_conexion', { mensaje: 'La sesión no está activa' });
            return;
        }

        // Guardar en la sesión con clave apropiada según el tipo
        const key = tipoInventario === 'ingredientes' ?
            (item.id || item.codigo) :
            item.numero;

        session.items.set(key, {
            [tipoInventario === 'ingredientes' ? 'ingrediente' : 'articulo']: item,
            cantidad,
            timestamp: new Date()
        });

        console.log(`📤 [WS] Enviando actualización a PC (${item.nombre} | Bultos: ${item.total_bultos_contados || 0})...`);

        const eventoData = {
            sessionId,
            [tipoInventario === 'ingredientes' ? 'ingrediente' : 'articulo']: item,
            cantidad,
            timestamp: new Date()
        };

        // Retransmisión bidireccional en espejo
        if (session.pcSocketId && socket.id !== session.pcSocketId) {
            io.to(session.pcSocketId).emit('nuevo_articulo', eventoData);
        }
        if (session.mobileSocketId && socket.id !== session.mobileSocketId) {
            io.to(session.mobileSocketId).emit('nuevo_articulo', eventoData);
        }

        // Solo confirmar y resetear formulario en el móvil si se finalizó explícitamente el item
        if (data.finalizar_item) {
            socket.emit('articulo_confirmado', {
                [tipoInventario === 'ingredientes' ? 'ingrediente' : 'articulo']: item,
                cantidad,
                nombre: item.nombre
            });
        }

        console.log(`✅ [WS] ${tipoInventario.slice(0, -1)} procesado exitosamente (Total en sesión: ${session.items.size})`);
    });

    // NUEVO: Hidratar estado del servidor desde la PC
    socket.on('hydrate_server_state', (data) => {
        const { sessionId, items } = data;
        const session = inventarioSesiones.get(sessionId);
        
        if (session && items && Array.isArray(items)) {
            console.log(`💧 [WS] Hidratando sesión ${sessionId} con ${items.length} artículos desde PC`);
            const tipoInventario = detectarTipoInventario(sessionId);
            
            items.forEach(itemData => {
                const item = itemData.articulo || itemData.ingrediente;
                if (!item) return;
                
                const cantidad = itemData.cantidad;
                const key = tipoInventario === 'ingredientes' ? (item.id || item.codigo) : item.numero;
                
                session.items.set(key, {
                    [tipoInventario === 'ingredientes' ? 'ingrediente' : 'articulo']: item,
                    cantidad,
                    timestamp: new Date()
                });
            });
            
            console.log(`✅ [WS] Sesión hidratada. Total items ahora: ${session.items.size}`);
            
            // Mirroring al móvil si está conectado
            if (session.mobileSocketId) {
                console.log(`📦 [WS] Sincronizando móvil con estado hidratado...`);
                const itemsAEnviar = Array.from(session.items.values());
                io.to(session.mobileSocketId).emit('conexion_exitosa', {
                    sessionId,
                    usuario: session.usuario,
                    sectores: session.sectores,
                    articulosContados: itemsAEnviar
                });
            }
        }
    });

    // Relay de datos de inventario (PC -> Móvil)
    socket.on('sincronizar_datos_inventario', (data) => {
        const { sessionId, ingredientes } = data;
        const session = inventarioSesiones.get(sessionId);

        if (session && session.mobileSocketId) {
            console.log(`📦 [WS] Sincronizando ${ingredientes.length} ingredientes con móvil...`);
            io.to(session.mobileSocketId).emit('datos_inventario', { ingredientes });
        }
    });

    // Relay de solicitud de impresión (Móvil -> PC)
    socket.on('solicitar_impresion', (data) => {
        const { sessionId, ingredientes } = data; // Legacy support
        // ...
    });

    // ✅ FIX: Listener específico para impresión de etiquetas de ingredientes
    // ✅ FIX: Listener específico para impresión de etiquetas de ingredientes
    // ✅ FIX: Listener específico para impresión de etiquetas de ingredientes
    socket.on('imprimir_etiqueta_ingrediente', async (data) => {
        const { sessionId, ingrediente } = data; // Ahora esperamos el objeto ingrediente completo
        const session = inventarioSesiones.get(sessionId);

        // TRAZA NIVEL 2: Recepción
        console.log(`TRAZA-SERVER: Orden de impresión recibida del cliente [${socket.id}] para [${ingrediente?.id}]`);
        console.log(`🖨️ [WS] Solicitud de impresión para: ${ingrediente?.nombre || 'Desconocido'}`);

        // NO Relay a PC (Centralizamos la impresión en el Servidor para soportar Móvil y evitar duplicados)
        // Si la PC necesita feedback, escuchará 'print_status'

        if (ingrediente) {
            try {
                // Usar módulo HTTP nativo para máxima compatibilidad (Node < 18 fallback)
                const http = require('http');
                const postData = JSON.stringify({
                    ingredienteId: ingrediente.id,
                    nombre: ingrediente.nombre,
                    codigo: ingrediente.codigo,
                    sector: ingrediente.sector_letra || ingrediente.sector_id || ''
                });

                // TRAZA NIVEL 3: Puente
                console.log(`TRAZA-SERVER: Enviando orden final al puerto 3000 con los datos: ${postData}`);

                const options = {
                    hostname: 'localhost',
                    port: 3000,
                    path: '/api/etiquetas/ingrediente',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData)
                    }
                };

                const req = http.request(options, (res) => {
                    let responseData = '';
                    res.on('data', (chunk) => { responseData += chunk; });
                    res.on('end', () => {
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            console.log("✅ [IMP] Orden enviada a localhost:3000 con éxito.");
                            socket.emit('print_status', { success: true, msg: 'Imprimiendo...' });
                        } else {
                            console.error(`TRAZA-SERVER-ERROR: Servicio de impresión respondió con error: Status ${res.statusCode} - ${responseData}`);
                            console.error(`❌ [IMP] Error del servicio (Status: ${res.statusCode}): ${responseData}`);
                            socket.emit('print_status', { success: false, msg: 'Error en servicio de impresión' });
                        }
                    });
                });

                req.on('error', (e) => {
                    console.error(`TRAZA-SERVER-ERROR: Error de conexión con puerto 3000: ${e.message}`);
                    console.error(`❌ [IMP] Error de conexión con localhost:3000: ${e.message}`);
                    socket.emit('print_status', { success: false, msg: 'Error: Servicio de impresión no disponible' });
                });

                // Write data to request body
                req.write(postData);
                req.end();

            } catch (err) {
                console.error("TRAZA-SERVER-ERROR: Excepción crítica server-side:", err.message);
                console.error("❌ [IMP] Excepción crítica al intentar imprimir:", err.message);
                socket.emit('print_status', { success: false, msg: 'Error interno de impresión' });
            }
        } else {
            console.warn("⚠️ [IMP] Datos de ingrediente inválidos/faltantes");
            socket.emit('print_status', { success: false, msg: 'Datos inválidos' });
        }
    });

    // NUEVO: Listener para impresión de sector (Relay a puerto 3000)
    socket.on('imprimir_etiqueta_sector', async (data) => {
        console.log(`🖨️ [WS] Imprimir etiqueta SECTOR: ${data.sector}`);
        try {
            // Enviamos al endpoint genérico de impresión de texto o específico si existe
            // Asumo /api/etiquetas/sector o similar. Si no, ajustar a /texto
            await fetch('http://localhost:3000/api/etiquetas/sector', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sector: data.sector })
            });
            console.log("✅ [IMP] Orden imprimir sector enviada");
        } catch (e) {
            console.error("❌ [IMP] Error al imprimir sector:", e.message);
        }
    });

    // PC o Móvil solicita finalización remota de inventario
    socket.on('finalizar_inventario', (data) => {
        const sessionId = data.sessionId;
        console.log('🏁 [WS] ===== SOLICITUD FINALIZAR INVENTARIO =====');
        console.log('🆔 [WS] Session ID:', sessionId);

        const session = inventarioSesiones.get(sessionId);

        if (!session) {
            console.log('⚠️ [WS] No se encontró la sesión a finalizar');
            return;
        }

        // Si la PC está conectada y el que llamó fue el móvil, ordenar a la PC que ejecute el cierre
        if (session.pcSocketId && socket.id !== session.pcSocketId) {
            console.log('💻 [WS] Enviando solicitud_cierre_remoto a PC...');
            io.to(session.pcSocketId).emit('solicitud_cierre_remoto', { sessionId });
        }
    });

    // Notificar fin de inventario con datos de reporte (Bidireccional: PC <-> Móvil)
    socket.on('notificar_fin_inventario', (data) => {
        const { sessionId, resultado } = data;
        console.log('🎉 [WS] Notificando fin de inventario con reporte para session:', sessionId);
        const session = inventarioSesiones.get(sessionId);
        if (session) {
            // Re-emitir a PC si el emisor no fue la PC
            if (session.pcSocketId && socket.id !== session.pcSocketId) {
                console.log('💻 [WS] Enviando inventario_finalizado_con_reporte a PC...');
                io.to(session.pcSocketId).emit('inventario_finalizado_con_reporte', {
                    sessionId,
                    resultado
                });
            }
            // Re-emitir a móvil si el emisor no fue el móvil
            if (session.mobileSocketId && socket.id !== session.mobileSocketId) {
                console.log('📱 [WS] Enviando inventario_finalizado_con_reporte a Móvil...');
                io.to(session.mobileSocketId).emit('inventario_finalizado_con_reporte', {
                    sessionId,
                    resultado
                });
            }

            session.estado = 'finalizada';

            // Limpieza diferida de la memoria de sesión
            setTimeout(() => {
                if (inventarioSesiones.has(sessionId)) {
                    inventarioSesiones.delete(sessionId);
                    console.log(`🧹 [WS] Sesión ${sessionId} eliminada de memoria tras cierre exitoso.`);
                }
            }, 10000);
        }
    });

    // NUEVO: Cancelar inventario (Sin guardar nada)
    socket.on('cancelar_inventario', (data) => {
        const sessionId = data.sessionId;
        console.log('⛔ [WS] ===== CANCELANDO INVENTARIO =====');
        console.log('🆔 [WS] Session ID:', sessionId);

        const session = inventarioSesiones.get(sessionId);
        if (!session) return;

        // Notificar a ambos
        if (session.pcSocketId) io.to(session.pcSocketId).emit('inventario_cancelado');
        if (session.mobileSocketId) io.to(session.mobileSocketId).emit('inventario_cancelado');

        // Limpiar sesión inmediatamente
        inventarioSesiones.delete(sessionId);
        console.log('🗑️ [WS] Sesión eliminada por cancelación');
    });

    // Limpiar cuando se desconectan
    socket.on('disconnect', () => {
        const tiempoDesconexion = Date.now();
        console.log('👋 [WS] ===== CLIENTE DESCONECTADO =====');
        console.log('🔌 [WS] Socket ID:', socket.id);
        console.log('⏱️ [WS] Timestamp desconexión:', new Date(tiempoDesconexion).toISOString());

        // Limpiar sesiones donde este socket era parte
        for (const [sessionId, session] of inventarioSesiones.entries()) {
            if (session.pcSocketId === socket.id) {
                console.log('💻 [WS] PC desconectada de sesión:', sessionId);

                // CORRECCIÓN: No eliminar inmediatamente, dar tiempo para reconexión
                session.estado = 'esperando_reconexion';
                session.timestampDesconexion = tiempoDesconexion;

                // Si se desconecta la PC, notificar al móvil pero NO cerrar sesión aún
                if (session.mobileSocketId) {
                    console.log('📱 [WS] Notificando al móvil sobre desconexión temporal de PC');
                    io.to(session.mobileSocketId).emit('pc_desconectada_temporal', {
                        mensaje: 'PC desconectada temporalmente. Esperando reconexión...'
                    });
                }

                // CORRECCIÓN: Aumentar timeout de 5s a 60s para permitir reconexiones
                setTimeout(() => {
                    const sesionActual = inventarioSesiones.get(sessionId);
                    // Solo eliminar si sigue en estado de espera (no se reconectó)
                    if (sesionActual && sesionActual.estado === 'esperando_reconexion') {
                        console.log('🗑️ [WS] Sesión eliminada por timeout (60s sin reconexión):', sessionId);
                        inventarioSesiones.delete(sessionId);

                        // Notificar al móvil que la sesión expiró definitivamente
                        if (sesionActual.mobileSocketId) {
                            io.to(sesionActual.mobileSocketId).emit('sesion_expirada', {
                                mensaje: 'La sesión ha expirado. La PC no se reconectó.'
                            });
                        }
                    } else if (sesionActual) {
                        console.log('✅ [WS] Sesión se reconectó exitosamente, no se eliminó:', sessionId);
                    }
                }, 60000); // 60 segundos en lugar de 5

            } else if (session.mobileSocketId === socket.id) {
                console.log('📱 [WS] Móvil desconectado de sesión:', sessionId);
                // Si se desconecta el móvil, notificar a la PC
                io.to(session.pcSocketId).emit('movil_desconectado');
                delete session.mobileSocketId;
            }
        }

        console.log('📊 [WS] Sesiones activas restantes:', inventarioSesiones.size);
    });
});

// Puerto
const PORT = process.env.PRODUCCION_PORT || 3002;

httpServer.listen(PORT, () => {
    console.log(`Servidor de producción corriendo en puerto ${PORT}`);

    // Saneamiento estructural idempotente de Línea 4 (Tostaderos) y Artículos Puente
    const { ejecutarSaneamientoLinea4 } = require('./migrations/saneamientoLinea4');
    ejecutarSaneamientoLinea4(db)
        .then(resMig => {
            console.log('✅ [STARTUP-LDN4] Saneamiento estructural verificado:', JSON.stringify(resMig));
        })
        .catch(errMig => {
            console.warn('⚠️ [STARTUP-LDN4] Advertencia al ejecutar saneamiento estructural:', errMig.message);
        });

    // Saneamiento estructural idempotente de Línea 6 (Granolas: GFGN y GSGN)
    const { ejecutarSaneamientoLinea6 } = require('./migrations/saneamientoLinea6');
    ejecutarSaneamientoLinea6(db)
        .then(resMig6 => {
            console.log('✅ [STARTUP-LDN6] Saneamiento estructural verificado:', JSON.stringify(resMig6));
        })
        .catch(errMig6 => {
            console.warn('⚠️ [STARTUP-LDN6] Advertencia al ejecutar saneamiento estructural:', errMig6.message);
        });

    // Saneamiento estructural idempotente de Línea 3 (Mixes) y Línea 5 (Barritas)
    const { ejecutarSaneamientoLinea3y5 } = require('./migrations/saneamientoLinea3y5');
    ejecutarSaneamientoLinea3y5(db)
        .then(resMig35 => {
            console.log('✅ [STARTUP-LDN3-LDN5] Saneamiento estructural verificado:', JSON.stringify(resMig35));
        })
        .catch(errMig35 => {
            console.warn('⚠️ [STARTUP-LDN3-LDN5] Advertencia al ejecutar saneamiento estructural:', errMig35.message);
        });

    // Esquema idempotente y desacople de retiros para Stock Domiciliario de Colaboradores
    const { asegurarEsquemaStockDomiciliario } = require('./migrations/saneamientoStockDomiciliario');
    asegurarEsquemaStockDomiciliario(db)
        .then(resDom => {
            console.log('✅ [STARTUP-STOCK-DOMICILIARIO] Esquema y desacople verificados:', JSON.stringify(resDom));
        })
        .catch(errDom => {
            console.warn('⚠️ [STARTUP-STOCK-DOMICILIARIO] Advertencia al verificar esquema domiciliario:', errDom.message);
        });

    // Ampliación idempotente del CHECK constraint de Mantenimiento para tipo_movimiento 'DESCARTE'
    // + Tabla de motivos de descarte, columnas de costo snapshot y backfill valorizado
    const { asegurarCheckDescarteMantenimiento } = require('./migrations/asegurarCheckDescarteMantenimiento');
    const { asegurarEsquemaDescartesMantenimiento } = require('./migrations/asegurarEsquemaDescartesMantenimiento');
    asegurarCheckDescarteMantenimiento(db)
        .then(resDesc => {
            console.log('✅ [STARTUP-MANTENIMIENTO-DESCARTE] CHECK constraint verificado:', JSON.stringify(resDesc));
            return asegurarEsquemaDescartesMantenimiento(db);
        })
        .then(resEsq => {
            console.log('✅ [STARTUP-MANTENIMIENTO-DESCARTE] Esquema motivos/costos y backfill verificados:', JSON.stringify(resEsq));
        })
        .catch(errDesc => {
            console.warn('⚠️ [STARTUP-MANTENIMIENTO-DESCARTE] Advertencia al verificar esquema DESCARTE:', errDesc.message);
        });

    // Bootstrap centralizado de esquema e integridad referencial de Nodos + aprovisionamiento y perfiles idempotentes
    // Serializado con advisory lock PostgreSQL (sin DDL en rutas HTTP)
    const { inicializarEsquemaEtapa1Nodos } = require('./migrations/asegurarEsquemaEtapa1Nodos');
    const { provisionarNodoManso } = require('./scripts/provisionarNodoManso');
    const { provisionarNodoMoro } = require('./scripts/provisionarNodoMoro');
    const { migrarPerfilesOperativosNodos } = require('./scripts/migrarPerfilesOperativosNodos');
    const ejecutarBootstrapNodosConReintento = async (intento = 1) => {
        try {
            await inicializarEsquemaEtapa1Nodos({ log: true });
            await provisionarNodoManso({ log: true });
            await provisionarNodoMoro({ log: true });
            await migrarPerfilesOperativosNodos({ log: true });
        } catch (errManso) {
            if (intento < 3 && (errManso?.code === '40P01' || /deadlock/i.test(String(errManso?.message || '')))) {
                console.warn(`⏳ [STARTUP-NODOS] Deadlock concurrencia en arranque (intento ${intento}/3); reintentando en ${intento * 2}s...`);
                setTimeout(() => ejecutarBootstrapNodosConReintento(intento + 1), intento * 2000);
                return;
            }
            console.warn('⚠️ [STARTUP-NODOS] Advertencia verificando bootstrap/aprovisionamiento idempotente de Nodos:', errManso.message);
        }
    };
    setTimeout(() => ejecutarBootstrapNodosConReintento(1), 2500);
    
    // Housekeeping periódico no solapado de reservas PENDIENTE_TRANSFERENCIA vencidas (TTL configurable)
    let _housekeepingReservasNodosEnCurso = false;
    const ejecutarHousekeepingReservasNodos = async () => {
        if (_housekeepingReservasNodosEnCurso) return;
        _housekeepingReservasNodosEnCurso = true;
        try {
            const nodosBarrialesService = require('./services/nodosBarrialesService');
            if (typeof nodosBarrialesService.liberarReservasVencidasNodos === 'function') {
                const resLib = await nodosBarrialesService.liberarReservasVencidasNodos();
                if (resLib && Number(resLib.liberadas || 0) > 0) {
                    console.log(`🧹 [HOUSEKEEPING-NODOS] Reservas vencidas liberadas: ${resLib.liberadas}`);
                }
            }
        } catch (errHk) {
            console.warn('⚠️ [HOUSEKEEPING-NODOS] Error liberando reservas vencidas:', errHk.message);
        } finally {
            _housekeepingReservasNodosEnCurso = false;
        }
    };
    const timerHousekeepingNodos = setInterval(ejecutarHousekeepingReservasNodos, 180000);
    if (typeof timerHousekeepingNodos.unref === 'function') {
        timerHousekeepingNodos.unref();
    }

    // Warmup asíncrono de Tabla Maestra en memoria para eliminación total de latencia inicial en Conciliación IA
    const conciliacionArticulosService = require('./services/conciliacionArticulosService');
    conciliacionArticulosService.obtenerTablaMaestraSupabase().catch(err => {
        console.warn('⚠️ [CONCILIACION] Warmup de Tabla Maestra falló en arranque:', err.message);
    });
});
