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
                    windowsHide: true
                });
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

// Iniciar túnel en segundo plano al levantar el router de Nodos en Laboratorio
setTimeout(() => {
    asegurarTunelCloudflareNodos().catch(() => {});
}, 800);

router.get('/ping-movil', (req, res) => {
    res.json({ ok: true, ts: Date.now() });
});

async function obtenerBaseUrlAccesibleCelular(req) {
    const hostHeader = String(req?.headers?.host || '').trim();
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
router.post('/propuestas', async (req, res) => {
    try {
        const propuesta = await nodosService.crearPropuestaFraccion(req.body || {});
        res.json({ ok: true, propuesta });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error creando propuesta:', error);
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
router.put('/ofertas-gestor/:id', async (req, res) => {
    try {
        const oferta = await nodosService.actualizarOfertaGestor(req.params.id, req.body || {});
        res.json({ ok: true, oferta });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error actualizando oferta gestor:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

// ============================================================================
// ENDPOINTS ETAPA 2: TIENDA MARCA BLANCA DEL VECINO Y PANEL DEL GESTOR
// ============================================================================

/**
 * GET /api/produccion/nodos/portal/:slug
 * Devuelve el catálogo publicado, horarios de corte, próxima entrega, pedidos y ofertas del Nodo
 */
router.get('/portal/:slug', async (req, res) => {
    try {
        const fechaSimulada = req.query.fecha_simulada || null;
        const data = await nodosService.obtenerDatosPortalNodo(req.params.slug, fechaSimulada);
        res.json({ ok: true, ...data });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /portal/:slug:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * PUT /api/produccion/nodos/gestor/:nodoId/config-logistica
 * Actualiza desde el Panel del Gestor los días de entrega, horarios de corte,
 * ventanas de retiro y costo de envío barrial (100% para el gestor).
 */
router.put('/gestor/:nodoId/config-logistica', async (req, res) => {
    try {
        const nodo = await nodosService.actualizarConfiguracionGestorNodo(req.params.nodoId, req.body || {});
        res.json({ ok: true, nodo });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en PUT /gestor/:nodoId/config-logistica:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/tienda/:slug/pedido
 * Registra el pedido de un vecino desde la Tienda Marca Blanca
 */
router.post('/tienda/:slug/pedido', async (req, res) => {
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
        const etiqueta = await nodosService.generarEtiquetaDePedidoExistente(req.params.pedidoId);
        res.json({ ok: true, ...etiqueta });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /pedidos/:pedidoId/etiqueta:', error);
        res.status(400).json({ ok: false, error: error.message });
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
router.get('/liquidacion/tablero', async (req, res) => {
    try {
        const data = await nodosService.obtenerTableroLiquidacionCobros({
            nodo_id: req.query.nodo_id || 0
        });
        res.json({ ok: true, ...data });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /liquidacion/tablero:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/liquidacion/pedidos/:pedidoId/conciliar-pago
 * Concilia una transferencia vecinal en Banco LAMDA (acreditando a favor del Nodo y
 * aprendiendo el titular) o registra el cobro en efectivo en mano del Gestor.
 */
router.post('/liquidacion/pedidos/:pedidoId/conciliar-pago', async (req, res) => {
    try {
        const tablero = await nodosService.conciliarPagoPedidoVecino(req.params.pedidoId, req.body || {});
        res.json({ ok: true, tablero });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /liquidacion/pedidos/:pedidoId/conciliar-pago:', error);
        res.status(400).json({ ok: false, error: error.message });
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
        const telefonoPrueba = '5492216615746';
        const telefonoOriginal = String(req.body?.telefono_original || '').trim();
        const destinatarioNombre = String(req.body?.destinatario_nombre || 'Cliente / Vecino').trim();
        const baseUrlMovil = await obtenerBaseUrlAccesibleCelular(req);

        let mensajeNormalizado = String(req.body?.mensaje || '').trim();
        mensajeNormalizado = mensajeNormalizado
            .replace(/https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?(\/gw\/3002)?(?=\/(gestor|tienda|deposito-nodos|liquidacion-nodos))/gi, baseUrlMovil)
            .replace(/https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?/gi, baseUrlMovil);

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

        res.json({
            ok: true,
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
