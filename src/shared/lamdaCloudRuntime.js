/**
 * LAMDA Cloud Runtime & Laboratory/Zebra Guard (Fase 2 / Micro-Etapa 1 — Rama `desarrollo`)
 * ------------------------------------------------------------------------------------------
 * Se monta en los 5 servidores Express (3000, 3002, 3003, 3004 y 3005) para proveer:
 *  1. Resolución dinámica de URLs entre entorno Multi-Puerto Local (`localhost:3000..3005`)
 *     y Dominio Único Cloud (`https://nube.lamdaser.com` / `https://logistica.lamdaser.com`).
 *  2. Detección automática de Presencia Física por Loopback (`http://127.0.0.1:3099/zebra-local-presence`)
 *     e inyección transparente de `X-Lamda-Physical-Station: PCALMACEN_VERIFIED` + `X-Lamda-Physical-Token`
 *     en `fetch` y `XMLHttpRequest`, logrando que los clics desde `PcAlmacen` impriman en ~1s
 *     mientras los disparos desde la calle quedan retenidos en `PENDIENTE_CONFIRMACION_GALPON`.
 *  3. Candado Triple Anti-Doble Arranque (`LAMDA_ROLE=GALPON_BRIDGE_ONLY` -> HTTP 423 / HTTP 302).
 *  4. Franja visual inconfundible de `🛠️ MODO LABORATORIO / PRUEBAS` y Bandeja interactiva de
 *     Confirmación de Etiquetas Zebra Retenidas (`🖨️ Cola Zebra Retenida`).
 */

const fs = require('fs');
const path = require('path');
const {
    esModoLaboratorio,
    esModoCloudOLinux,
    obtenerSecretoPresenciaZebra,
    middlewareContextoPresenciaZebra,
    registrarHeartbeatAgenteZebra,
    obtenerResumenColaRetenida,
    liberarEtiquetasRetenidas,
    descartarEtiquetasRetenidas,
    obtenerTrabajosLiberadosParaAgente,
    confirmarImpresionAgente
} = require('../services/zebraPrintBridgeService');
const {
    JWT_SECRET,
    galponBridgeRoleLockMiddleware,
    emitirCookieSesionCloud,
    verificarTokenOExtraerUsuario
} = require('./lamdaCloudAuthGuard');

