/**
 * Modal Omnicanal Reutilizable para Solicitud de Domicilio de Entrega (PC y LAMDA Móvil)
 * Cumple estrictamente la política cero wa.me / mailto: en pantallas administrativas:
 * todo despacho se realiza vía backend interno (Motor WhatsApp :3004 + Email SMTP).
 */
(function (global) {
    'use strict';

    function escapeHtml(val) {
        return String(val ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getThemeColors(theme) {
        if (theme === 'dark') {
            return {
                bg: '#1e293b',
                color: '#f8fafc',
                cardBg: '#0f172a',
                border: '#334155',
                muted: '#94a3b8',
                inputBg: '#1e293b',
                inputText: '#f8fafc',
                btnCopyBg: '#334155',
                btnCopyColor: '#f8fafc'
            };
        }
        return {
            bg: '#ffffff',
            color: '#0f172a',
            cardBg: '#f8fafc',
            border: '#cbd5e1',
            muted: '#64748b',
            inputBg: '#ffffff',
            inputText: '#0f172a',
            btnCopyBg: '#e2e8f0',
            btnCopyColor: '#1e293b'
        };
    }

    async function mostrarModalOmnicanal({ solicitud, cliente, urlPublica, qrDataUrl, theme = 'light', onDone = null }) {
        const pal = getThemeColors(theme);
        const nombreCli = cliente?.cliente_nombre || solicitud?.cliente_nombre_snapshot || 'Cliente';
        const contactosWa = Array.isArray(cliente?.contactos_whatsapp) ? cliente.contactos_whatsapp : [];
        const contactosEmail = Array.isArray(cliente?.contactos_email) ? cliente.contactos_email : [];
        const esActualizar = solicitud?.modo === 'ACTUALIZAR_EXISTENTE';

        const waCheckboxesHtml = contactosWa.length > 0
            ? contactosWa.map((w, idx) => `
                <label style="display:flex; align-items:center; gap:0.45rem; padding:0.4rem 0.55rem; background:${pal.inputBg}; border:1px solid ${pal.border}; border-radius:0.5rem; margin-bottom:0.3rem; cursor:pointer; font-size:0.8rem;">
                    <input type="checkbox" class="dom-sol-chk-wa" value="${escapeHtml(w.numero)}" ${idx === 0 ? 'checked' : ''} style="width:1rem; height:1rem; accent-color:#10b981;">
                    <span style="color:${pal.color}; font-weight:700;">${escapeHtml(w.numero)}</span>
                    ${(w.nombre || w.cargo) ? `<span style="color:${pal.muted}; font-size:0.74rem;">(${escapeHtml([w.nombre, w.cargo].filter(Boolean).join(' · '))})</span>` : ''}
                </label>
            `).join('')
            : `<div style="font-size:0.75rem; color:${pal.muted}; margin-bottom:0.35rem;">Sin WhatsApp cargado en ficha. Ingresá uno abajo y podés guardarlo automáticamente.</div>`;

        const emailCheckboxesHtml = contactosEmail.length > 0
            ? contactosEmail.map((em, idx) => `
                <label style="display:flex; align-items:center; gap:0.45rem; padding:0.4rem 0.55rem; background:${pal.inputBg}; border:1px solid ${pal.border}; border-radius:0.5rem; margin-bottom:0.3rem; cursor:pointer; font-size:0.8rem;">
                    <input type="checkbox" class="dom-sol-chk-email" value="${escapeHtml(em.email)}" ${idx === 0 ? 'checked' : ''} style="width:1rem; height:1rem; accent-color:#3b82f6;">
                    <span style="color:${pal.color}; font-weight:700; word-break:break-all;">${escapeHtml(em.email)}</span>
                    ${(em.nombre || em.cargo) ? `<span style="color:${pal.muted}; font-size:0.74rem;">(${escapeHtml([em.nombre, em.cargo].filter(Boolean).join(' · '))})</span>` : ''}
                </label>
            `).join('')
            : `<div style="font-size:0.75rem; color:${pal.muted}; margin-bottom:0.35rem;">Sin correos cargados en ficha. Podés ingresar uno manual abajo.</div>`;

        const mensajeDefault =
            `📍 *CARGA DE DOMICILIO DE ENTREGA - LAMDA*\n` +
            `Hola *${nombreCli}*! Para coordinar tu entrega sin demoras, te compartimos este enlace directo para que cargues tu dirección y marques tu ubicación en el mapa (sin usuario ni contraseña):\n\n` +
            `👉 ${urlPublica}\n\n` +
            `⏳ _Enlace válido por 7 días (uso único)._`;

        const asuntoDefault = `📍 Confirmá tu Domicilio de Entrega en LAMDA - ${nombreCli}`;
        const defaultCheckWa = contactosWa.length > 0;
        const defaultCheckEmail = !defaultCheckWa && contactosEmail.length > 0;
        const expiresFmt = solicitud?.expires_at ? new Date(solicitud.expires_at).toLocaleDateString('es-AR') : '7 días';

        await Swal.fire({
            title: `<div style="color:${theme === 'dark' ? '#c084fc' : '#5b21b6'}; font-size:1.1rem; font-weight:800;">📍 Pedir Domicilio de Entrega</div>`,
            background: pal.bg,
            color: pal.color,
            width: '540px',
            html: `
                <div style="text-align:center; font-size:0.84rem; color:${pal.color};">
                    <div style="margin-bottom:0.6rem;">
                        <strong>${escapeHtml(nombreCli)}</strong>
                        <span style="display:inline-block; margin-left:6px; background:${esActualizar ? 'rgba(245,158,11,0.16)' : 'rgba(124,58,237,0.14)'}; color:${esActualizar ? '#d97706' : '#7c3aed'}; padding:2px 9px; border-radius:999px; font-weight:800; font-size:0.74rem;">
                            ${esActualizar ? 'Actualizar ubicación existente' : 'Nuevo punto de entrega'} · Vence ${escapeHtml(expiresFmt)}
                        </span>
                    </div>

                    ${qrDataUrl ? `
                    <div style="display:inline-block; background:#ffffff; padding:0.55rem; border-radius:0.8rem; border:1px solid #cbd5e1; margin-bottom:0.5rem;">
                        <img src="${qrDataUrl}" alt="QR Domicilio" style="width:155px; height:155px; display:block;" />
                    </div>` : ''}

                    <div style="display:flex; gap:0.45rem; margin-bottom:0.8rem;">
                        <button type="button" id="btn-dom-sol-copy" style="flex:1; background:${pal.btnCopyBg}; color:${pal.btnCopyColor}; padding:0.55rem 0.7rem; border-radius:0.6rem; font-weight:700; border:none; cursor:pointer; font-size:0.8rem;">
                            📋 Copiar Enlace
                        </button>
                        <a href="${escapeHtml(urlPublica)}" target="_blank" style="flex:1; background:${pal.cardBg}; border:1px solid ${pal.border}; color:${pal.color}; padding:0.55rem 0.7rem; border-radius:0.6rem; font-weight:700; text-decoration:none; font-size:0.8rem; display:flex; align-items:center; justify-content:center;">
                            🌐 Probar Link
                        </a>
                    </div>

                    <div style="text-align:left; background:${pal.cardBg}; border:1px solid ${pal.border}; border-radius:0.75rem; padding:0.75rem;">
                        <div style="font-size:0.8rem; font-weight:800; margin-bottom:0.5rem;">
                            📤 Despacho Omnicanal Interno (Motor LAMDA)
                        </div>

                        <div style="display:flex; gap:0.75rem; flex-wrap:wrap; margin-bottom:0.6rem;">
                            <label style="display:flex; align-items:center; gap:0.35rem; font-size:0.8rem; font-weight:700; color:#10b981; cursor:pointer;">
                                <input type="checkbox" id="dom-sol-canal-wa" ${defaultCheckWa ? 'checked' : ''} style="width:1rem; height:1rem; accent-color:#10b981;">
                                WhatsApp (:3004)
                            </label>
                            <label style="display:flex; align-items:center; gap:0.35rem; font-size:0.8rem; font-weight:700; color:#3b82f6; cursor:pointer;">
                                <input type="checkbox" id="dom-sol-canal-email" ${defaultCheckEmail ? 'checked' : ''} style="width:1rem; height:1rem; accent-color:#3b82f6;">
                                Email SMTP
                            </label>
                            <label style="display:flex; align-items:center; gap:0.35rem; font-size:0.75rem; color:${pal.muted}; cursor:pointer;">
                                <input type="checkbox" id="dom-sol-qr-wa" style="width:0.95rem; height:0.95rem; accent-color:#7c3aed;">
                                Adjuntar QR PNG
                            </label>
                        </div>

                        <div id="dom-sol-box-wa" style="margin-bottom:0.55rem; display:${defaultCheckWa ? 'block' : 'none'};">
                            <div style="font-size:0.74rem; font-weight:700; color:${pal.muted}; margin-bottom:0.25rem;">Destinatarios WhatsApp:</div>
                            ${waCheckboxesHtml}
                            <input type="tel" id="dom-sol-wa-manual" placeholder="+ Otro WhatsApp manual (ej: 2215551234)" style="width:100%; margin-top:0.25rem; box-sizing:border-box; padding:0.48rem 0.6rem; border:1px solid ${pal.border}; border-radius:0.5rem; background:${pal.inputBg}; color:${pal.inputText}; font-size:0.8rem;">
                            <label style="display:flex; align-items:center; gap:0.35rem; font-size:0.74rem; color:${pal.muted}; margin-top:0.3rem; cursor:pointer;">
                                <input type="checkbox" id="dom-sol-guardar-wa" checked style="accent-color:#10b981;">
                                💾 Guardar número manual en la ficha del cliente
                            </label>
                        </div>

                        <div id="dom-sol-box-email" style="margin-bottom:0.55rem; display:${defaultCheckEmail ? 'block' : 'none'};">
                            <div style="font-size:0.74rem; font-weight:700; color:${pal.muted}; margin-bottom:0.25rem;">Destinatarios Email:</div>
                            ${emailCheckboxesHtml}
                            <input type="email" id="dom-sol-email-manual" placeholder="+ Otro Email manual (ej: cliente@gmail.com)" style="width:100%; margin-top:0.25rem; margin-bottom:0.35rem; box-sizing:border-box; padding:0.48rem 0.6rem; border:1px solid ${pal.border}; border-radius:0.5rem; background:${pal.inputBg}; color:${pal.inputText}; font-size:0.8rem;">
                            <input type="text" id="dom-sol-asunto" value="${escapeHtml(asuntoDefault)}" placeholder="Asunto del correo" style="width:100%; box-sizing:border-box; padding:0.48rem 0.6rem; border:1px solid ${pal.border}; border-radius:0.5rem; background:${pal.inputBg}; color:${pal.inputText}; font-size:0.8rem;">
                        </div>

                        <label style="display:block; font-size:0.74rem; font-weight:700; color:${pal.muted}; margin-bottom:0.25rem;">Vista previa editable del mensaje:</label>
                        <textarea id="dom-sol-msg" rows="5" style="width:100%; box-sizing:border-box; background:${pal.inputBg}; color:${pal.inputText}; border:1px solid ${pal.border}; border-radius:0.55rem; padding:0.5rem; font-size:0.78rem; line-height:1.38; font-family:inherit;">${escapeHtml(mensajeDefault)}</textarea>

                        <div id="dom-sol-feedback" style="display:none; margin-top:0.55rem; padding:0.5rem 0.65rem; border-radius:0.5rem; font-size:0.78rem; font-weight:700;"></div>

                        <div style="display:flex; gap:0.45rem; margin-top:0.65rem;">
                            <button type="button" id="btn-dom-sol-enviar" style="flex:1; background:#059669; color:#ffffff; border:none; border-radius:0.6rem; padding:0.68rem 1rem; font-weight:800; font-size:0.86rem; cursor:pointer;">
                                🚀 Enviar Solicitud Ahora
                            </button>
                            <button type="button" id="btn-dom-sol-revocar" style="background:#fef2f2; color:#dc2626; border:1px solid #fecaca; border-radius:0.6rem; padding:0.68rem 0.75rem; font-weight:700; font-size:0.78rem; cursor:pointer;" title="Revocar este enlace">
                                🚫 Revocar
                            </button>
                        </div>
                    </div>
                </div>
            `,
            showConfirmButton: true,
            confirmButtonText: 'Cerrar',
            confirmButtonColor: '#475569',
            didOpen: () => {
                const btnCopy = document.getElementById('btn-dom-sol-copy');
                if (btnCopy) {
                    btnCopy.onclick = () => {
                        navigator.clipboard?.writeText(urlPublica);
                        btnCopy.innerText = '✅ ¡Enlace Copiado!';
                        btnCopy.style.background = '#059669';
                        btnCopy.style.color = '#ffffff';
                        setTimeout(() => {
                            btnCopy.innerText = '📋 Copiar Enlace';
                            btnCopy.style.background = pal.btnCopyBg;
                            btnCopy.style.color = pal.btnCopyColor;
                        }, 2400);
                    };
                }

                const chkWa = document.getElementById('dom-sol-canal-wa');
                const chkEmail = document.getElementById('dom-sol-canal-email');
                const boxWa = document.getElementById('dom-sol-box-wa');
                const boxEmail = document.getElementById('dom-sol-box-email');
                const syncVisibilidad = () => {
                    if (boxWa) boxWa.style.display = chkWa?.checked ? 'block' : 'none';
                    if (boxEmail) boxEmail.style.display = chkEmail?.checked ? 'block' : 'none';
                };
                if (chkWa) chkWa.addEventListener('change', syncVisibilidad);
                if (chkEmail) chkEmail.addEventListener('change', syncVisibilidad);

                const feedbackEl = document.getElementById('dom-sol-feedback');
                const showFb = (ok, text) => {
                    if (!feedbackEl) return;
                    feedbackEl.style.display = 'block';
                    feedbackEl.style.background = ok ? 'rgba(16,185,129,0.16)' : 'rgba(239,68,68,0.16)';
                    feedbackEl.style.color = ok ? (theme === 'dark' ? '#6ee7b7' : '#047857') : (theme === 'dark' ? '#fca5a5' : '#b91c1c');
                    feedbackEl.innerText = text;
                };

                const btnEnviar = document.getElementById('btn-dom-sol-enviar');
                if (btnEnviar) {
                    btnEnviar.onclick = async () => {
                        const usarWa = Boolean(chkWa?.checked);
                        const usarEmail = Boolean(chkEmail?.checked);
                        const waSel = Array.from(document.querySelectorAll('.dom-sol-chk-wa:checked')).map(el => el.value.trim()).filter(Boolean);
                        const waManual = (document.getElementById('dom-sol-wa-manual')?.value || '').trim();
                        if (waManual) waSel.push(waManual);

                        const emailSel = Array.from(document.querySelectorAll('.dom-sol-chk-email:checked')).map(el => el.value.trim()).filter(Boolean);
                        const emailManual = (document.getElementById('dom-sol-email-manual')?.value || '').trim();
                        if (emailManual) emailSel.push(emailManual);

                        const msg = (document.getElementById('dom-sol-msg')?.value || '').trim();
                        const asunto = (document.getElementById('dom-sol-asunto')?.value || '').trim();
                        const adjQr = Boolean(document.getElementById('dom-sol-qr-wa')?.checked);
                        const guardarManual = Boolean(document.getElementById('dom-sol-guardar-wa')?.checked);

                        if (!usarWa && !usarEmail) return showFb(false, '⚠️ Activá al menos un canal (WhatsApp o Email).');
                        if (usarWa && waSel.length === 0) return showFb(false, '⚠️ Seleccioná o ingresá un WhatsApp.');
                        if (usarEmail && emailSel.length === 0) return showFb(false, '⚠️ Seleccioná o ingresá un Email.');

                        btnEnviar.disabled = true;
                        const origTxt = btnEnviar.innerText;
                        btnEnviar.innerText = '⏳ Enviando...';
                        if (feedbackEl) feedbackEl.style.display = 'none';

                        try {
                            const envRes = await fetch(`/api/logistica/domicilios/solicitudes/${solicitud.id}/enviar-omnicanal`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    canales: { whatsapp: usarWa, email: usarEmail },
                                    destinatarios_whatsapp: waSel,
                                    destinatarios_email: emailSel,
                                    asunto_email: asunto,
                                    mensaje_whatsapp: msg,
                                    mensaje_email: msg,
                                    adjuntar_qr_wa: adjQr,
                                    qr_data_url: qrDataUrl,
                                    guardar_wa_manual_numero: (usarWa && guardarManual && waManual) ? waManual : ''
                                })
                            });
                            const envData = await envRes.json().catch(() => ({}));
                            const partes = [];
                            if (envData.resultados?.whatsapp) {
                                const simTag = envData.resultados.whatsapp.simulated ? ' [Simulado Lab]' : '';
                                partes.push(envData.resultados.whatsapp.success
                                    ? `✅ WhatsApp enviado${simTag} (${waSel.join(', ')})`
                                    : `❌ WhatsApp: ${envData.resultados.whatsapp.error}`);
                            }
                            if (envData.resultados?.email) {
                                const simTag = envData.resultados.email.simulated ? ' [Simulado Lab]' : '';
                                partes.push(envData.resultados.email.success
                                    ? `✅ Email enviado${simTag} (${emailSel.join(', ')})`
                                    : `❌ Email: ${envData.resultados.email.error}`);
                            }
                            if (!envRes.ok || !envData.success) {
                                throw new Error(partes.join(' | ') || envData.error || 'Error enviando solicitud');
                            }
                            showFb(true, partes.join(' | '));
                            btnEnviar.innerText = '✅ ¡Enviado!';
                            if (typeof onDone === 'function') onDone({ action: 'sent', envData });
                        } catch (errEnv) {
                            showFb(false, errEnv.message);
                            btnEnviar.innerText = origTxt;
                        } finally {
                            btnEnviar.disabled = false;
                        }
                    };
                }

                const btnRevocar = document.getElementById('btn-dom-sol-revocar');
                if (btnRevocar) {
                    btnRevocar.onclick = async () => {
                        btnRevocar.disabled = true;
                        try {
                            const resRev = await fetch(`/api/logistica/domicilios/solicitudes/${solicitud.id}/revocar`, { method: 'POST' });
                            const datRev = await resRev.json();
                            if (!resRev.ok || !datRev.success) throw new Error(datRev.error || 'No se pudo revocar');
                            Swal.close();
                            if (typeof onDone === 'function') onDone({ action: 'revoked', solicitud: datRev.solicitud });
                        } catch (eRev) {
                            showFb(false, eRev.message);
                            btnRevocar.disabled = false;
                        }
                    };
                }
            }
        });

        if (typeof onDone === 'function') {
            onDone({ action: 'closed', solicitud });
        }
    }

    const SolicitudDomicilioModal = {
        async abrir({
            clienteId,
            clienteNombre = '',
            modo = 'ALTA_NUEVA',
            domicilioObjetivoId = null,
            domicilioObjetivoAlias = '',
            notaOperador = '',
            marcarPredeterminado = false,
            theme = 'light',
            onDone = null
        }) {
            if (!clienteId) return;
            const pal = getThemeColors(theme);

            try {
                Swal.fire({
                    title: 'Generando enlace seguro...',
                    background: pal.bg,
                    color: pal.color,
                    allowOutsideClick: false,
                    didOpen: () => Swal.showLoading()
                });

                const res = await fetch('/api/logistica/domicilios/solicitudes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id_cliente: clienteId,
                        modo,
                        domicilio_objetivo_id: domicilioObjetivoId,
                        marcar_predeterminado: marcarPredeterminado,
                        nota_operador: notaOperador || (domicilioObjetivoAlias ? `Actualizar ubicación de: ${domicilioObjetivoAlias}` : null)
                    })
                });
                const data = await res.json().catch(() => ({}));

                if (!res.ok || !data.success) {
                    if (res.status === 409 && data.code === 'MAX_PENDIENTES_ALCANZADO') {
                        const listRes = await fetch(`/api/logistica/domicilios/solicitudes?id_cliente=${encodeURIComponent(clienteId)}`);
                        const listData = await listRes.json().catch(() => ({}));
                        const pend = (listData.solicitudes || []).filter(s => s.estado === 'PENDIENTE');
                        if (pend.length > 0) {
                            await mostrarModalOmnicanal({
                                solicitud: pend[0],
                                cliente: listData.cliente || { cliente_nombre: clienteNombre },
                                urlPublica: pend[0].url_publica,
                                qrDataUrl: pend[0].qr_data_url,
                                theme,
                                onDone
                            });
                            return;
                        }
                    }
                    throw new Error(data.error || 'No se pudo generar el enlace de domicilio.');
                }

                await mostrarModalOmnicanal({
                    solicitud: data.solicitud,
                    cliente: data.cliente,
                    urlPublica: data.url_publica,
                    qrDataUrl: data.qr_data_url,
                    theme,
                    onDone
                });
            } catch (err) {
                console.error('❌ [SOLICITUD-DOMICILIO-MODAL]', err);
                Swal.fire({
                    icon: 'error',
                    title: 'No se pudo generar el enlace',
                    text: err.message,
                    background: pal.bg,
                    color: pal.color
                });
            }
        },

        async abrirParaSolicitudExistente({ solicitud, cliente, theme = 'light', onDone = null }) {
            if (!solicitud || !solicitud.url_publica) return;
            await mostrarModalOmnicanal({
                solicitud,
                cliente,
                urlPublica: solicitud.url_publica,
                qrDataUrl: solicitud.qr_data_url || '',
                theme,
                onDone
            });
        },

        async revocar(solicitudId, onDone = null) {
            const res = await fetch(`/api/logistica/domicilios/solicitudes/${solicitudId}/revocar`, { method: 'POST' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'No se pudo revocar el enlace.');
            }
            if (typeof onDone === 'function') onDone(data.solicitud);
            return data.solicitud;
        }
    };

    global.SolicitudDomicilioModal = SolicitudDomicilioModal;
})(window);
