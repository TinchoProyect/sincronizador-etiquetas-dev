const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');
const db = require('../config/database');

const ICON_SIZES_VALIDOS = new Set([180, 192, 512]);
const _iconBufferCache = new Map();
const _imageCache = new Map();

function limpiarHexColor(valor, fallback = '#D36344') {
    const s = String(valor || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
        return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    }
    return fallback;
}

function oscurecerHex(hex, factor = 0.45) {
    const clean = limpiarHexColor(hex, '#654830');
    const r = Math.max(0, Math.min(255, Math.round(parseInt(clean.slice(1, 3), 16) * factor)));
    const g = Math.max(0, Math.min(255, Math.round(parseInt(clean.slice(3, 5), 16) * factor)));
    const b = Math.max(0, Math.min(255, Math.round(parseInt(clean.slice(5, 7), 16) * factor)));
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function luminanciaRelativaHex(hex) {
    const clean = limpiarHexColor(hex, '#D36344');
    const [r, g, b] = [1, 3, 5].map(idx => {
        const c = parseInt(clean.slice(idx, idx + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

async function obtenerNodoPublicoPwaPorSlug(slugRaw) {
    const slug = String(slugRaw || '').trim();
    if (!slug) return null;

    const { rows } = await db.query(
        `SELECT id, codigo_nodo, slug, slug_historico, nombre_marca, bajada_marca,
                subtitulo_marca, barrio_zona, color_primario, tema_visual, gestor_token
         FROM public.nodos_maestro
         WHERE (LOWER(slug) = LOWER($1) OR LOWER(COALESCE(slug_historico, '')) = LOWER($1))
           AND COALESCE(activo, true) = true
         ORDER BY CASE WHEN LOWER(slug) = LOWER($1) THEN 0 ELSE 1 END, id ASC
         LIMIT 1`,
        [slug]
    );
    return rows[0] || null;
}

function extraerPaletaNodoPwa(nodo) {
    const tv = (nodo?.tema_visual && typeof nodo.tema_visual === 'object') ? nodo.tema_visual : {};
    const pal = (tv.paleta && typeof tv.paleta === 'object') ? tv.paleta : {};
    const logos = (tv.logos && typeof tv.logos === 'object') ? tv.logos : {};

    const colorMarca = limpiarHexColor(pal.terracota || nodo?.color_primario, '#D36344');
    const fondoClaro = limpiarHexColor(pal.fondo, '#FBF8F3');
    const fondoGestor = pal.primario
        ? limpiarHexColor(pal.primario, '#654830')
        : oscurecerHex(colorMarca, 0.38);
    const fondoGestorOscuro = pal.primario_oscuro
        ? limpiarHexColor(pal.primario_oscuro, '#4E3924')
        : oscurecerHex(fondoGestor, 0.78);
    const acentoSol = limpiarHexColor(pal.amarillo_sol, '#FFC266');

    return {
        colorMarca,
        fondoClaro,
        fondoGestor,
        fondoGestorOscuro,
        acentoSol,
        isotipoRelPath: String(logos.isotipo || '').trim()
    };
}

function construirManifestPwaNodo(nodo, rol = 'tienda', tokenQuery = '') {
    const slug = String(nodo?.slug || '').trim();
    const slugEnc = encodeURIComponent(slug);
    const nombreMarca = String(nodo?.nombre_marca || 'Nodo Barrial').trim();
    const bajada = String(nodo?.bajada_marca || nodo?.subtitulo_marca || '').trim();
    const pal = extraerPaletaNodoPwa(nodo);

    if (rol === 'gestor') {
        const tokReq = String(tokenQuery || '').trim();
        const tokReal = String(nodo?.gestor_token || '').trim();
        const tieneTokenValido = Boolean(tokReq && tokReal && tokReq === tokReal);
        const startUrl = tieneTokenValido
            ? `/gestor/${slugEnc}?t=${encodeURIComponent(tokReal)}&pwa=1`
            : `/gestor/${slugEnc}?pwa=1`;

        return {
            id: `/gestor/${slugEnc}`,
            name: `${nombreMarca} · Panel Nodo`,
            short_name: `Nodo ${nombreMarca}`,
            description: `Panel operativo de gestión — Nodo ${nombreMarca}`,
            lang: 'es-AR',
            start_url: startUrl,
            scope: `/gestor/${slugEnc}`,
            display: 'standalone',
            orientation: 'portrait',
            background_color: pal.fondoGestor,
            theme_color: pal.fondoGestor,
            icons: [
                {
                    src: `/api/produccion/nodos/pwa/${slugEnc}/icon-gestor-192.png?v=1`,
                    sizes: '192x192',
                    type: 'image/png',
                    purpose: 'any'
                },
                {
                    src: `/api/produccion/nodos/pwa/${slugEnc}/icon-gestor-512.png?v=1`,
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'any'
                },
                {
                    src: `/api/produccion/nodos/pwa/${slugEnc}/icon-gestor-512.png?v=1`,
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'maskable'
                }
            ]
        };
    }

    return {
        id: `/tienda/${slugEnc}`,
        name: `${nombreMarca} — Tienda`,
        short_name: nombreMarca,
        description: bajada || `Tienda vecinal de ${nombreMarca}`,
        lang: 'es-AR',
        start_url: `/tienda/${slugEnc}?pwa=1`,
        scope: `/tienda/${slugEnc}`,
        display: 'standalone',
        orientation: 'portrait',
        background_color: pal.fondoClaro,
        theme_color: pal.fondoClaro,
        icons: [
            {
                src: `/api/produccion/nodos/pwa/${slugEnc}/icon-tienda-192.png?v=1`,
                sizes: '192x192',
                type: 'image/png',
                purpose: 'any'
            },
            {
                src: `/api/produccion/nodos/pwa/${slugEnc}/icon-tienda-512.png?v=1`,
                sizes: '512x512',
                type: 'image/png',
                purpose: 'any'
            },
            {
                src: `/api/produccion/nodos/pwa/${slugEnc}/icon-tienda-512.png?v=1`,
                sizes: '512x512',
                type: 'image/png',
                purpose: 'maskable'
            }
        ]
    };
}

function trazarRectRedondeado(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
}

/**
 * Dibuja la palabra "NODO" con geometría vectorial redondeada limpia
 * para garantizar nitidez idéntica en Windows y Linux sin depender de fuentes del SO.
 */
function dibujarPalabraVectorialNodo(ctx, centerX, centerY, heightPx, colorHex) {
    const h = heightPx;
    const stroke = Math.max(2, h * 0.205);
    const wN = h * 0.72;
    const wO = h * 0.76;
    const wD = h * 0.74;
    const gap = h * 0.34;
    const totalW = wN + gap + wO + gap + wD + gap + wO;

    ctx.save();
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = stroke;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    let x = centerX - totalW / 2;
    const top = centerY - h / 2;
    const bot = centerY + h / 2;

    // 'N'
    ctx.beginPath();
    ctx.moveTo(x, bot);
    ctx.lineTo(x, top);
    ctx.lineTo(x + wN, bot);
    ctx.lineTo(x + wN, top);
    ctx.stroke();
    x += wN + gap;

    // 'O' (1)
    const drawRoundedO = (ox) => {
        const rx = wO / 2;
        const ry = h / 2;
        ctx.beginPath();
        ctx.ellipse(ox + rx, centerY, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
    };
    drawRoundedO(x);
    x += wO + gap;

    // 'D'
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bot);
    ctx.lineTo(x + wD * 0.38, bot);
    ctx.bezierCurveTo(
        x + wD * 1.08, bot,
        x + wD * 1.08, top,
        x + wD * 0.38, top
    );
    ctx.closePath();
    ctx.stroke();
    x += wD + gap;

    // 'O' (2)
    drawRoundedO(x);

    ctx.restore();
}

function dibujarMonogramaFallback(ctx, cx, cy, boxSize, nombreMarca, colorMarca) {
    const r = boxSize * 0.46;
    ctx.save();
    ctx.fillStyle = colorMarca;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
    ctx.lineWidth = Math.max(2, boxSize * 0.03);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.84, 0, Math.PI * 2);
    ctx.stroke();

    const inicial = String(nombreMarca || 'N').trim().charAt(0).toUpperCase() || 'N';
    ctx.fillStyle = '#FFFDF9';
    ctx.font = `900 ${Math.round(boxSize * 0.48)}px "DejaVu Sans", "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(inicial, cx, cy + boxSize * 0.02);
    ctx.restore();
}

async function cargarImagenIsotipoLocal(isotipoRelPath) {
    if (!isotipoRelPath) return null;
    const cleanRel = isotipoRelPath.replace(/^\/+/, '');
    const fullPath = path.join(__dirname, '..', cleanRel);
    if (!fs.existsSync(fullPath)) return null;

    const stat = fs.statSync(fullPath);
    const cacheKey = `${fullPath}:${stat.mtimeMs}`;
    if (_imageCache.has(cacheKey)) {
        return _imageCache.get(cacheKey);
    }
    const img = await loadImage(fullPath);
    _imageCache.set(cacheKey, img);
    return img;
}

async function renderizarIconoPngNodo(nodo, rol = 'tienda', sizeRaw = 192) {
    const size = Number(sizeRaw);
    const safeSize = ICON_SIZES_VALIDOS.has(size) ? size : 192;
    const rolNorm = rol === 'gestor' ? 'gestor' : 'tienda';
    const pal = extraerPaletaNodoPwa(nodo);
    const nombreMarca = String(nodo?.nombre_marca || 'Nodo').trim();

    const cacheKey = [
        nodo?.id || 0,
        nodo?.slug || '',
        rolNorm,
        safeSize,
        pal.fondoClaro,
        pal.fondoGestor,
        pal.colorMarca,
        pal.isotipoRelPath,
        nombreMarca
    ].join('|');

    if (_iconBufferCache.has(cacheKey)) {
        return _iconBufferCache.get(cacheKey);
    }

    const canvas = createCanvas(safeSize, safeSize);
    const ctx = canvas.getContext('2d');
    ctx.quality = 'best';
    ctx.patternQuality = 'best';

    const isotipoImg = await cargarImagenIsotipoLocal(pal.isotipoRelPath).catch(() => null);

    if (rolNorm === 'tienda') {
        // Fondo cálido/crema limpio de la identidad visual de la tienda (sin marcos rectangulares que recorte Android circular)
        ctx.fillStyle = pal.fondoClaro;
        ctx.fillRect(0, 0, safeSize, safeSize);

        // Isotipo centrado con amplio margen estético (~19% por lado, 100% seguro dentro de squircle iOS y círculo Android)
        const boxSize = Math.round(safeSize * 0.62);
        const offset = Math.round((safeSize - boxSize) / 2);
        if (isotipoImg) {
            ctx.drawImage(isotipoImg, offset, offset, boxSize, boxSize);
        } else {
            const colorMono = luminanciaRelativaHex(pal.colorMarca) > 0.45 ? oscurecerHex(pal.colorMarca, 0.78) : pal.colorMarca;
            dibujarMonogramaFallback(ctx, safeSize / 2, safeSize / 2, boxSize, nombreMarca, colorMono);
        }
    } else {
        // Variante Gestor / Nodo: fondo profundo de gestión (#654830 / primario oscuro)
        const bgGrad = ctx.createLinearGradient(0, 0, 0, safeSize);
        bgGrad.addColorStop(0, pal.fondoGestor);
        bgGrad.addColorStop(1, pal.fondoGestorOscuro);
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, safeSize, safeSize);

        // Medallón superior crema cálido dentro de zona segura maskable (iOS squircle + Android círculo)
        const cardW = Math.round(safeSize * 0.58);
        const cardH = Math.round(safeSize * 0.49);
        const cardX = Math.round((safeSize - cardW) / 2);
        const cardY = Math.round(safeSize * 0.145);
        const cardR = Math.round(safeSize * 0.125);

        ctx.save();
        ctx.shadowColor = 'rgba(20, 12, 6, 0.28)';
        ctx.shadowBlur = Math.round(safeSize * 0.032);
        ctx.shadowOffsetY = Math.round(safeSize * 0.012);
        trazarRectRedondeado(ctx, cardX, cardY, cardW, cardH, cardR);
        ctx.fillStyle = pal.fondoClaro;
        ctx.fill();
        ctx.restore();

        const isoSize = Math.round(safeSize * 0.39);
        const isoX = Math.round((safeSize - isoSize) / 2);
        const isoY = Math.round(cardY + (cardH - isoSize) / 2);
        if (isotipoImg) {
            ctx.drawImage(isotipoImg, isoX, isoY, isoSize, isoSize);
        } else {
            const colorMono = luminanciaRelativaHex(pal.colorMarca) > 0.45 ? oscurecerHex(pal.colorMarca, 0.78) : pal.colorMarca;
            dibujarMonogramaFallback(ctx, safeSize / 2, cardY + cardH / 2, isoSize, nombreMarca, colorMono);
        }

        // Pastilla inferior nítida "NODO" centrada cómodamente dentro del círculo maskable (y: 68%..81%)
        const pillW = Math.round(safeSize * 0.50);
        const pillH = Math.round(safeSize * 0.128);
        const pillX = Math.round((safeSize - pillW) / 2);
        const pillY = Math.round(safeSize * 0.685);
        const colorPastilla = luminanciaRelativaHex(pal.colorMarca) > 0.42
            ? oscurecerHex(pal.colorMarca, 0.72)
            : pal.colorMarca;

        trazarRectRedondeado(ctx, pillX, pillY, pillW, pillH, pillH / 2);
        ctx.fillStyle = colorPastilla;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 251, 245, 0.38)';
        ctx.lineWidth = Math.max(1, safeSize * 0.008);
        ctx.stroke();

        dibujarPalabraVectorialNodo(
            ctx,
            safeSize / 2,
            pillY + pillH / 2,
            pillH * 0.48,
            '#FFFDF9'
        );
    }

    const buf = canvas.toBuffer('image/png');
    if (_iconBufferCache.size > 64) {
        _iconBufferCache.clear();
    }
    _iconBufferCache.set(cacheKey, buf);
    return buf;
}

function generarCodigoServiceWorkerNodo() {
    return `/* LAMDA Nodos Barriales — Service Worker liviano (network-first, sin caché de API ni precios) */
const SW_VERSION = 'lamda-nodo-pwa-v2';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .catch(() => {})
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (!req || req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (_) {
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req, { cache: 'no-cache' }).catch(() => new Response(
        '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sin conexión</title></head>' +
        '<body style="font-family:sans-serif;background:#FBF8F3;color:#2E2218;display:flex;align-items:center;justify-content:center;min-height:92vh;margin:0;padding:20px;text-align:center;">' +
        '<div style="max-width:340px;background:#fff;border:1px solid #E6DDD0;border-radius:18px;padding:24px;box-shadow:0 8px 24px rgba(46,34,24,0.08);">' +
        '<div style="font-size:2rem;margin-bottom:8px;">📡</div>' +
        '<h2 style="margin:0 0 8px;font-size:1.1rem;">Sin conexión a internet</h2>' +
        '<p style="margin:0 0 16px;font-size:0.88rem;color:#6E5D4F;line-height:1.45;">Verificá tu señal Wi-Fi o datos móviles para cargar el catálogo actualizado.</p>' +
        '<button onclick="location.reload()" style="background:#D36344;color:#fff;border:none;border-radius:10px;padding:11px 18px;font-weight:700;font-size:0.9rem;cursor:pointer;">Reintentar</button>' +
        '</div></body></html>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
      ))
    );
  }
});
`;
}

module.exports = {
    ICON_SIZES_VALIDOS,
    obtenerNodoPublicoPwaPorSlug,
    extraerPaletaNodoPwa,
    construirManifestPwaNodo,
    renderizarIconoPngNodo,
    generarCodigoServiceWorkerNodo
};