const CLIENT_RUNTIME_SCRIPT = `
(function() {
    if (window.__LAMDA_CLOUD_RUNTIME_LOADED__) return;
    window.__LAMDA_CLOUD_RUNTIME_LOADED__ = true;

    window.__LAMDA_PHYSICAL_PRESENCE__ = {
        verified: false,
        station: 'REMOTE_CLIENT',
        token: '',
        ts: 0
    };

    function isCloudSinglePortOrigin() {
        var host = (window.location && window.location.hostname) ? window.location.hostname.toLowerCase() : '';
        if (!host) return false;
        if (window.location.pathname && window.location.pathname.indexOf('/gw/300') === 0) return true;
        if (host !== 'localhost' && host !== '127.0.0.1') return true;
        return false;
    }

    window.LAMDA_RESOLVE_URL = function(rawUrl) {
        if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
        if (rawUrl.indexOf('127.0.0.1:3099') !== -1 || rawUrl.indexOf('localhost:3099') !== -1) {
            return rawUrl;
        }

        var resolved = rawUrl;
        if (isCloudSinglePortOrigin()) {
            var origin = window.location.origin;
            if (/^https?:\\/\\/(localhost|127\\.0\\.0\\.1|[^/:]+\\.lamdaser\\.com):3005\\/?$/i.test(resolved)) {
                return origin + '/pages/dashboard.html';
            }
            if (/^https?:\\/\\/(localhost|127\\.0\\.0\\.1|[^/:]+\\.lamdaser\\.com):3000\\/?$/i.test(resolved)) {
                return origin + '/gw/3000/';
            }
            if (/^https?:\\/\\/(localhost|127\\.0\\.0\\.1|[^/:]+\\.lamdaser\\.com):3002\\/?$/i.test(resolved)) {
                return origin + '/gw/3002/pages/produccion.html';
            }
            if (/^https?:\\/\\/(localhost|127\\.0\\.0\\.1|[^/:]+\\.lamdaser\\.com):3003\\/?$/i.test(resolved) || /^\\/presupuestos\\/?$/i.test(resolved)) {
                return origin + '/gw/3003/pages/presupuestos.html';
            }
            if (/^https?:\\/\\/(localhost|127\\.0\\.0\\.1|[^/:]+\\.lamdaser\\.com):3004\\/?$/i.test(resolved)) {
                return origin + '/gw/3004/pages/facturas.html';
            }
            resolved = resolved
                .replace(/^https?:\\/\\/(localhost|127\\.0\\.0\\.1|[^/:]+\\.lamdaser\\.com):3005(\\/|$)/i, origin + '$2')
                .replace(/^https?:\\/\\/(localhost|127\\.0\\.0\\.1|[^/:]+\\.lamdaser\\.com):3000(\\/|$)/i, origin + '/gw/3000/')
                .replace(/^https?:\\/\\/(localhost|127\\.0\\.0\\.1|[^/:]+\\.lamdaser\\.com):3002(\\/|$)/i, origin + '/gw/3002/')
                .replace(/^https?:\\/\\/(localhost|127\\.0\\.0\\.1|[^/:]+\\.lamdaser\\.com):3003(\\/|$)/i, origin + '/gw/3003/')
                .replace(/^https?:\\/\\/(localhost|127\\.0\\.0\\.1|[^/:]+\\.lamdaser\\.com):3004(\\/|$)/i, origin + '/gw/3004/');
        }

        // Si el navegador está bajo /gw/(300[0234])/ y la URL es relativa a la raíz (/...),
        // anteponer automáticamente /gw/300X salvo rutas globales de 3005/sistema
        var locPath = (window.location && window.location.pathname) ? window.location.pathname : '';
        var gwMatch = /^\\/gw\\/(300[0234])(\\/|$)/i.exec(locPath);
        if (gwMatch && resolved.charAt(0) === '/' && resolved.charAt(1) !== '/') {
            var isLogisticaPage = /^\\/pages\\/(auditoria-rutas|bunker|config-puntos|configuracion-jerarquia-b2b|cuenta-corriente|dashboard|diccionario-bunker|historial-auditorias|ingesta-satelital|listado-bunker|listado-clientes|prospectos|recepcion-efectivo|tratamiento-checkin)\\.html([?#]|$)/i.test(resolved);
            var isRootGatewayRoute =
                isLogisticaPage ||
                resolved.indexOf('/gw/300') === 0 ||
                resolved.indexOf('/api/logistica') === 0 ||
                resolved.indexOf('/api/bunker') === 0 ||
                resolved.indexOf('/api/b2b') === 0 ||
                resolved.indexOf('/api/system') === 0 ||
                resolved.indexOf('/lamda-cloud-runtime.js') === 0 ||
                resolved.indexOf('/lamda-prueba-') === 0 ||
                resolved.indexOf('/env-config.js') === 0 ||
                resolved.indexOf('/login') === 0 ||
                resolved.indexOf('/logout') === 0 ||
                resolved.indexOf('/mobile') === 0 ||
                resolved.indexOf('/institucional.html') === 0 ||
                resolved.indexOf('/catalogo-publico.json') === 0;
            if (!isRootGatewayRoute) {
                resolved = '/gw/' + gwMatch[1] + resolved;
            }
        }

        return resolved;
    };

    function hasActivePhysicalPresence() {
        var p = window.__LAMDA_PHYSICAL_PRESENCE__;
        return Boolean(p && p.verified && p.token && (Date.now() - p.ts) < 35000);
    }

    function isLoopbackPresenceUrl(urlStr) {
        if (!urlStr || typeof urlStr !== 'string') return false;
        return urlStr.indexOf('127.0.0.1:3099') !== -1 || urlStr.indexOf('localhost:3099') !== -1;
    }

    var originalFetch = (typeof window.fetch === 'function') ? window.fetch.bind(window) : null;

    // 0. Sonda de Presencia Física por Loopback (127.0.0.1:3099/zebra-local-presence)
    // Solo se ejecuta cuando el servidor informa que el agente Zebra local está activo en la misma IP
    // (o cuando esta estación ya fue verificada como PcAlmacen), evitando errores ERR_CONNECTION_REFUSED en Notebooks/Celulares.
    var loopbackProbeInFlight = false;
    var lastLoopbackProbeTs = 0;

    function isMobileBrowser() {
        try {
            return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
        } catch (e) {
            return false;
        }
    }

    function pollLocalZebraPresence(forceProbe) {
        if (!originalFetch || isMobileBrowser() || loopbackProbeInFlight) return;
        try {
            if (!forceProbe && sessionStorage.getItem('__lamda_loopback_3099_unavailable__') === '1') {
                return;
            }
        } catch (e) {}
        if (!forceProbe && (Date.now() - lastLoopbackProbeTs) < 10000) return;

        loopbackProbeInFlight = true;
        lastLoopbackProbeTs = Date.now();
        originalFetch('http://127.0.0.1:3099/zebra-local-presence', {
            method: 'GET',
            mode: 'cors',
            cache: 'no-store'
        })
        .then(function(r) { return r && r.ok ? r.json() : null; })
        .then(function(data) {
            loopbackProbeInFlight = false;
            if (data && data.ok && data.station === 'PCALMACEN_VERIFIED' && data.token) {
                window.__LAMDA_PHYSICAL_PRESENCE__ = {
                    verified: true,
                    station: 'PCALMACEN_VERIFIED',
                    token: String(data.token),
                    ts: Date.now()
                };
                try {
                    localStorage.setItem('__lamda_is_pcalmacen_station__', '1');
                    sessionStorage.removeItem('__lamda_loopback_3099_unavailable__');
                } catch (e) {}
            } else {
                window.__LAMDA_PHYSICAL_PRESENCE__.verified = false;
                try {
                    sessionStorage.setItem('__lamda_loopback_3099_unavailable__', '1');
                } catch (e) {}
            }
        })
        .catch(function() {
            loopbackProbeInFlight = false;
            window.__LAMDA_PHYSICAL_PRESENCE__.verified = false;
            try {
                localStorage.removeItem('__lamda_is_pcalmacen_station__');
                sessionStorage.setItem('__lamda_loopback_3099_unavailable__', '1');
            } catch (e) {}
        });
    }

    // 1. Interceptar window.fetch (Resolución Cloud + Inyección de Presencia Física PcAlmacen)
    if (originalFetch) {
        window.fetch = function(input, init) {
            var targetUrl = '';
            if (typeof input === 'string') {
                input = window.LAMDA_RESOLVE_URL(input);
                targetUrl = input;
            } else if (input && typeof Request !== 'undefined' && input instanceof Request && input.url) {
                var resolved = window.LAMDA_RESOLVE_URL(input.url);
                targetUrl = resolved;
                if (resolved !== input.url) {
                    input = new Request(resolved, input);
                }
            }

            if (!isLoopbackPresenceUrl(targetUrl) && hasActivePhysicalPresence()) {
                init = init ? Object.assign({}, init) : {};
                var p = window.__LAMDA_PHYSICAL_PRESENCE__;
                if (typeof Headers !== 'undefined' && init.headers instanceof Headers) {
                    var clonedHeaders = new Headers(init.headers);
                    clonedHeaders.set('X-Lamda-Physical-Station', p.station);
                    clonedHeaders.set('X-Lamda-Physical-Token', p.token);
                    init.headers = clonedHeaders;
                } else {
                    var hdrs = Object.assign({}, init.headers || {});
                    hdrs['X-Lamda-Physical-Station'] = p.station;
                    hdrs['X-Lamda-Physical-Token'] = p.token;
                    init.headers = hdrs;
                }
            }

            return originalFetch(input, init);
        };
    }

    // 2. Interceptar XMLHttpRequest (usado por Axios y llamadas legacy)
    if (typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype && XMLHttpRequest.prototype.open) {
        var originalXhrOpen = XMLHttpRequest.prototype.open;
        var originalXhrSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function(method, url) {
            var args = Array.prototype.slice.call(arguments);
            if (typeof url === 'string') {
                args[1] = window.LAMDA_RESOLVE_URL(url);
                this.__lamdaTargetUrl = args[1];
            }
            return originalXhrOpen.apply(this, args);
        };
        XMLHttpRequest.prototype.send = function() {
            try {
                if (!isLoopbackPresenceUrl(this.__lamdaTargetUrl || '') && hasActivePhysicalPresence()) {
                    var p = window.__LAMDA_PHYSICAL_PRESENCE__;
                    this.setRequestHeader('X-Lamda-Physical-Station', p.station);
                    this.setRequestHeader('X-Lamda-Physical-Token', p.token);
                }
            } catch (e) {}
            return originalXhrSend.apply(this, arguments);
        };
    }

    // 3. Interceptar window.open
    if (typeof window.open === 'function') {
        var originalWindowOpen = window.open.bind(window);
        window.open = function(url, target, features) {
            if (typeof url === 'string') {
                url = window.LAMDA_RESOLVE_URL(url);
            }
            return originalWindowOpen(url, target, features);
        };
    }

    // 4. Reescritura proactiva de enlaces DOM + Intercepción de clics/touch en <a href="...">
    function shouldRewriteHref(href) {
        if (!href || typeof href !== 'string') return false;
        if (href.indexOf('javascript:') === 0 || href.charAt(0) === '#' || href.indexOf('mailto:') === 0 || href.indexOf('tel:') === 0) {
            return false;
        }
        return (
            /^https?:\\/\\/(localhost|127\\.0\\.0\\.1|[^/:]+\\.lamdaser\\.com):300[0-5]/i.test(href) ||
            /^\\/presupuestos(\\/|$)/i.test(href) ||
            /^\\/(pages|documentos)\\//i.test(href)
        );
    }

    function rewriteAllDomLinks(rootNode) {
        if (!isCloudSinglePortOrigin()) return;
        try {
            var scope = (rootNode && rootNode.querySelectorAll) ? rootNode : document;
            var anchors = scope.querySelectorAll('a[href]');
            for (var i = 0; i < anchors.length; i++) {
                var a = anchors[i];
                var href = a.getAttribute('href');
                if (shouldRewriteHref(href)) {
                    var resolved = window.LAMDA_RESOLVE_URL(href);
                    if (resolved && resolved !== href) {
                        a.setAttribute('href', resolved);
                    }
                }
            }
            var clickEls = scope.querySelectorAll('[onclick*="localhost:300"], [onclick*="127.0.0.1:300"]');
            for (var j = 0; j < clickEls.length; j++) {
                var el = clickEls[j];
                var rawOnclick = el.getAttribute('onclick') || '';
                var updatedOnclick = rawOnclick.replace(/https?:\\/\\/(localhost|127\\.0\\.0\\.1|[^/:]+\\.lamdaser\\.com):300[0-5][^'"\\s)]*/gi, function(m) {
                    return window.LAMDA_RESOLVE_URL(m);
                });
                if (updatedOnclick !== rawOnclick) {
                    el.setAttribute('onclick', updatedOnclick);
                }
            }
        } catch (e) {}
    }

    function handleAnchorInteraction(e) {
        var anchor = e.target && e.target.closest ? e.target.closest('a[href]') : null;
        if (!anchor) return;
        var href = anchor.getAttribute('href');
        if (shouldRewriteHref(href)) {
            var resolved = window.LAMDA_RESOLVE_URL(href);
            if (resolved && resolved !== href) {
                anchor.setAttribute('href', resolved);
            }
        }
    }

    document.addEventListener('click', handleAnchorInteraction, true);
    document.addEventListener('auxclick', handleAnchorInteraction, true);
    document.addEventListener('touchstart', handleAnchorInteraction, { capture: true, passive: true });

    // 4B. Sincronizar token localStorage -> Cookie HttpOnly (lamda_cloud_jwt)
    function syncAuthCookieIfPresent() {
        try {
            var tok = localStorage.getItem('token') || '';
            if (!tok) {
                var rawChofer = localStorage.getItem('sesion_chofer') || sessionStorage.getItem('sesion_chofer');
                if (rawChofer) {
                    var parsed = JSON.parse(rawChofer);
                    if (parsed && parsed.token) tok = parsed.token;
                }
            }
            if (!tok || sessionStorage.getItem('__lamda_cookie_synced__') === tok) return;
            if (originalFetch) {
                originalFetch('/api/system/auth/sync-cookie', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
                    body: JSON.stringify({ token: tok })
                }).then(function(r) {
                    if (r && r.ok) sessionStorage.setItem('__lamda_cookie_synced__', tok);
                }).catch(function() {});
            }
        } catch (e) {}
    }
    syncAuthCookieIfPresent();

    // 5. Franja de MODO LABORATORIO + Bandeja de Cola Zebra Retenida
    var labBannerEl = null;
    var labBannerShownOnce = false;
    var labBannerDismissTimer = null;
    var zebraBannerEl = null;
    var zebraModalEl = null;
    var lastZebraItems = [];

    function ensureTopContainer() {
        var container = document.getElementById('lamda-system-top-banners');
        if (!container && document.body) {
            container = document.createElement('div');
            container.id = 'lamda-system-top-banners';
            container.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483640;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;pointer-events:none;';
            document.body.insertBefore(container, document.body.firstChild);
        }
        return container;
    }

    function dismissLabBanner() {
        if (labBannerDismissTimer) {
            clearTimeout(labBannerDismissTimer);
            labBannerDismissTimer = null;
        }
        if (!labBannerEl) return;
        labBannerEl.style.opacity = '0';
        labBannerEl.style.transform = 'translateY(-100%)';
        setTimeout(function() {
            if (labBannerEl) {
                labBannerEl.remove();
                labBannerEl = null;
            }
        }, 350);
    }

    function renderLabBanner(status) {
        if (!status || (!status.isLaboratorio && !status.isPruebaNube)) {
            if (labBannerEl) {
                labBannerEl.remove();
                labBannerEl = null;
            }
            return;
        }
        if (status.isPruebaNube && !status.isLaboratorio) {
            if (document.title && document.title.indexOf('[NUBE PRUEBA]') === -1) {
                document.title = '[NUBE PRUEBA] ' + document.title;
            }
            if (labBannerShownOnce) return;
            labBannerShownOnce = true;
            var containerNube = ensureTopContainer();
            if (!containerNube) return;
            if (!labBannerEl) {
                labBannerEl = document.createElement('div');
                labBannerEl.id = 'lamda-lab-mode-banner';
                containerNube.appendChild(labBannerEl);
            }
            labBannerEl.style.cssText = [
                'background: linear-gradient(90deg, rgba(3,105,161,0.95), rgba(15,23,42,0.95), rgba(3,105,161,0.95));',
                'color: #f0f9ff;',
                'padding: 6px 14px;',
                'font-size: 12px;',
                'font-weight: 800;',
                'letter-spacing: 0.2px;',
                'text-align: center;',
                'border-bottom: 2px solid #38bdf8;',
                'box-shadow: 0 3px 10px rgba(0,0,0,0.35);',
                'display: flex;',
                'align-items: center;',
                'justify-content: center;',
                'gap: 10px;',
                'flex-wrap: wrap;',
                'pointer-events: auto;',
                'transition: opacity 0.35s ease, transform 0.35s ease;'
            ].join('');
            labBannerEl.innerHTML =
                '<span style="background:#38bdf8;color:#0f172a;padding:2px 7px;border-radius:4px;font-weight:900;">☁️ MODO PRUEBA EN NUBE (PARALELO)</span>' +
                '<span>ENTORNO DE ENSAYO — <strong style="color:#fde68a;">PcAlmacen SIGUE COMO TITULAR EN EL DEPÓSITO</strong></span>' +
                '<span style="font-size:11px;background:rgba(0,0,0,0.45);padding:2px 8px;border-radius:4px;">🧪 WhatsApp a ' + (status.safeRedirectWhatsapp || '221-6615746') + ' · Emails a ' + (status.safeRedirectEmail || 'miserrano75@gmail.com') + ' · Supabase B4.1 Activo</span>' +
                '<button id="lamda-lab-banner-close" title="Ocultar aviso" style="background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.25);color:#f0f9ff;border-radius:4px;padding:1px 7px;cursor:pointer;font-size:11px;font-weight:800;">✕</button>';
            var btnCloseNube = document.getElementById('lamda-lab-banner-close');
            if (btnCloseNube) btnCloseNube.onclick = dismissLabBanner;
            labBannerDismissTimer = setTimeout(dismissLabBanner, 3800);
            return;
        }
        if (document.title && document.title.indexOf('[PRUEBAS]') === -1) {
            document.title = '[PRUEBAS] ' + document.title;
        }
        if (labBannerShownOnce) return;
        labBannerShownOnce = true;
        var container = ensureTopContainer();
        if (!container) return;
        if (!labBannerEl) {
            labBannerEl = document.createElement('div');
            labBannerEl.id = 'lamda-lab-mode-banner';
            labBannerEl.style.cssText = [
                'background: repeating-linear-gradient(135deg, #b45309, #b45309 18px, #92400e 18px, #92400e 36px);',
                'color: #fffbeb;',
                'padding: 6px 14px;',
                'font-size: 12px;',
                'font-weight: 800;',
                'letter-spacing: 0.2px;',
                'text-align: center;',
                'border-bottom: 2px solid #fde68a;',
                'box-shadow: 0 3px 10px rgba(0,0,0,0.35);',
                'display: flex;',
                'align-items: center;',
                'justify-content: center;',
                'gap: 10px;',
                'flex-wrap: wrap;',
                'pointer-events: auto;',
                'transition: opacity 0.35s ease, transform 0.35s ease;'
            ].join('');
            container.appendChild(labBannerEl);
        }
        labBannerEl.innerHTML =
            '<span style="background:#fef3c7;color:#78350f;padding:2px 8px;border-radius:4px;font-weight:900;">🛠️ MODO LABORATORIO / PRUEBAS</span>' +
            '<span>BASE DE DATOS: <strong style="color:#fde68a;text-decoration:underline;">' + (status.dbName || 'etiquetas_pruebas') + '</strong> — NO USAR PARA OPERACIÓN REAL</span>' +
            '<span style="font-size:11px;background:rgba(0,0,0,0.35);padding:2px 8px;border-radius:4px;">🔒 Supabase B2B Desconectado · WhatsApp Saliente Bloqueado · ARCA Homologación · Zebra Física Simulada</span>' +
            '<button id="lamda-lab-banner-close" title="Ocultar aviso" style="background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);color:#fffbeb;border-radius:4px;padding:1px 7px;cursor:pointer;font-size:11px;font-weight:800;">✕</button>';
        var btnCloseLab = document.getElementById('lamda-lab-banner-close');
        if (btnCloseLab) btnCloseLab.onclick = dismissLabBanner;
        labBannerDismissTimer = setTimeout(dismissLabBanner, 4500);
    }

    function openZebraModal() {
        if (zebraModalEl) zebraModalEl.remove();
        zebraModalEl = document.createElement('div');
        zebraModalEl.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.75);z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,-apple-system,sans-serif;';
        var rowsHtml = '';
        if (!lastZebraItems || lastZebraItems.length === 0) {
            rowsHtml = '<tr><td colspan="4" style="padding:16px;text-align:center;color:#94a3b8;">No hay etiquetas retenidas en la cola.</td></tr>';
        } else {
            for (var i = 0; i < lastZebraItems.length; i++) {
                var it = lastZebraItems[i];
                var fecha = it.created_at ? new Date(it.created_at).toLocaleString('es-AR') : '-';
                rowsHtml += '<tr style="border-bottom:1px solid #334155;">' +
                    '<td style="padding:8px 10px;font-weight:700;color:#e2e8f0;">#' + it.id + '</td>' +
                    '<td style="padding:8px 10px;color:#cbd5e1;">' + (it.tipo_etiqueta || 'ZPL') + '</td>' +
                    '<td style="padding:8px 10px;color:#f8fafc;">' + (it.descripcion || '-') + '</td>' +
                    '<td style="padding:8px 10px;color:#94a3b8;font-size:12px;">' + fecha + '</td>' +
                    '</tr>';
            }
        }
        zebraModalEl.innerHTML =
            '<div style="background:#0f172a;color:#f8fafc;border:1px solid #38bdf8;border-radius:10px;max-width:760px;width:100%;max-height:82vh;display:flex;flex-direction:column;box-shadow:0 20px 45px rgba(0,0,0,0.6);">' +
                '<div style="padding:14px 18px;border-bottom:1px solid #1e293b;display:flex;justify-content:space-between;align-items:center;">' +
                    '<div style="font-weight:800;font-size:16px;">🖨️ Bandeja de Etiquetas Zebra Retenidas (' + (lastZebraItems ? lastZebraItems.length : 0) + ')</div>' +
                    '<button id="lamda-zebra-modal-close" style="background:transparent;border:none;color:#94a3b8;font-size:20px;cursor:pointer;">✕</button>' +
                '</div>' +
                '<div style="padding:12px 18px;overflow-y:auto;flex:1;">' +
                    '<table style="width:100%;border-collapse:collapse;font-size:13px;text-align:left;">' +
                        '<thead><tr style="border-bottom:2px solid #334155;color:#38bdf8;">' +
                            '<th style="padding:8px 10px;">ID</th>' +
                            '<th style="padding:8px 10px;">Tipo</th>' +
                            '<th style="padding:8px 10px;">Descripción</th>' +
                            '<th style="padding:8px 10px;">Encolada</th>' +
                        '</tr></thead>' +
                        '<tbody>' + rowsHtml + '</tbody>' +
                    '</table>' +
                '</div>' +
                '<div style="padding:12px 18px;border-top:1px solid #1e293b;display:flex;justify-content:flex-end;gap:10px;">' +
                    '<button id="lamda-zebra-modal-discard" style="background:#7f1d1d;color:#fecaca;border:1px solid #ef4444;padding:7px 14px;border-radius:6px;font-weight:700;cursor:pointer;">🗑️ Descartar Todas</button>' +
                    '<button id="lamda-zebra-modal-release" style="background:#0284c7;color:#fff;border:1px solid #38bdf8;padding:7px 16px;border-radius:6px;font-weight:800;cursor:pointer;">▶️ Imprimir Todas Ahora</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(zebraModalEl);
        document.getElementById('lamda-zebra-modal-close').onclick = function() { zebraModalEl.remove(); zebraModalEl = null; };
        document.getElementById('lamda-zebra-modal-release').onclick = function() { triggerZebraReleaseAll(); if (zebraModalEl) { zebraModalEl.remove(); zebraModalEl = null; } };
        document.getElementById('lamda-zebra-modal-discard').onclick = function() { triggerZebraDiscardAll(); if (zebraModalEl) { zebraModalEl.remove(); zebraModalEl = null; } };
    }

    function triggerZebraReleaseAll() {
        fetch('/api/system/print-queue/release-all', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
            .then(function(r) { return r.json(); })
            .then(function() { pollSystemStatus(); })
            .catch(function(err) { console.error('[ZEBRA-BRIDGE] Error liberando cola:', err); });
    }

    function triggerZebraDiscardAll() {
        if (!window.confirm('¿Descartar todas las etiquetas retenidas en la cola Zebra? Esta acción no las imprimirá.')) return;
        fetch('/api/system/print-queue/discard-all', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
            .then(function(r) { return r.json(); })
            .then(function() { pollSystemStatus(); })
            .catch(function(err) { console.error('[ZEBRA-BRIDGE] Error descartando cola:', err); });
    }

    function renderZebraBanner(zebraQueue) {
        var count = (zebraQueue && zebraQueue.pendingPrintCount) ? zebraQueue.pendingPrintCount : 0;
        lastZebraItems = (zebraQueue && zebraQueue.items) ? zebraQueue.items : [];
        if (count <= 0) {
            if (zebraBannerEl) {
                zebraBannerEl.remove();
                zebraBannerEl = null;
            }
            return;
        }
        var container = ensureTopContainer();
        if (!container) return;
        if (!zebraBannerEl) {
            zebraBannerEl = document.createElement('div');
            zebraBannerEl.id = 'lamda-zebra-queue-banner';
            zebraBannerEl.style.cssText = [
                'background: linear-gradient(90deg, #0f172a, #1e3a8a);',
                'color: #f8fafc;',
                'padding: 7px 16px;',
                'font-size: 13px;',
                'font-weight: 700;',
                'border-bottom: 2px solid #38bdf8;',
                'display: flex;',
                'align-items: center;',
                'justify-content: center;',
                'gap: 10px;',
                'flex-wrap: wrap;',
                'pointer-events: auto;'
            ].join('');
            container.appendChild(zebraBannerEl);
        }
        zebraBannerEl.innerHTML =
            '<span>🖨️ <strong>Cola Zebra Retenida:</strong> Tenés <span style="background:#38bdf8;color:#0f172a;padding:1px 7px;border-radius:999px;font-weight:900;">' + count + '</span> etiqueta(s) pendiente(s) de confirmación en el galpón</span>' +
            '<button id="lamda-btn-zebra-release" style="background:#0284c7;color:#fff;border:1px solid #7dd3fc;padding:3px 10px;border-radius:5px;font-weight:800;cursor:pointer;font-size:12px;">▶️ Imprimir Todas Ahora</button>' +
            '<button id="lamda-btn-zebra-view" style="background:#1e293b;color:#e2e8f0;border:1px solid #475569;padding:3px 10px;border-radius:5px;font-weight:700;cursor:pointer;font-size:12px;">👁️ Ver Lista</button>' +
            '<button id="lamda-btn-zebra-discard" style="background:#7f1d1d;color:#fecaca;border:1px solid #f87171;padding:3px 10px;border-radius:5px;font-weight:700;cursor:pointer;font-size:12px;">🗑️ Descartar</button>';

        var btnRel = document.getElementById('lamda-btn-zebra-release');
        var btnView = document.getElementById('lamda-btn-zebra-view');
        var btnDisc = document.getElementById('lamda-btn-zebra-discard');
        if (btnRel) btnRel.onclick = triggerZebraReleaseAll;
        if (btnView) btnView.onclick = openZebraModal;
        if (btnDisc) btnDisc.onclick = triggerZebraDiscardAll;
    }

    // 5B. Sello de agua sutil de entorno (L · Local vs N · Nube) — Cero intrusivo (pointer-events: none)
    function renderSubtleEnvironmentWatermark(status) {
        if (!document.body) return;
        var host = (window.location && window.location.hostname) ? window.location.hostname.toLowerCase() : '';
        var isPrueba = Boolean((status && status.isPruebaNube) || host.indexOf('nube-prueba') !== -1);
        var isLab = Boolean((status && status.isLaboratorio) || window.__LAMDA_IS_LABORATORIO__);
        var isCloud = Boolean((status && status.isCloudMode) || (host && host !== 'localhost' && host !== '127.0.0.1'));

        var label = 'L · Local';
        var bg = 'rgba(15, 23, 42, 0.08)';
        var fg = '#475569';
        var border = 'rgba(100, 116, 139, 0.22)';

        if (isPrueba) {
            label = 'N · Nube Prueba';
            bg = 'rgba(39, 39, 42, 0.14)';
            fg = '#71717a';
            border = 'rgba(161, 161, 170, 0.32)';
        } else if (isCloud) {
            label = 'N · Nube';
            bg = 'rgba(15, 23, 42, 0.10)';
            fg = '#64748b';
            border = 'rgba(100, 116, 139, 0.25)';
        } else if (isLab) {
            label = 'L · Lab';
            bg = 'rgba(39, 39, 42, 0.14)';
            fg = '#71717a';
            border = 'rgba(161, 161, 170, 0.32)';
        }

        var wm = document.getElementById('lamda-subtle-env-watermark');
        if (!wm) {
            wm = document.createElement('div');
            wm.id = 'lamda-subtle-env-watermark';
            document.body.appendChild(wm);
        }
        wm.style.cssText = [
            'position: fixed;',
            'bottom: 6px;',
            'right: 10px;',
            'z-index: 2147483600;',
            'pointer-events: none;',
            'user-select: none;',
            'font-family: system-ui, -apple-system, Segoe UI, Roboto, monospace;',
            'font-size: 10px;',
            'font-weight: 700;',
            'letter-spacing: 0.5px;',
            'padding: 2px 7px;',
            'border-radius: 999px;',
            'background: ' + bg + ';',
            'color: ' + fg + ';',
            'border: 1px solid ' + border + ';',
            'opacity: 0.52;',
            'backdrop-filter: blur(2px);'
        ].join('');
        wm.textContent = label;
    }

    function pollSystemStatus() {
        fetch('/api/system/env-status', { headers: { 'Accept': 'application/json' } })
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(data) {
                if (!data) return;
                window.__LAMDA_ENV_STATUS__ = data;
                renderLabBanner(data);
                renderSubtleEnvironmentWatermark(data);
                renderZebraBanner(data.zebraQueue);
                if (data.canProbeLocalBridge) {
                    pollLocalZebraPresence(false);
                }
            })
            .catch(function() {});
    }

    // 6. Instalador de Acceso Directo ("LAMDA Prueba") para Celular y Notebook
    window.__LAMDA_DEFERRED_PWA_PROMPT__ = null;
    window.addEventListener('beforeinstallprompt', function(e) {
        e.preventDefault();
        window.__LAMDA_DEFERRED_PWA_PROMPT__ = e;
    });

    function isTestOrLabOrigin() {
        var host = (window.location && window.location.hostname) ? window.location.hostname.toLowerCase() : '';
        if (host.indexOf('nube-prueba') !== -1 || host.indexOf('prueba') !== -1) return true;
        if (window.__LAMDA_IS_LABORATORIO__) return true;
        if (window.__LAMDA_ENV_STATUS__ && (window.__LAMDA_ENV_STATUS__.isPruebaNube || window.__LAMDA_ENV_STATUS__.isLaboratorio)) return true;
        return false;
    }

    function applyTestEnvironmentGrayscaleBranding() {
        if (!isTestOrLabOrigin()) return;
        try {
            if (document.head) {
                var existingIcons = document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]');
                if (existingIcons && existingIcons.length > 0) {
                    for (var k = 0; k < existingIcons.length; k++) {
                        existingIcons[k].href = '/mobile/favicon-lab.ico';
                    }
                } else {
                    var fav = document.createElement('link');
                    fav.rel = 'icon';
                    fav.type = 'image/x-icon';
                    fav.href = '/mobile/favicon-lab.ico';
                    document.head.appendChild(fav);
                }
                var appleIcons = document.querySelectorAll('link[rel="apple-touch-icon"]');
                if (appleIcons && appleIcons.length > 0) {
                    for (var m = 0; m < appleIcons.length; m++) {
                        appleIcons[m].href = '/mobile/apple-touch-icon-lab.png';
                    }
                }
            }
            var pathLower = (window.location && window.location.pathname) ? window.location.pathname.toLowerCase() : '';
            if (pathLower.indexOf('/mobile') === 0) {
                var mobLogos = document.querySelectorAll('.header-logo-mark, .login-logo-mark, .home-brand-logo');
                for (var n = 0; n < mobLogos.length; n++) {
                    mobLogos[n].src = '/mobile/isotipo-lab.png';
                    mobLogos[n].style.boxShadow = '0 4px 14px rgba(82, 82, 91, 0.45)';
                }
                var homeBadge = document.querySelector('.home-brand-badge');
                if (homeBadge) {
                    homeBadge.textContent = 'Móvil Prueba';
                    homeBadge.style.background = 'rgba(82, 82, 91, 0.65)';
                    homeBadge.style.color = '#e4e4e7';
                    homeBadge.style.borderColor = '#a1a1aa';
                }
                var txtHomeInst = document.getElementById('txt-home-install-movil');
                if (txtHomeInst) {
                    txtHomeInst.textContent = '📲 LAMDA Móvil Prueba';
                }
            }
        } catch (e) {}
    }

    function setupPwaManifestAndButtons() {
        applyTestEnvironmentGrayscaleBranding();
        if (!isCloudSinglePortOrigin()) return;
        try {
            var pathLower = (window.location && window.location.pathname) ? window.location.pathname.toLowerCase() : '';
            if (pathLower.indexOf('/mobile/') !== 0 && document.head) {
                if (!document.querySelector('link[rel="manifest"]')) {
                    var linkManifest = document.createElement('link');
                    linkManifest.rel = 'manifest';
                    linkManifest.href = '/lamda-prueba-manifest.json';
                    document.head.appendChild(linkManifest);
                }
                if (!document.querySelector('link[rel="apple-touch-icon"]')) {
                    var linkApple = document.createElement('link');
                    linkApple.rel = 'apple-touch-icon';
                    linkApple.href = '/mobile/apple-touch-icon-lab.png';
                    document.head.appendChild(linkApple);
                }
                if (!document.querySelector('meta[name="apple-mobile-web-app-title"]')) {
                    var metaTitle = document.createElement('meta');
                    metaTitle.name = 'apple-mobile-web-app-title';
                    metaTitle.content = 'LAMDA Prueba';
                    document.head.appendChild(metaTitle);
                }
            }
            if ('serviceWorker' in navigator && pathLower.indexOf('/mobile/') !== 0) {
                navigator.serviceWorker.register('/lamda-prueba-sw.js', { scope: '/' }).catch(function() {});
            }

            // Inyectar botón "📲 LAMDA Prueba" en la barra superior de la Pantalla Principal y en el Menú Lateral
            var navBar = document.querySelector('.header-nav-bar');
            if (navBar && !document.getElementById('btn-header-install-lamda-prueba')) {
                var btnHeader = document.createElement('button');
                btnHeader.type = 'button';
                btnHeader.id = 'btn-header-install-lamda-prueba';
                btnHeader.className = 'nav-btn';
                btnHeader.title = 'Instalar acceso directo LAMDA Prueba en este dispositivo (Celular o Notebook)';
                btnHeader.style.cssText = 'background:#f4f4f5;color:#27272a;border:1px solid #a1a1aa;font-size:0.82rem;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:16px;';
                btnHeader.innerHTML = '<img src="/mobile/icon-lab-192.png" alt="LAMDA Prueba" style="width:16px;height:16px;border-radius:4px;"><span>📲 Instalar "LAMDA Prueba"</span>';
                btnHeader.onclick = function() { window.instalarAccesoDirectoLamdaPrueba(); };
                navBar.appendChild(btnHeader);
            }

            var navTree = document.querySelector('.nav-tree');
            if (navTree && !document.getElementById('tree-item-install-lamda-prueba')) {
                var liInstall = document.createElement('li');
                liInstall.id = 'tree-item-install-lamda-prueba';
                liInstall.className = 'tree-item';
                liInstall.innerHTML = '<a href="javascript:void(0)" class="tree-link" style="background:#f4f4f5;border-left:4px solid #52525b;color:#27272a;font-weight:800;display:flex;align-items:center;gap:8px;"><img src="/mobile/icon-lab-192.png" alt="LAMDA Prueba" style="width:18px;height:18px;border-radius:4px;"><span>📲 Instalar Acceso "LAMDA Prueba"</span></a>';
                liInstall.onclick = function() {
                    if (typeof window.closeSidebar === 'function') window.closeSidebar();
                    window.instalarAccesoDirectoLamdaPrueba();
                };
                navTree.insertBefore(liInstall, navTree.firstChild);
            }
        } catch (e) {}
    }

    window.instalarAccesoDirectoLamdaPrueba = function() {
        if (window.__LAMDA_DEFERRED_PWA_PROMPT__) {
            var promptEvent = window.__LAMDA_DEFERRED_PWA_PROMPT__;
            window.__LAMDA_DEFERRED_PWA_PROMPT__ = null;
            promptEvent.prompt();
            return;
        }
        var existing = document.getElementById('lamda-pwa-install-modal');
        if (existing) existing.remove();

        var isMob = isMobileBrowser();
        var overlay = document.createElement('div');
        overlay.id = 'lamda-pwa-install-modal';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.78);z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;';
        overlay.innerHTML =
            '<div style="background:#1e293b;color:#f8fafc;border:1px solid #a1a1aa;border-top:4px solid #a1a1aa;border-radius:14px;max-width:480px;width:100%;padding:22px;box-shadow:0 20px 50px rgba(0,0,0,0.65);">' +
                '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;">' +
                    '<div style="display:flex;align-items:center;gap:10px;">' +
                        '<img src="/mobile/icon-lab-192.png" alt="LAMDA Prueba" style="width:42px;height:42px;border-radius:10px;border:1px solid #71717a;">' +
                        '<div>' +
                            '<div style="font-size:1.05rem;font-weight:800;color:#f8fafc;">LAMDA Prueba</div>' +
                            '<div style="font-size:0.78rem;color:#cbd5e1;">Ícono monocromático en escala de grises (Entorno de Prueba)</div>' +
                        '</div>' +
                    '</div>' +
                    '<button id="lamda-pwa-modal-close" style="background:transparent;border:none;color:#94a3b8;font-size:22px;cursor:pointer;line-height:1;">&times;</button>' +
                '</div>' +
                (isMob
                    ? '<div style="background:#0f172a;border:1px solid #334155;border-radius:10px;padding:14px;font-size:0.88rem;line-height:1.5;color:#e2e8f0;margin-bottom:14px;">' +
                        '<div style="font-weight:800;color:#e2e8f0;margin-bottom:6px;">📱 Cómo agregarlo a la pantalla de inicio del celular:</div>' +
                        '<ol style="padding-left:18px;margin:0;">' +
                            '<li style="margin-bottom:6px;">En <strong>Chrome (Android)</strong>: tocá el menú <strong>⋮</strong> (arriba a la derecha) y elegí <strong>«Instalar aplicación»</strong> o <strong>«Agregar a la pantalla principal»</strong>.</li>' +
                            '<li>En <strong>Safari (iPhone)</strong>: tocá el botón <strong>Compartir (⬆️)</strong> abajo y elegí <strong>«Agregar a inicio»</strong>.</li>' +
                        '</ol>' +
                        '<div style="margin-top:8px;font-size:0.78rem;color:#94a3b8;">El acceso quedará guardado con el logo monocromático en escala de grises y el nombre <strong>LAMDA Prueba</strong>.</div>' +
                      '</div>'
                    : '<div style="background:#0f172a;border:1px solid #334155;border-radius:10px;padding:14px;font-size:0.88rem;line-height:1.5;color:#e2e8f0;margin-bottom:14px;">' +
                        '<div style="font-weight:800;color:#e2e8f0;margin-bottom:8px;">💻 Cómo crear el acceso directo en la Notebook:</div>' +
                        '<div style="margin-bottom:10px;"><strong>Opción 1 (App con ícono gris en Escritorio / Barra de tareas):</strong> En la barra de direcciones de Chrome/Edge (arriba a la derecha), hacé clic en el ícono de computadora con flecha <strong>«Instalar LAMDA Prueba»</strong> o en el menú <strong>⋮ → Guardar y compartir → Instalar LAMDA Prueba</strong>.</div>' +
                        '<div><strong>Opción 2 (Descarga directa para Escritorio):</strong> Descargá el acceso directo listo para tu Escritorio:</div>' +
                        '<a href="/api/system/shortcut-desktop" download="LAMDA Prueba.url" style="margin-top:10px;display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:10px 14px;background:linear-gradient(90deg,#3f3f46,#52525b);border:1px solid #a1a1aa;color:#ffffff;font-weight:800;text-decoration:none;border-radius:8px;font-size:0.88rem;">📥 Descargar Acceso Directo "LAMDA Prueba.url"</a>' +
                      '</div>'
                ) +
                '<div style="text-align:right;">' +
                    '<button id="lamda-pwa-modal-ok" style="background:#334155;color:#f8fafc;border:none;padding:8px 16px;border-radius:7px;font-weight:700;cursor:pointer;font-size:0.85rem;">Entendido</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(overlay);
        document.getElementById('lamda-pwa-modal-close').onclick = function() { overlay.remove(); };
        document.getElementById('lamda-pwa-modal-ok').onclick = function() { overlay.remove(); };
        overlay.onclick = function(ev) { if (ev.target === overlay) overlay.remove(); };
    };

    function initCloudDomEnhancements() {
        rewriteAllDomLinks(document);
        setupPwaManifestAndButtons();
        renderSubtleEnvironmentWatermark(window.__LAMDA_ENV_STATUS__ || null);
        pollSystemStatus();
        setInterval(pollSystemStatus, 12000);
        if (isCloudSinglePortOrigin() && document.body && typeof MutationObserver !== 'undefined') {
            var rewriteTimer = null;
            var obs = new MutationObserver(function() {
                if (rewriteTimer) return;
                rewriteTimer = setTimeout(function() {
                    rewriteTimer = null;
                    rewriteAllDomLinks(document);
                }, 120);
            });
            obs.observe(document.body, { childList: true, subtree: true });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCloudDomEnhancements);
    } else {
        initCloudDomEnhancements();
    }
})();
`;

