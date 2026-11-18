const express = require('express');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const QRCode = require('qrcode');
const multer = require('multer');
const router = express.Router();
const nodosService = require('../services/nodosBarrialesService');
const nodosAnaliticaService = require('../services/nodosAnaliticaService');
const nodosPwaService = require('../services/nodosPwaService');
const nodosFotosService = require('../services/nodosFotosService');

const uploadFotoNodoMemoria = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 12 * 1024 * 1024,
        files: 1
    }
});

const uploadVideoNodoDisco = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, os.tmpdir()),
        filename: (_req, file, cb) => {
            const rawExt = path.extname(String(file.originalname || '.mp4')).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10) || '.mp4';
            cb(null, `lamda_vid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}${rawExt}`);
        }
    }),
    limits: {
        fileSize: 45 * 1024 * 1024,
        files: 1
    }
});

const uploadComprobantePagoMemoria = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 1
    }
});

const uploadExtractoGaliciaMemoria = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024,
        files: 1
    }
});

function middlewareSubidaComprobanteOpcional(req, res, next) {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (!contentType.includes('multipart/form-data')) {
        return next();
    }
    return uploadComprobantePagoMemoria.single('comprobante')(req, res, (err) => {
        if (err) {
            const esTamano = err.code === 'LIMIT_FILE_SIZE';
            return res.status(400).json({
                ok: false,
                error: esTamano
                    ? 'El comprobante supera el límite máximo permitido (5 MB).'
                    : ('Error recibiendo comprobante: ' + err.message)
            });
        }
        return next();
    });
}

function middlewareSubidaFotoOpcional(req, res, next) {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (!contentType.includes('multipart/form-data')) {
        return next();
    }
    return uploadFotoNodoMemoria.single('foto')(req, res, (err) => {
        if (err) {
            const esTamano = err.code === 'LIMIT_FILE_SIZE';
            return res.status(400).json({
                ok: false,
                error: esTamano
                    ? 'La foto supera el límite máximo permitido (12 MB).'
                    : ('Error recibiendo imagen: ' + err.message)
            });
        }
        return next();
    });
}

function middlewareSubidaVideoUnico(req, res, next) {
    return uploadVideoNodoDisco.single('video')(req, res, (err) => {
        if (err) {
            if (req.file && req.file.path && fs.existsSync(req.file.path)) {
                try { fs.unlinkSync(req.file.path); } catch (_) {}
            }
            const esTamano = err.code === 'LIMIT_FILE_SIZE';
            return res.status(400).json({
                ok: false,
                error: esTamano
                    ? 'El video supera el peso máximo permitido (45 MB). Grabá un clip más corto.'
                    : ('Error recibiendo el video: ' + err.message)
            });
        }
        return next();
    });
}

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

