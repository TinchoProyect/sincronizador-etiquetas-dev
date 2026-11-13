const express = require('express');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const QRCode = require('qrcode');
const router = express.Router();
const nodosService = require('../services/nodosBarrialesService');

const CLOUDFLARED_EXE = 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe';
const TUNNEL_CACHE_FILE = path.join(os.tmpdir(), 'lamda_nodos_cloudflare_tunnel.json');
const EMPTY_CF_CONFIG = path.join(os.tmpdir(), 'lamda_empty_cloudflared.yml');
let tunelCloudflareUrlActual = null;
let tunelCloudflareProc = null;
let tunelCloudflareIniciandoPromise = null;

function detectarIpLanWifiLocal() {
    try {
        const nets = os.networkInterfaces();
        let fallbackIp = null;
        for (const name of Object.keys(nets)) {
            for (const net of (nets[name] || [])) {
                if (net.family === 'IPv4' && !net.internal) {
                    const addr = String(net.address || '').trim();
                    if (!addr || addr.startsWith('169.254.')) continue;
                    if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(addr)) {
                        if (/wi-?fi|wlan|wireless|ethernet/i.test(name)) {
                            return addr;
                        }
                        if (!fallbackIp) fallbackIp = addr;
                    }
                }
            }
        }
        return fallbackIp || 'localhost';
    } catch (_) {
        return 'localhost';
    }
}

async function verificarTunelVivo(url) {
    if (!url || !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(url)) return false;
    try {
        const res = await fetch(`${url}/api/produccion/nodos/ping-movil`, {
            signal: AbortSignal.timeout(3000)
        });
        return res.ok;
    } catch (_) {
        return false;
    }
}

async function asegurarTunelCloudflareNodos() {
    if (tunelCloudflareUrlActual) {
        return tunelCloudflareUrlActual;
    }
    if (tunelCloudflareIniciandoPromise) {
        return tunelCloudflareIniciandoPromise;
    }

    tunelCloudflareIniciandoPromise = (async () => {
        try {
            if (fs.existsSync(TUNNEL_CACHE_FILE)) {
                const cached = JSON.parse(fs.readFileSync(TUNNEL_CACHE_FILE, 'utf8'));
                if (cached?.url && (await verificarTunelVivo(cached.url))) {
                    tunelCloudflareUrlActual = cached.url;
                    return tunelCloudflareUrlActual;
                }
            }
        } catch (_) {}

        if (!fs.existsSync(CLOUDFLARED_EXE)) {
            return null;
        }

        return new Promise((resolve) => {
            let resuelto = false;
            const finalizar = (url) => {
                if (resuelto) return;
                resuelto = true;
                resolve(url || null);
            };

            const timer = setTimeout(() => finalizar(tunelCloudflareUrlActual), 9000);

            try {
                try {
                    fs.writeFileSync(EMPTY_CF_CONFIG, '# empty config for quick tunnel\n', 'utf8');
                } catch (_) {}
                const proc = spawn(CLOUDFLARED_EXE, ['tunnel', '--config', EMPTY_CF_CONFIG, '--url', 'http://127.0.0.1:3002', '--no-autoupdate'], {
                    windowsHide: true,
                    detached: true
                });
                proc.unref();
                tunelCloudflareProc = proc;

                const revisarSalida = (chunk) => {
                    const txt = String(chunk || '');
                    const match = txt.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
                    if (match && match[0]) {
                        tunelCloudflareUrlActual = match[0];
                        try {
                            fs.writeFileSync(TUNNEL_CACHE_FILE, JSON.stringify({
                                url: tunelCloudflareUrlActual,
                                pid: proc.pid,
                                updated_at: new Date().toISOString()
                            }), 'utf8');
                        } catch (_) {}
                        console.log(`🌐 [NodosBarriales] Túnel HTTPS Celular activo: ${tunelCloudflareUrlActual}`);
                        clearTimeout(timer);
                        finalizar(tunelCloudflareUrlActual);
                    }
                };

                proc.stdout.on('data', revisarSalida);
                proc.stderr.on('data', revisarSalida);
                proc.on('exit', () => {
                    tunelCloudflareProc = null;
                    tunelCloudflareUrlActual = null;
                    clearTimeout(timer);
                    finalizar(null);
                });
            } catch (_) {
                clearTimeout(timer);
                finalizar(null);
            }
        });
    })().finally(() => {
        tunelCloudflareIniciandoPromise = null;
    });

    return tunelCloudflareIniciandoPromise;
}

const NODOS_PUBLIC_HOST_CONFIG = String(process.env.NODOS_PUBLIC_HOST || 'tienda.lamdaser.com')
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '');

function extraerHostSinPuertoNodos(req) {
    const rawHost = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').split(',')[0].trim().toLowerCase();
    return rawHost.replace(/:\d+$/, '');
}

function esSolicitudPublicaNodos(req) {
    const h = extraerHostSinPuertoNodos(req);
    if (!h) return false;
    if (h.includes('.trycloudflare.com')) return true;
    if (NODOS_PUBLIC_HOST_CONFIG && h === NODOS_PUBLIC_HOST_CONFIG) return true;
    if (h === 'tienda.lamdaser.com' || h.startsWith('tienda.')) return true;
    return false;
}

function extraerTokenGestorRequest(req) {
    const headerTok = String(req?.headers?.['x-nodo-gestor-token'] || '').trim();
    const queryTok = String(req?.query?.t || req?.query?.gestor_token || '').trim();
    const bodyTok = String(req?.body?.gestor_token || '').trim();
    return headerTok || queryTok || bodyTok || '';
}

function esModoLaboratorioWaSegura() {
    return String(process.env.LAMDA_MODO_LABORATORIO || '').trim().toLowerCase() === 'true'
        && String(process.env.DB_NAME || '').trim() === 'etiquetas_pruebas';
}