function injectScriptTagInHtml(htmlContent, servicePort = 3005) {
    if (typeof htmlContent !== 'string') return htmlContent;
    let outHtml = htmlContent;
    const portNum = Number(servicePort);
    if ([3000, 3002, 3003, 3004].includes(portNum)) {
        outHtml = outHtml.replace(
            /\b(src|href)=(["'])\/(js|css)\//gi,
            `$1=$2/gw/${portNum}/$3/`
        );
    }
    if (outHtml.includes('/lamda-cloud-runtime.js')) return outHtml;
    const scriptTag = '<script src="/lamda-cloud-runtime.js"></script>';
    if (/<head[^>]*>/i.test(outHtml)) {
        return outHtml.replace(/<head[^>]*>/i, (match) => `${match}\n    ${scriptTag}`);
    }
    if (/<body[^>]*>/i.test(outHtml)) {
        return outHtml.replace(/<body[^>]*>/i, (match) => `${match}\n    ${scriptTag}`);
    }
    return `${scriptTag}\n${outHtml}`;
}

function attachLamdaCloudRuntime(app, servicePort = 3000) {
    // 0. Compatibilidad de rutas /gw/300X en acceso directo local (localhost:300X)
    const portNum = Number(servicePort);
    if ([3000, 3002, 3003, 3004].includes(portNum)) {
        const gwPrefix = `/gw/${portNum}`;
        app.use((req, res, next) => {
            if (req.url === gwPrefix || req.url.startsWith(gwPrefix + '/')) {
                req.url = req.url.slice(gwPrefix.length) || '/';
            }
            next();
        });
    }

    // 0A. Candado Triple Anti-Doble Arranque (LAMDA_ROLE=GALPON_BRIDGE_ONLY -> HTTP 423 / HTTP 302)
    app.use(galponBridgeRoleLockMiddleware);

    // 0B. Contexto de Presencia Física por Loopback (X-Lamda-Physical-Station: PCALMACEN_VERIFIED + HMAC Token)
    app.use(middlewareContextoPresenciaZebra);

    // 0C. Manifest y Service Worker para Acceso Directo "LAMDA Prueba" (Celular y Notebook — Íconos Monocromáticos en Escala de Grises)
    app.get('/lamda-prueba-manifest.json', (req, res) => {
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        return res.json({
            id: '/?app=lamda-prueba',
            name: 'LAMDA Prueba',
            short_name: 'LAMDA Prueba',
            description: 'Sistema LAMDA Cloud 24/7 — Servidor de Prueba (Escala de Grises)',
            start_url: '/gw/3000/',
            scope: '/',
            display: 'standalone',
            background_color: '#e4e4e7',
            theme_color: '#52525b',
            icons: [
                { src: '/mobile/icon-lab-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
                { src: '/mobile/icon-lab-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
                { src: '/mobile/apple-touch-icon-lab.png', sizes: '180x180', type: 'image/png', purpose: 'any' }
            ]
        });
    });

    app.get('/lamda-prueba-sw.js', (req, res) => {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Service-Worker-Allowed', '/');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        return res.send(
            "self.addEventListener('install', function() { self.skipWaiting(); });\n" +
            "self.addEventListener('activate', function(e) { e.waitUntil(self.clients.claim()); });\n" +
            "self.addEventListener('fetch', function() {});\n"
        );
    });

    app.get('/api/system/shortcut-desktop', (req, res) => {
        const proto = (req.secure || String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https') ? 'https' : 'http';
        const host = req.headers.host || 'nube-prueba.lamdaser.com';
        const baseUrl = `${proto}://${host}`;
        const shortcutContent = [
            '[InternetShortcut]',
            `URL=${baseUrl}/gw/3000/`,
            'IconIndex=0',
            `IconFile=${baseUrl}/mobile/favicon-lab.ico`,
            ''
        ].join('\r\n');
        res.setHeader('Content-Type', 'application/internet-shortcut; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="LAMDA Prueba.url"');
        return res.send(shortcutContent);
    });

    // 0D. En Modo Laboratorio o Modo Prueba Nube, personalizar el manifest PWA de /mobile con íconos monocromáticos en escala de grises
    app.get('/mobile/manifest.json', (req, res, next) => {
        const flagNube = String(process.env.LAMDA_MODO_PRUEBA_NUBE || '').trim().toLowerCase();
        const flagRedirect = String(process.env.SAFE_DELIVERY_REDIRECT || '').trim().toLowerCase();
        const host = String(req.headers.host || '').toLowerCase();
        const isPruebaNube = flagNube === 'true' || flagNube === '1' || flagRedirect === 'true' || flagRedirect === '1' || host.includes('nube-prueba');
        if (!esModoLaboratorio() && !isPruebaNube) return next();
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        return res.json({
            id: '/mobile/?app=lamda-movil-prueba',
            name: 'LAMDA Móvil Prueba',
            short_name: 'LAMDA Móvil Prueba',
            description: 'Entorno de Prueba y Desarrollo — LAMDA Móvil (Escala de Grises)',
            start_url: './home.html',
            scope: './',
            display: 'standalone',
            background_color: '#e4e4e7',
            theme_color: '#52525b',
            orientation: 'portrait',
            icons: [
                { src: 'icon-lab-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
                { src: 'icon-lab-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
                { src: 'apple-touch-icon-lab.png', sizes: '180x180', type: 'image/png', purpose: 'any' }
            ]
        });
    });

    // 1. Servir el script de cliente unificado
    app.get('/lamda-cloud-runtime.js', (req, res) => {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        const isLab = esModoLaboratorio();
        let preamble = '';
        if (isLab) {
            let adminJwt = '';
            try {
                const jwt = require('jsonwebtoken');
                adminJwt = jwt.sign({ id: 2, usuario: 'Tincho', rol_id: 1 }, JWT_SECRET, { expiresIn: '365d' });
            } catch (_) {}
            const mobileToken = Buffer.from(`2:${Date.now()}`).toString('base64');
            preamble = `(function(){
    window.__LAMDA_IS_LABORATORIO__ = true;
    try {
        var rawSes = localStorage.getItem('sesion_chofer') || sessionStorage.getItem('sesion_chofer');
        var sesObj = rawSes ? JSON.parse(rawSes) : null;
        if (!sesObj || !sesObj.token || !sesObj.id) {
            var defaultSes = JSON.stringify({ id: 2, usuario: 'Tincho', nombre: 'Martin Ignacio Serrano', rol_id: 1, token: '${mobileToken}' });
            localStorage.setItem('sesion_chofer', defaultSes);
            sessionStorage.setItem('sesion_chofer', defaultSes);
        }
        var p = (window.location && window.location.pathname) ? window.location.pathname.toLowerCase() : '';
        if (p === '/mobile' || p === '/mobile/' || p === '/mobile/index.html' || p === '/public/mobile/index.html') {
            window.location.replace('/mobile/home.html');
            return;
        }
        if ('${adminJwt}') {
            localStorage.setItem('token', '${adminJwt}');
        }
        if (!localStorage.getItem('colaboradorActivo')) {
            localStorage.setItem('colaboradorActivo', JSON.stringify({ id: 2, nombre: 'Martin Ignacio Serrano', usuario: 'Tincho', rol_id: 1, timestamp: new Date().toISOString() }));
        }
        if (!sessionStorage.getItem('usuarioInventario')) {
            sessionStorage.setItem('usuarioInventario', JSON.stringify({ id: 2, nombre: 'Martin Ignacio Serrano', usuario: 'Tincho' }));
            sessionStorage.setItem('inventario_usuario_id', '2');
        }
    } catch (e) {}
})();\n`;
        }
        res.send(preamble + CLIENT_RUNTIME_SCRIPT);
    });

    // 1B. Sincronización de Cookie HttpOnly lamda_cloud_jwt desde sesión activa
    app.post('/api/system/auth/sync-cookie', (req, res) => {
        const user = verificarTokenOExtraerUsuario(req);
        if (!user) {
            return res.status(401).json({ ok: false, error: 'Token no válido para sincronizar cookie' });
        }
        emitirCookieSesionCloud(res, user);
        return res.json({ ok: true, usuario: user.usuario || user.id });
    });

    // 2. Endpoint de estado de entorno (Modo Laboratorio + Cola Zebra Retenida + Presencia Física)
    app.get('/api/system/env-status', async (req, res) => {
        const isLaboratorio = esModoLaboratorio();
        const flagNube = String(process.env.LAMDA_MODO_PRUEBA_NUBE || '').trim().toLowerCase();
        const flagRedirect = String(process.env.SAFE_DELIVERY_REDIRECT || '').trim().toLowerCase();
        const isPruebaNube = flagNube === 'true' || flagNube === '1' || flagRedirect === 'true' || flagRedirect === '1';
        const zebraQueue = await obtenerResumenColaRetenida();
        const clientIp = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
        const bridgeSt = (zebraQueue && zebraQueue.bridgeStatus) ? zebraQueue.bridgeStatus : null;
        const bridgeHbMs = (bridgeSt && bridgeSt.last_heartbeat_at) ? new Date(bridgeSt.last_heartbeat_at).getTime() : 0;
        const bridgeActiveRecently = bridgeHbMs > 0 && (Date.now() - bridgeHbMs) < 25000;
        const bridgeIp = (bridgeSt && bridgeSt.ip_origen) ? String(bridgeSt.ip_origen).split(',')[0].trim() : '';
        const canProbeLocalBridge = Boolean(
            bridgeActiveRecently &&
            (!bridgeIp || !clientIp || bridgeIp === clientIp || clientIp === '127.0.0.1' || clientIp === '::1')
        );
        res.json({
            ok: true,
            servicePort,
            isLaboratorio,
            isPruebaNube,
            lamdaRole: process.env.LAMDA_ROLE || 'PRIMARY',
            physicalPresence: req.zebraPhysicalPresence || { estacionFisicaVerificada: false },
            canProbeLocalBridge,
            safeRedirectWhatsapp: process.env.SAFE_REDIRECT_WHATSAPP_TO || '5492216615746',
            safeRedirectEmail: process.env.SAFE_REDIRECT_EMAIL_TO || 'miserrano75@gmail.com',
            isCloudMode: esModoCloudOLinux(),
            dbName: process.env.DB_NAME || 'etiquetas',
            afipEnv: (isLaboratorio || isPruebaNube) ? 'HOMO' : (process.env.AFIP_ENV || 'PROD'),
            whatsappModoEspejo: String(process.env.WHATSAPP_MODO_ESPEJO || '').toLowerCase() === 'true',
            zebraQueue
        });
    });

    // 2B. Diagnóstico Integral de ARCA en la Nube (Facturación + Padrón CUIT Clientes + Criptografía OpenSSL)
    // Garantiza 0% de interferencia con el Ticket de Acceso (TA) de Facturación (wsfe) activo en PcAlmacen.
    app.get('/api/system/arca-diagnostico', async (req, res) => {
        const os = require('os');
        const https = require('https');
        const { execFile } = require('child_process');
        const { promisify } = require('util');
        const execFileAsync = promisify(execFile);

        const rawOpenSsl = process.env.OPENSSL_EXE || process.env.OPENSSL_BIN || '';
        const opensslBin = (process.platform !== 'win32' && (!rawOpenSsl || rawOpenSsl.includes(':\\')))
            ? 'openssl'
            : (rawOpenSsl || 'C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe');

        const certsDir = path.resolve(__dirname, '../facturacion/certs');
        const cuitPrueba = String(req.query.cuit || '23248921749').replace(/[^0-9]/g, '');

        async function inspectCertAndTestSign(label, certName, keyName, servicioAsociado) {
            const certPath = path.join(certsDir, certName);
            const keyPath = path.join(certsDir, keyName);
            const info = {
                label,
                servicioAsociado,
                certExists: fs.existsSync(certPath),
                keyExists: fs.existsSync(keyPath),
                subject: null,
                issuer: null,
                notBefore: null,
                notAfter: null,
                cmsSignatureTestOk: false,
                cmsBytes: 0,
                error: null
            };
            if (!info.certExists || !info.keyExists) {
                info.error = 'Archivo de certificado o clave privada no encontrado en ' + certsDir;
                return info;
            }
            try {
                const { stdout } = await execFileAsync(opensslBin, [
                    'x509', '-in', certPath, '-noout', '-subject', '-issuer', '-dates'
                ]);
                const lines = String(stdout || '').split(/\r?\n/);
                for (const ln of lines) {
                    if (ln.startsWith('subject=')) info.subject = ln.replace(/^subject=/, '').trim();
                    if (ln.startsWith('issuer=')) info.issuer = ln.replace(/^issuer=/, '').trim();
                    if (ln.startsWith('notBefore=')) info.notBefore = ln.replace(/^notBefore=/, '').trim();
                    if (ln.startsWith('notAfter=')) info.notAfter = ln.replace(/^notAfter=/, '').trim();
                }
                const tmpTra = path.join(os.tmpdir(), `diag_tra_${Date.now()}_${Math.random().toString(36).slice(2)}.xml`);
                const tmpCms = path.join(os.tmpdir(), `diag_cms_${Date.now()}_${Math.random().toString(36).slice(2)}.cms`);
                try {
                    fs.writeFileSync(tmpTra, '<loginTicketRequest version="1.0"><service>' + servicioAsociado + '</service></loginTicketRequest>', 'utf8');
                    await execFileAsync(opensslBin, [
                        'smime', '-sign', '-in', tmpTra, '-out', tmpCms, '-outform', 'DER',
                        '-signer', certPath, '-inkey', keyPath, '-nodetach', '-binary'
                    ]);
                    if (fs.existsSync(tmpCms)) {
                        const stat = fs.statSync(tmpCms);
                        info.cmsBytes = stat.size;
                        info.cmsSignatureTestOk = stat.size > 500;
                    }
                } finally {
                    try { if (fs.existsSync(tmpTra)) fs.unlinkSync(tmpTra); } catch (_) {}
                    try { if (fs.existsSync(tmpCms)) fs.unlinkSync(tmpCms); } catch (_) {}
                }
            } catch (err) {
                info.error = err.message;
            }
            return info;
        }

        function callWsfeProdDummy() {
            return new Promise((resolve) => {
                const t0 = Date.now();
                const soapBody =
                    '<?xml version="1.0" encoding="utf-8"?>' +
                    '<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
                    '<soap:Body><FEDummy xmlns="http://ar.gov.afip.dif.FEV1/" /></soap:Body></soap:Envelope>';
                const reqHttps = https.request('https://servicios1.afip.gov.ar/wsfev1/service.asmx', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'text/xml; charset=utf-8',
                        'SOAPAction': '"http://ar.gov.afip.dif.FEV1/FEDummy"',
                        'Content-Length': Buffer.byteLength(soapBody)
                    },
                    timeout: 12000
                }, (resp) => {
                    let data = '';
                    resp.on('data', (chunk) => { data += chunk; });
                    resp.on('end', () => {
                        const appServer = (/<AppServer>([^<]+)<\/AppServer>/i.exec(data) || [])[1] || null;
                        const dbServer = (/<DbServer>([^<]+)<\/DbServer>/i.exec(data) || [])[1] || null;
                        const authServer = (/<AuthServer>([^<]+)<\/AuthServer>/i.exec(data) || [])[1] || null;
                        resolve({
                            ok: appServer === 'OK' && dbServer === 'OK' && authServer === 'OK',
                            statusCode: resp.statusCode,
                            latencyMs: Date.now() - t0,
                            endpoint: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
                            appServer,
                            dbServer,
                            authServer,
                            notaSeguridad: 'Verificación 100% pasiva (FEDummy): NO consume ni invalida el Ticket de Acceso (TA) de Facturación (wsfe) activo en PcAlmacen.'
                        });
                    });
                });
                reqHttps.on('error', (err) => {
                    resolve({ ok: false, error: err.message, latencyMs: Date.now() - t0 });
                });
                reqHttps.on('timeout', () => {
                    reqHttps.destroy();
                    resolve({ ok: false, error: 'Timeout conectando a servicios1.afip.gov.ar', latencyMs: Date.now() - t0 });
                });
                reqHttps.write(soapBody);
                reqHttps.end();
            });
        }

        try {
            let opensslVersion = null;
            try {
                const { stdout } = await execFileAsync(opensslBin, ['version']);
                opensslVersion = String(stdout || '').trim();
            } catch (e) {
                opensslVersion = 'Error: ' + e.message;
            }

            const [certFactProd, certPadronProd, certHomo, wsfeDummy] = await Promise.all([
                inspectCertAndTestSign('Facturación Electrónica Producción (CN=LAMDA_FACTURACION)', 'prod-cert.pem', 'prod-key.pem', 'wsfe'),
                inspectCertAndTestSign('Padrón A5 Clientes Búnker Producción (CN=lamda_clientes)', 'lamda_clientes.crt', 'lamda_clientes.key', 'ws_sr_constancia_inscripcion'),
                inspectCertAndTestSign('Facturación Homologación (CN=LAMDAHOMO2025M)', 'homo_cert.pem', 'homo_key.pem', 'wsfe'),
                callWsfeProdDummy()
            ]);

            let padronTest = { ok: false, cuitConsultado: cuitPrueba };
            const tPadron0 = Date.now();
            try {
                const { consultarPadron } = require('../logistica/services/arcaService');
                const datosCuit = await consultarPadron(cuitPrueba);
                padronTest = {
                    ok: true,
                    cuitConsultado: cuitPrueba,
                    latencyMs: Date.now() - tPadron0,
                    endpoint: 'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5',
                    servicio: 'ws_sr_constancia_inscripcion',
                    datos: datosCuit
                };
            } catch (errPadron) {
                padronTest = {
                    ok: false,
                    cuitConsultado: cuitPrueba,
                    latencyMs: Date.now() - tPadron0,
                    error: errPadron.message
                };
            }

            let taTableRows = [];
            try {
                const { pool } = require('../logistica/config/database');
                const rTa = await pool.query(`
                    SELECT entorno, servicio, expira_en, creado_en, cuit, origen_host,
                           (expira_en > NOW()) AS vigente,
                           ROUND(EXTRACT(EPOCH FROM (expira_en - NOW())) / 60) AS minutos_restantes
                    FROM public.factura_afip_ta
                    ORDER BY entorno, servicio
                `);
                taTableRows = rTa.rows || [];
            } catch (_) {}

            const flagNube = String(process.env.LAMDA_MODO_PRUEBA_NUBE || '').trim().toLowerCase();
            const isPruebaNube = flagNube === 'true' || flagNube === '1';

            return res.json({
                ok: Boolean(
                    certFactProd.cmsSignatureTestOk &&
                    certPadronProd.cmsSignatureTestOk &&
                    wsfeDummy.ok &&
                    padronTest.ok
                ),
                timestamp: new Date().toISOString(),
                host: os.hostname(),
                platform: `${process.platform} (${os.release()})`,
                openssl: {
                    binary: opensslBin,
                    version: opensslVersion
                },
                resguardoPcAlmacen: {
                    modoPruebaNubeActivo: isPruebaNube,
                    emisionRealWsfeBloqueadaEnNubePrueba: isPruebaNube,
                    explicacion: 'Mientras PcAlmacen es titular en el depósito, nube-prueba mantiene bloqueado el pedido de TA PROD/wsfe para jamás competir con la facturación local. La aptitud de PROD/wsfe se verifica mediante firma CMS local + FEDummy pasivo.'
                },
                certificados: {
                    facturacionProd: certFactProd,
                    padronClientesProd: certPadronProd,
                    facturacionHomo: certHomo
                },
                wsfeProduccionDummy: wsfeDummy,
                padronClientesA5: padronTest,
                ticketsAccesoEnBD: taTableRows
            });
        } catch (err) {
            return res.status(500).json({ ok: false, error: err.message });
        }
    });

    // 2C. Diagnóstico Integral de Servicios de IA ("Chofer" / Gemini) en la Nube y Resguardo de Switch Local <-> Nube
    app.get('/api/system/ia-diagnostico', async (req, res) => {
        try {
            const flagNube = String(process.env.LAMDA_MODO_PRUEBA_NUBE || '').trim().toLowerCase();
            const flagRedirect = String(process.env.SAFE_DELIVERY_REDIRECT || '').trim().toLowerCase();
            const isPruebaNube = flagNube === 'true' || flagNube === '1' || flagRedirect === 'true' || flagRedirect === '1';
            const isEspejoWa = String(process.env.WHATSAPP_MODO_ESPEJO || '').trim().toLowerCase() === 'true';
            const isStandbyWa = String(process.env.LAMDA_ROLE || '').trim().toUpperCase() === 'GALPON_BRIDGE_ONLY' || String(process.env.WHATSAPP_STANDBY_PASIVO || '').trim().toLowerCase() === 'true';

            const keyPrimary = String(process.env.GEMINI_API_KEY || '').trim();
            const keyBackup = String(process.env.GEMINI_API_KEY_BACKUP || '').trim();

            let modoCredLlm = null;
            try {
                const agenteHibridoLlm = require('../services/whatsappAgenteHibridoLlmService');
                modoCredLlm = agenteHibridoLlm.obtenerModoCredencialGemini();
            } catch (errSalud) {
                modoCredLlm = { error: errSalud.message };
            }

            let saludLlm = { ok: false };
            if (keyPrimary.length > 10) {
                const https = require('https');
                const tPing0 = Date.now();
                saludLlm = await new Promise((resolve) => {
                    const reqG = https.get(
                        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash?key=' + encodeURIComponent(keyPrimary),
                        { timeout: 10000 },
                        (resp) => {
                            let body = '';
                            resp.on('data', (c) => { body += c; });
                            resp.on('end', () => {
                                try {
                                    const parsed = JSON.parse(body);
                                    resolve({
                                        ok: resp.statusCode === 200 && Boolean(parsed && parsed.name),
                                        statusCode: resp.statusCode,
                                        latencyMs: Date.now() - tPing0,
                                        modelVerified: parsed.name || 'models/gemini-2.5-flash',
                                        displayName: parsed.displayName || 'Gemini 2.5 Flash',
                                        modoCredencialAgente: modoCredLlm ? modoCredLlm.modo : null
                                    });
                                } catch (e) {
                                    resolve({ ok: false, statusCode: resp.statusCode, error: e.message });
                                }
                            });
                        }
                    );
                    reqG.on('error', (err) => resolve({ ok: false, error: err.message, latencyMs: Date.now() - tPing0 }));
                    reqG.on('timeout', () => { reqG.destroy(); resolve({ ok: false, error: 'Timeout Gemini API', latencyMs: Date.now() - tPing0 }); });
                });
            }

            let estadoCredito = null;
            try {
                const iaCreditoMonitor = require('../services/iaCreditoMonitorService');
                estadoCredito = iaCreditoMonitor.leerLedgerDisco();
            } catch (errCred) {
                estadoCredito = { error: errCred.message };
            }

            return res.json({
                ok: Boolean(saludLlm && saludLlm.ok && keyPrimary.length > 10),
                timestamp: new Date().toISOString(),
                credenciales: {
                    geminiApiKeyPrincipalConfigurada: keyPrimary.length > 10,
                    geminiApiKeyPrincipalPrefijo: keyPrimary ? keyPrimary.slice(0, 8) + '...' : null,
                    geminiApiKeyBackupConfigurada: keyBackup.length > 10,
                    geminiApiKeyBackupPrefijo: keyBackup ? keyBackup.slice(0, 8) + '...' : null
                },
                pingEnVivoGemini: saludLlm,
                presupuestoYTokensLedger: estadoCredito,
                modulosIaRelevados: [
                    {
                        modulo: '1. Asistente Híbrido CRM WhatsApp ("Chofer" / Mesa de Agentes)',
                        archivo: 'src/services/whatsappAgenteHibridoLlmService.js',
                        modelo: process.env.GEMINI_MODEL || 'gemini-3.8-flash / gemini-flash-latest',
                        modoDisparo: 'Bajo demanda (al hacer clic en Generar Propuesta IA en Mesa de Agentes)',
                        estadoEnNube: saludLlm.ok ? 'ACTIVO_Y_VERIFICADO' : 'ERROR'
                    },
                    {
                        modulo: '2. Transcriptor Automático de Audios de Clientes WhatsApp (Ogg Opus -> Texto)',
                        archivo: 'src/services/whatsappAudioTranscriberService.js',
                        modelo: 'gemini-2.5-flash (multimodal nativo) + fallback Whisper local',
                        modoDisparo: 'Automático al ingresar audio PTT de Cliente Búnker en el servidor Activo; o bajo demanda desde el CRM',
                        proteccionSwitch: (isPruebaNube || isEspejoWa || isStandbyWa)
                            ? 'BLOQUEADO_EN_STANDBY_PRUEBA (No transcribe en duplicado mientras PcAlmacen es titular)'
                            : 'ACTIVO_TITULAR'
                    },
                    {
                        modulo: '3. Conciliador Inteligente de Extractos Bancarios (Home Banking / Cuentas Bancarias)',
                        archivo: 'src/facturacion/services/geminiService.js + cuentasBancariasService.js',
                        modelo: 'gemini-2.5-flash',
                        modoDisparo: 'Bajo demanda al importar movimientos bancarios en Facturación (3004)',
                        estadoEnNube: keyPrimary.length > 10 ? 'ACTIVO_Y_VERIFICADO' : 'FALTA_API_KEY'
                    },
                    {
                        modulo: '4. Monitor de Presupuesto y Tokens IA (Ledger USD)',
                        archivo: 'src/services/iaCreditoMonitorService.js',
                        modelo: 'Auditoría contable de tokens (data/ia_credito_ledger.json)',
                        estadoEnNube: (estadoCredito && !estadoCredito.error) ? 'ACTIVO_Y_VERIFICADO' : 'ERROR'
                    }
                ],
                resguardoSwitchLocalNube: {
                    modoPruebaNubeActivo: isPruebaNube,
                    modoEspejoWaActivo: isEspejoWa,
                    modoStandbyPasivoActivo: isStandbyWa,
                    garantiaNoDuplicacion: 'Ningún servicio de IA envía mensajes autónomos sin acción humana. El único proceso automático en segundo plano (transcripción de audios entrantes de clientes por WhatsApp) está bloqueado por candado en el servidor en Standby/Prueba, garantizando 0% de duplicación entre Local y Nube.'
                }
            });
        } catch (err) {
            return res.status(500).json({ ok: false, error: err.message });
        }
    });

    // 3. Endpoints de gestión de Bandeja Zebra (Liberar / Descartar / Agente Local)
    app.get('/api/system/print-queue/status', async (req, res) => {
        const resumen = await obtenerResumenColaRetenida();
        res.json({ ok: true, ...resumen });
    });

    app.post('/api/system/print-queue/release/:id', async (req, res) => {
        try {
            const jobId = parseInt(req.params.id, 10);
            if (!Number.isFinite(jobId) || jobId <= 0) {
                return res.status(400).json({ ok: false, error: 'ID de trabajo inválido.' });
            }
            const result = await liberarEtiquetasRetenidas([jobId]);
            res.json({ ok: true, id: jobId, ...result });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    app.post('/api/system/print-queue/release-all', async (req, res) => {
        try {
            const ids = (req.body && Array.isArray(req.body.ids)) ? req.body.ids : null;
            const result = await liberarEtiquetasRetenidas(ids);
            res.json({ ok: true, ...result });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    app.post('/api/system/print-queue/discard-all', async (req, res) => {
        try {
            const ids = (req.body && Array.isArray(req.body.ids)) ? req.body.ids : null;
            const result = await descartarEtiquetasRetenidas(ids);
            res.json({ ok: true, ...result });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    app.get('/api/system/print-queue/agent-pull', async (req, res) => {
        try {
            const tokenHeader = String(req.headers['x-lamda-print-token'] || req.query.token || '').trim();
            const expectedToken = String(process.env.LAMDA_PRINT_BRIDGE_TOKEN || obtenerSecretoPresenciaZebra()).trim();
            if (!tokenHeader || tokenHeader !== expectedToken) {
                return res.status(401).json({ ok: false, error: 'Token de Print Bridge inválido.' });
            }
            await registrarHeartbeatAgenteZebra({
                estacionId: 'PCALMACEN',
                ipOrigen: String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || '127.0.0.1'),
                estadoImpresora: 'ONLINE'
            });
            const jobs = await obtenerTrabajosLiberadosParaAgente(20);
            res.json({ ok: true, jobs });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    app.post('/api/system/print-queue/agent-ack/:id', async (req, res) => {
        try {
            const tokenHeader = String(req.headers['x-lamda-print-token'] || req.query.token || '').trim();
            const expectedToken = String(process.env.LAMDA_PRINT_BRIDGE_TOKEN || obtenerSecretoPresenciaZebra()).trim();
            if (!tokenHeader || tokenHeader !== expectedToken) {
                return res.status(401).json({ ok: false, error: 'Token de Print Bridge inválido.' });
            }
            const jobId = parseInt(req.params.id, 10);
            const exito = req.body ? Boolean(req.body.exito) : true;
            const errorDetalle = req.body ? req.body.errorDetalle : null;
            await confirmarImpresionAgente(jobId, exito, errorDetalle);
            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    // 4. Inyección transparente de <script src="/lamda-cloud-runtime.js"></script> y reescritura /gw/300X/(js|css)/ en respuestas HTML (incluyendo express.static)
    app.use((req, res, next) => {
        const reqPathClean = String(req.path || req.url || '').split('?')[0].toLowerCase();
        const isPotentialHtmlGet = req.method === 'GET' && (reqPathClean === '/' || reqPathClean.endsWith('.html'));
        if (isPotentialHtmlGet) {
            delete req.headers['if-none-match'];
            delete req.headers['if-modified-since'];
            delete req.headers['accept-encoding'];
        }

        const originalSend = res.send.bind(res);
        const originalSendFile = res.sendFile.bind(res);
        const originalWrite = res.write.bind(res);
        const originalEnd = res.end.bind(res);
        let htmlChunks = [];
        let bufferingHtmlStream = false;

        res.send = function(body) {
            try {
                const contentType = String(res.getHeader('Content-Type') || '');
                if (typeof body === 'string' && (contentType.includes('text/html') || /^\s*<!DOCTYPE html/i.test(body) || /^\s*<html/i.test(body))) {
                    body = injectScriptTagInHtml(body, servicePort);
                }
            } catch (_) {}
            return originalSend(body);
        };

        res.sendFile = function(filePath, options, fn) {
            if (typeof filePath === 'string' && filePath.toLowerCase().endsWith('.html') && fs.existsSync(filePath)) {
                try {
                    const rawHtml = fs.readFileSync(filePath, 'utf8');
                    res.setHeader('Content-Type', 'text/html; charset=utf-8');
                    return originalSend(injectScriptTagInHtml(rawHtml, servicePort));
                } catch (_) {}
            }
            return originalSendFile(filePath, options, fn);
        };

        if (isPotentialHtmlGet) {
            res.write = function(chunk, encoding, cb) {
                const ct = String(res.getHeader('Content-Type') || '').toLowerCase();
                if (ct.includes('text/html') && chunk) {
                    bufferingHtmlStream = true;
                    htmlChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8'));
                    if (typeof cb === 'function') cb();
                    return true;
                }
                return originalWrite(chunk, encoding, cb);
            };

            res.end = function(chunk, encoding, cb) {
                const ct = String(res.getHeader('Content-Type') || '').toLowerCase();
                if ((bufferingHtmlStream || ct.includes('text/html')) && (htmlChunks.length > 0 || chunk)) {
                    try {
                        if (chunk && typeof chunk !== 'function') {
                            htmlChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8'));
                        }
                        const rawStr = Buffer.concat(htmlChunks).toString('utf8');
                        const modifiedStr = injectScriptTagInHtml(rawStr, servicePort);
                        const outBuf = Buffer.from(modifiedStr, 'utf8');
                        if (!res.headersSent) {
                            res.setHeader('Content-Length', outBuf.length);
                            res.removeHeader('ETag');
                        }
                        return originalEnd(outBuf, typeof encoding === 'function' ? encoding : cb);
                    } catch (_) {}
                }
                return originalEnd(chunk, encoding, cb);
            };
        }

        next();
    });
}

module.exports = {
    attachLamdaCloudRuntime,
    injectScriptTagInHtml
};