function bloquearEnHostPublicoTienda(req, res, next) {
    if (esSolicitudPublicaNodos(req)) {
        return res.status(403).json({
            ok: false,
            code: 'INTERNAL_ADMIN_ONLY',
            error: 'Ruta administrativa interna de LAMDA bloqueada en el dominio público de tiendas.'
        });
    }
    return next();
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
    const hostClean = hostHeader.replace(/:\d+$/, '').toLowerCase();
    const proto = String(req?.headers?.['x-forwarded-proto'] || req?.protocol || 'http').split(',')[0].trim();
    const isPublicCloud = hostClean && !/^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.)/i.test(hostClean);
    if (isPublicCloud) {
        if (hostClean.endsWith('.lamdaser.com') && NODOS_PUBLIC_HOST_CONFIG) {
            return `https://${NODOS_PUBLIC_HOST_CONFIG}`;
        }
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
 * GET /api/produccion/nodos/diccionario-bunker
 * Catálogo relacional oficial del Diccionario Búnker (Familias, Posiciones, Sustantivos Ancla,
 * Términos vinculados por familia + principal y Rubros/Subrubros) para Caso B de la Mesa Cotizadora.
 */
router.get('/diccionario-bunker', async (req, res) => {
    try {
        if (esSolicitudPublicaNodos(req)) {
            return res.status(403).json({ ok: false, error: 'Diccionario Búnker restringido a administración interna.' });
        }
        const data = await nodosService.obtenerDiccionarioBunkerCotizador(
            req.query.familia_id || null,
            req.query.articulo_principal_id || null
        );
        res.json({ ok: true, ...data });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /diccionario-bunker:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/previsualizar-anatomia
 * Resuelve en vivo para la Mesa Cotizadora el SKU oficial y la Nomenclatura Oficial del Diccionario Búnker.
 */
router.post(['/previsualizar-anatomia', '/cotizar-preview'], async (req, res) => {
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
        if (esSolicitudPublicaNodos(req)) {
            return res.status(403).json({ ok: false, error: 'Operación restringida a administración interna.' });
        }
        const nodo = await nodosService.guardarNodoMaestro(req.body || {}, null);
        res.json({ ok: true, nodo });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error creando Nodo:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/maestro/:id/clonar
 * Clona en 1 clic la configuración operativa de una tienda existente (ej. MANSO o Paraíso)
 */
router.post('/maestro/:id/clonar', async (req, res) => {
    try {
        if (esSolicitudPublicaNodos(req)) {
            return res.status(403).json({ ok: false, error: 'Operación restringida a administración interna.' });
        }
        const resultado = await nodosService.clonarNodoMaestro(req.params.id, req.body || {});
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error clonando tienda:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

/**
 * PUT /api/produccion/nodos/maestro/:id
 * Actualiza un Nodo Barrial existente y regenera su gráfico ZPL ^GFA
 */
router.put('/maestro/:id', async (req, res) => {
    try {
        if (esSolicitudPublicaNodos(req)) {
            return res.status(403).json({ ok: false, error: 'Operación restringida a administración interna.' });
        }
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
 * ============================================================================
 * COMBOS / PACKS COMPUESTOS (LDN 8 + SOLICITUDES DESDE TIENDAS)
 * ============================================================================
 */
router.get('/combos/estado', bloquearEnHostPublicoTienda, async (req, res) => {
    try {
        const data = await nodosService.obtenerEstadoCombosPizarra();
        res.json({ ok: true, ...data });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /combos/estado:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

router.post('/combos/previsualizar', bloquearEnHostPublicoTienda, async (req, res) => {
    try {
        const preview = await nodosService.previsualizarCotizacionCombo(req.body || {});
        res.json({ ok: true, ...preview });
    } catch (error) {
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

router.post('/combos/cotizar-aprobar', bloquearEnHostPublicoTienda, async (req, res) => {
    try {
        const resultado = await nodosService.cotizarYAprobarCombo(req.body || {});
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /combos/cotizar-aprobar:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

router.post('/propuestas-combos', autenticarGestorSiPublicoOToken, async (req, res) => {
    try {
        const body = { ...(req.body || {}) };
        if (req.nodoAuth) {
            if (body.nodo_solicitante_id && Number(body.nodo_solicitante_id) !== Number(req.nodoAuth.id)) {
                return res.status(403).json({ ok: false, error: 'No autorizado para enviar solicitudes en nombre de otra tienda.' });
            }
            body.nodo_solicitante_id = req.nodoAuth.id;
        }
        const propuesta = await nodosService.crearPropuestaComboGestor(body);
        res.json({ ok: true, propuesta });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error creando propuesta de combo:', error);
        res.status(error.statusCode || 400).json({
            ok: false,
            error: error.message,
            combo_existente: error.combo_existente || null,
            propuesta_existente: error.propuesta_existente || null
        });
    }
});

router.post('/propuestas-combos/:id/anular', autenticarGestorSiPublicoOToken, async (req, res) => {
    try {
        const nodoIdRestringido = req.nodoAuth ? Number(req.nodoAuth.id) : (req.body?.nodo_id ? Number(req.body.nodo_id) : null);
        const propuesta = await nodosService.anularODescartarPropuestaCombo(req.params.id, {
            accion: 'anular',
            nodoIdRestringido
        });
        res.json({ ok: true, propuesta });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error anulando propuesta de combo:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

router.post('/propuestas-combos/:id/descartar', bloquearEnHostPublicoTienda, async (req, res) => {
    try {
        const motivo = req.body && req.body.motivo;
        const propuesta = await nodosService.anularODescartarPropuestaCombo(req.params.id, {
            accion: 'descartar',
            motivo
        });
        res.json({ ok: true, propuesta });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error descartando propuesta de combo:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
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
 * ============================================================================
 * ÁLBUM DE FOTOS POR OFERTA DEL NODO (AUTO-MEJORA ADAPTATIVA + CICLO COMPLETO)
 * ============================================================================
 */
router.post('/ofertas-gestor/:id/fotos/preview', autenticarGestorSiPublicoOToken, middlewareSubidaFotoOpcional, async (req, res) => {
    try {
        if (req.nodoAuth) {
            await nodosService.asegurarOfertaPerteneceANodo(req.params.id, req.nodoAuth.id);
        }
        const body = req.body || {};
        const resultado = await nodosFotosService.previsualizarFotoOferta({
            ofertaId: req.params.id,
            nodoAuthId: req.nodoAuth ? req.nodoAuth.id : null,
            fileBuffer: req.file ? req.file.buffer : null,
            fotoId: body.foto_id || null,
            rotacion: body.rotacion,
            crop: body.crop,
            previewAmbas: body.preview_ambas !== false && body.preview_ambas !== 'false',
            incluirBaseEncuadre: body.incluir_base_encuadre === true || body.incluir_base_encuadre === 'true'
        });
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en preview de foto de oferta:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

router.post('/ofertas-gestor/:id/fotos', autenticarGestorSiPublicoOToken, middlewareSubidaFotoOpcional, async (req, res) => {
    try {
        if (req.nodoAuth) {
            await nodosService.asegurarOfertaPerteneceANodo(req.params.id, req.nodoAuth.id);
        }
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({ ok: false, error: 'Debés adjuntar una foto para agregar al álbum.' });
        }
        const body = req.body || {};
        const resultado = await nodosFotosService.agregarFotoOferta({
            ofertaId: req.params.id,
            nodoAuthId: req.nodoAuth ? req.nodoAuth.id : null,
            fileBuffer: req.file.buffer,
            rotacion: body.rotacion,
            crop: body.crop,
            aplicarFiltro: body.aplicar_filtro
        });
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error agregando foto a oferta:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

router.put('/ofertas-gestor/:id/fotos-orden', autenticarGestorSiPublicoOToken, async (req, res) => {
    try {
        if (req.nodoAuth) {
            await nodosService.asegurarOfertaPerteneceANodo(req.params.id, req.nodoAuth.id);
        }
        const body = req.body || {};
        const resultado = await nodosFotosService.reordenarFotosOferta({
            ofertaId: req.params.id,
            nodoAuthId: req.nodoAuth ? req.nodoAuth.id : null,
            ordenIds: Array.isArray(body.orden_ids) ? body.orden_ids : null,
            portadaId: body.portada_id || null
        });
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error reordenando fotos de oferta:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

router.put('/ofertas-gestor/:id/fotos/:fotoId', autenticarGestorSiPublicoOToken, middlewareSubidaFotoOpcional, async (req, res) => {
    try {
        if (req.nodoAuth) {
            await nodosService.asegurarOfertaPerteneceANodo(req.params.id, req.nodoAuth.id);
        }
        const body = req.body || {};
        const resultado = await nodosFotosService.editarOReemplazarFotoOferta({
            ofertaId: req.params.id,
            fotoId: req.params.fotoId,
            nodoAuthId: req.nodoAuth ? req.nodoAuth.id : null,
            fileBuffer: req.file ? req.file.buffer : null,
            rotacion: body.rotacion,
            crop: body.crop,
            aplicarFiltro: body.aplicar_filtro
        });
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error editando/reemplazando foto de oferta:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

router.delete('/ofertas-gestor/:id/fotos/:fotoId', autenticarGestorSiPublicoOToken, async (req, res) => {
    try {
        if (req.nodoAuth) {
            await nodosService.asegurarOfertaPerteneceANodo(req.params.id, req.nodoAuth.id);
        }
        const resultado = await nodosFotosService.eliminarFotoOferta({
            ofertaId: req.params.id,
            fotoId: req.params.fotoId,
            nodoAuthId: req.nodoAuth ? req.nodoAuth.id : null
        });
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error eliminando foto de oferta:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

router.delete('/ofertas-gestor/:id/fotos', autenticarGestorSiPublicoOToken, async (req, res) => {
    try {
        if (req.nodoAuth) {
            await nodosService.asegurarOfertaPerteneceANodo(req.params.id, req.nodoAuth.id);
        }
        const resultado = await nodosFotosService.vaciarAlbumOferta({
            ofertaId: req.params.id,
            nodoAuthId: req.nodoAuth ? req.nodoAuth.id : null
        });
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error vaciando álbum de oferta:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

router.post('/ofertas-gestor/:id/videos', autenticarGestorSiPublicoOToken, middlewareSubidaVideoUnico, async (req, res) => {
    const tempPath = req.file && req.file.path ? req.file.path : null;
    try {
        if (req.nodoAuth) {
            await nodosService.asegurarOfertaPerteneceANodo(req.params.id, req.nodoAuth.id);
        }
        if (!tempPath) {
            return res.status(400).json({ ok: false, error: 'Debés seleccionar un archivo de video para subir.' });
        }
        const resultado = await nodosFotosService.agregarVideoOferta({
            ofertaId: req.params.id,
            nodoAuthId: req.nodoAuth ? req.nodoAuth.id : null,
            tempFilePath: tempPath
        });
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error subiendo video de oferta:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    } finally {
        if (tempPath && fs.existsSync(tempPath)) {
            try { fs.unlinkSync(tempPath); } catch (_) {}
        }
    }
});

router.delete('/ofertas-gestor/:id/videos/:videoId', autenticarGestorSiPublicoOToken, async (req, res) => {
    try {
        if (req.nodoAuth) {
            await nodosService.asegurarOfertaPerteneceANodo(req.params.id, req.nodoAuth.id);
        }
        const resultado = await nodosFotosService.eliminarVideoOferta({
            ofertaId: req.params.id,
            videoId: req.params.videoId,
            nodoAuthId: req.nodoAuth ? req.nodoAuth.id : null
        });
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error eliminando video de oferta:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

router.put('/ofertas-gestor/:id/portada', autenticarGestorSiPublicoOToken, async (req, res) => {
    try {
        if (req.nodoAuth) {
            await nodosService.asegurarOfertaPerteneceANodo(req.params.id, req.nodoAuth.id);
        }
        const body = req.body || {};
        const resultado = await nodosFotosService.configurarPortadaOferta({
            ofertaId: req.params.id,
            nodoAuthId: req.nodoAuth ? req.nodoAuth.id : null,
            portadaModo: body.portada_modo,
            portadaMediaId: body.portada_media_id
        });
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error configurando portada de oferta:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

router.post('/ofertas-gestor/:id/fotos/importar-sugerida', autenticarGestorSiPublicoOToken, async (req, res) => {
    try {
        if (req.nodoAuth) {
            await nodosService.asegurarOfertaPerteneceANodo(req.params.id, req.nodoAuth.id);
        }
        const body = req.body || {};
        const resultado = await nodosFotosService.importarFotoSugeridaOferta({
            ofertaId: req.params.id,
            nodoAuthId: req.nodoAuth ? req.nodoAuth.id : null,
            fotoSugeridaIdOUrl: body.foto_sugerida_id || body.url || ''
        });
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error importando foto sugerida de oferta:', error);
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
            const slugReqLower = String(req.params.slug || '').trim().toLowerCase();
            const slugAuthLower = String(req.nodoAuth?.slug || '').trim().toLowerCase();
            const slugHistLower = String(req.nodoAuth?.slug_historico || '').trim().toLowerCase();
            if (req.nodoAuth && slugAuthLower !== slugReqLower && (!slugHistLower || slugHistLower !== slugReqLower)) {
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
 * GET /api/produccion/nodos/tienda/:slug/cotizar-cp
 * Cotiza envío postal nacional por Código Postal (4 dígitos) y subtotal de productos
 */
router.get('/tienda/:slug/cotizar-cp', async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        const resultado = await nodosService.cotizarEnvioPostalTienda(
            req.params.slug,
            req.query.cp || '',
            Number(req.query.subtotal || 0)
        );
        res.json(resultado);
    } catch (error) {
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
        const vid = String(req.query.vid || '').trim();
        if (vid && data?.pedido) {
            const ipReq = String(req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0] : '') || req.ip || '').trim();
            nodosAnaliticaService.vincularVisitanteConVecino({
                visitorId: vid,
                nodoId: data.pedido.nodo_id,
                vecinoId: data.pedido.vecino_id,
                vecinoNombre: data.identidad_vecino?.nombre_completo || data.pedido.vecino_nombre,
                vecinoTelefono: data.identidad_vecino?.telefono_whatsapp || data.pedido.vecino_telefono,
                telefonoNormalizado: data.identidad_vecino?.telefono_normalizado || null,
                identificadoVia: 'SEGUIMIENTO_TOKEN',
                ipOrigen: ipReq,
                userAgent: req.headers['user-agent'] || ''
            }).catch(() => {});
        }
        res.json({ ok: true, ...data });
    } catch (error) {
        res.status(404).json({ ok: false, error: error.message });
    }
});

/**
 * GET /api/produccion/nodos/seguimiento/:token
 * Seguimiento directo por token criptográfico sin requerir slug en la URL
 */
router.get('/seguimiento/:token', async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        const data = await nodosService.obtenerSeguimientoPublicoPedidoVecino('', req.params.token);
        const vid = String(req.query.vid || '').trim();
        if (vid && data?.pedido) {
            const ipReq = String(req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0] : '') || req.ip || '').trim();
            nodosAnaliticaService.vincularVisitanteConVecino({
                visitorId: vid,
                nodoId: data.pedido.nodo_id,
                vecinoId: data.pedido.vecino_id,
                vecinoNombre: data.identidad_vecino?.nombre_completo || data.pedido.vecino_nombre,
                vecinoTelefono: data.identidad_vecino?.telefono_whatsapp || data.pedido.vecino_telefono,
                telefonoNormalizado: data.identidad_vecino?.telefono_normalizado || null,
                identificadoVia: 'SEGUIMIENTO_TOKEN',
                ipOrigen: ipReq,
                userAgent: req.headers['user-agent'] || ''
            }).catch(() => {});
        }
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
 * POST /api/produccion/nodos/gestor/:nodoId/pedidos/:pedidoId/reenviar-recibo-whatsapp
 * Reenvía desde el celular del gestor el recibo PNG con membrete oficial al WhatsApp registrado del cliente.
 */
router.post('/gestor/:nodoId/pedidos/:pedidoId/reenviar-recibo-whatsapp', autenticarGestorSiPublicoOToken, async (req, res) => {
    try {
        if (req.nodoAuth) {
            if (Number(req.params.nodoId) !== Number(req.nodoAuth.id)) {
                return res.status(403).json({ ok: false, error: 'No autorizado para enviar recibos de otra tienda.' });
            }
            await nodosService.asegurarPedidoPerteneceANodo(req.params.pedidoId, req.nodoAuth.id);
        }
        const resultado = await nodosService.reenviarReciboWhatsAppPorGestor(
            req.params.nodoId,
            req.params.pedidoId,
            req.body || {}
        );
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en reenviar-recibo-whatsapp:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

/**
 * GET /api/produccion/nodos/pedidos/:pedidoId/recibo-marca-blanca.png
 * Renderiza el Recibo de Pago en PNG de alta definición con el membrete oficial de la tienda (cero menciones a LAMDA / nodo).
 */
router.get('/pedidos/:pedidoId/recibo-marca-blanca.png', async (req, res) => {
    try {
        const tokenGestor = extraerTokenGestorRequest(req);
        const nodoAuth = tokenGestor ? await nodosService.resolverNodoPorTokenGestor(tokenGestor) : null;
        const trackingToken = String(req.query.tracking_token || '').trim();
        const portalToken = String(req.query.portal_token || '').trim();
        const esPublico = esSolicitudPublicaNodos(req) || Boolean(trackingToken || portalToken || tokenGestor);

        const rec = await nodosService.obtenerReciboPngAutorizadoPedido(req.params.pedidoId, {
            esHostPublico: esPublico,
            nodoAuth,
            trackingToken,
            portalToken
        });
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', `inline; filename="${rec.filename}"`);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, max-age=60');
        res.send(rec.buffer);
    } catch (error) {
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

/**
 * GET /api/produccion/nodos/gestor/:nodoId/geocodificar?q=...
 * Geocodificador AR autenticado para corregir ubicaciones de vecinos desde el Panel del Gestor.
 */
router.get('/gestor/:nodoId/geocodificar', autenticarGestorSiPublicoOToken, async (req, res) => {
    try {
        if (req.nodoAuth && Number(req.params.nodoId) !== Number(req.nodoAuth.id)) {
            return res.status(403).json({ ok: false, error: 'No autorizado para geocodificar en otro Nodo.' });
        }
        const q = String(req.query.q || '').trim();
        const data = await nodosService.geocodificarDireccionParaGestor(req.params.nodoId, q);
        res.json({ ok: true, ...data });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /gestor/:nodoId/geocodificar:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/gestor/:nodoId/reparto/sugerir-orden
 * Calcula orden óptimo de paradas (Nearest-Neighbor + 2-opt) desde el Nodo o GPS actual.
 */
router.post('/gestor/:nodoId/reparto/sugerir-orden', autenticarGestorSiPublicoOToken, async (req, res) => {
    try {
        if (req.nodoAuth && Number(req.params.nodoId) !== Number(req.nodoAuth.id)) {
            return res.status(403).json({ ok: false, error: 'No autorizado para ordenar repartos de otro Nodo.' });
        }
        const resultado = await nodosService.sugerirOrdenRepartoGestor(req.params.nodoId, req.body || {});
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /gestor/:nodoId/reparto/sugerir-orden:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

/**
 * PUT /api/produccion/nodos/gestor/:nodoId/reparto/orden
 * Persiste orden manual de paradas desde botones táctiles Subir/Bajar.
 */
router.put('/gestor/:nodoId/reparto/orden', autenticarGestorSiPublicoOToken, async (req, res) => {
    try {
        if (req.nodoAuth && Number(req.params.nodoId) !== Number(req.nodoAuth.id)) {
            return res.status(403).json({ ok: false, error: 'No autorizado para modificar el orden de otro Nodo.' });
        }
        const resultado = await nodosService.guardarOrdenManualRepartoGestor(req.params.nodoId, req.body || {});
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en PUT /gestor/:nodoId/reparto/orden:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

/**
 * PUT /api/produccion/nodos/gestor/:nodoId/reparto/seleccion
 * Agrega (AGREGAR) o quita (QUITAR) pedidos arbitrarios de la Hoja de Ruta activa del Gestor.
 */
router.put('/gestor/:nodoId/reparto/seleccion', autenticarGestorSiPublicoOToken, async (req, res) => {
    try {
        if (req.nodoAuth && Number(req.params.nodoId) !== Number(req.nodoAuth.id)) {
            return res.status(403).json({ ok: false, error: 'No autorizado para modificar la hoja de ruta de otro Nodo.' });
        }
        const resultado = await nodosService.actualizarSeleccionHojaRutaGestor(req.params.nodoId, req.body || {});
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en PUT /gestor/:nodoId/reparto/seleccion:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/gestor/:nodoId/reparto/iniciar
 * Pasa los pedidos de la Hoja de Ruta a EN_CAMINO_VECINO (Hito 5) preservando el orden establecido.
 */
router.post('/gestor/:nodoId/reparto/iniciar', autenticarGestorSiPublicoOToken, async (req, res) => {
    try {
        if (req.nodoAuth && Number(req.params.nodoId) !== Number(req.nodoAuth.id)) {
            return res.status(403).json({ ok: false, error: 'No autorizado para iniciar reparto de otro Nodo.' });
        }
        const resultado = await nodosService.iniciarModoRepartoGestor(req.params.nodoId, req.body || {});
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /gestor/:nodoId/reparto/iniciar:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

/**
 * PUT /api/produccion/nodos/gestor/:nodoId/reparto/pedidos/:pedidoId/coordenadas
 * Guarda/corrige pin exacto en Leaflet para el pedido, el vecino y sus envíos pendientes iguales.
 */
router.put('/gestor/:nodoId/reparto/pedidos/:pedidoId/coordenadas', autenticarGestorSiPublicoOToken, async (req, res) => {
    try {
        if (req.nodoAuth) {
            if (Number(req.params.nodoId) !== Number(req.nodoAuth.id)) {
                return res.status(403).json({ ok: false, error: 'No autorizado para editar ubicaciones de otro Nodo.' });
            }
            await nodosService.asegurarPedidoPerteneceANodo(req.params.pedidoId, req.nodoAuth.id);
        }
        const resultado = await nodosService.actualizarCoordenadasPedidoYVecinoGestor(
            req.params.nodoId,
            req.params.pedidoId,
            req.body || {}
        );
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en PUT /gestor/:nodoId/reparto/pedidos/:pedidoId/coordenadas:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/gestor/:nodoId/reparto/radar
 * Actualiza o apaga el radar en vivo de proximidad del Gestor (expira automáticamente en 4 min).
 */
router.post('/gestor/:nodoId/reparto/radar', autenticarGestorSiPublicoOToken, async (req, res) => {
    try {
        if (req.nodoAuth && Number(req.params.nodoId) !== Number(req.nodoAuth.id)) {
            return res.status(403).json({ ok: false, error: 'No autorizado para actualizar radar de otro Nodo.' });
        }
        const resultado = await nodosService.actualizarRadarRepartoGestor(req.params.nodoId, req.body || {});
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /gestor/:nodoId/reparto/radar:', error);
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
 * GET /api/produccion/nodos/tienda/:slug/pedidos/:codigoOToken/estado-pago
 * Consulta pública autenticada por tracking_token, portal_token o teléfono del comprador
 */
router.get('/tienda/:slug/pedidos/:codigoOToken/estado-pago', async (req, res) => {
    try {
        const data = await nodosService.obtenerEstadoPagoPublicoPedidoTienda(
            req.params.slug,
            req.params.codigoOToken,
            {
                tracking_token: req.query?.tracking_token || req.query?.t || '',
                portal_token: req.query?.portal_token || '',
                telefono: req.query?.telefono || ''
            }
        );
        res.json(data);
    } catch (error) {
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/tienda/:slug/pedidos/:codigoOToken/aviso-pago
 * Registra un aviso declarativo de transferencia (1 toque o tramo parcial + titular emisor opcional + comprobante opcional <= 5 MB)
 */
router.post('/tienda/:slug/pedidos/:codigoOToken/aviso-pago', limitarPedidosPublicos, middlewareSubidaComprobanteOpcional, async (req, res) => {
    try {
        const payload = {
            ...(req.body || {}),
            tracking_token: req.body?.tracking_token || req.query?.tracking_token || req.query?.t || '',
            portal_token: req.body?.portal_token || req.query?.portal_token || '',
            telefono: req.body?.telefono || req.query?.telefono || ''
        };
        const data = await nodosService.registrarAvisoPagoCompradorTienda(
            req.params.slug,
            req.params.codigoOToken,
            payload,
            req.file || null
        );
        res.json(data);
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /tienda/:slug/pedidos/:codigoOToken/aviso-pago:', error.message);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

/**
 * GET /api/produccion/nodos/comprobante-pago/:avisoId
 * Descarga/visualización protegida del comprobante adjuntado por el comprador
 */
router.get('/comprobante-pago/:avisoId', async (req, res) => {
    try {
        const esPublico = esSolicitudPublicaNodos(req);
        const gestorToken = extraerTokenGestorRequest(req);
        const info = await nodosService.obtenerArchivoComprobanteAvisoPagoNodos(req.params.avisoId, {
            requerirAutorizacion: esPublico,
            comprobanteToken: req.query?.ct || '',
            trackingToken: req.query?.tracking_token || '',
            gestorToken
        });
        res.setHeader('Content-Type', info.mime || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${info.filename}"`);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        return res.sendFile(info.absPath);
    } catch (error) {
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
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
router.post('/deposito/canastos/:canastoId/reabrir-prueba', bloquearEnHostPublicoTienda, async (req, res) => {
    try {
        const tablero = await nodosService.reabrirCanastoParaPruebaLaboratorio(req.params.canastoId);
        res.json({ ok: true, tablero });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /deposito/canastos/:canastoId/reabrir-prueba:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

// ============================================================================
// ENDPOINTS BLOQUE B: FULFILLMENT PAQUETERÍA 24/7, ZPL MARCA BLANCA Y CSV POSTAL
// ============================================================================

/**
 * GET /api/produccion/nodos/deposito/fulfillment/preimposicion.csv
 * Descarga el CSV masivo de Preimposición (Correo Argentino Paq.ar / Andreani)
 */
router.get('/deposito/fulfillment/preimposicion.csv', bloquearEnHostPublicoTienda, async (req, res) => {
    try {
        const csvData = await nodosService.exportarCsvPreimposicionFulfillment({
            nodo_id: req.query.nodo_id || 0,
            operador_postal: req.query.operador_postal || 'CORREO_ARGENTINO',
            solo_pendientes: req.query.solo_pendientes !== '0',
            pedido_ids: req.query.pedido_ids || ''
        });
        if (String(req.query.format || '').toLowerCase() === 'json') {
            return res.json({ ok: true, ...csvData });
        }
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${csvData.filename}"`);
        return res.send(csvData.csv_content);
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /deposito/fulfillment/preimposicion.csv:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

/**
 * GET /api/produccion/nodos/deposito/fulfillment/:pedidoId/etiqueta-zpl
 * Genera la etiqueta térmica Zebra ZD220 100% Marca Blanca (Cara Cliente) + Talón Interno LAMDA
 */
router.get('/deposito/fulfillment/:pedidoId/etiqueta-zpl', bloquearEnHostPublicoTienda, async (req, res) => {
    try {
        const etiqueta = await nodosService.generarEtiquetaFulfillmentMarcaBlanca(req.params.pedidoId);
        if (String(req.query.download || '') === '1') {
            const fname = `Etiqueta_Fulfillment_${String(etiqueta.pedido_codigo || req.params.pedidoId).replace(/[^A-Za-z0-9_-]/g, '')}.zpl`;
            res.setHeader('Content-Type', 'application/x-zpl; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
            return res.send(etiqueta.zpl);
        }
        res.json({ ok: true, ...etiqueta });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /deposito/fulfillment/:pedidoId/etiqueta-zpl:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/deposito/fulfillment/:pedidoId/empaquetar
 * Marca una orden online (con pago conciliado) como controlada y empaquetada en Depósito Central LAMDA
 */
router.post('/deposito/fulfillment/:pedidoId/empaquetar', bloquearEnHostPublicoTienda, async (req, res) => {
    try {
        const resultado = await nodosService.marcarEmpaqueFulfillmentPedido(req.params.pedidoId, req.body || {});
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /deposito/fulfillment/:pedidoId/empaquetar:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/deposito/fulfillment/:pedidoId/despachar
 * Confirma atómicamente el despacho postal (Guía + Costo Flete LAMDA + Hito 4 + Descuento Stock + Débito Cta. Cte.)
 */
router.post('/deposito/fulfillment/:pedidoId/despachar', bloquearEnHostPublicoTienda, async (req, res) => {
    try {
        const resultado = await nodosService.confirmarDespachoPostalPedido(req.params.pedidoId, req.body || {});
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /deposito/fulfillment/:pedidoId/despachar:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/deposito/fulfillment/:pedidoId/entregar-final
 * Registra la entrega final en destino de un envío postal (Hito 6 ENTREGADO)
 */
router.post('/deposito/fulfillment/:pedidoId/entregar-final', bloquearEnHostPublicoTienda, async (req, res) => {
    try {
        const resultado = await nodosService.marcarEntregaFinalPostalPedido(req.params.pedidoId, req.body || {});
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /deposito/fulfillment/:pedidoId/entregar-final:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
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
 * GET /api/produccion/nodos/liquidacion/conciliador-galicia
 * Devuelve propuestas automáticas de cruce de Banco Galicia (LAMDA.SER.MARTIN), créditos libres y avisos pendientes
 */
router.get('/liquidacion/conciliador-galicia', bloquearEnHostPublicoTienda, async (req, res) => {
    try {
        const data = await nodosService.obtenerTableroConciliadorGaliciaNodos({
            nodo_id: req.query?.nodo_id || 0,
            usar_ia: String(req.query?.usar_ia || '').toLowerCase() === 'true'
        });
        res.json({ ok: true, ...data });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /liquidacion/conciliador-galicia:', error);
        res.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/liquidacion/conciliador-galicia/ingesta-extracto
 * Sube un archivo .xls / .xlsx de Banco Galicia, lo ingesta con deduplicación SHA-256 en fin_movimientos_bancarios
 * y devuelve inmediatamente las sugerencias híbridas de conciliación sobre pedidos pendientes.
 */
router.post(
    '/liquidacion/conciliador-galicia/ingesta-extracto',
    bloquearEnHostPublicoTienda,
    (req, res, next) => {
        uploadExtractoGaliciaMemoria.single('archivo')(req, res, (err) => {
            if (err) {
                return res.status(400).json({
                    ok: false,
                    error: err.code === 'LIMIT_FILE_SIZE'
                        ? 'El extracto bancario supera el límite de 10 MB.'
                        : ('Error recibiendo archivo Excel: ' + err.message)
                });
            }
            next();
        });
    },
    async (req, res) => {
        try {
            if (!req.file || !req.file.buffer) {
                return res.status(400).json({ ok: false, error: 'Seleccioná un archivo .xls o .xlsx de Banco Galicia.' });
            }
            const resultado = await nodosService.ingestarExtractoGaliciaParaNodos(req.file.buffer, {
                nodo_id: req.body?.nodo_id || req.query?.nodo_id || 0,
                usar_ia: String(req.body?.usar_ia ?? 'true').toLowerCase() !== 'false'
            });
            const tablero = await nodosService.obtenerTableroLiquidacionCobros({
                nodo_id: req.body?.nodo_id || req.query?.nodo_id || 0
            });
            res.json({ ok: true, ...resultado, tablero });
        } catch (error) {
            console.error('❌ [NodosRoutes] Error en POST /liquidacion/conciliador-galicia/ingesta-extracto:', error);
            res.status(error.statusCode || 400).json({ ok: false, error: error.message });
        }
    }
);

/**
 * POST /api/produccion/nodos/liquidacion/conciliador-galicia/conciliar
 * Confirma 1 o múltiples imputaciones N:M entre créditos de fin_movimientos_bancarios y pedidos pendientes
 */
router.post('/liquidacion/conciliador-galicia/conciliar', bloquearEnHostPublicoTienda, async (req, res) => {
    try {
        const resultado = await nodosService.conciliarCreditosBancariosNodos(req.body || {});
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /liquidacion/conciliador-galicia/conciliar:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/liquidacion/pedidos/:pedidoId/reclamar-pago-no-recibido
 * Marca en 1 clic "Pago no recibido / Solicitar comprobante" (o levanta el reclamo con { levantar_reclamo: true })
 */
router.post('/liquidacion/pedidos/:pedidoId/reclamar-pago-no-recibido', bloquearEnHostPublicoTienda, async (req, res) => {
    try {
        const resultado = await nodosService.marcarPagoNoRecibidoPedidoNodo(req.params.pedidoId, req.body || {});
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /liquidacion/pedidos/:pedidoId/reclamar-pago-no-recibido:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
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
        res.json({
            ok: true,
            tablero,
            envio_whatsapp_recibo: tablero?.ultimo_envio_whatsapp_recibo || null
        });
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
 * POST /api/produccion/nodos/liquidacion/nodos/:nodoId/corte-fulfillment
 * Genera un Corte de Liquidación Continua sobre todas las órdenes despachadas con pago conciliado pendientes de corte
 */
router.post('/liquidacion/nodos/:nodoId/corte-fulfillment', bloquearEnHostPublicoTienda, async (req, res) => {
    try {
        const resultado = await nodosService.generarCorteLiquidacionFulfillment(req.params.nodoId, req.body || {});
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /liquidacion/nodos/:nodoId/corte-fulfillment:', error);
        res.status(error.statusCode || 400).json({ ok: false, error: error.message });
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
    const hostClean = hostHeader.replace(/:\d+$/, '').toLowerCase();
    const proto = String(req?.headers?.['x-forwarded-proto'] || req?.protocol || 'http').split(',')[0].trim();
    const isPublicCloud = hostClean && !/^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.)/i.test(hostClean);
    if (isPublicCloud) {
        if (hostClean.endsWith('.lamdaser.com') && NODOS_PUBLIC_HOST_CONFIG) {
            return `https://${NODOS_PUBLIC_HOST_CONFIG}`;
        }
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

function obtenerBaseUrlEscritorioNodos(req) {
    const hostHeader = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').split(',')[0].trim();
    const proto = String(req?.headers?.['x-forwarded-proto'] || req?.protocol || 'http').split(',')[0].trim();
    const isPublicCloud = hostHeader && !/^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.)/i.test(hostHeader);
    if (isPublicCloud) {
        return `${proto}://${hostHeader}`;
    }
    const localHostOnly = hostHeader ? hostHeader.split(':')[0] : 'localhost';
    return `http://${localHostOnly || 'localhost'}:3002`;
}

async function construirPayloadQrNodo(nodo, baseMovil, req = null) {
    const slugEnc = encodeURIComponent(nodo.slug);
    const tokenQ = nodo.gestor_token ? `?t=${encodeURIComponent(nodo.gestor_token)}` : '';
    const basePc = obtenerBaseUrlEscritorioNodos(req);
    const urlMovilGestor = `${baseMovil}/gestor/${slugEnc}${tokenQ}`;
    const urlMovilTienda = `${baseMovil}/tienda/${slugEnc}`;
    const urlMovilTiendaQrAfiche = `${baseMovil}/tienda/${slugEnc}?utm_source=qr&utm_medium=afiche`;
    const urlMovilTiendaAdmin = `${baseMovil}/tienda/${slugEnc}?modo_admin=1`;
    const urlMovilTiendaClienteLimpio = `${baseMovil}/tienda/${slugEnc}?modo_admin=0`;
    const urlPcGestor = `${basePc}/gestor/${slugEnc}${tokenQ}`;
    const urlPcTienda = `${basePc}/tienda/${slugEnc}`;
    const urlPcTiendaAdmin = `${basePc}/tienda/${slugEnc}?modo_admin=1`;

    const [qrGestorDataUrl, qrTiendaDataUrl, qrAficheDataUrl, qrTiendaAdminDataUrl] = await Promise.all([
        QRCode.toDataURL(urlMovilGestor, { margin: 2, width: 360, errorCorrectionLevel: 'M' }),
        QRCode.toDataURL(urlMovilTienda, { margin: 2, width: 360, errorCorrectionLevel: 'M' }),
        QRCode.toDataURL(urlMovilTiendaQrAfiche, { margin: 2, width: 360, errorCorrectionLevel: 'M' }),
        QRCode.toDataURL(urlMovilTiendaAdmin, { margin: 2, width: 320, errorCorrectionLevel: 'M' })
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
        qr_tienda_data_url: qrTiendaDataUrl,
        url_movil_tienda_qr_afiche: urlMovilTiendaQrAfiche,
        qr_afiche_data_url: qrAficheDataUrl,
        url_movil_tienda_admin: urlMovilTiendaAdmin,
        url_pc_tienda_admin: urlPcTiendaAdmin,
        qr_tienda_admin_data_url: qrTiendaAdminDataUrl,
        url_movil_tienda_cliente_limpio: urlMovilTiendaClienteLimpio
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
        const vid = String(req.query.vid || '').trim();
        if (vid && data?.vecino) {
            const ipReq = String(req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0] : '') || req.ip || '').trim();
            nodosAnaliticaService.vincularVisitanteConVecino({
                visitorId: vid,
                nodoId: data.nodo?.id || null,
                vecinoId: data.vecino.id,
                vecinoNombre: data.vecino.nombre_completo,
                vecinoTelefono: data.vecino.telefono_whatsapp,
                identificadoVia: 'MI_CUENTA',
                ipOrigen: ipReq,
                userAgent: req.headers['user-agent'] || ''
            }).catch(() => {});
        }
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
        const payload = await construirPayloadQrNodo(nodo, baseMovil, req);
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
        const payload = await construirPayloadQrNodo(nodo, baseMovil, req);
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
        const basePc = obtenerBaseUrlEscritorioNodos(req);
        const urlMovilVecino = `${baseMovil}/tienda/${slugEnc}/mi-cuenta/${tokEnc}`;
        const urlPcVecino = `${basePc}/tienda/${slugEnc}/mi-cuenta/${tokEnc}`;
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

// ============================================================================
// TELEMETRÍA PÚBLICA DE TIENDA Y CENTRO INTERNO DE NODOS Y ANALÍTICA
// ============================================================================

const _rateLimitTelemetriaTiendaMap = new Map();
const RATE_LIMIT_TEL_VENTANA_MS = 60 * 1000;
const RATE_LIMIT_TEL_MAX_POR_MINUTO = 120;

function extraerIpRealTelemetria(req) {
    return String(
        req.headers['cf-connecting-ip'] ||
        (req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0] : '') ||
        req.ip ||
        req.socket?.remoteAddress ||
        'anon'
    ).trim();
}

function limitarTelemetriaPublicaTienda(req, res, next) {
    const ahora = Date.now();
    if (_rateLimitTelemetriaTiendaMap.size > 1500) {
        for (const [k, v] of _rateLimitTelemetriaTiendaMap.entries()) {
            if (ahora - v.inicio > RATE_LIMIT_TEL_VENTANA_MS) {
                _rateLimitTelemetriaTiendaMap.delete(k);
            }
        }
    }
    const ip = extraerIpRealTelemetria(req);
    let reg = _rateLimitTelemetriaTiendaMap.get(ip);
    if (!reg || (ahora - reg.inicio) >= RATE_LIMIT_TEL_VENTANA_MS) {
        reg = { inicio: ahora, conteo: 0 };
        _rateLimitTelemetriaTiendaMap.set(ip, reg);
    }
    reg.conteo += 1;
    if (reg.conteo > RATE_LIMIT_TEL_MAX_POR_MINUTO) {
        return res.status(429).json({ ok: false, error: 'Límite de eventos por minuto alcanzado.' });
    }
    const rawSize = Number(req.headers['content-length'] || 0);
    if (rawSize > 16384) {
        return res.status(413).json({ ok: false, error: 'Payload de telemetría excede el tamaño máximo permitido.' });
    }
    return next();
}

function bloquearEnDominioPublicoTienda(req, res, next) {
    if (esSolicitudPublicaNodos(req)) {
        return res.status(403).json({
            ok: false,
            error: 'Acceso restringido. El Centro de Nodos y Analítica es exclusivo del entorno interno de LAMDA.'
        });
    }
    return next();
}

/**
 * POST /api/produccion/nodos/tienda/:slug/telemetria
 * Único endpoint público de recepción liviana y no bloqueante de eventos de tienda y seguimiento.
 */
router.post('/tienda/:slug/telemetria', limitarTelemetriaPublicaTienda, async (req, res) => {
    try {
        const bodyObj = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
        if (JSON.stringify(bodyObj).length > 16384) {
            return res.status(413).json({ ok: false, error: 'Payload excede el tamaño permitido.' });
        }
        const resultado = await nodosAnaliticaService.registrarEventoTelemetriaTienda(
            req.params.slug,
            bodyObj,
            {
                ip: extraerIpRealTelemetria(req),
                userAgent: req.headers['user-agent'] || ''
            }
        );
        return res.json({ ok: true, registrado: Boolean(resultado?.ok) });
    } catch (error) {
        console.warn('⚠️ [NodosTelemetria] Evento descartado sin bloquear tienda:', error.message);
        return res.status(200).json({ ok: true, registrado: false });
    }
});

/**
 * GET /api/produccion/nodos/centro-analitica/resumen
 * Vista A: Listado integral de Nodos (Modalidad Contable + Resumen Comercial + Pulso Hoy).
 * Bloqueado estrictamente con HTTP 403 en tienda.lamdaser.com.
 */
router.get('/centro-analitica/resumen', bloquearEnDominioPublicoTienda, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        const data = await nodosAnaliticaService.obtenerResumenCentroNodos({
            calcularProximaEntregaFn: nodosService.calcularProximaEntregaNodo
        });
        res.json(data);
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /centro-analitica/resumen:', error.message);
        res.status(500).json({ ok: false, error: error.message });
    }
});

/**
 * GET /api/produccion/nodos/centro-analitica/nodo/:id/ficha
 * Vista A (Detalle): Movimientos contables filtrados por referencia del Nodo, Lotes, Remitos, Liquidaciones y Pedidos.
 * Bloqueado estrictamente con HTTP 403 en tienda.lamdaser.com.
 */
router.get('/centro-analitica/nodo/:id/ficha', bloquearEnDominioPublicoTienda, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        const data = await nodosAnaliticaService.obtenerFichaDetalleNodo(req.params.id, {
            calcularProximaEntregaFn: nodosService.calcularProximaEntregaNodo
        });
        res.json(data);
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /centro-analitica/nodo/:id/ficha:', error.message);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * GET /api/produccion/nodos/centro-analitica/radar
 * Vista B: Radar en Vivo, Flujo de Nube, Embudo, Búsquedas y Carritos Abandonados por Nodo.
 * Bloqueado estrictamente con HTTP 403 en tienda.lamdaser.com.
 */
router.get('/centro-analitica/radar', bloquearEnDominioPublicoTienda, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        const data = await nodosAnaliticaService.obtenerRadarAnaliticaNodos({
            nodoId: req.query.nodo_id || 'todos',
            rango: req.query.rango || 'hoy',
            fecha: req.query.fecha || null,
            audiencia: req.query.audiencia || 'clientes',
            limiteEventos: req.query.limite || 400
        });
        res.json(data);
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /centro-analitica/radar:', error.message);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ============================================================================
// MODAL INTERNO OMNICANAL DE COMUNICACIONES (WHATSAPP :3004 + EMAIL SMTP)
// ============================================================================

function construirPlantillasOmnicanalNodo(nodoDet, qrPayload) {
    const marca = nodoDet.nombre_marca || 'Nodo Barrial';
    const marcaCompleta = nodoDet.bajada_marca ? `${marca} · ${nodoDet.bajada_marca}` : marca;
    const gestor = nodoDet.gestor_nombre || 'Gestor/a';
    const retiro = nodoDet.direccion_retiro || nodoDet.barrio_zona || '-';
    const aliasLinea = nodoDet.alias_bancario_display
        ? `🏦 Alias recaudador vecinos: ${nodoDet.alias_bancario_display}\n`
        : '';

    return {
        gestor_y_tienda: {
            id: 'gestor_y_tienda',
            titulo: 'Invitación Gestor + Tienda Pública',
            qr_tipo_sugerido: 'tienda_afiche',
            asunto: `🌱 Accesos y Código QR de tu Nodo — ${marca}`,
            mensaje_texto: [
                `🌱 *Bienvenido/a a ${marcaCompleta}*`,
                `👤 Gestor/a: ${gestor}`,
                `📍 Punto de retiro: ${retiro}`,
                aliasLinea ? aliasLinea.trimEnd() : null,
                ``,
                `🎛️ *1. Tu Panel Móvil de Gestor (uso privado — canastos, márgenes, cobros y reparto):*`,
                qrPayload.url_movil_gestor,
                ``,
                `🛒 *2. Tu Tienda Pública Vecinal (para compartir con tus vecinos):*`,
                qrPayload.url_movil_tienda
            ].filter(v => v !== null).join('\n')
        },
        solo_tienda: {
            id: 'solo_tienda',
            titulo: 'Solo Tienda Pública Vecinal',
            qr_tipo_sugerido: 'tienda_afiche',
            asunto: `🛒 Tienda Online y Código QR — ${marca}`,
            mensaje_texto: [
                `🛒 *Tienda Online — ${marcaCompleta}*`,
                `📍 Retiro / Zona: ${retiro}`,
                ``,
                `Hacé tu pedido directo desde el celular entrando en este enlace o escaneando el Código QR adjunto:`,
                qrPayload.url_movil_tienda
            ].join('\n')
        },
        admin_prueba: {
            id: 'admin_prueba',
            titulo: 'Acceso Admin de Prueba con ?modo_admin=1',
            qr_tipo_sugerido: 'admin_prueba',
            asunto: `🛠️ Identificación de Celular Admin / Prueba — ${marca}`,
            mensaje_texto: [
                `🛠️ *Identificación de Dispositivo Admin / Prueba — ${marca}*`,
                ``,
                `Abrí este enlace o escaneá el QR adjunto una sola vez en tu celular para que tus visitas de prueba a la tienda de *${marca}* queden identificadas como Administración y no distorsionen las métricas de clientes reales en el Radar:`,
                qrPayload.url_movil_tienda_admin,
                ``,
                `🔄 Si luego querés volver a simular un vecino real en ese celular:`,
                qrPayload.url_movil_tienda_cliente_limpio
            ].join('\n')
        }
    };
}

async function resolverImagenQrParaEnvio(nodoDet, qrPayload, qrTipo = 'tienda_afiche') {
    const slugLimpio = String(nodoDet.slug || 'nodo').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
    let urlObjetivo = qrPayload.url_movil_tienda_qr_afiche || qrPayload.url_movil_tienda;
    let sufijo = 'tienda-afiche';
    let label = 'QR Tienda Pública (con trazabilidad de Afiche)';

    if (qrTipo === 'gestor') {
        urlObjetivo = qrPayload.url_movil_gestor;
        sufijo = 'panel-gestor';
        label = 'QR Panel Móvil del Gestor';
    } else if (qrTipo === 'tienda_limpio') {
        urlObjetivo = qrPayload.url_movil_tienda;
        sufijo = 'tienda';
        label = 'QR Tienda Pública (enlace limpio)';
    } else if (qrTipo === 'admin_prueba') {
        urlObjetivo = qrPayload.url_movil_tienda_admin;
        sufijo = 'modo-admin';
        label = 'QR Identificación Celular Admin (?modo_admin=1)';
    }

    const dataUrlAlta = await QRCode.toDataURL(urlObjetivo, {
        margin: 2,
        width: 520,
        errorCorrectionLevel: 'M'
    });
    const base64Data = String(dataUrlAlta || '').replace(/^data:image\/png;base64,/i, '').trim();
    return {
        qr_tipo: qrTipo,
        label,
        url: urlObjetivo,
        filename: `QR-${slugLimpio}-${sufijo}.png`,
        mimeType: 'image/png',
        dataUrl: dataUrlAlta,
        base64Data
    };
}

/**
 * GET /api/produccion/nodos/comunicaciones-modal.js
 * Sirve el componente JS compartido del modal omnicanal interno para Pizarra, Centro de Nodos y Clientes Búnker.
 */
router.get('/comunicaciones-modal.js', bloquearEnDominioPublicoTienda, (req, res) => {
    const modalScriptPath = path.join(__dirname, '..', 'js', 'components', 'nodoEnvioOmnicanalModal.js');
    res.set('Content-Type', 'application/javascript; charset=utf-8');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    if (!fs.existsSync(modalScriptPath)) {
        return res.status(404).send('// nodoEnvioOmnicanalModal.js no encontrado');
    }
    return res.sendFile(modalScriptPath);
});

/**
 * GET /api/produccion/nodos/comunicaciones/nodo/:idOrSlug/contexto
 * Precarga contactos (ficha madre Búnker + subficha + gestor), plantillas, QRs y estado del motor :3004.
 */
router.get('/comunicaciones/nodo/:idOrSlug/contexto', bloquearEnDominioPublicoTienda, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        const [datosContactos, baseMovil] = await Promise.all([
            nodosService.obtenerContactosOmnicanalNodo(req.params.idOrSlug),
            obtenerUrlPublicaQrNodos(req)
        ]);
        const qrPayload = await construirPayloadQrNodo(datosContactos.nodo_qr, baseMovil, req);
        const plantillas = construirPlantillasOmnicanalNodo(datosContactos.nodo_detalle, qrPayload);

        let estadoWa = null;
        try {
            const stRes = await fetch('http://127.0.0.1:3004/facturacion/whatsapp/status', {
                signal: AbortSignal.timeout(2500)
            });
            if (stRes.ok) {
                const stJson = await stRes.json();
                estadoWa = stJson?.data || null;
            }
        } catch (_) {}

        res.json({
            ok: true,
            modo_laboratorio: esModoLaboratorioWaSegura(),
            telefono_resguardo_laboratorio: '221 661 5746',
            whatsapp_motor: {
                status: estadoWa?.status || 'DESCONOCIDO',
                step_text: estadoWa?.stepText || ''
            },
            nodo: datosContactos.nodo_detalle,
            cliente_operativo: datosContactos.cliente_operativo,
            contactos_whatsapp: datosContactos.contactos_whatsapp,
            contactos_email: datosContactos.contactos_email,
            accesos_qr: {
                base_url_movil: qrPayload.base_url_movil,
                es_tunel_https: qrPayload.es_tunel_https,
                es_dominio_publico_fijo: qrPayload.es_dominio_publico_fijo,
                url_movil_gestor: qrPayload.url_movil_gestor,
                url_movil_tienda: qrPayload.url_movil_tienda,
                url_movil_tienda_qr_afiche: qrPayload.url_movil_tienda_qr_afiche,
                url_movil_tienda_admin: qrPayload.url_movil_tienda_admin,
                url_movil_tienda_cliente_limpio: qrPayload.url_movil_tienda_cliente_limpio,
                qr_gestor_data_url: qrPayload.qr_gestor_data_url,
                qr_tienda_data_url: qrPayload.qr_tienda_data_url,
                qr_afiche_data_url: qrPayload.qr_afiche_data_url,
                qr_tienda_admin_data_url: qrPayload.qr_tienda_admin_data_url
            },
            plantillas
        });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /comunicaciones/nodo/:idOrSlug/contexto:', error.message);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/comunicaciones/nodo/:idOrSlug/enviar
 * Despacha internamente por el motor propio de WhatsApp (:3004) y/o Email SMTP (:3004),
 * adjuntando opcionalmente la imagen PNG en alta resolución del Código QR seleccionado.
 */
router.post('/comunicaciones/nodo/:idOrSlug/enviar', bloquearEnDominioPublicoTienda, async (req, res) => {
    try {
        const body = req.body || {};
        const enviarWhatsapp = Boolean(body.enviar_whatsapp);
        const enviarEmail = Boolean(body.enviar_email);
        const adjuntarQr = body.adjuntar_qr !== false;
        const qrTipo = String(body.qr_tipo || 'tienda_afiche').trim();
        const asunto = String(body.asunto || '').trim();
        const mensajeTexto = String(body.mensaje_texto || '').trim();

        if (!enviarWhatsapp && !enviarEmail) {
            return res.status(400).json({ ok: false, error: 'Seleccioná al menos un canal de envío (WhatsApp y/o Email).' });
        }
        if (!mensajeTexto) {
            return res.status(400).json({ ok: false, error: 'El cuerpo del mensaje no puede estar vacío.' });
        }

        const listaWa = Array.isArray(body.destinatarios_whatsapp)
            ? [...new Set(body.destinatarios_whatsapp.map(t => String(t || '').replace(/[^\d+]/g, '').trim()).filter(t => t.replace(/\D/g, '').length >= 7))]
            : [];
        const listaEmails = Array.isArray(body.destinatarios_email)
            ? [...new Set(body.destinatarios_email.map(e => String(e || '').trim().toLowerCase()).filter(e => e.includes('@')))]
            : [];

        if (enviarWhatsapp && listaWa.length === 0) {
            return res.status(400).json({ ok: false, error: 'Seleccioná o ingresá al menos un número de WhatsApp válido.' });
        }
        if (enviarEmail && listaEmails.length === 0) {
            return res.status(400).json({ ok: false, error: 'Seleccioná o ingresá al menos una dirección de Email válida.' });
        }

        const [datosContactos, baseMovil] = await Promise.all([
            nodosService.obtenerContactosOmnicanalNodo(req.params.idOrSlug),
            obtenerUrlPublicaQrNodos(req)
        ]);
        const qrPayload = await construirPayloadQrNodo(datosContactos.nodo_qr, baseMovil, req);
        const nodoDet = datosContactos.nodo_detalle;
        const nombreDestinatarioSaludo = String(
            body.nombre_destinatario ||
            datosContactos.cliente_operativo?.cliente_nombre ||
            nodoDet.gestor_nombre ||
            nodoDet.nombre_marca ||
            'Cliente'
        ).trim();

        let qrImgInfo = null;
        if (adjuntarQr) {
            qrImgInfo = await resolverImagenQrParaEnvio(nodoDet, qrPayload, qrTipo);
        }

        const resultadoWhatsapp = {
            attempted: enviarWhatsapp,
            ok: false,
            simulated: false,
            destinatarios: listaWa,
            adjunto_qr: qrImgInfo ? qrImgInfo.filename : null,
            resultados: [],
            error: null
        };

        const resultadoEmail = {
            attempted: enviarEmail,
            ok: false,
            simulated: false,
            destinatarios: listaEmails,
            adjunto_qr: qrImgInfo ? qrImgInfo.filename : null,
            messageId: null,
            error: null
        };

        const promesas = [];

        if (enviarWhatsapp) {
            promesas.push((async () => {
                try {
                    const endpointWa = qrImgInfo
                        ? 'http://127.0.0.1:3004/facturacion/whatsapp/enviar-imagen'
                        : 'http://127.0.0.1:3004/facturacion/whatsapp/enviar-mensaje';
                    const payloadWa = qrImgInfo
                        ? {
                            destinatarios: listaWa.join(', '),
                            base64Data: qrImgInfo.base64Data,
                            mimeType: qrImgInfo.mimeType,
                            filename: qrImgInfo.filename,
                            mensajeTexto
                        }
                        : {
                            destinatarios: listaWa.join(', '),
                            mensajeTexto
                        };

                    const wpRes = await fetch(endpointWa, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payloadWa),
                        signal: AbortSignal.timeout(45000)
                    });
                    const wpJson = await wpRes.json().catch(() => ({}));
                    const dets = Array.isArray(wpJson?.data?.resultados)
                        ? wpJson.data.resultados
                        : (Array.isArray(wpJson?.detalles) ? wpJson.detalles : []);

                    resultadoWhatsapp.resultados = dets;
                    resultadoWhatsapp.simulated = dets.some(r => Boolean(r && r.simulated));

                    if (!wpRes.ok || !wpJson.success) {
                        resultadoWhatsapp.ok = false;
                        resultadoWhatsapp.error = wpJson.error || wpJson.message || `Error HTTP ${wpRes.status} en motor WhatsApp (:3004).`;
                    } else {
                        const exitosos = dets.filter(r => r && (r.success === true || r.status === 'enviado'));
                        resultadoWhatsapp.ok = dets.length === 0 ? true : exitosos.length > 0;
                        if (!resultadoWhatsapp.ok) {
                            resultadoWhatsapp.error = dets[0]?.error || 'No se pudo entregar el mensaje por WhatsApp.';
                        }
                    }
                } catch (errWa) {
                    resultadoWhatsapp.ok = false;
                    resultadoWhatsapp.error = errWa.message || 'No se pudo contactar al motor interno de WhatsApp (:3004).';
                }
            })());
        }

        if (enviarEmail) {
            promesas.push((async () => {
                try {
                    const asuntoFinal = asunto || `🌱 Accesos y Código QR — ${nodoDet.nombre_marca || 'Nodo Barrial'}`;
                    const payloadEmail = {
                        clienteNombre: nombreDestinatarioSaludo,
                        destinatarios: listaEmails,
                        asunto: asuntoFinal,
                        mensajeTexto,
                        notaAdjunto: qrImgInfo
                            ? `En el cuerpo y adjunto de este correo encontrará la imagen PNG (${qrImgInfo.filename}) lista para escanear, reenviar o imprimir.`
                            : '',
                        adjuntos: qrImgInfo
                            ? [{
                                filename: qrImgInfo.filename,
                                base64Data: qrImgInfo.base64Data,
                                mimeType: qrImgInfo.mimeType,
                                cid: 'qr-nodo-acceso'
                            }]
                            : []
                    };

                    const emRes = await fetch('http://127.0.0.1:3004/facturacion/email/notificacion/enviar', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payloadEmail),
                        signal: AbortSignal.timeout(35000)
                    });
                    const emJson = await emRes.json().catch(() => ({}));
                    if (!emRes.ok || !emJson.success) {
                        resultadoEmail.ok = false;
                        resultadoEmail.error = emJson.message || emJson.error || `Error HTTP ${emRes.status} en servidor de Email (:3004).`;
                    } else {
                        resultadoEmail.ok = true;
                        resultadoEmail.simulated = Boolean(emJson.simulated || emJson?.data?.simulated);
                        resultadoEmail.messageId = emJson?.data?.messageId || null;
                    }
                } catch (errEm) {
                    resultadoEmail.ok = false;
                    resultadoEmail.error = errEm.message || 'No se pudo contactar al servicio interno de Email (:3004).';
                }
            })());
        }

        await Promise.all(promesas);

        const intentados = [resultadoWhatsapp, resultadoEmail].filter(r => r.attempted);
        const exitosos = intentados.filter(r => r.ok);
        const todoOk = intentados.length > 0 && exitosos.length === intentados.length;
        const algunoOk = exitosos.length > 0;

        return res.status(algunoOk ? 200 : 500).json({
            ok: algunoOk,
            todo_ok: todoOk,
            parcial: algunoOk && !todoOk,
            modo_laboratorio: esModoLaboratorioWaSegura(),
            whatsapp: resultadoWhatsapp,
            email: resultadoEmail,
            error: !algunoOk
                ? [resultadoWhatsapp.error, resultadoEmail.error].filter(Boolean).join(' | ')
                : null
        });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /comunicaciones/nodo/:idOrSlug/enviar:', error.message);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ============================================================================
// PWA MARCA BLANCA POR NODO — MANIFESTS E ICONOS PNG DIFERENCIADOS (TIENDA vs GESTOR)
// ============================================================================
router.get('/pwa/:slug/:recurso', async (req, res) => {
    try {
        const slug = String(req.params.slug || '').trim();
        const recurso = String(req.params.recurso || '').trim().toLowerCase();

        const manifestMatch = /^(tienda|gestor)\.webmanifest$/.exec(recurso);
        const iconMatch = /^icon-(tienda|gestor)-(180|192|512)\.png$/.exec(recurso);

        if (!manifestMatch && !iconMatch) {
            return res.status(404).json({ ok: false, error: 'Recurso PWA no reconocido.' });
        }

        const nodo = await nodosPwaService.obtenerNodoPublicoPwaPorSlug(slug);
        if (!nodo) {
            return res.status(404).json({ ok: false, error: 'Nodo Barrial no encontrado o inactivo.' });
        }

        if (manifestMatch) {
            const rol = manifestMatch[1];
            const tokenQuery = String(req.query.t || req.query.gestor_token || '').trim();
            const hostHdr = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
            const isLocal = !hostHdr || /^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.)/i.test(hostHdr);
            const protoHdr = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
                || (req.secure || !isLocal ? 'https' : (req.protocol || 'http'));
            const baseOrigin = hostHdr ? `${protoHdr}://${hostHdr}` : '';
            const manifest = nodosPwaService.construirManifestPwaNodo(nodo, rol, tokenQuery, baseOrigin);
            res.set('Cache-Control', 'no-cache, must-revalidate');
            res.set('Content-Type', 'application/manifest+json; charset=utf-8');
            return res.status(200).send(JSON.stringify(manifest, null, 2));
        }

        const rolIcon = iconMatch[1];
        const sizeIcon = parseInt(iconMatch[2], 10);
        const pngBuffer = await nodosPwaService.renderizarIconoPngNodo(nodo, rolIcon, sizeIcon);
        // Header cacheable estándar para WebAPK Minting Server de Android Chrome; la invalidación la garantiza el hash ?v=5_<sha1>
        res.set('Cache-Control', 'public, max-age=86400');
        res.set('Content-Type', 'image/png');
        return res.status(200).send(pngBuffer);
    } catch (error) {
        console.error('❌ [NodosRoutes] Error sirviendo recurso PWA:', error.message);
        return res.status(500).json({ ok: false, error: 'Error generando recurso PWA del Nodo.' });
    }
});

module.exports = router;
