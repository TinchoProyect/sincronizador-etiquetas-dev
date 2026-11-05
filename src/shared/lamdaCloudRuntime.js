/**
 * LAMDA Cloud Runtime & Laboratory/Zebra Guard (Fase 2 — Rama `desarrollo`)
 * --------------------------------------------------------------------------
 * Se monta en los 5 servidores Express (3000, 3002, 3003, 3004 y 3005) para proveer:
 *  1. Resolución dinámica de URLs entre entorno Multi-Puerto Local (`localhost:3000..3005`)
 *     y Dominio Único Cloud (`https://nube.lamdaser.com` / `https://logistica.lamdaser.com`).
 *  2. Franja visual inconfundible de `🛠️ MODO LABORATORIO / PRUEBAS` cuando `DB_NAME=etiquetas_pruebas`
 *     o `LAMDA_MODO_LABORATORIO=true`, más prefijo `[PRUEBAS]` en la pestaña del navegador.
 *  3. Bandeja interactiva de Confirmación de Etiquetas Zebra Retenidas (`🖨️ Cola Zebra Retenida`),
 *     garantizando que ninguna etiqueta enviada desde la calle o con la Zebra apagada se imprima
 *     sola sin confirmación explícita en el galpón.
 */

const fs = require('fs');
const path = require('path');
const {
    esModoLaboratorio,
    esModoCloudOLinux,
    obtenerResumenColaRetenida,
    liberarEtiquetasRetenidas,
    descartarEtiquetasRetenidas,
    obtenerTrabajosLiberadosParaAgente,
    confirmarImpresionAgente
} = require('../services/zebraPrintBridgeService');

const CLIENT_RUNTIME_SCRIPT = `
(function() {
    if (window.__LAMDA_CLOUD_RUNTIME_LOADED__) return;
    window.__LAMDA_CLOUD_RUNTIME_LOADED__ = true;

    function isCloudSinglePortOrigin() {
        var host = (window.location && window.location.hostname) ? window.location.hostname.toLowerCase() : '';
        if (!host) return false;
        if (window.location.pathname && window.location.pathname.indexOf('/gw/300') === 0) return true;
        if (host !== 'localhost' && host !== '127.0.0.1') return true;
        return false;
    }

    window.LAMDA_RESOLVE_URL = function(rawUrl) {
        if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
        if (!isCloudSinglePortOrigin()) return rawUrl;

        var origin = window.location.origin;
        return rawUrl
            .replace(/^https?:\\/\\/(localhost|127\\.0\\.0\\.1):3005(\\/|$)/i, origin + '$2')
            .replace(/^https?:\\/\\/(localhost|127\\.0\\.0\\.1):3000(\\/|$)/i, origin + '/gw/3000$2')
            .replace(/^https?:\\/\\/(localhost|127\\.0\\.0\\.1):3002(\\/|$)/i, origin + '/gw/3002$2')
            .replace(/^https?:\\/\\/(localhost|127\\.0\\.0\\.1):3003(\\/|$)/i, origin + '/gw/3003$2')
            .replace(/^https?:\\/\\/(localhost|127\\.0\\.0\\.1):3004(\\/|$)/i, origin + '/gw/3004$2');
    };

    // 1. Interceptar window.fetch
    if (typeof window.fetch === 'function') {
        var originalFetch = window.fetch.bind(window);
        window.fetch = function(input, init) {
            if (typeof input === 'string') {
                input = window.LAMDA_RESOLVE_URL(input);
            } else if (input && typeof Request !== 'undefined' && input instanceof Request && input.url) {
                var resolved = window.LAMDA_RESOLVE_URL(input.url);
                if (resolved !== input.url) {
                    input = new Request(resolved, input);
                }
            }
            return originalFetch(input, init);
        };
    }

    // 2. Interceptar XMLHttpRequest (usado por Axios y llamadas legacy)
    if (typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype && XMLHttpRequest.prototype.open) {
        var originalXhrOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url) {
            var args = Array.prototype.slice.call(arguments);
            if (typeof url === 'string') {
                args[1] = window.LAMDA_RESOLVE_URL(url);
            }
            return originalXhrOpen.apply(this, args);
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
        if (!status || !status.isLaboratorio) {
            if (labBannerEl) {
                labBannerEl.remove();
                labBannerEl = null;
            }
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

function injectScriptTagInHtml(htmlContent) {
    if (typeof htmlContent !== 'string') return htmlContent;
    if (htmlContent.includes('/lamda-cloud-runtime.js')) return htmlContent;
    const scriptTag = '<script src="/lamda-cloud-runtime.js"></script>';
    if (/<head[^>]*>/i.test(htmlContent)) {
        return htmlContent.replace(/<head[^>]*>/i, (match) => `${match}\n    ${scriptTag}`);
    }
    if (/<body[^>]*>/i.test(htmlContent)) {
        return htmlContent.replace(/<body[^>]*>/i, (match) => `${match}\n    ${scriptTag}`);
    }
    return `${scriptTag}\n${htmlContent}`;
}

function attachLamdaCloudRuntime(app, servicePort = 3000) {
    // 0. En Modo Laboratorio, personalizar el manifest PWA de /mobile para diferenciar el ícono en el celular
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
        res.send(CLIENT_RUNTIME_SCRIPT);
    });

    // 2. Endpoint de estado de entorno (Modo Laboratorio + Cola Zebra Retenida)
    app.get('/api/system/env-status', async (req, res) => {
        const isLaboratorio = esModoLaboratorio();
        const zebraQueue = await obtenerResumenColaRetenida();
        res.json({
            ok: true,
            servicePort,
            isLaboratorio,
            isCloudMode: esModoCloudOLinux(),
            dbName: process.env.DB_NAME || 'etiquetas',
            afipEnv: isLaboratorio ? 'HOMO' : (process.env.AFIP_ENV || 'PROD'),
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
            const tokenHeader = req.headers['x-lamda-print-token'] || req.query.token || '';
            const expectedToken = process.env.LAMDA_PRINT_BRIDGE_TOKEN || '';
            if (expectedToken && tokenHeader !== expectedToken) {
                return res.status(401).json({ ok: false, error: 'Token de Print Bridge inválido.' });
            }
            const jobs = await obtenerTrabajosLiberadosParaAgente(20);
            res.json({ ok: true, jobs });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    app.post('/api/system/print-queue/agent-ack/:id', async (req, res) => {
        try {
            const tokenHeader = req.headers['x-lamda-print-token'] || req.query.token || '';
            const expectedToken = process.env.LAMDA_PRINT_BRIDGE_TOKEN || '';
            if (expectedToken && tokenHeader !== expectedToken) {
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
                    body = injectScriptTagInHtml(body);
                }
            } catch (_) {}
            return originalSend(body);
        };

        res.sendFile = function(filePath, options, fn) {
            if (typeof filePath === 'string' && filePath.toLowerCase().endsWith('.html') && fs.existsSync(filePath)) {
                try {
                    const rawHtml = fs.readFileSync(filePath, 'utf8');
                    res.setHeader('Content-Type', 'text/html; charset=utf-8');
                    return originalSend(injectScriptTagInHtml(rawHtml));
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
