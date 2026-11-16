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
                subtitulo_marca, barrio_zona, color_primario, tema_visual, gestor_token,
                logo_original_base64
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
    const nombreMarca = String(nodo?.nombre_marca || 'Tienda').trim();
    const bajada = String(nodo?.bajada_marca || nodo?.subtitulo_marca || '').trim();
    const pal = extraerPaletaNodoPwa(nodo);

    if (rol === 'gestor') {
        const tokReq = String(tokenQuery || '').trim();
        const tokReal = String(nodo?.gestor_token || '').trim();
        const tieneTokenValido = Boolean(tokReq && tokReal && tokReq === tokReal);
        const startUrl = tieneTokenValido
            ? `/gestor/${slugEnc}?t=${encodeURIComponent(tokReal)}&pwa=1`
            : `/gestor/${slugEnc}?pwa=1`;
        const tituloGestion = `Gestión ${nombreMarca}`;

        return {
            id: `/gestor/${slugEnc}`,
            name: tituloGestion,
            short_name: tituloGestion,
            description: `Gestión comercial — ${nombreMarca}`,
            lang: 'es-AR',
            start_url: startUrl,
            scope: `/gestor/${slugEnc}`,
            display: 'standalone',
            orientation: 'portrait',
            background_color: pal.fondoGestor,
            theme_color: pal.fondoGestor,
            icons: [
                {
                    src: `/api/produccion/nodos/pwa/${slugEnc}/icon-gestor-192.png?v=2`,
                    sizes: '192x192',
                    type: 'image/png',
                    purpose: 'any'
                },
                {
                    src: `/api/produccion/nodos/pwa/${slugEnc}/icon-gestor-512.png?v=2`,
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'any'
                },
                {
                    src: `/api/produccion/nodos/pwa/${slugEnc}/icon-gestor-512.png?v=2`,
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'maskable'
                }
            ]
        };
    }

    return {
        id: `/tienda/${slugEnc}`,
        name: nombreMarca,
        short_name: nombreMarca,
        description: bajada || `Tienda de ${nombreMarca}`,
        lang: 'es-AR',
        start_url: `/tienda/${slugEnc}?pwa=1`,
        scope: `/tienda/${slugEnc}`,
        display: 'standalone',
        orientation: 'portrait',
        background_color: pal.fondoClaro,
        theme_color: pal.fondoClaro,
        icons: [
            {
                src: `/api/produccion/nodos/pwa/${slugEnc}/icon-tienda-192.png?v=2`,
                sizes: '192x192',
                type: 'image/png',
                purpose: 'any'
            },
            {
                src: `/api/produccion/nodos/pwa/${slugEnc}/icon-tienda-512.png?v=2`,
                sizes: '512x512',
                type: 'image/png',
                purpose: 'any'
            },
            {
                src: `/api/produccion/nodos/pwa/${slugEnc}/icon-tienda-512.png?v=2`,
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

    const inicial = String(nombreMarca || 'T').trim().charAt(0).toUpperCase() || 'T';
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

async function cargarImagenBase64Nodo(dataUrlOrBase64) {
    const raw = String(dataUrlOrBase64 || '').trim();
    if (!raw || raw.length < 32) return null;
    const cacheKey = `b64:${raw.length}:${raw.slice(0, 48)}:${raw.slice(-32)}`;
    if (_imageCache.has(cacheKey)) {
        return _imageCache.get(cacheKey);
    }
    try {
        const cleanB64 = raw.includes('base64,') ? raw.split('base64,')[1] : raw;
        const buf = Buffer.from(cleanB64, 'base64');
        if (!buf || buf.length < 24) return null;
        const img = await loadImage(buf);
        if (!img || !img.width || !img.height) return null;
        _imageCache.set(cacheKey, img);
        return img;
    } catch (_) {
        return null;
    }
}

function dibujarImagenContenidaSegura(ctx, img, boxX, boxY, boxSize) {
    const w = Number(img?.width || 0);
    const h = Number(img?.height || 0);
    if (w <= 0 || h <= 0) return false;
    const ratio = w / h;
    // Si el logo es una marquesina horizontal muy apaisada (> 2.4:1), en un ícono circular 192px
    // quedaría diminuto; en ese caso el monograma vectorial de alto contraste luce mucho más limpio.
    if (ratio > 2.4 || ratio < (1 / 2.4)) return false;
    let drawW = boxSize;
    let drawH = boxSize;
    if (ratio >= 1) {
        drawH = Math.round(boxSize / ratio);
    } else {
        drawW = Math.round(boxSize * ratio);
    }
    const dx = Math.round(boxX + (boxSize - drawW) / 2);
    const dy = Math.round(boxY + (boxSize - drawH) / 2);
    ctx.drawImage(img, dx, dy, drawW, drawH);
    return true;
}

async function renderizarIconoPngNodo(nodo, rol = 'tienda', sizeRaw = 192) {
    const size = Number(sizeRaw);
    const safeSize = ICON_SIZES_VALIDOS.has(size) ? size : 192;
    const rolNorm = rol === 'gestor' ? 'gestor' : 'tienda';
    const pal = extraerPaletaNodoPwa(nodo);
    const nombreMarca = String(nodo?.nombre_marca || 'Tienda').trim();
    const logoB64Len = nodo?.logo_original_base64 ? String(nodo.logo_original_base64).length : 0;

    const cacheKey = [
        'v2-clean',
        nodo?.id || 0,
        nodo?.slug || '',
        rolNorm,
        safeSize,
        pal.fondoClaro,
        pal.fondoGestor,
        pal.colorMarca,
        pal.isotipoRelPath,
        logoB64Len,
        nombreMarca
    ].join('|');

    if (_iconBufferCache.has(cacheKey)) {
        return _iconBufferCache.get(cacheKey);
    }

    const canvas = createCanvas(safeSize, safeSize);
    const ctx = canvas.getContext('2d');
    ctx.quality = 'best';
    ctx.patternQuality = 'best';

    let isotipoImg = await cargarImagenIsotipoLocal(pal.isotipoRelPath).catch(() => null);
    let esIsotipoArchivo = Boolean(isotipoImg);
    if (!isotipoImg && nodo?.logo_original_base64) {
        isotipoImg = await cargarImagenBase64Nodo(nodo.logo_original_base64);
    }

    if (rolNorm === 'tienda') {
        // Fondo cálido/crema limpio de la identidad visual de la tienda (sin marcos ni textos)
        ctx.fillStyle = pal.fondoClaro;
        ctx.fillRect(0, 0, safeSize, safeSize);

        // Isotipo/monograma centrado con margen maskable seguro exacto (20% por lado)
        const boxSize = Math.round(safeSize * 0.60);
        const offset = Math.round((safeSize - boxSize) / 2);
        let dibujado = false;
        if (isotipoImg) {
            if (esIsotipoArchivo) {
                ctx.drawImage(isotipoImg, offset, offset, boxSize, boxSize);
                dibujado = true;
            } else {
                dibujado = dibujarImagenContenidaSegura(ctx, isotipoImg, offset, offset, boxSize);
            }
        }
        if (!dibujado) {
            const colorMono = luminanciaRelativaHex(pal.colorMarca) > 0.45 ? oscurecerHex(pal.colorMarca, 0.78) : pal.colorMarca;
            dibujarMonogramaFallback(ctx, safeSize / 2, safeSize / 2, boxSize, nombreMarca, colorMono);
        }
    } else {
        // Variante Gestión: fondo profundo de gestión + medallón limpio centrado sin cintas ni textos
        const bgGrad = ctx.createLinearGradient(0, 0, 0, safeSize);
        bgGrad.addColorStop(0, pal.fondoGestor);
        bgGrad.addColorStop(1, pal.fondoGestorOscuro);
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, safeSize, safeSize);

        const cardSize = Math.round(safeSize * 0.60);
        const cardOffset = Math.round((safeSize - cardSize) / 2);
        const cardR = Math.round(safeSize * 0.145);

        ctx.save();
        ctx.shadowColor = 'rgba(20, 12, 6, 0.28)';
        ctx.shadowBlur = Math.round(safeSize * 0.032);
        ctx.shadowOffsetY = Math.round(safeSize * 0.012);
        trazarRectRedondeado(ctx, cardOffset, cardOffset, cardSize, cardSize, cardR);
        ctx.fillStyle = pal.fondoClaro;
        ctx.fill();
        ctx.restore();

        const isoSize = Math.round(safeSize * 0.44);
        const isoOffset = Math.round((safeSize - isoSize) / 2);
        let dibujadoGestor = false;
        if (isotipoImg) {
            if (esIsotipoArchivo) {
                ctx.drawImage(isotipoImg, isoOffset, isoOffset, isoSize, isoSize);
                dibujadoGestor = true;
            } else {
                dibujadoGestor = dibujarImagenContenidaSegura(ctx, isotipoImg, isoOffset, isoOffset, isoSize);
            }
        }
        if (!dibujadoGestor) {
            const colorMono = luminanciaRelativaHex(pal.colorMarca) > 0.45 ? oscurecerHex(pal.colorMarca, 0.78) : pal.colorMarca;
            dibujarMonogramaFallback(ctx, safeSize / 2, safeSize / 2, isoSize, nombreMarca, colorMono);
        }
    }

    const buf = canvas.toBuffer('image/png');
    if (_iconBufferCache.size > 64) {
        _iconBufferCache.clear();
    }
    _iconBufferCache.set(cacheKey, buf);
    return buf;
}

function generarCodigoServiceWorkerNodo() {
    return `/* LAMDA Tiendas Comunitarias — Service Worker liviano (network-first, sin caché de API, media ni subidas multipart) */
const SW_VERSION = 'lamda-nodo-pwa-v4';

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
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/nodos/')) return;

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
