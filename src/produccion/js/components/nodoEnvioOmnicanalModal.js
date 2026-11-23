/**
 * ============================================================================
 * MODAL INTERNO OMNICANAL DE NODOS BARRIALES (WHATSAPP :3004 + EMAIL SMTP)
 * ============================================================================
 * Política Permanente del Taller LAMDA:
 * Ninguna pantalla administrativa interna abre `wa.me`, `api.whatsapp.com` ni `mailto:`.
 * Todo envío de invitaciones, links móviles o códigos QR de Nodos Barriales se
 * realiza mediante este modal previo con selección de contactos Búnker, destinatarios
 * manuales al vuelo, vista previa editable y confirmación real por canal (:3004 / SMTP).
 */
(function () {
    'use strict';

    if (window.__LAMDA_NODO_MODAL_OMNICANAL_READY__) return;
    window.__LAMDA_NODO_MODAL_OMNICANAL_READY__ = true;

    const MODAL_ID = 'lamda-modal-omnicanal-nodo-overlay';
    const STYLE_ID = 'lamda-modal-omnicanal-nodo-styles';

    let _estadoActual = null;

    function esc(val) {
        return String(val ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function inyectarEstilosModal() {
        if (document.getElementById(STYLE_ID)) return;
        const st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = `
            #${MODAL_ID} {
                position: fixed;
                inset: 0;
                z-index: 20050;
                background: rgba(15, 23, 42, 0.72);
                backdrop-filter: blur(3px);
                display: none;
                align-items: center;
                justify-content: center;
                padding: 16px;
                font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
                color: #0f172a;
                box-sizing: border-box;
            }
            #${MODAL_ID}.visible {
                display: flex;
            }
            #${MODAL_ID} * {
                box-sizing: border-box;
            }
            .lomni-dialog {
                width: 100%;
                max-width: 840px;
                max-height: 93vh;
                background: #ffffff;
                border-radius: 16px;
                box-shadow: 0 24px 60px rgba(15, 23, 42, 0.42);
                border: 1px solid #cbd5e1;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }
            .lomni-header {
                padding: 15px 20px;
                background: linear-gradient(135deg, #0f172a 0%, #1e293b 55%, #14532d 100%);
                color: #ffffff;
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                gap: 12px;
                flex-shrink: 0;
            }
            .lomni-close {
                background: rgba(255, 255, 255, 0.16);
                border: 1px solid rgba(255, 255, 255, 0.24);
                color: #ffffff;
                width: 34px;
                height: 34px;
                border-radius: 9px;
                font-size: 20px;
                font-weight: 800;
                cursor: pointer;
                line-height: 1;
                flex-shrink: 0;
            }
            .lomni-close:hover {
                background: rgba(255, 255, 255, 0.28);
            }
            .lomni-body {
                padding: 16px 20px;
                overflow-y: auto;
                flex: 1;
                background: #f8fafc;
                display: flex;
                flex-direction: column;
                gap: 14px;
            }
            .lomni-grid-2 {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 12px;
            }
            @media (max-width: 720px) {
                .lomni-grid-2 {
                    grid-template-columns: 1fr;
                }
            }
            .lomni-channel-box {
                background: #ffffff;
                border: 1.5px solid #cbd5e1;
                border-radius: 12px;
                padding: 12px;
                display: flex;
                flex-direction: column;
                gap: 8px;
                transition: border-color 0.15s, box-shadow 0.15s;
            }
            .lomni-channel-box.active-wa {
                border-color: #10b981;
                box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
            }
            .lomni-channel-box.active-em {
                border-color: #7c3aed;
                box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.1);
            }
            .lomni-channel-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                padding-bottom: 7px;
                border-bottom: 1px solid #e2e8f0;
            }
            .lomni-contact-list {
                display: flex;
                flex-direction: column;
                gap: 5px;
                max-height: 145px;
                overflow-y: auto;
            }
            .lomni-contact-item {
                display: flex;
                align-items: flex-start;
                gap: 8px;
                padding: 6px 8px;
                border-radius: 8px;
                border: 1px solid #e2e8f0;
                background: #f8fafc;
                cursor: pointer;
                font-size: 12px;
            }
            .lomni-contact-item:hover {
                background: #f1f5f9;
            }
            .lomni-inline-add {
                display: flex;
                gap: 6px;
                margin-top: 2px;
            }
            .lomni-input {
                width: 100%;
                padding: 7px 10px;
                border: 1px solid #cbd5e1;
                border-radius: 8px;
                font-size: 12.5px;
                color: #0f172a;
                background: #ffffff;
                font-family: inherit;
            }
            .lomni-input:focus {
                outline: none;
                border-color: #6366f1;
                box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.15);
            }
            .lomni-btn-mini {
                padding: 6px 10px;
                border-radius: 8px;
                border: 1px solid #cbd5e1;
                background: #f1f5f9;
                color: #1e293b;
                font-size: 11.5px;
                font-weight: 800;
                cursor: pointer;
                white-space: nowrap;
            }
            .lomni-btn-mini:hover {
                background: #e2e8f0;
            }
            .lomni-pill-tpl {
                padding: 7px 11px;
                border-radius: 9px;
                border: 1px solid #cbd5e1;
                background: #ffffff;
                color: #334155;
                font-size: 12px;
                font-weight: 800;
                cursor: pointer;
                transition: all 0.12s;
            }
            .lomni-pill-tpl.active {
                background: #0f172a;
                color: #ffffff;
                border-color: #0f172a;
            }
            .lomni-footer {
                padding: 12px 20px;
                background: #ffffff;
                border-top: 1px solid #e2e8f0;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 10px;
                flex-wrap: wrap;
                flex-shrink: 0;
            }
            .lomni-btn-cancel {
                padding: 9px 16px;
                border-radius: 9px;
                border: 1px solid #cbd5e1;
                background: #f1f5f9;
                color: #334155;
                font-size: 13px;
                font-weight: 800;
                cursor: pointer;
            }
            .lomni-btn-send {
                padding: 10px 20px;
                border-radius: 9px;
                border: none;
                background: linear-gradient(135deg, #16a34a 0%, #059669 100%);
                color: #ffffff;
                font-size: 13px;
                font-weight: 800;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(22, 163, 74, 0.25);
            }
            .lomni-btn-send:disabled {
                opacity: 0.6;
                cursor: wait;
            }
        `;
        document.head.appendChild(st);
    }

    function asegurarContenedorDom() {
        inyectarEstilosModal();
        let el = document.getElementById(MODAL_ID);
        if (!el) {
            el = document.createElement('div');
            el.id = MODAL_ID;
            el.addEventListener('click', function (ev) {
                if (ev.target === el) {
                    cerrarModalEnvioOmnicanalNodo();
                }
            });
            document.body.appendChild(el);
        }
        return el;
    }

    function cerrarModalEnvioOmnicanalNodo() {
        const el = document.getElementById(MODAL_ID);
        if (el) {
            el.classList.remove('visible');
        }
    }

    function obtenerPreviewQrPorTipo(accesosQr, qrTipo) {
        if (!accesosQr) return '';
        if (qrTipo === 'gestor') return accesosQr.qr_gestor_data_url || '';
        if (qrTipo === 'tienda_limpio') return accesosQr.qr_tienda_data_url || '';
        if (qrTipo === 'admin_prueba') return accesosQr.qr_tienda_admin_data_url || '';
        return accesosQr.qr_afiche_data_url || accesosQr.qr_tienda_data_url || '';
    }

    function actualizarEstadoVisualCanales() {
        if (!_estadoActual) return;
        const chkWa = document.getElementById('lomni-chk-canal-wa');
        const chkEm = document.getElementById('lomni-chk-canal-em');
        const boxWa = document.getElementById('lomni-box-wa');
        const boxEm = document.getElementById('lomni-box-em');
        const wrapAsunto = document.getElementById('lomni-wrap-asunto');

        const waOn = Boolean(chkWa && chkWa.checked);
        const emOn = Boolean(chkEm && chkEm.checked);
        if (boxWa) boxWa.classList.toggle('active-wa', waOn);
        if (boxEm) boxEm.classList.toggle('active-em', emOn);
        if (wrapAsunto) wrapAsunto.style.display = emOn ? 'block' : 'none';
    }

    function actualizarMiniaturaQr() {
        if (!_estadoActual) return;
        const chkQr = document.getElementById('lomni-chk-adjuntar-qr');
        const selQr = document.getElementById('lomni-sel-qr-tipo');
        const imgEl = document.getElementById('lomni-img-qr-preview');
        const wrapSel = document.getElementById('lomni-qr-config-detail');
        const activo = Boolean(chkQr && chkQr.checked);
        const qrTipo = selQr ? selQr.value : 'tienda_afiche';
        if (wrapSel) wrapSel.style.opacity = activo ? '1' : '0.45';
        if (selQr) selQr.disabled = !activo;
        if (imgEl) {
            const src = obtenerPreviewQrPorTipo(_estadoActual.data.accesos_qr, qrTipo);
            imgEl.src = src || '';
            imgEl.style.display = src && activo ? 'block' : 'none';
        }
    }

    function seleccionarPlantillaModal(tplKey) {
        if (!_estadoActual) return;
        _estadoActual.plantillaActiva = tplKey;

        document.querySelectorAll('#lomni-tpl-bar .lomni-pill-tpl').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-tpl') === tplKey);
        });

        const tpl = (_estadoActual.plantillas && _estadoActual.plantillas[tplKey]) || null;
        if (!tpl) return;

        const inpAsunto = document.getElementById('lomni-input-asunto');
        const inpMensaje = document.getElementById('lomni-input-mensaje');
        const selQr = document.getElementById('lomni-sel-qr-tipo');

        if (inpAsunto) inpAsunto.value = tpl.asunto || '';
        if (inpMensaje) inpMensaje.value = tpl.mensaje_texto || '';
        if (selQr && tpl.qr_tipo_sugerido) {
            selQr.value = tpl.qr_tipo_sugerido;
        }
        actualizarMiniaturaQr();
    }

    function renderizarListasContactos() {
        if (!_estadoActual) return;
        const contWa = document.getElementById('lomni-list-wa');
        const contEm = document.getElementById('lomni-list-em');

        if (contWa) {
            if (_estadoActual.contactosWa.length === 0) {
                contWa.innerHTML = `<div style="font-size:11.5px; color:#64748b; padding:6px 4px;">Sin teléfonos precargados en la ficha. Ingresá un número abajo.</div>`;
            } else {
                contWa.innerHTML = _estadoActual.contactosWa.map((c, idx) => `
                    <label class="lomni-contact-item">
                        <input type="checkbox" data-wa-idx="${idx}" ${c.checked ? 'checked' : ''}
                            style="margin-top:2px; width:15px; height:15px; accent-color:#16a34a; cursor:pointer;"
                            onchange="window.__LAMDA_OMNI_TOGGLE_CONTACT__('wa', ${idx}, this.checked)" />
                        <div style="flex:1; min-width:0;">
                            <div style="display:flex; justify-content:space-between; gap:6px; align-items:center; flex-wrap:wrap;">
                                <strong style="color:#0f172a; font-family:monospace; font-size:12px;">📱 ${esc(c.numero_display || c.numero)}</strong>
                                <span style="font-size:10px; font-weight:800; padding:1px 6px; border-radius:999px; background:#dcfce7; color:#166534;">${esc(c.origen || 'Manual')}</span>
                            </div>
                            <div style="font-size:11px; color:#475569; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                                ${esc(c.nombre || '')}${c.cargo ? ' · ' + esc(c.cargo) : ''}
                            </div>
                        </div>
                    </label>
                `).join('');
            }
        }

        if (contEm) {
            if (_estadoActual.contactosEm.length === 0) {
                contEm.innerHTML = `<div style="font-size:11.5px; color:#64748b; padding:6px 4px;">Sin correos precargados en la ficha. Ingresá un email abajo.</div>`;
            } else {
                contEm.innerHTML = _estadoActual.contactosEm.map((c, idx) => `
                    <label class="lomni-contact-item">
                        <input type="checkbox" data-em-idx="${idx}" ${c.checked ? 'checked' : ''}
                            style="margin-top:2px; width:15px; height:15px; accent-color:#7c3aed; cursor:pointer;"
                            onchange="window.__LAMDA_OMNI_TOGGLE_CONTACT__('em', ${idx}, this.checked)" />
                        <div style="flex:1; min-width:0;">
                            <div style="display:flex; justify-content:space-between; gap:6px; align-items:center; flex-wrap:wrap;">
                                <strong style="color:#0f172a; font-size:11.8px; word-break:break-all;">✉️ ${esc(c.email)}</strong>
                                <span style="font-size:10px; font-weight:800; padding:1px 6px; border-radius:999px; background:#ede9fe; color:#5b21b6;">${esc(c.origen || 'Manual')}</span>
                            </div>
                            <div style="font-size:11px; color:#475569; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                                ${esc(c.nombre || '')}${c.cargo ? ' · ' + esc(c.cargo) : ''}
                            </div>
                        </div>
                    </label>
                `).join('');
            }
        }
    }

    window.__LAMDA_OMNI_TOGGLE_CONTACT__ = function (tipo, idx, checked) {
        if (!_estadoActual) return;
        const arr = tipo === 'wa' ? _estadoActual.contactosWa : _estadoActual.contactosEm;
        if (arr[idx]) arr[idx].checked = Boolean(checked);
    };

    function agregarContactoManualAlVuelo(tipo) {
        if (!_estadoActual) return;
        if (tipo === 'wa') {
            const inp = document.getElementById('lomni-manual-wa');
            if (!inp) return;
            const partes = String(inp.value || '').split(/[,;]+/).map(s => s.trim()).filter(Boolean);
            let sumados = 0;
            for (const p of partes) {
                const digits = p.replace(/\D/g, '');
                if (digits.length < 7) continue;
                const existente = _estadoActual.contactosWa.find(c => c.numero.replace(/\D/g, '').endsWith(digits.slice(-8)));
                if (existente) {
                    existente.checked = true;
                } else {
                    _estadoActual.contactosWa.push({
                        numero: digits,
                        numero_display: p,
                        nombre: 'Destinatario manual / Prueba',
                        cargo: '',
                        origen: 'Manual al vuelo',
                        checked: true
                    });
                }
                sumados++;
            }
            if (sumados > 0) {
                inp.value = '';
                const chkCanal = document.getElementById('lomni-chk-canal-wa');
                if (chkCanal) chkCanal.checked = true;
                renderizarListasContactos();
                actualizarEstadoVisualCanales();
            }
        } else {
            const inp = document.getElementById('lomni-manual-em');
            if (!inp) return;
            const partes = String(inp.value || '').split(/[,;]+/).map(s => s.trim().toLowerCase()).filter(s => s.includes('@'));
            let sumados = 0;
            for (const p of partes) {
                const existente = _estadoActual.contactosEm.find(c => c.email.toLowerCase() === p);
                if (existente) {
                    existente.checked = true;
                } else {
                    _estadoActual.contactosEm.push({
                        email: p,
                        nombre: 'Destinatario manual / Prueba',
                        cargo: '',
                        origen: 'Manual al vuelo',
                        checked: true
                    });
                }
                sumados++;
            }
            if (sumados > 0) {
                inp.value = '';
                const chkCanal = document.getElementById('lomni-chk-canal-em');
                if (chkCanal) chkCanal.checked = true;
                renderizarListasContactos();
                actualizarEstadoVisualCanales();
            }
        }
    }

    async function ejecutarDespachoOmnicanalNodo() {
        if (!_estadoActual) return;
        const btnSend = document.getElementById('lomni-btn-submit');
        const resBox = document.getElementById('lomni-result-box');

        // Si el usuario tipeó algo en el input rápido sin tocar "+ Sumar", incluirlo automáticamente
        const rawManualWa = String(document.getElementById('lomni-manual-wa')?.value || '').trim();
        if (rawManualWa) agregarContactoManualAlVuelo('wa');
        const rawManualEm = String(document.getElementById('lomni-manual-em')?.value || '').trim();
        if (rawManualEm) agregarContactoManualAlVuelo('em');

        const enviarWa = Boolean(document.getElementById('lomni-chk-canal-wa')?.checked);
        const enviarEm = Boolean(document.getElementById('lomni-chk-canal-em')?.checked);
        const adjuntarQr = Boolean(document.getElementById('lomni-chk-adjuntar-qr')?.checked);
        const qrTipo = String(document.getElementById('lomni-sel-qr-tipo')?.value || 'tienda_afiche');
        const adjuntarVideo = Boolean(document.getElementById('lomni-chk-adjuntar-video')?.checked);
        const asunto = String(document.getElementById('lomni-input-asunto')?.value || '').trim();
        const mensajeTexto = String(document.getElementById('lomni-input-mensaje')?.value || '').trim();

        const destWa = _estadoActual.contactosWa.filter(c => c.checked).map(c => c.numero);
        const destEm = _estadoActual.contactosEm.filter(c => c.checked).map(c => c.email);

        if (!enviarWa && !enviarEm) {
            if (resBox) {
                resBox.style.display = 'block';
                resBox.innerHTML = `<div style="padding:10px 12px; border-radius:9px; background:#fef2f2; border:1px solid #fecaca; color:#991b1b; font-size:12.5px; font-weight:700;">⚠️ Marcá al menos un canal de envío (WhatsApp y/o Correo Electrónico).</div>`;
            }
            return;
        }
        if (enviarWa && destWa.length === 0) {
            if (resBox) {
                resBox.style.display = 'block';
                resBox.innerHTML = `<div style="padding:10px 12px; border-radius:9px; background:#fef2f2; border:1px solid #fecaca; color:#991b1b; font-size:12.5px; font-weight:700;">⚠️ Tildá al menos un teléfono de WhatsApp o escribí un número en el campo manual.</div>`;
            }
            return;
        }
        if (enviarEm && destEm.length === 0) {
            if (resBox) {
                resBox.style.display = 'block';
                resBox.innerHTML = `<div style="padding:10px 12px; border-radius:9px; background:#fef2f2; border:1px solid #fecaca; color:#991b1b; font-size:12.5px; font-weight:700;">⚠️ Tildá al menos un correo electrónico o escribí un email en el campo manual.</div>`;
            }
            return;
        }
        if (!mensajeTexto) {
            if (resBox) {
                resBox.style.display = 'block';
                resBox.innerHTML = `<div style="padding:10px 12px; border-radius:9px; background:#fef2f2; border:1px solid #fecaca; color:#991b1b; font-size:12.5px; font-weight:700;">⚠️ El cuerpo del mensaje no puede estar vacío.</div>`;
            }
            return;
        }

        const textoBtnOrig = btnSend ? btnSend.innerHTML : '';
        if (btnSend) {
            btnSend.disabled = true;
            btnSend.innerHTML = '⏳ Despachando por motor interno...';
        }
        if (resBox) {
            resBox.style.display = 'block';
            resBox.innerHTML = `<div style="padding:10px 12px; border-radius:9px; background:#eff6ff; border:1px solid #bfdbfe; color:#1e40af; font-size:12.5px; font-weight:700;">⏳ Procesando envío interno en servidor LAMDA (:3004)...</div>`;
        }

        try {
            const nodoId = _estadoActual.data.nodo.id;
            const resp = await fetch(`/api/produccion/nodos/comunicaciones/nodo/${encodeURIComponent(nodoId)}/enviar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    enviar_whatsapp: enviarWa,
                    enviar_email: enviarEm,
                    destinatarios_whatsapp: destWa,
                    destinatarios_email: destEm,
                    plantilla_tipo: _estadoActual.plantillaActiva,
                    adjuntar_qr: adjuntarQr,
                    adjuntar_video_bienvenida: adjuntarVideo,
                    qr_tipo: qrTipo,
                    asunto,
                    mensaje_texto: mensajeTexto,
                    nombre_destinatario: _estadoActual.opciones?.nombreDestinatarioInicial || ''
                })
            });
            const rJson = await resp.json().catch(() => ({}));

            const bloques = [];
            if (rJson.whatsapp && rJson.whatsapp.attempted) {
                if (rJson.whatsapp.ok) {
                    const simBadge = rJson.whatsapp.simulated
                        ? `<span style="background:#fef3c7; color:#92400e; padding:1px 7px; border-radius:999px; font-size:10.5px; margin-left:6px;">🛡️ SIMULADO EN LABORATORIO (221 661 5746)</span>`
                        : `<span style="background:#dcfce7; color:#166534; padding:1px 7px; border-radius:999px; font-size:10.5px; margin-left:6px;">✅ ENTREGADO (:3004)</span>`;
                    bloques.push(`
                        <div style="padding:8px 11px; border-radius:8px; background:#f0fdf4; border:1px solid #86efac; color:#14532d; font-size:12px;">
                            <strong>📱 WhatsApp Interno (:3004):</strong> Destinos: <code>${esc(rJson.whatsapp.destinatarios.join(', '))}</code>
                            ${rJson.whatsapp.adjunto_qr ? ` · 🖼️ QR: <code>${esc(rJson.whatsapp.adjunto_qr)}</code>` : ''}
                            ${rJson.whatsapp.adjunto_video ? ` · 🎬 Video: <code>${esc(rJson.whatsapp.adjunto_video)}</code>` : ''}
                            ${simBadge}
                        </div>
                    `);
                } else {
                    bloques.push(`
                        <div style="padding:8px 11px; border-radius:8px; background:#fef2f2; border:1px solid #fecaca; color:#991b1b; font-size:12px;">
                            <strong>❌ WhatsApp (:3004):</strong> ${esc(rJson.whatsapp.error || 'Error al despachar por WhatsApp')}
                        </div>
                    `);
                }
            }

            if (rJson.email && rJson.email.attempted) {
                if (rJson.email.ok) {
                    const simEmBadge = rJson.email.simulated
                        ? `<span style="background:#fef3c7; color:#92400e; padding:1px 7px; border-radius:999px; font-size:10.5px; margin-left:6px;">🛡️ SIMULADO EN LABORATORIO (sin SMTP real)</span>`
                        : `<span style="background:#ede9fe; color:#5b21b6; padding:1px 7px; border-radius:999px; font-size:10.5px; margin-left:6px;">✅ ENVIADO POR SMTP</span>`;
                    bloques.push(`
                        <div style="padding:8px 11px; border-radius:8px; background:#f5f3ff; border:1px solid #c4b5fd; color:#4c1d95; font-size:12px;">
                            <strong>✉️ Correo Electrónico (SMTP):</strong> Destinos: <code>${esc(rJson.email.destinatarios.join(', '))}</code>
                            ${rJson.email.adjunto_qr ? ` · 🖼️ Adjunto: <code>${esc(rJson.email.adjunto_qr)}</code>` : ''}
                            ${simEmBadge}
                        </div>
                    `);
                } else {
                    bloques.push(`
                        <div style="padding:8px 11px; border-radius:8px; background:#fef2f2; border:1px solid #fecaca; color:#991b1b; font-size:12px;">
                            <strong>❌ Correo Electrónico (SMTP):</strong> ${esc(rJson.email.error || 'Error al enviar correo')}
                        </div>
                    `);
                }
            }

            if (bloques.length === 0 && !resp.ok) {
                bloques.push(`
                    <div style="padding:8px 11px; border-radius:8px; background:#fef2f2; border:1px solid #fecaca; color:#991b1b; font-size:12px;">
                        <strong>❌ Error:</strong> ${esc(rJson.error || 'No se pudo procesar el envío.')}
                    </div>
                `);
            }

            if (resBox) {
                resBox.style.display = 'block';
                resBox.innerHTML = `<div style="display:flex; flex-direction:column; gap:6px;">${bloques.join('')}</div>`;
            }
        } catch (err) {
            if (resBox) {
                resBox.style.display = 'block';
                resBox.innerHTML = `<div style="padding:10px 12px; border-radius:9px; background:#fef2f2; border:1px solid #fecaca; color:#991b1b; font-size:12.5px; font-weight:700;">❌ Error de red: ${esc(err.message)}</div>`;
            }
        } finally {
            if (btnSend) {
                btnSend.disabled = false;
                btnSend.innerHTML = textoBtnOrig;
            }
        }
    }

    async function abrirModalEnvioOmnicanalNodo(opciones = {}) {
        const overlay = asegurarContenedorDom();
        const identificador = opciones.nodoId || opciones.bunkerClienteId || opciones.slug || '';
        if (!identificador) {
            window.alert('No se especificó el identificador del Nodo para abrir el modal de envío.');
            return;
        }

        overlay.innerHTML = `
            <div class="lomni-dialog" onclick="event.stopPropagation()" style="max-width:520px;">
                <div class="lomni-header">
                    <div>
                        <div style="font-size:11px; text-transform:uppercase; opacity:0.85; font-weight:800;">Comunicaciones Internas LAMDA</div>
                        <h3 style="margin:3px 0 0 0; font-size:1.05rem; font-weight:800;">Cargando contactos y códigos QR del Nodo...</h3>
                    </div>
                    <button type="button" class="lomni-close" onclick="window.cerrarModalEnvioOmnicanalNodo()">&times;</button>
                </div>
                <div class="lomni-body" style="padding:28px 20px; text-align:center; color:#475569; font-size:13.5px;">
                    ⏳ Consultando ficha Búnker, plantillas y motor interno (:3004)...
                </div>
            </div>
        `;
        overlay.classList.add('visible');

        try {
            const resp = await fetch(`/api/produccion/nodos/comunicaciones/nodo/${encodeURIComponent(identificador)}/contexto`);
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || !data.ok) {
                throw new Error(data.error || `Error HTTP ${resp.status} obteniendo contexto del Nodo.`);
            }

            const desmarcarPrecargados = Boolean(opciones.desmarcarContactosPrecargados || opciones.telefonoManualInicial);
            const contactosWa = (data.contactos_whatsapp || []).map(c => ({
                ...c,
                checked: desmarcarPrecargados ? false : Boolean(c.seleccionado_default)
            }));
            const contactosEm = (data.contactos_email || []).map(c => ({
                ...c,
                checked: desmarcarPrecargados ? false : Boolean(c.seleccionado_default)
            }));

            if (opciones.telefonoManualInicial) {
                const telM = String(opciones.telefonoManualInicial).trim();
                const digits = telM.replace(/\D/g, '');
                if (digits.length >= 7) {
                    contactosWa.unshift({
                        numero: digits,
                        numero_display: telM,
                        nombre: opciones.nombreDestinatarioInicial || 'Visitante / Vecino',
                        cargo: 'Contacto directo',
                        origen: 'Seleccionado',
                        checked: true
                    });
                }
            }

            const plantillas = { ...(data.plantillas || {}) };
            let tplInicial = opciones.plantillaInicial || 'gestor_y_tienda';
            if (opciones.mensajePersonalizadoInicial) {
                plantillas.personalizado = {
                    id: 'personalizado',
                    titulo: opciones.tituloPlantillaPersonalizada || 'Mensaje Personalizado',
                    qr_tipo_sugerido: opciones.qrTipoInicial || 'tienda_limpio',
                    asunto: opciones.asuntoPersonalizadoInicial || `🛒 ${data.nodo.nombre_marca} — Tu pedido en tienda`,
                    mensaje_texto: opciones.mensajePersonalizadoInicial
                };
                tplInicial = 'personalizado';
            }
            if (!plantillas[tplInicial]) {
                tplInicial = 'gestor_y_tienda';
            }

            const tplObj = plantillas[tplInicial] || { asunto: '', mensaje_texto: '', qr_tipo_sugerido: 'tienda_afiche' };
            const qrTipoActivo = opciones.qrTipoInicial || tplObj.qr_tipo_sugerido || 'tienda_afiche';
            const adjuntarQrActivo = opciones.adjuntarQrInicial !== false;

            const activarWaInicial = contactosWa.some(c => c.checked) || contactosWa.length > 0;
            const activarEmInicial = Boolean(opciones.activarEmailInicial) || (!activarWaInicial && contactosEm.length > 0);

            _estadoActual = {
                data,
                opciones,
                plantillas,
                plantillaActiva: tplInicial,
                contactosWa,
                contactosEm
            };

            const n = data.nodo || {};
            const cli = data.cliente_operativo || {};
            const waStatus = data.whatsapp_motor?.status || 'DESCONOCIDO';

            overlay.innerHTML = `
                <div class="lomni-dialog" onclick="event.stopPropagation()">
                    <div class="lomni-header">
                        <div>
                            <div style="display:flex; align-items:center; gap:7px; flex-wrap:wrap; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; opacity:0.92;">
                                <span>🏘️ ${esc(n.nombre_marca)} (${esc(n.codigo_nodo)})</span>
                                <span style="background:rgba(255,255,255,0.18); padding:2px 8px; border-radius:999px;">
                                    ${cli.es_cuenta_madre_unificada ? '🔗 Cuenta Madre: ' : '🏢 Ficha Búnker: '}${esc(cli.codigo_bunker_cliente || '-')} · ${esc(cli.cliente_nombre || '')}
                                </span>
                            </div>
                            <h3 style="margin:4px 0 0 0; font-size:1.12rem; font-weight:900;">
                                📤 Envío Interno de Invitación, Links y Código QR (WhatsApp :3004 / Email)
                            </h3>
                        </div>
                        <button type="button" class="lomni-close" title="Cerrar" onclick="window.cerrarModalEnvioOmnicanalNodo()">&times;</button>
                    </div>

                    <div class="lomni-body">
                        <!-- Estado operativo del motor y resguardo -->
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; padding:8px 12px; border-radius:10px; background:${data.modo_laboratorio ? '#fffbeb' : '#ecfdf5'}; border:1px solid ${data.modo_laboratorio ? '#fcd34d' : '#86efac'}; font-size:12px;">
                            <span style="font-weight:800; color:${data.modo_laboratorio ? '#92400e' : '#166534'};">
                                ${data.modo_laboratorio
                                    ? `🛡️ Modo Laboratorio Activo: WhatsApp protegido/simulado hacia ${esc(data.telefono_resguardo_laboratorio)} y Email simulado sin envío externo.`
                                    : `🟢 Motor Propio LAMDA (:3004): WhatsApp ${esc(waStatus)} · SMTP Corporativo listo (cero enlaces wa.me externos).`
                                }
                            </span>
                            <span style="font-family:monospace; font-size:11px; color:#334155; font-weight:700;">
                                🌐 Base QR: ${esc(data.accesos_qr?.base_url_movil || '')}
                            </span>
                        </div>

                        <!-- 1. Selección de Canales y Contactos -->
                        <div class="lomni-grid-2">
                            <!-- Canal WhatsApp -->
                            <div id="lomni-box-wa" class="lomni-channel-box ${activarWaInicial ? 'active-wa' : ''}">
                                <div class="lomni-channel-head">
                                    <label style="display:flex; align-items:center; gap:7px; cursor:pointer; font-weight:900; font-size:13px; color:#14532d;">
                                        <input type="checkbox" id="lomni-chk-canal-wa" ${activarWaInicial ? 'checked' : ''}
                                            style="width:16px; height:16px; accent-color:#16a34a; cursor:pointer;"
                                            onchange="window.__LAMDA_OMNI_SYNC_CHANNELS__()" />
                                        📲 Canal WhatsApp (:3004)
                                    </label>
                                    <span style="font-size:10.5px; font-weight:800; color:#15803d; background:#dcfce7; padding:2px 7px; border-radius:999px;">Motor Propio</span>
                                </div>
                                <div id="lomni-list-wa" class="lomni-contact-list"></div>
                                <div class="lomni-inline-add">
                                    <input type="text" id="lomni-manual-wa" class="lomni-input"
                                        placeholder="➕ Otro WhatsApp (ej: 221 661 5746 para autoenvío)"
                                        onkeydown="if(event.key==='Enter'){event.preventDefault();window.__LAMDA_OMNI_ADD_MANUAL__('wa');}" />
                                    <button type="button" class="lomni-btn-mini" onclick="window.__LAMDA_OMNI_ADD_MANUAL__('wa')">+ Sumar</button>
                                </div>
                            </div>

                            <!-- Canal Email -->
                            <div id="lomni-box-em" class="lomni-channel-box ${activarEmInicial ? 'active-em' : ''}">
                                <div class="lomni-channel-head">
                                    <label style="display:flex; align-items:center; gap:7px; cursor:pointer; font-weight:900; font-size:13px; color:#4c1d95;">
                                        <input type="checkbox" id="lomni-chk-canal-em" ${activarEmInicial ? 'checked' : ''}
                                            style="width:16px; height:16px; accent-color:#7c3aed; cursor:pointer;"
                                            onchange="window.__LAMDA_OMNI_SYNC_CHANNELS__()" />
                                        ✉️ Canal Email (SMTP LAMDA)
                                    </label>
                                    <span style="font-size:10.5px; font-weight:800; color:#5b21b6; background:#ede9fe; padding:2px 7px; border-radius:999px;">Correo Oficial</span>
                                </div>
                                <div id="lomni-list-em" class="lomni-contact-list"></div>
                                <div class="lomni-inline-add">
                                    <input type="email" id="lomni-manual-em" class="lomni-input"
                                        placeholder="➕ Otro Email al vuelo (ej: tu correo)"
                                        onkeydown="if(event.key==='Enter'){event.preventDefault();window.__LAMDA_OMNI_ADD_MANUAL__('em');}" />
                                    <button type="button" class="lomni-btn-mini" onclick="window.__LAMDA_OMNI_ADD_MANUAL__('em')">+ Sumar</button>
                                </div>
                            </div>
                        </div>

                        <!-- 2. Plantilla Rápida y Adjunto de Código QR PNG -->
                        <div style="background:#ffffff; border:1px solid #cbd5e1; border-radius:12px; padding:12px; display:flex; flex-direction:column; gap:10px;">
                            <div>
                                <div style="font-size:11px; font-weight:800; color:#475569; text-transform:uppercase; margin-bottom:6px;">
                                    📋 Plantilla de Comunicación
                                </div>
                                <div id="lomni-tpl-bar" style="display:flex; gap:6px; flex-wrap:wrap;">
                                    ${Object.values(plantillas).map(tp => `
                                        <button type="button" class="lomni-pill-tpl ${tp.id === tplInicial ? 'active' : ''}"
                                            data-tpl="${esc(tp.id)}"
                                            onclick="window.__LAMDA_OMNI_SELECT_TPL__('${esc(tp.id)}')">
                                            ${esc(tp.titulo)}
                                        </button>
                                    `).join('')}
                                </div>
                            </div>

                            <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; padding-top:8px; border-top:1px dashed #cbd5e1;">
                                <div style="flex:1; min-width:240px;">
                                    <label style="display:inline-flex; align-items:center; gap:8px; cursor:pointer; font-weight:800; font-size:12.8px; color:#0f172a;">
                                        <input type="checkbox" id="lomni-chk-adjuntar-qr" ${adjuntarQrActivo ? 'checked' : ''}
                                            style="width:16px; height:16px; accent-color:#0284c7; cursor:pointer;"
                                            onchange="window.__LAMDA_OMNI_UPDATE_QR__()" />
                                        🖼️ Adjuntar imagen PNG del Código QR / Afiche del Nodo
                                    </label>
                                    <div id="lomni-qr-config-detail" style="margin-top:6px; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                        <span style="font-size:11.5px; color:#475569; font-weight:700;">Imagen a adjuntar:</span>
                                        <select id="lomni-sel-qr-tipo" class="lomni-input" style="width:auto; padding:4px 8px; font-size:12px; font-weight:700;"
                                            onchange="window.__LAMDA_OMNI_UPDATE_QR__()">
                                            <option value="tienda_afiche" ${qrTipoActivo === 'tienda_afiche' ? 'selected' : ''}>🛒 QR Tienda Pública / Afiche (utm_source=qr)</option>
                                            <option value="gestor" ${qrTipoActivo === 'gestor' ? 'selected' : ''}>🎛️ QR Panel Móvil del Gestor (privado)</option>
                                            <option value="tienda_limpio" ${qrTipoActivo === 'tienda_limpio' ? 'selected' : ''}>🏪 QR Tienda Pública (enlace limpio)</option>
                                            <option value="admin_prueba" ${qrTipoActivo === 'admin_prueba' ? 'selected' : ''}>🛠️ QR Identificar Celular Admin (?modo_admin=1)</option>
                                        </select>
                                    </div>
                                </div>
                                <img id="lomni-img-qr-preview" src="" alt="Preview QR"
                                    style="width:74px; height:74px; border-radius:8px; border:1px solid #cbd5e1; background:#ffffff; padding:3px; object-fit:contain; display:none;" />
                            </div>

                            ${data.video_bienvenida && data.video_bienvenida.disponible ? `
                                <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; padding-top:8px; border-top:1px dashed #cbd5e1;">
                                    <div style="flex:1; min-width:240px;">
                                        <label style="display:inline-flex; align-items:center; gap:8px; cursor:pointer; font-weight:800; font-size:12.8px; color:#0f172a;">
                                            <input type="checkbox" id="lomni-chk-adjuntar-video" ${opciones.adjuntarVideoInicial ? 'checked' : ''}
                                                style="width:16px; height:16px; accent-color:#16a34a; cursor:pointer;" />
                                            🎬 Adjuntar también el Video de Presentación MP4 por WhatsApp (opcional)
                                        </label>
                                        <div style="margin-top:4px; font-size:11.5px; color:#475569; font-weight:600;">
                                            ${Number(data.video_bienvenida.duration_sec || 0).toFixed(0)}s · ${(Number(data.video_bienvenida.bytes_whatsapp || 0) / (1024 * 1024)).toFixed(1)} MB · ${data.video_bienvenida.tiene_audio ? '🔊 Con música y sonido' : 'Sin audio'} ·
                                            <a href="${esc(data.video_bienvenida.url_whatsapp)}" target="_blank" rel="noopener" style="color:#0284c7; font-weight:800; text-decoration:underline;">Ver video ↗</a>
                                        </div>
                                    </div>
                                    ${data.video_bienvenida.poster_url ? `
                                        <img src="${esc(data.video_bienvenida.poster_url)}" alt="Póster video"
                                            style="width:48px; height:74px; border-radius:8px; border:1px solid #cbd5e1; object-fit:cover; background:#0f172a; flex-shrink:0;" />
                                    ` : ''}
                                </div>
                            ` : ''}
                        </div>

                        <!-- 3. Vista Previa Editable de Asunto y Cuerpo -->
                        <div style="background:#ffffff; border:1px solid #cbd5e1; border-radius:12px; padding:12px; display:flex; flex-direction:column; gap:9px;">
                            <div id="lomni-wrap-asunto" style="display:${activarEmInicial ? 'block' : 'none'};">
                                <label for="lomni-input-asunto" style="display:block; font-size:11.5px; font-weight:800; color:#4c1d95; margin-bottom:4px;">
                                    ✉️ Asunto del Correo Electrónico (editable)
                                </label>
                                <input type="text" id="lomni-input-asunto" class="lomni-input" value="${esc(tplObj.asunto || '')}" />
                            </div>
                            <div>
                                <label for="lomni-input-mensaje" style="display:block; font-size:11.5px; font-weight:800; color:#0f172a; margin-bottom:4px;">
                                    📝 Vista Previa Editable del Mensaje (WhatsApp / Email)
                                </label>
                                <textarea id="lomni-input-mensaje" class="lomni-input" rows="7"
                                    style="resize:vertical; line-height:1.45; font-size:12.5px;">${esc(tplObj.mensaje_texto || '')}</textarea>
                            </div>
                        </div>

                        <!-- 4. Confirmación Real por Canal -->
                        <div id="lomni-result-box" style="display:none;"></div>
                    </div>

                    <div class="lomni-footer">
                        <span style="font-size:11.5px; color:#64748b;">
                            🔒 Despacho directo desde servidor LAMDA sin exponer ni abrir WhatsApp Web / mailto en el navegador.
                        </span>
                        <div style="display:flex; gap:8px; align-items:center;">
                            <button type="button" class="lomni-btn-cancel" onclick="window.cerrarModalEnvioOmnicanalNodo()">Cerrar</button>
                            <button type="button" id="lomni-btn-submit" class="lomni-btn-send" onclick="window.__LAMDA_OMNI_SEND__()">
                                📤 Enviar por Canales Seleccionados
                            </button>
                        </div>
                    </div>
                </div>
            `;

            renderizarListasContactos();
            actualizarEstadoVisualCanales();
            actualizarMiniaturaQr();
        } catch (err) {
            overlay.innerHTML = `
                <div class="lomni-dialog" onclick="event.stopPropagation()" style="max-width:520px;">
                    <div class="lomni-header" style="background:#991b1b;">
                        <h3 style="margin:0; font-size:1.05rem; font-weight:800;">❌ No se pudo abrir el envío omnicanal</h3>
                        <button type="button" class="lomni-close" onclick="window.cerrarModalEnvioOmnicanalNodo()">&times;</button>
                    </div>
                    <div class="lomni-body" style="padding:20px; color:#7f1d1d; font-size:13px;">
                        ${esc(err.message)}
                    </div>
                    <div class="lomni-footer" style="justify-content:flex-end;">
                        <button type="button" class="lomni-btn-cancel" onclick="window.cerrarModalEnvioOmnicanalNodo()">Cerrar</button>
                    </div>
                </div>
            `;
        }
    }

    window.__LAMDA_OMNI_SYNC_CHANNELS__ = actualizarEstadoVisualCanales;
    window.__LAMDA_OMNI_UPDATE_QR__ = actualizarMiniaturaQr;
    window.__LAMDA_OMNI_SELECT_TPL__ = seleccionarPlantillaModal;
    window.__LAMDA_OMNI_ADD_MANUAL__ = agregarContactoManualAlVuelo;
    window.__LAMDA_OMNI_SEND__ = ejecutarDespachoOmnicanalNodo;
    window.abrirModalEnvioOmnicanalNodo = abrirModalEnvioOmnicanalNodo;
    window.cerrarModalEnvioOmnicanalNodo = cerrarModalEnvioOmnicanalNodo;
})();