async function autenticarGestorSiPublicoOToken(req, res, next) {
    try {
        const token = extraerTokenGestorRequest(req);
        const esPublico = esSolicitudPublicaNodos(req);
        if (!esPublico && !token) {
            return next();
        }
        if (!token) {
            return res.status(401).json({
                ok: false,
                code: 'GESTOR_TOKEN_REQUIRED',
                error: 'Se requiere acceso autorizado del Gestor (reescaneá tu código QR de Gestor).'
            });
        }
        const nodoAuth = await nodosService.resolverNodoPorTokenGestor(token);
        if (!nodoAuth) {
            return res.status(403).json({
                ok: false,
                code: 'GESTOR_TOKEN_INVALID',
                error: 'El código QR o token del Gestor ya no es válido. Solicitá uno nuevo.'
            });
        }
        req.nodoAuth = nodoAuth;
        return next();
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
}

// Iniciar túnel efímero en segundo plano únicamente en Laboratorio Windows sin dominio público fijo
const esLabWindowsConTunel = process.platform === 'win32'
    && String(process.env.LAMDA_MODO_LABORATORIO || '').trim().toLowerCase() === 'true'
    && !String(process.env.NODOS_PUBLIC_BASE_URL || '').trim();
if (esLabWindowsConTunel) {
    setTimeout(() => {
        asegurarTunelCloudflareNodos().catch(() => {});
    }, 800);
}

router.get('/ping-movil', (req, res) => {
    res.json({ ok: true, ts: Date.now() });
});

async function obtenerBaseUrlAccesibleCelular(req) {
    const publicBaseEnv = String(process.env.NODOS_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
    if (publicBaseEnv) {
        return publicBaseEnv;
    }
    const hostHeader = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').split(',')[0].trim();
    const proto = String(req?.headers?.['x-forwarded-proto'] || req?.protocol || 'http').split(',')[0].trim();
    const isPublicCloud = hostHeader && !/^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.)/i.test(hostHeader);
    if (isPublicCloud) {
        return `${proto}://${hostHeader}`;
    }
    const tunelHttps = await asegurarTunelCloudflareNodos();
    if (tunelHttps) {
        return tunelHttps;
    }
    const lanIp = detectarIpLanWifiLocal();
    return `http://${lanIp}:3002`;
}

/**
 * GET /api/produccion/nodos/inicializar
 * Devuelve Nodos Maestro, Catálogo Aislado de Nodos, Propuestas de Fracciones,
 * Ofertas por Gestor y las Fuentes de Costo de los 6 Flujos de la Pizarra.
 */
router.get('/inicializar', async (req, res) => {
    try {
        const data = await nodosService.obtenerEstadoCompletoNodos();
        res.json({ ok: true, ...data });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /inicializar:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/calcular-preview
 * Simulación instantánea de costos de una fracción sobre cualquiera de los 6 Flujos
 */
router.post('/calcular-preview', async (req, res) => {
    try {
        const resultado = nodosService.calcularEstructuraCostosNodo(req.body || {});
        res.json({ ok: true, calculo: resultado });
    } catch (error) {
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/previsualizar-anatomia
 * Resuelve en vivo para la Mesa Cotizadora el SKU nativo en Búnker, receta/bolsa real
 * en Espacios Personales y el Alias Amigable sugerido para el Vecino.
 */
router.post('/previsualizar-anatomia', async (req, res) => {
    try {
        const anatomia = await nodosService.previsualizarAnatomiaCotizacionNodo(req.body || {});
        res.json({ ok: true, anatomia });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /previsualizar-anatomia:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/convertir-logo-zpl
 * Convierte un PNG/JPG base64 o monograma a ZPL ^GFA y devuelve el preview monocromático 1-bit
 */
router.post('/convertir-logo-zpl', async (req, res) => {
    try {
        const conv = await nodosService.convertirLogoAZplGfa(req.body || {});
        res.json({
            ok: true,
            width: conv.width,
            height: conv.height,
            bytesPerRow: conv.bytesPerRow,
            totalBytes: conv.totalBytes,
            logo_zpl_gfa: conv.logo_zpl_gfa,
            logo_mono_preview_base64: conv.logo_mono_preview_base64
        });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /convertir-logo-zpl:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/preview-etiqueta
 * Genera el ZPL en rollo de doble columna (X=23 izquierda / X=443 derecha) con soporte
 * de etiquetas de continuación si hay más de 6 ítems, y renderiza la vista previa PNG.
 */
router.post('/preview-etiqueta', async (req, res) => {
    try {
        const preview = await nodosService.generarPreviewVisualEtiquetaPar(req.body || {});
        res.json({ ok: true, ...preview });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /preview-etiqueta:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/maestro
 * Crea un nuevo Nodo Barrial
 */
router.post('/maestro', async (req, res) => {
    try {
        const nodo = await nodosService.guardarNodoMaestro(req.body || {}, null);
        res.json({ ok: true, nodo });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error creando Nodo:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * PUT /api/produccion/nodos/maestro/:id
 * Actualiza un Nodo Barrial existente y regenera su gráfico ZPL ^GFA
 */
router.put('/maestro/:id', async (req, res) => {
    try {
        const nodo = await nodosService.guardarNodoMaestro(req.body || {}, req.params.id);
        res.json({ ok: true, nodo });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error actualizando Nodo:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * GET /api/produccion/nodos/geocodificar-ar
 * Geocodificador interno para ABM Pizarra (GeoRef AR oficial + Nominatim fallback + caché)
 */
router.get('/geocodificar-ar', async (req, res) => {
    try {
        if (esSolicitudPublicaNodos(req)) {
            return res.status(403).json({ ok: false, error: 'Geocodificador restringido a administración interna.' });
        }
        const data = await nodosService.geocodificarDireccionArgentina(req.query.q || '', {
            partido_hint: req.query.partido || ''
        });
        res.json({ ok: true, ...data });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /geocodificar-ar:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

/**
 * GET /api/produccion/nodos/geocodificar-inverso
 * Geocodificación inversa interna al arrastrar/pinchar mapa Leaflet en ABM Pizarra
 */
router.get('/geocodificar-inverso', async (req, res) => {
    try {
        if (esSolicitudPublicaNodos(req)) {
            return res.status(403).json({ ok: false, error: 'Geocodificador restringido a administración interna.' });
        }
        const data = await nodosService.geocodificarInversoArgentina(req.query.lat, req.query.lng);
        res.json({ ok: true, ...data });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /geocodificar-inverso:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

/**
 * PUT /api/produccion/nodos/maestro/:id/estado
 * Archiva o reactiva un Nodo Barrial sin eliminar historial de Liquidación/Armado
 */
router.put('/maestro/:id/estado', async (req, res) => {
    try {
        if (esSolicitudPublicaNodos(req)) {
            return res.status(403).json({ ok: false, error: 'Operación restringida a administración interna.' });
        }
        const nodo = await nodosService.archivarOActivarNodoMaestro(req.params.id, req.body?.activo);
        res.json({ ok: true, nodo });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error actualizando estado del Nodo:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

/**
 * DELETE /api/produccion/nodos/maestro/:id
 * Eliminación transaccional segura de un Nodo de Prueba (EXCLUSIVA DE MODO LABORATORIO)
 */
router.delete('/maestro/:id', async (req, res) => {
    try {
        if (esSolicitudPublicaNodos(req) || !esModoLaboratorioWaSegura()) {
            return res.status(403).json({
                ok: false,
                error: 'La eliminación de Nodos solo está permitida en Modo Laboratorio interno sobre etiquetas_pruebas.'
            });
        }
        const resultado = await nodosService.eliminarNodoPruebaLaboratorio(req.params.id, {
            motivo: (req.body && req.body.motivo) || req.query?.motivo || ''
        });
        res.json(resultado);
    } catch (error) {
        console.error('❌ [NodosRoutes] Error eliminando Nodo de prueba:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

/**
 * PUT /api/produccion/nodos/config-cuenta-canal
 * Actualiza el Alias/CBU/Titular compartido del Canal Nodos (Marca Blanca)
 * y lo propaga automáticamente a todos los Nodos que usan la cuenta recaudadora compartida.
 */
router.put('/config-cuenta-canal', async (req, res) => {
    try {
        const resultado = await nodosService.actualizarConfiguracionCuentaCanalNodos(req.body || {});
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en PUT /config-cuenta-canal:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/propuestas
 * Crea una nueva solicitud/propuesta de fracción de un gestor de Nodo hacia LAMDA
 */
router.post('/propuestas', autenticarGestorSiPublicoOToken, async (req, res) => {
    try {
        const body = { ...(req.body || {}) };
        if (req.nodoAuth) {
            if (body.nodo_solicitante_id && Number(body.nodo_solicitante_id) !== Number(req.nodoAuth.id)) {
                return res.status(403).json({ ok: false, error: 'No autorizado para enviar propuestas en nombre de otro Nodo.' });
            }
            body.nodo_solicitante_id = req.nodoAuth.id;
        }
        const propuesta = await nodosService.crearPropuestaFraccion(body);
        res.json({ ok: true, propuesta });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error creando propuesta:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/propuestas/:id/anular
 * Permite al Gestor anular una solicitud propia mientras siga pendiente de cotización
 */
router.post('/propuestas/:id/anular', autenticarGestorSiPublicoOToken, async (req, res) => {
    try {
        const nodoId = req.nodoAuth ? req.nodoAuth.id : (req.body && req.body.nodo_id);
        const nodoSlug = req.nodoAuth ? req.nodoAuth.slug : (req.body && req.body.nodo_slug);
        const propuesta = await nodosService.anularODescartarPropuestaFraccion(req.params.id, {
            origen: 'GESTOR',
            nodo_id: nodoId,
            nodo_slug: nodoSlug
        });
        res.json({ ok: true, propuesta });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error anulando propuesta desde Gestor:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/propuestas/:id/descartar
 * Permite a Administración de LAMDA descartar una solicitud pendiente
 */
router.post('/propuestas/:id/descartar', async (req, res) => {
    try {
        const motivo = req.body && req.body.motivo;
        const propuesta = await nodosService.anularODescartarPropuestaFraccion(req.params.id, {
            origen: 'ADMIN',
            motivo
        });
        res.json({ ok: true, propuesta });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error descartando propuesta desde Administración:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/cotizar-aprobar
 * Cotiza en Pizarra una fracción, la aprueba en el catálogo aislado de Nodos
 * y propaga el Precio Base Nodo a las ofertas de los gestores.
 */
router.post('/cotizar-aprobar', async (req, res) => {
    try {
        const resultado = await nodosService.cotizarYAprobarArticuloNodo(req.body || {});
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error cotizando/aprobando artículo de Nodo:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/recalcular-cascada
 * Sincroniza todo el catálogo de Nodos con los costos vivos de los 6 Flujos de la Pizarra
 */
router.post('/recalcular-cascada', async (req, res) => {
    try {
        const costosSimulados = (req.body && req.body.costos_simulados) || {};
        const resultado = await nodosService.recalcularCascadaCatalogoNodos(costosSimulados);
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error recalculando cascada Nodos:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

/**
 * PUT /api/produccion/nodos/ofertas-gestor/:id
 * Actualiza el margen del gestor y/o el estado de publicación para sus vecinos
 */
router.put('/ofertas-gestor/:id', autenticarGestorSiPublicoOToken, async (req, res) => {
    try {
        if (req.nodoAuth) {
            await nodosService.asegurarOfertaPerteneceANodo(req.params.id, req.nodoAuth.id);
        }
        const oferta = await nodosService.actualizarOfertaGestor(req.params.id, req.body || {});
        res.json({ ok: true, oferta });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error actualizando oferta gestor:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/gestor/:nodoId/sumar-catalogo
 * Permite al Gestor incorporar en 1 toque a Mi Oferta y Márgenes un artículo ya cotizado
 * en el Catálogo Base de Nodos, sin pedir nueva cotización.
 */
router.post('/gestor/:nodoId/sumar-catalogo', autenticarGestorSiPublicoOToken, async (req, res) => {
    try {
        if (req.nodoAuth && Number(req.params.nodoId) !== Number(req.nodoAuth.id)) {
            return res.status(403).json({ ok: false, error: 'No autorizado para modificar otro Nodo.' });
        }
        const catalogoId = req.body && req.body.catalogo_id;
        const oferta = await nodosService.sumarArticuloCatalogoANodo(req.params.nodoId, catalogoId);
        res.json({ ok: true, oferta });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error incorporando artículo de catálogo al Nodo:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

// ============================================================================
// ENDPOINTS ETAPA 2: TIENDA MARCA BLANCA DEL VECINO Y PANEL DEL GESTOR
// ============================================================================

/**
 * GET /api/produccion/nodos/portal/:slug
 * Devuelve el catálogo publicado, horarios de corte, próxima entrega, pedidos y ofertas del Nodo
 */
router.get('/portal/:slug', async (req, res, next) => {
    const vistaReq = String(req.query.vista || '').trim().toLowerCase();
    if (vistaReq === 'gestor') {
        return autenticarGestorSiPublicoOToken(req, res, () => {
            if (req.nodoAuth && String(req.nodoAuth.slug || '').toLowerCase() !== String(req.params.slug || '').trim().toLowerCase()) {
                return res.status(403).json({
                    ok: false,
                    code: 'GESTOR_WRONG_NODE',
                    error: 'El token del Gestor no corresponde a este Nodo.'
                });
            }
            return next();
        });
    }
    return next();
}, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        const fechaSimulada = req.query.fecha_simulada || null;
        const vista = req.query.vista || '';
        const data = await nodosService.obtenerDatosPortalNodo(req.params.slug, fechaSimulada, {
            vista,
            strictSlug: true
        });
        res.json({ ok: true, ...data });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /portal/:slug:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

/**
 * GET /api/produccion/nodos/tienda/:slug/seguimiento/:token
 * Seguimiento en vivo Marca Blanca por token criptográfico (6 hitos envío / 5 hitos retiro)
 */
router.get('/tienda/:slug/seguimiento/:token', async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        const data = await nodosService.obtenerSeguimientoPublicoPedidoVecino(req.params.slug, req.params.token);
        res.json({ ok: true, ...data });
    } catch (error) {
        res.status(404).json({ ok: false, error: error.message });
    }
});

// Límite de tasa por IP para consultas públicas de seguimiento sin token (anti-enumeración en túnel móvil)
const _rateLimitSeguimientoWaMap = new Map();
const RATE_LIMIT_WA_VENTANA_MS = 60 * 1000;
const RATE_LIMIT_WA_MAX_POR_MINUTO = 12;

function limitarConsultasPublicasSeguimiento(req, res, next) {
    const ahora = Date.now();
    if (_rateLimitSeguimientoWaMap.size > 500) {
        for (const [k, v] of _rateLimitSeguimientoWaMap.entries()) {
            if (ahora - v.inicio > RATE_LIMIT_WA_VENTANA_MS) {
                _rateLimitSeguimientoWaMap.delete(k);
            }
        }
    }

    const ipRaw = String(
        req.headers['cf-connecting-ip'] ||
        (req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0] : '') ||
        req.ip ||
        req.socket?.remoteAddress ||
        'anon'
    ).trim();

    let registro = _rateLimitSeguimientoWaMap.get(ipRaw);
    if (!registro || (ahora - registro.inicio) >= RATE_LIMIT_WA_VENTANA_MS) {
        registro = { inicio: ahora, conteo: 0 };
        _rateLimitSeguimientoWaMap.set(ipRaw, registro);
    }

    registro.conteo += 1;
    if (registro.conteo > RATE_LIMIT_WA_MAX_POR_MINUTO) {
        const segRestantes = Math.max(1, Math.ceil((RATE_LIMIT_WA_VENTANA_MS - (ahora - registro.inicio)) / 1000));
        res.set('Retry-After', String(segRestantes));
        return res.status(429).json({
            ok: false,
            error: `Realizaste demasiadas consultas seguidas. Esperá ${segRestantes} segundos y volvé a intentar.`
        });
    }

    next();
}

/**
 * POST /api/produccion/nodos/tienda/:slug/seguimiento-whatsapp
 * Consulta pública de cero fricción ingresando únicamente el número de WhatsApp:
 * aplica límite de consultas por minuto y devuelve datos sensibles parcialmente enmascarados.
 */
router.post('/tienda/:slug/seguimiento-whatsapp', limitarConsultasPublicasSeguimiento, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        const data = await nodosService.consultarSeguimientoPublicoPorWhatsapp(req.params.slug, req.body || {});
        res.json({ ok: true, ...data });
    } catch (error) {
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/tienda/:slug/buscar-seguimiento
 * Buscador público validando coincidencia simultánea de WhatsApp + código #NB-...
 */
router.post('/tienda/:slug/buscar-seguimiento', limitarConsultasPublicasSeguimiento, async (req, res) => {
    try {
        const data = await nodosService.buscarSeguimientoPublicoPorTelefonoYPedido(req.params.slug, req.body || {});
        res.json({ ok: true, ...data });
    } catch (error) {
        res.status(400).json({ ok: false, error: error.message });
    }
});

const _rateLimitPedidosPublicosMap = new Map();
const RATE_LIMIT_PEDIDOS_VENTANA_MS = 60 * 1000;
const RATE_LIMIT_PEDIDOS_MAX_POR_MINUTO = 20;

function limitarPedidosPublicos(req, res, next) {
    const ahora = Date.now();
    if (_rateLimitPedidosPublicosMap.size > 500) {
        for (const [k, v] of _rateLimitPedidosPublicosMap.entries()) {
            if (ahora - v.inicio > RATE_LIMIT_PEDIDOS_VENTANA_MS) {
                _rateLimitPedidosPublicosMap.delete(k);
            }
        }
    }
    const ipRaw = String(
        req.headers['cf-connecting-ip'] ||
        (req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0] : '') ||
        req.ip ||
        req.socket?.remoteAddress ||
        'anon'
    ).trim();
    let reg = _rateLimitPedidosPublicosMap.get(ipRaw);
    if (!reg || (ahora - reg.inicio) >= RATE_LIMIT_PEDIDOS_VENTANA_MS) {
        reg = { inicio: ahora, conteo: 0 };
        _rateLimitPedidosPublicosMap.set(ipRaw, reg);
    }
    reg.conteo += 1;
    if (reg.conteo > RATE_LIMIT_PEDIDOS_MAX_POR_MINUTO) {
        const segRestantes = Math.max(1, Math.ceil((RATE_LIMIT_PEDIDOS_VENTANA_MS - (ahora - reg.inicio)) / 1000));
        res.set('Retry-After', String(segRestantes));
        return res.status(429).json({
            ok: false,
            error: `Demasiados pedidos seguidos desde esta conexión. Esperá ${segRestantes} segundos.`
        });
    }
    next();
}

/**
 * POST /api/produccion/nodos/gestor/:nodoId/lotes/:canastoId/confirmar-recepcion
 * Confirmación de 1 toque de recepción física del lote en el Nodo (Hito 3 -> 4 + Débito CB-NODO-xxx)
 */
router.post('/gestor/:nodoId/lotes/:canastoId/confirmar-recepcion', autenticarGestorSiPublicoOToken, async (req, res) => {
    try {
        if (req.nodoAuth && Number(req.params.nodoId) !== Number(req.nodoAuth.id)) {
            return res.status(403).json({ ok: false, error: 'No autorizado para confirmar lotes de otro Nodo.' });
        }
        const resultado = await nodosService.confirmarRecepcionLotePorGestor(
            req.params.nodoId,
            req.params.canastoId,
            req.body || {}
        );
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en confirmar-recepcion de lote:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/gestor/:nodoId/pedidos/:pedidoId/estado-entrega
 * Controles de 1 toque del Gestor: SALIO_REPARTO (Hito 5) y ENTREGADO (Hito 6 + cobro efectivo unificado)
 */
router.post('/gestor/:nodoId/pedidos/:pedidoId/estado-entrega', autenticarGestorSiPublicoOToken, async (req, res) => {
    try {
        if (req.nodoAuth) {
            if (Number(req.params.nodoId) !== Number(req.nodoAuth.id)) {
                return res.status(403).json({ ok: false, error: 'No autorizado para modificar entregas de otro Nodo.' });
            }
            await nodosService.asegurarPedidoPerteneceANodo(req.params.pedidoId, req.nodoAuth.id);
        }
        const resultado = await nodosService.actualizarEstadoEntregaVecinoPorGestor(
            req.params.nodoId,
            req.params.pedidoId,
            req.body || {}
        );
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en estado-entrega de pedido vecinal:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

/**
 * PUT /api/produccion/nodos/gestor/:nodoId/config-logistica
 * Actualiza desde el Panel del Gestor los días de entrega, horarios de corte,
 * ventanas de retiro y costo de envío barrial (100% para el gestor).
 */
router.put('/gestor/:nodoId/config-logistica', autenticarGestorSiPublicoOToken, async (req, res) => {
    try {
        if (req.nodoAuth && Number(req.params.nodoId) !== Number(req.nodoAuth.id)) {
            return res.status(403).json({ ok: false, error: 'No autorizado para configurar logística de otro Nodo.' });
        }
        const nodo = await nodosService.actualizarConfiguracionGestorNodo(req.params.nodoId, req.body || {});
        res.json({ ok: true, nodo });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en PUT /gestor/:nodoId/config-logistica:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

/**
 * GET /api/produccion/nodos/gestor/:nodoId/compartir-kit
 * Devuelve URL pública oficial Marca Blanca, QR PNG limpio y ofertas publicadas compartibles
 * para difusión directa del Gestor (WhatsApp abierto, redes, descarga QR).
 */
router.get('/gestor/:nodoId/compartir-kit', autenticarGestorSiPublicoOToken, async (req, res) => {
    try {
        if (req.nodoAuth && Number(req.params.nodoId) !== Number(req.nodoAuth.id)) {
            return res.status(403).json({
                ok: false,
                code: 'GESTOR_WRONG_NODE',
                error: 'No autorizado para acceder al kit de difusión de otro Nodo.'
            });
        }
        const [kit, baseMovil] = await Promise.all([
            nodosService.obtenerKitCompartirNodo(req.params.nodoId),
            obtenerUrlPublicaQrNodos(req)
        ]);
        const urlTiendaPublica = `${baseMovil}/tienda/${encodeURIComponent(kit.nodo.slug)}`;
        const qrTiendaDataUrl = await QRCode.toDataURL(urlTiendaPublica, {
            margin: 2,
            width: 512,
            errorCorrectionLevel: 'M'
        });

        res.json({
            ok: true,
            base_url_movil: baseMovil,
            es_tunel_https: baseMovil.startsWith('https://'),
            url_tienda_publica: urlTiendaPublica,
            qr_tienda_data_url: qrTiendaDataUrl,
            nodo: kit.nodo,
            proxima_entrega: kit.proxima_entrega,
            ofertas_publicadas: (kit.ofertas_publicadas || []).map(o => ({
                ...o,
                url_directa: `${urlTiendaPublica}?oferta=${encodeURIComponent(o.oferta_id)}`
            }))
        });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /gestor/:nodoId/compartir-kit:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

/**
 * GET /api/produccion/nodos/gestor/:nodoId/compradores
 * Lista los compradores registrados en `nodos_vecinos` pertenecientes exclusivamente al Nodo autenticado.
 */
router.get('/gestor/:nodoId/compradores', autenticarGestorSiPublicoOToken, async (req, res) => {
    try {
        if (req.nodoAuth && Number(req.params.nodoId) !== Number(req.nodoAuth.id)) {
            return res.status(403).json({
                ok: false,
                code: 'GESTOR_WRONG_NODE',
                error: 'No autorizado para consultar compradores de otro Nodo.'
            });
        }
        const data = await nodosService.obtenerCompradoresRegistradosNodo(req.params.nodoId);
        res.json({ ok: true, ...data });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /gestor/:nodoId/compradores:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/tienda/:slug/pedido
 * Registra el pedido de un vecino desde la Tienda Marca Blanca
 */
router.post('/tienda/:slug/pedido', limitarPedidosPublicos, async (req, res) => {
    try {
        const resultado = await nodosService.crearPedidoVecinoTienda(req.params.slug, req.body || {});
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /tienda/:slug/pedido:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * GET /api/produccion/nodos/pedidos/:pedidoId/etiqueta
 * Devuelve la etiqueta térmica Zebra en doble columna (PNG + ZPL) de un pedido vecinal
 */
router.get('/pedidos/:pedidoId/etiqueta', async (req, res) => {
    try {
        const esPublico = esSolicitudPublicaNodos(req);
        const gestorToken = extraerTokenGestorRequest(req);
        const trackingToken = String(req.query?.tracking_token || '').trim();
        const etiqueta = await nodosService.obtenerEtiquetaDePedidoAutorizada(req.params.pedidoId, {
            requerirAutorizacion: esPublico || Boolean(gestorToken) || Boolean(trackingToken),
            gestorToken,
            trackingToken
        });
        res.json({ ok: true, ...etiqueta });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /pedidos/:pedidoId/etiqueta:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

// ============================================================================
// ENDPOINTS ETAPA 3: MESA DE ARMADO, 4° DEPÓSITO (ESTACION_NODOS) Y QR MAESTRO
// ============================================================================

/**
 * GET /api/produccion/nodos/deposito/tablero
 * Devuelve los Canastos de ESTACION_NODOS, el resumen consolidado a fraccionar y las bolsas por vecino
 */
router.get('/deposito/tablero', async (req, res) => {
    try {
        const data = await nodosService.obtenerTableroMesaArmadoDeposito({
            nodo_id: req.query.nodo_id || 0
        });
        res.json({ ok: true, ...data });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /deposito/tablero:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/deposito/pedidos/:pedidoId/armar-bolsa
 * Marca el pedido de un vecino como preparado, lo aloja en el Canasto de ESTACION_NODOS
 * y devuelve su par gemelo de etiquetas térmicas Zebra.
 */
router.post('/deposito/pedidos/:pedidoId/armar-bolsa', async (req, res) => {
    try {
        const resultado = await nodosService.armarBolsaPedidoVecino(req.params.pedidoId, req.body || {});
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /deposito/pedidos/:pedidoId/armar-bolsa:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/deposito/canastos/:canastoId/armar-todo
 * Marca todas las bolsas pendientes del Canasto como listas en ESTACION_NODOS
 */
router.post('/deposito/canastos/:canastoId/armar-todo', async (req, res) => {
    try {
        const resultado = await nodosService.armarTodasBolsasDeCanasto(req.params.canastoId, req.body || {});
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /deposito/canastos/:canastoId/armar-todo:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * GET /api/produccion/nodos/deposito/canastos/:canastoId/etiqueta-qr
 * Genera la Etiqueta Maestra del Canasto con su QR Maestro y manifiesto de bolsas
 */
router.get('/deposito/canastos/:canastoId/etiqueta-qr', async (req, res) => {
    try {
        const etiqueta = await nodosService.generarEtiquetaQrMaestroCanasto(req.params.canastoId);
        res.json({ ok: true, ...etiqueta });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /deposito/canastos/:canastoId/etiqueta-qr:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/deposito/canastos/:canastoId/entregar-gestor
 * Confirma el retiro del Canasto por el Gestor (escaneo QR Maestro), pasa los pedidos
 * a "En reparto / En poder del Gestor" e impacta el Débito por Costo Base LAMDA en Cta. Cte.
 */
router.post('/deposito/canastos/:canastoId/entregar-gestor', async (req, res) => {
    try {
        const resultado = await nodosService.confirmarRetiroCanastoPorGestor(req.params.canastoId, req.body || {});
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /deposito/canastos/:canastoId/entregar-gestor:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/deposito/canastos/:canastoId/reabrir-prueba
 * Permite en Modo Laboratorio reabrir un Canasto entregado para volver a probar el flujo
 */
router.post('/deposito/canastos/:canastoId/reabrir-prueba', async (req, res) => {
    try {
        const tablero = await nodosService.reabrirCanastoParaPruebaLaboratorio(req.params.canastoId);
        res.json({ ok: true, tablero });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /deposito/canastos/:canastoId/reabrir-prueba:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

// ============================================================================
// ENDPOINTS ETAPA 4: CONCILIACIÓN DE COBROS Y LIQUIDACIÓN DE CUENTA CORRIENTE
// ============================================================================

/**
 * GET /api/produccion/nodos/liquidacion/tablero
 * Devuelve los lotes, el cuadro de liquidación y compensación automática,
 * los titulares bancarios aprendidos y el libro mayor de Cuenta Corriente del Nodo.
 */
router.get('/liquidacion/tablero', autenticarGestorSiPublicoOToken, async (req, res) => {
    try {
        const nodoIdSeguro = req.nodoAuth ? Number(req.nodoAuth.id) : (req.query.nodo_id || 0);
        const data = await nodosService.obtenerTableroLiquidacionCobros({
            nodo_id: nodoIdSeguro
        });
        res.json({ ok: true, ...data });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /liquidacion/tablero:', error);
        res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/liquidacion/pedidos/:pedidoId/conciliar-pago
 * Concilia una transferencia vecinal en Banco LAMDA (acreditando a favor del Nodo y
 * aprendiendo el titular) o registra el cobro en efectivo en mano del Gestor.
 */
router.post('/liquidacion/pedidos/:pedidoId/conciliar-pago', autenticarGestorSiPublicoOToken, async (req, res) => {
    try {
        if (req.nodoAuth) {
            await nodosService.asegurarPedidoPerteneceANodo(req.params.pedidoId, req.nodoAuth.id);
            const medio = String(req.body?.medio_pago || '').trim().toUpperCase();
            if (medio !== 'EFECTIVO') {
                return res.status(403).json({
                    ok: false,
                    error: 'Desde el Panel del Gestor solo se puede registrar cobro en efectivo en mano.'
                });
            }
        }
        const tablero = await nodosService.conciliarPagoPedidoVecino(req.params.pedidoId, req.body || {});
        res.json({ ok: true, tablero });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /liquidacion/pedidos/:pedidoId/conciliar-pago:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/liquidacion/canastos/:canastoId/conciliar-todo
 * Concilia todos los cobros pendientes del lote (transferencias + efectivo)
 */
router.post('/liquidacion/canastos/:canastoId/conciliar-todo', async (req, res) => {
    try {
        const tablero = await nodosService.conciliarTodosLosPagosPendientesCanasto(req.params.canastoId);
        res.json({ ok: true, tablero });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /liquidacion/canastos/:canastoId/conciliar-todo:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/liquidacion/canastos/:canastoId/cerrar-liquidacion
 * Ejecuta la compensación automática y deja saldada la Cuenta Corriente del lote
 */
router.post('/liquidacion/canastos/:canastoId/cerrar-liquidacion', async (req, res) => {
    try {
        const tablero = await nodosService.cerrarLiquidacionCanasto(req.params.canastoId, req.body || {});
        res.json({ ok: true, tablero });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /liquidacion/canastos/:canastoId/cerrar-liquidacion:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/liquidacion/canastos/:canastoId/reabrir-prueba
 * Permite en Modo Laboratorio reabrir los cobros y la liquidación del lote para repetir la prueba
 */
router.post('/liquidacion/canastos/:canastoId/reabrir-prueba', async (req, res) => {
    try {
        const tablero = await nodosService.reabrirLiquidacionCanastoPrueba(req.params.canastoId);
        res.json({ ok: true, tablero });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /liquidacion/canastos/:canastoId/reabrir-prueba:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/liquidacion/pedidos/:pedidoId/anular
 * Anula un pedido de vecino antes de su entrega/despacho revirtiendo subcuenta y Cta. Cte. si correspondiera
 */
router.post('/liquidacion/pedidos/:pedidoId/anular', async (req, res) => {
    try {
        const resultado = await nodosService.anularPedidoVecinoNodo(req.params.pedidoId, req.body || {});
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /liquidacion/pedidos/:pedidoId/anular:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/liquidacion/pedidos/:pedidoId/nota-credito
 * Aplica una Nota de Crédito / ajuste parcial sobre un pedido de vecino antes del cierre del lote
 */
router.post('/liquidacion/pedidos/:pedidoId/nota-credito', async (req, res) => {
    try {
        const resultado = await nodosService.aplicarNotaCreditoPedidoVecino(req.params.pedidoId, req.body || {});
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /liquidacion/pedidos/:pedidoId/nota-credito:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * GET /api/produccion/nodos/bunker-arbol/:nodoId
 * Devuelve el árbol desplegable de un Nodo Barrial (cuadratura en vivo + subcuentas de vecinos)
 */
router.get('/bunker-arbol/:nodoId', async (req, res) => {
    try {
        const data = await nodosService.obtenerArbolNodoClientesBunker(req.params.nodoId, {
            search: req.query.search || ''
        });
        res.json({ ok: true, ...data });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /bunker-arbol/:nodoId:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * GET /api/produccion/nodos/vecinos/:vecinoId/subcuenta
 * Devuelve el detalle completo de la subcuenta de un vecino comprador (pedidos + libro mayor + KPIs)
 */
router.get('/vecinos/:vecinoId/subcuenta', async (req, res) => {
    try {
        const data = await nodosService.obtenerSubcuentaVecinoDetalle(req.params.vecinoId);
        res.json({ ok: true, ...data });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /vecinos/:vecinoId/subcuenta:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * Resuelve la URL pública HTTPS accesible desde cualquier celular (túnel Cloudflare activo o dominio Cloud),
 * garantizando que los códigos QR jamás apunten a `localhost`.
 */
async function obtenerUrlPublicaQrNodos(req) {
    const publicBaseEnv = String(process.env.NODOS_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
    if (publicBaseEnv) {
        return publicBaseEnv;
    }
    const hostHeader = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').split(',')[0].trim();
    const proto = String(req?.headers?.['x-forwarded-proto'] || req?.protocol || 'http').split(',')[0].trim();
    const isPublicCloud = hostHeader && !/^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.)/i.test(hostHeader);
    if (isPublicCloud) {
        return `${proto}://${hostHeader}`;
    }
    if (tunelCloudflareUrlActual && !(await verificarTunelVivo(tunelCloudflareUrlActual))) {
        tunelCloudflareUrlActual = null;
    }
    const tunelHttps = await asegurarTunelCloudflareNodos();
    if (tunelHttps) {
        return tunelHttps;
    }
    const lanIp = detectarIpLanWifiLocal();
    return `http://${lanIp}:3002`;
}

async function construirPayloadQrNodo(nodo, baseMovil) {
    const slugEnc = encodeURIComponent(nodo.slug);
    const tokenQ = nodo.gestor_token ? `?t=${encodeURIComponent(nodo.gestor_token)}` : '';
    const urlMovilGestor = `${baseMovil}/gestor/${slugEnc}${tokenQ}`;
    const urlMovilTienda = `${baseMovil}/tienda/${slugEnc}`;
    const urlPcGestor = `http://localhost:3002/gestor/${slugEnc}${tokenQ}`;
    const urlPcTienda = `http://localhost:3002/tienda/${slugEnc}`;

    const [qrGestorDataUrl, qrTiendaDataUrl] = await Promise.all([
        QRCode.toDataURL(urlMovilGestor, { margin: 2, width: 360, errorCorrectionLevel: 'M' }),
        QRCode.toDataURL(urlMovilTienda, { margin: 2, width: 360, errorCorrectionLevel: 'M' })
    ]);

    return {
        ok: true,
        tipo: 'NODO_GESTOR',
        base_url_movil: baseMovil,
        es_dominio_publico_fijo: Boolean(String(process.env.NODOS_PUBLIC_BASE_URL || '').trim()),
        es_tunel_https: baseMovil.startsWith('https://'),
        nodo,
        url_movil_gestor: urlMovilGestor,
        url_pc_gestor: urlPcGestor,
        qr_gestor_data_url: qrGestorDataUrl,
        url_movil_tienda: urlMovilTienda,
        url_pc_tienda: urlPcTienda,
        qr_tienda_data_url: qrTiendaDataUrl
    };
}

/**
 * GET /api/produccion/nodos/tienda/:slug/mi-cuenta/:portalToken
 * Portal personal 100% Marca Blanca del Vecino ("Mi Cuenta / Mis Pedidos"):
 * saldo al día / pendiente, pedido en curso con seguimiento en vivo, recibos digitales e historial.
 */
router.get('/tienda/:slug/mi-cuenta/:portalToken', async (req, res) => {
    try {
        const data = await nodosService.obtenerPortalCuentaVecinoMarcaBlanca(
            req.params.slug,
            req.params.portalToken
        );
        res.json({ ok: true, ...data });
    } catch (error) {
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * GET /api/produccion/nodos/accesos-qr/nodo/:idOrSlug
 * Genera los códigos QR grandes y enlaces directos del Gestor del Nodo (/gestor/:slug)
 * y de la Tienda Pública del Nodo (/tienda/:slug) sobre el túnel móvil activo.
 */
router.get('/accesos-qr/nodo/:idOrSlug', async (req, res) => {
    try {
        const [nodo, baseMovil] = await Promise.all([
            nodosService.obtenerDatosQrAccesoNodo(req.params.idOrSlug),
            obtenerUrlPublicaQrNodos(req)
        ]);
        const payload = await construirPayloadQrNodo(nodo, baseMovil);
        res.json(payload);
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /accesos-qr/nodo/:idOrSlug:', error.message);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/accesos-qr/nodo/:idOrSlug/rotar-token
 * Rota inmediatamente el gestor_token criptográfico e invalida los QRs anteriores del Gestor.
 */
router.post('/accesos-qr/nodo/:idOrSlug/rotar-token', async (req, res) => {
    try {
        const [nodo, baseMovil] = await Promise.all([
            nodosService.rotarGestorTokenNodo(req.params.idOrSlug),
            obtenerUrlPublicaQrNodos(req)
        ]);
        const payload = await construirPayloadQrNodo(nodo, baseMovil);
        res.json(payload);
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /accesos-qr/nodo/:idOrSlug/rotar-token:', error.message);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * GET /api/produccion/nodos/accesos-qr/vecino/:vecinoId
 * Genera el código QR personal "Ver como Cliente" de un vecino comprador (/tienda/:slug/mi-cuenta/:portalToken)
 * sobre el túnel móvil activo, sin exponer datos de otros vecinos ni de LAMDA.
 */
router.get('/accesos-qr/vecino/:vecinoId', async (req, res) => {
    try {
        const [datosVec, baseMovil] = await Promise.all([
            nodosService.obtenerDatosQrAccesoVecino(req.params.vecinoId),
            obtenerUrlPublicaQrNodos(req)
        ]);
        const slugEnc = encodeURIComponent(datosVec.nodo.slug);
        const tokEnc = encodeURIComponent(datosVec.portal_token);
        const urlMovilVecino = `${baseMovil}/tienda/${slugEnc}/mi-cuenta/${tokEnc}`;
        const urlPcVecino = `http://localhost:3002/tienda/${slugEnc}/mi-cuenta/${tokEnc}`;
        const qrVecinoDataUrl = await QRCode.toDataURL(urlMovilVecino, {
            margin: 2,
            width: 360,
            errorCorrectionLevel: 'M'
        });

        res.json({
            ok: true,
            tipo: 'VECINO_CLIENTE',
            base_url_movil: baseMovil,
            es_tunel_https: baseMovil.startsWith('https://'),
            vecino: {
                id: datosVec.vecino_id,
                codigo_vecino: datosVec.codigo_vecino,
                nombre_completo: datosVec.nombre_completo,
                telefono_whatsapp: datosVec.telefono_whatsapp,
                saldo_actual: datosVec.saldo_actual
            },
            nodo: datosVec.nodo,
            url_movil_vecino: urlMovilVecino,
            url_pc_vecino: urlPcVecino,
            qr_vecino_data_url: qrVecinoDataUrl
        });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /accesos-qr/vecino/:vecinoId:', error.message);
        res.status(400).json({ ok: false, error: error.message });
    }
});

// ============================================================================
// ENDPOINTS INTEGRACIÓN CON EL CIRCUITO OPERATIVO HABITUAL DE LAMDA
// (Pizarra Principal :3000 -> Producción/Carro Personal -> Imprimir -> Armar/Chequeo -> Reparto :3005)
// ============================================================================

/**
 * GET /api/produccion/nodos/circuito-lamda/estado
 * Devuelve el estado sincronizado de todos los Canastos de Nodos dentro del circuito operativo LAMDA
 */
router.get('/circuito-lamda/estado', async (req, res) => {
    try {
        const data = await nodosService.obtenerEstadoCircuitoOperativoLamda();
        res.json({ ok: true, ...data });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /circuito-lamda/estado:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/circuito-lamda/canastos/:canastoId/etapa
 * Permite avanzar o situar un Canasto en una etapa específica del circuito habitual de LAMDA
 */
router.post('/circuito-lamda/canastos/:canastoId/etapa', async (req, res) => {
    try {
        const etapa = req.body?.etapa || 'IMPRIMIR_CON_FALTANTES';
        const data = await nodosService.cambiarEtapaCircuitoLamdaCanasto(req.params.canastoId, etapa);
        res.json({ ok: true, ...data });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /circuito-lamda/canastos/:canastoId/etapa:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/reset-pruebas
 * Pone a cero todos los datos de muestra de Nodos (tablas nodos_* + clientes + cuentas corrientes + presupuestos canastos)
 */
router.post('/reset-pruebas', async (req, res) => {
    try {
        if (esSolicitudPublicaNodos(req) || !esModoLaboratorioWaSegura()) {
            return res.status(403).json({
                ok: false,
                error: 'Operación /reset-pruebas bloqueada fuera del Laboratorio aislado.'
            });
        }
        const conservarArticulosBase = req.body?.conservar_articulos_base !== false;
        const resultado = await nodosService.ponerACeroDatosNodosBarriales({ conservarArticulosBase });
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /reset-pruebas:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/whatsapp-prueba
 * Despacha el mensaje directamente por el servicio interno de WhatsApp de LAMDA (:3004/facturacion/whatsapp/enviar-mensaje)
 * sin abrir ventanas externas wa.me en el navegador, y normaliza las URLs de /gestor y /tienda a la IP LAN Wi-Fi
 * para que puedan tocarse y abrirse directamente desde el celular.
 */
router.post('/whatsapp-prueba', async (req, res) => {
    try {
        if (esSolicitudPublicaNodos(req) || !esModoLaboratorioWaSegura()) {
            return res.status(403).json({
                ok: false,
                error: 'Endpoint de WhatsApp de laboratorio deshabilitado en Producción.'
            });
        }
        const telefonoPrueba = '5492216615746';
        const telefonoOriginal = String(req.body?.telefono_original || '').trim();
        const destinatarioNombre = String(req.body?.destinatario_nombre || 'Cliente / Vecino').trim();
        const soloPreview = Boolean(req.body?.solo_preview);
        const baseUrlMovil = await obtenerBaseUrlAccesibleCelular(req);

        let mensajeNormalizado = String(req.body?.mensaje || '').trim();
        mensajeNormalizado = mensajeNormalizado
            .replace(/https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?(\/gw\/3002)?(?=\/(gestor|tienda|deposito-nodos|liquidacion-nodos))/gi, baseUrlMovil)
            .replace(/https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?/gi, baseUrlMovil);

        const urlRegex = /https?:\/\/[^\s)]+\/(gestor|tienda)\/[^\s)]+/gi;
        const rawUrls = [...new Set(mensajeNormalizado.match(urlRegex) || [])];
        const linksDetectados = [];
        for (const u of rawUrls) {
            let qrDataUrl = null;
            try {
                qrDataUrl = await QRCode.toDataURL(u, { margin: 1, width: 180 });
            } catch (_) {}
            linksDetectados.push({
                tipo: /\/gestor\//i.test(u) ? 'GESTOR' : 'TIENDA',
                label: /\/gestor\//i.test(u) ? '🎛️ Panel del Gestor' : '🛒 Tienda del Vecino',
                url: u,
                qr_data_url: qrDataUrl
            });
        }

        if (soloPreview) {
            return res.json({
                ok: true,
                preview_only: true,
                enviado_directo: false,
                modo_laboratorio: true,
                simulated: false,
                telefono_destino_forzado: telefonoPrueba,
                telefono_destino_display: '221 661 5746',
                telefono_original: telefonoOriginal,
                destinatario_nombre: destinatarioNombre,
                base_url_movil: baseUrlMovil,
                mensaje_enviado: mensajeNormalizado,
                links_detectados: linksDetectados,
                resultados_wa: []
            });
        }

        console.log(`🧪 [MODO LABORATORIO - NODOS WA INTERNO] Despachando vía servicio interno (:3004) para "${destinatarioNombre}" (${telefonoOriginal || 'S/T'}) -> ${telefonoPrueba} (221 661 5746) | Base Móvil: ${baseUrlMovil}`);

        let estadoWa = null;
        for (let intento = 0; intento < 15; intento++) {
            try {
                const stRes = await fetch('http://127.0.0.1:3004/facturacion/whatsapp/status');
                if (stRes.ok) {
                    const stJson = await stRes.json();
                    estadoWa = stJson?.data || null;
                    if (estadoWa?.status === 'CONECTADO' || estadoWa?.status === 'ESPERANDO_QR') {
                        break;
                    }
                }
            } catch (_) {}
            await new Promise(r => setTimeout(r, 1500));
        }

        const wpRes = await fetch('http://127.0.0.1:3004/facturacion/whatsapp/enviar-mensaje', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                destinatarios: telefonoOriginal || telefonoPrueba,
                mensajeTexto: mensajeNormalizado
            })
        });

        const wpJson = await wpRes.json();
        if (!wpRes.ok || !wpJson.success) {
            throw new Error(wpJson.error || wpJson.message || 'No se pudo despachar el mensaje por el servicio interno de WhatsApp (:3004).');
        }

        const resultados = Array.isArray(wpJson?.data?.resultados) ? wpJson.data.resultados : [];
        const primerResultado = resultados[0] || {};
        if (primerResultado.status && primerResultado.status !== 'enviado') {
            throw new Error(primerResultado.error || `No se pudo enviar el mensaje (${primerResultado.status}).`);
        }

        res.json({
            ok: true,
            preview_only: false,
            enviado_directo: true,
            modo_laboratorio: true,
            simulated: Boolean(primerResultado.simulated),
            step_text_wa: estadoWa?.stepText || '',
            telefono_destino_forzado: telefonoPrueba,
            telefono_destino_display: '221 661 5746',
            telefono_original: telefonoOriginal,
            destinatario_nombre: destinatarioNombre,
            base_url_movil: baseUrlMovil,
            mensaje_enviado: mensajeNormalizado,
            links_detectados: linksDetectados,
            resultados_wa: resultados
        });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /whatsapp-prueba:', error.message);
        res.status(500).json({ ok: false, error: error.message });
    }
});

module.exports = router;
