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
            resolved = resolved
                .replace(/^https?:\\/\\/(localhost|127\\.0\\.0\\.1):3005(\\/|$)/i, origin + '$2')
                .replace(/^https?:\\/\\/(localhost|127\\.0\\.0\\.1):3000(\\/|$)/i, origin + '/gw/3000$2')
                .replace(/^https?:\\/\\/(localhost|127\\.0\\.0\\.1):3002(\\/|$)/i, origin + '/gw/3002$2')
                .replace(/^https?:\\/\\/(localhost|127\\.0\\.0\\.1):3003(\\/|$)/i, origin + '/gw/3003$2')
                .replace(/^https?:\\/\\/(localhost|127\\.0\\.0\\.1):3004(\\/|$)/i, origin + '/gw/3004$2');
        }

        // Si el navegador está bajo /gw/(300[0234])/ y la URL es relativa a la raíz (/...),
        // anteponer automáticamente /gw/300X salvo rutas globales de 3005/sistema
        var locPath = (window.location && window.location.pathname) ? window.location.pathname : '';
        var gwMatch = /^\\/gw\\/(300[0234])(\\/|$)/i.exec(locPath);
        if (gwMatch && resolved.charAt(0) === '/' && resolved.charAt(1) !== '/') {
            var isRootGatewayRoute =
                resolved.indexOf('/gw/300') === 0 ||
                resolved.indexOf('/api/logistica') === 0 ||
                resolved.indexOf('/api/bunker') === 0 ||
                resolved.indexOf('/api/b2b') === 0 ||
                resolved.indexOf('/api/system') === 0 ||
                resolved.indexOf('/lamda-cloud-runtime.js') === 0 ||
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
    function pollLocalZebraPresence() {
        if (!originalFetch) return;
        originalFetch('http://127.0.0.1:3099/zebra-local-presence', {
            method: 'GET',
            mode: 'cors',
            cache: 'no-store'
        })
        .then(function(r) { return r && r.ok ? r.json() : null; })
        .then(function(data) {
            if (data && data.ok && data.station === 'PCALMACEN_VERIFIED' && data.token) {
                window.__LAMDA_PHYSICAL_PRESENCE__ = {
                    verified: true,
                    station: 'PCALMACEN_VERIFIED',
                    token: String(data.token),
                    ts: Date.now()
                };
            } else {
                window.__LAMDA_PHYSICAL_PRESENCE__.verified = false;
            }
        })
        .catch(function() {
            window.__LAMDA_PHYSICAL_PRESENCE__.verified = false;
        });
    }

    pollLocalZebraPresence();
    setInterval(pollLocalZebraPresence, 4000);

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

    // 4. Interceptar clics en enlaces <a href="http://localhost:300X...">
    document.addEventListener('click', function(e) {
        var anchor = e.target && e.target.closest ? e.target.closest('a[href]') : null;
        if (!anchor) return;
        var href = anchor.getAttribute('href');
        if (href && /^https?:\\/\\/(localhost|127\\.0\\.0\\.1):300[0-5]/i.test(href)) {
            var resolved = window.LAMDA_RESOLVE_URL(href);
            if (resolved !== href) {
                anchor.setAttribute('href', resolved);
            }
        }
    }, true);

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
    var zebraBannerEl = null;
    var zebraModalEl = null;
    var lastZebraItems = [];

    function ensureTopContainer() {
        var container = document.getElementById('lamda-system-top-banners');
        if (!container && document.body) {
            container = document.createElement('div');
            container.id = 'lamda-system-top-banners';
            container.style.cssText = 'position:sticky;top:0;left:0;right:0;z-index:2147483640;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;';
            document.body.insertBefore(container, document.body.firstChild);
        }
        return container;
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
            var containerNube = ensureTopContainer();
            if (!containerNube) return;
            if (!labBannerEl) {
                labBannerEl = document.createElement('div');
                labBannerEl.id = 'lamda-lab-mode-banner';
                containerNube.appendChild(labBannerEl);
            }
            labBannerEl.style.cssText = [
                'background: linear-gradient(90deg, #0369a1, #0f172a, #0369a1);',
                'color: #f0f9ff;',
                'padding: 8px 16px;',
                'font-size: 13px;',
                'font-weight: 800;',
                'letter-spacing: 0.3px;',
                'text-align: center;',
                'border-bottom: 2px solid #38bdf8;',
                'box-shadow: 0 3px 10px rgba(0,0,0,0.35);',
                'display: flex;',
                'align-items: center;',
                'justify-content: center;',
                'gap: 12px;',
                'flex-wrap: wrap;'
            ].join('');
            labBannerEl.innerHTML =
                '<span style="background:#38bdf8;color:#0f172a;padding:2px 8px;border-radius:4px;font-weight:900;">☁️ MODO PRUEBA EN NUBE (PARALELO)</span>' +
                '<span>ENTORNO PARALELO DE ENSAYO — <strong style="color:#fde68a;">PcAlmacen SIGUE COMO TITULAR EN EL DEPÓSITO</strong></span>' +
                '<span style="font-size:11px;background:rgba(0,0,0,0.45);padding:2px 8px;border-radius:4px;">🧪 WhatsApp redirigido a ' + (status.safeRedirectWhatsapp || '221-6615746') + ' · Emails redirigidos a ' + (status.safeRedirectEmail || 'miserrano75@gmail.com') + ' · Supabase Sandbox</span>';
            return;
        }
        if (document.title && document.title.indexOf('[PRUEBAS]') === -1) {
            document.title = '[PRUEBAS] ' + document.title;
        }
        var container = ensureTopContainer();
        if (!container) return;
        if (!labBannerEl) {
            labBannerEl = document.createElement('div');
            labBannerEl.id = 'lamda-lab-mode-banner';
            labBannerEl.style.cssText = [
                'background: repeating-linear-gradient(135deg, #b45309, #b45309 18px, #92400e 18px, #92400e 36px);',
                'color: #fffbeb;',
                'padding: 8px 16px;',
                'font-size: 13px;',
                'font-weight: 800;',
                'letter-spacing: 0.3px;',
                'text-align: center;',
                'border-bottom: 2px solid #fde68a;',
                'box-shadow: 0 3px 10px rgba(0,0,0,0.35);',
                'display: flex;',
                'align-items: center;',
                'justify-content: center;',
                'gap: 12px;',
                'flex-wrap: wrap;'
            ].join('');
            container.appendChild(labBannerEl);
        }
        labBannerEl.innerHTML =
            '<span style="background:#fef3c7;color:#78350f;padding:2px 8px;border-radius:4px;font-weight:900;">🛠️ MODO LABORATORIO / PRUEBAS</span>' +
            '<span>BASE DE DATOS: <strong style="color:#fde68a;text-decoration:underline;">' + (status.dbName || 'etiquetas_pruebas') + '</strong> — NO USAR PARA OPERACIÓN REAL</span>' +
            '<span style="font-size:11px;background:rgba(0,0,0,0.35);padding:2px 8px;border-radius:4px;">🔒 Supabase B2B Desconectado · WhatsApp Saliente Bloqueado · ARCA Homologación · Zebra Física Simulada</span>';
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
                'flex-wrap: wrap;'
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

    function pollSystemStatus() {
        fetch('/api/system/env-status', { headers: { 'Accept': 'application/json' } })
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(data) {
                if (!data) return;
                window.__LAMDA_ENV_STATUS__ = data;
                renderLabBanner(data);
                renderZebraBanner(data.zebraQueue);
            })
            .catch(function() {});
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            pollSystemStatus();
            setInterval(pollSystemStatus, 12000);
        });
    } else {
        pollSystemStatus();
        setInterval(pollSystemStatus, 12000);
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

    // 0C. En Modo Laboratorio, personalizar el manifest PWA de /mobile para diferenciar el ícono en el celular
    app.get('/mobile/manifest.json', (req, res, next) => {
        if (!esModoLaboratorio()) return next();
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        return res.json({
            name: '🛠️ [LAB] LAMDA Móvil (Pruebas)',
            short_name: 'LAMDA LAB',
            description: 'Entorno de Laboratorio y Pruebas - LAMDA Móvil (BD: etiquetas_pruebas)',
            start_url: './home.html',
            scope: './',
            display: 'standalone',
            background_color: '#78350f',
            theme_color: '#b45309',
            orientation: 'portrait',
            icons: [
                { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
                { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
                { src: 'apple-touch-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' }
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
        res.json({
            ok: true,
            servicePort,
            isLaboratorio,
            isPruebaNube,
            lamdaRole: process.env.LAMDA_ROLE || 'PRIMARY',
            physicalPresence: req.zebraPhysicalPresence || { estacionFisicaVerificada: false },
            safeRedirectWhatsapp: process.env.SAFE_REDIRECT_WHATSAPP_TO || '5492216615746',
            safeRedirectEmail: process.env.SAFE_REDIRECT_EMAIL_TO || 'miserrano75@gmail.com',
            isCloudMode: esModoCloudOLinux(),
            dbName: process.env.DB_NAME || 'etiquetas',
            afipEnv: (isLaboratorio || isPruebaNube) ? 'HOMO' : (process.env.AFIP_ENV || 'PROD'),
            whatsappModoEspejo: String(process.env.WHATSAPP_MODO_ESPEJO || '').toLowerCase() === 'true',
            zebraQueue
        });
    });

    // 3. Endpoints de gestión de Bandeja Zebra (Liberar / Descartar / Agente Local)
    app.get('/api/system/print-queue/status', async (req, res) => {
        const resumen = await obtenerResumenColaRetenida();
        res.json({ ok: true, ...resumen });
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

    // 4. Inyección transparente de <script src="/lamda-cloud-runtime.js"></script> en respuestas HTML
    app.use((req, res, next) => {
        const originalSend = res.send.bind(res);
        const originalSendFile = res.sendFile.bind(res);

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

        next();
    });
}

module.exports = {
    attachLamdaCloudRuntime,
    injectScriptTagInHtml
};
