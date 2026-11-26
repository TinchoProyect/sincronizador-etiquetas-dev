'use strict';

const { DomicilioSolicitudesService, construirUrlPublicaDomicilio } = require('../services/domicilioSolicitudesService');
const { geocodificarDireccionArgentina, geocodificarInversoArgentina } = require('../services/geocoderArService');

const _rateBuckets = new Map();
function verificarRateLimit(req, limitePorMinuto = 60) {
    const ip = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || 'local').split(',')[0].trim();
    const token = String(req.params?.token || '').slice(0, 24);
    const key = `${ip}|${token}`;
    const ahora = Date.now();
    let b = _rateBuckets.get(key);
    if (!b || (ahora - b.ts) > 60000) {
        b = { ts: ahora, count: 0 };
        if (_rateBuckets.size > 1500) _rateBuckets.clear();
        _rateBuckets.set(key, b);
    }
    b.count += 1;
    return b.count <= limitePorMinuto;
}

exports.listarSolicitudes = async (req, res) => {
    try {
        const { id_cliente } = req.query;
        if (!id_cliente) {
            return res.status(400).json({ success: false, error: 'El parámetro id_cliente es requerido.' });
        }
        const data = await DomicilioSolicitudesService.listarSolicitudesPorCliente(id_cliente, req);
        return res.json({ success: true, ...data });
    } catch (error) {
        console.error('❌ [DOM-SOLICITUDES] Error listando solicitudes:', error.message);
        return res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
};

exports.crearSolicitud = async (req, res) => {
    try {
        const {
            id_cliente,
            cliente_id,
            modo,
            domicilio_objetivo_id,
            marcar_predeterminado,
            nota_operador,
            vigencia_dias,
            creado_por
        } = req.body || {};

        const targetCli = id_cliente || cliente_id;
        if (!targetCli) {
            return res.status(400).json({ success: false, error: 'El campo id_cliente es requerido.' });
        }

        const operador = creado_por || (req.lamdaUser && req.lamdaUser.usuario) || (req.user && req.user.nombre) || 'Operador LAMDA';
        const resultado = await DomicilioSolicitudesService.crearSolicitud({
            cliente_id: targetCli,
            modo,
            domicilio_objetivo_id,
            marcar_predeterminado,
            nota_operador,
            vigencia_dias,
            creado_por: operador,
            req
        });

        return res.status(201).json({ success: true, ...resultado });
    } catch (error) {
        console.error('❌ [DOM-SOLICITUDES] Error creando solicitud:', error.message);
        return res.status(error.statusCode || 500).json({
            success: false,
            code: error.code || undefined,
            error: error.message
        });
    }
};

exports.revocarSolicitud = async (req, res) => {
    try {
        const { id } = req.params;
        const operador = (req.lamdaUser && req.lamdaUser.usuario) || 'Operador LAMDA';
        const solicitud = await DomicilioSolicitudesService.revocarSolicitud(id, operador);
        return res.json({ success: true, solicitud });
    } catch (error) {
        console.error('❌ [DOM-SOLICITUDES] Error revocando solicitud:', error.message);
        return res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
};

exports.enviarSolicitudOmnicanal = async (req, res) => {
    try {
        const { id } = req.params;
        const solicitud = await DomicilioSolicitudesService.obtenerSolicitudPorId(id);
        if (!solicitud) {
            return res.status(404).json({ success: false, error: 'Solicitud de domicilio no encontrada.' });
        }

        const {
            canales = {},
            destinatarios_whatsapp = [],
            destinatarios_email = [],
            asunto_email,
            mensaje_whatsapp,
            mensaje_email,
            adjuntar_qr_wa = true,
            qr_data_url,
            guardar_wa_manual_numero = ''
        } = req.body || {};

        const usarWa = Boolean(canales.whatsapp);
        const usarEmail = Boolean(canales.email);
        if (!usarWa && !usarEmail) {
            return res.status(400).json({ success: false, error: 'Seleccioná al menos un canal de envío (WhatsApp o Email).' });
        }

        const waList = (Array.isArray(destinatarios_whatsapp) ? destinatarios_whatsapp : String(destinatarios_whatsapp || '').split(','))
            .map(v => String(v || '').trim())
            .filter(v => v.replace(/\D/g, '').length >= 8);

        const emailList = (Array.isArray(destinatarios_email) ? destinatarios_email : String(destinatarios_email || '').split(','))
            .map(v => String(v || '').trim())
            .filter(v => v.includes('@'));

        if (usarWa && waList.length === 0) {
            return res.status(400).json({ success: false, error: 'Seleccioná o ingresá al menos un número de WhatsApp válido.' });
        }
        if (usarEmail && emailList.length === 0) {
            return res.status(400).json({ success: false, error: 'Seleccioná o ingresá al menos una dirección de Email válida.' });
        }

        const urlPublica = construirUrlPublicaDomicilio(solicitud.token_publico, req);
        const resultados = { whatsapp: null, email: null };

        if (usarWa) {
            const factBaseUrl = (process.env.FACTURACION_API_URL || `http://127.0.0.1:${process.env.FACTURACION_PORT || 3004}`).replace(/\/+$/, '');
            const cleanQrBase64 = String(qr_data_url || '').replace(/^data:image\/png;base64,/i, '').trim();
            const textoWa = String(mensaje_whatsapp || '').trim() ||
                `📍 Hola *${solicitud.cliente_nombre_snapshot}*!\nCompletá tu domicilio y ubicación de entrega en LAMDA desde este enlace (válido 7 días):\n${urlPublica}`;

            try {
                const endpoint = (adjuntar_qr_wa && cleanQrBase64)
                    ? `${factBaseUrl}/facturacion/whatsapp/enviar-imagen`
                    : `${factBaseUrl}/facturacion/whatsapp/enviar-mensaje`;
                const payload = (adjuntar_qr_wa && cleanQrBase64)
                    ? {
                        destinatarios: waList.join(', '),
                        base64Data: cleanQrBase64,
                        mimeType: 'image/png',
                        filename: `QR_Domicilio_${solicitud.codigo_bunker_cliente}.png`,
                        mensajeTexto: textoWa
                    }
                    : {
                        destinatarios: waList.join(', '),
                        mensajeTexto: textoWa
                    };

                const waRes = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const waData = await waRes.json().catch(() => ({}));
                if (!waRes.ok || !waData.success) {
                    throw new Error(waData.message || waData.error || `HTTP ${waRes.status}`);
                }
                const arrResp = Array.isArray(waData.data?.resultados)
                    ? waData.data.resultados
                    : (Array.isArray(waData.data) ? waData.data : []);
                const simulated = arrResp.some(x => x && x.simulated);
                resultados.whatsapp = {
                    success: true,
                    simulated,
                    destinatarios: waList,
                    data: waData.data || waData
                };
            } catch (waErr) {
                resultados.whatsapp = {
                    success: false,
                    destinatarios: waList,
                    error: waErr.message
                };
            }
        }

        if (usarEmail) {
            try {
                const emailService = require('../../facturacion/services/emailService');
                const clienteNom = solicitud.cliente_nombre_snapshot || 'Cliente';
                const subject = String(asunto_email || '').trim() || `📍 Confirmá tu Domicilio de Entrega en LAMDA (${clienteNom})`;
                const cuerpoTexto = String(mensaje_email || '').trim();
                const cuerpoHtml = cuerpoTexto
                    ? cuerpoTexto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
                    : `Hola <strong>${clienteNom}</strong>,<br><br>Ingresá al siguiente enlace para cargar o confirmar tu dirección y ubicación exacta de entrega en el mapa:`;

                const cleanQrBase64 = String(qr_data_url || '').replace(/^data:image\/png;base64,/i, '').trim();
                const attachments = cleanQrBase64
                    ? [{
                        filename: `QR_Domicilio_${solicitud.codigo_bunker_cliente}.png`,
                        content: Buffer.from(cleanQrBase64, 'base64'),
                        cid: 'qr_domicilio_lamda'
                    }]
                    : [];

                const htmlBody = `
                    <!DOCTYPE html>
                    <html lang="es">
                    <head><meta charset="UTF-8"></head>
                    <body style="font-family:'Segoe UI',sans-serif; background:#f1f5f9; color:#0f172a; padding:20px;">
                        <div style="max-width:580px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; border-top:6px solid #7c3aed; box-shadow:0 4px 12px rgba(0,0,0,0.06);">
                            <div style="padding:20px 24px; background:#f5f3ff; border-bottom:1px solid #ede9fe;">
                                <h2 style="margin:0; color:#5b21b6; font-size:19px;">📍 Domicilio de Entrega — LAMDA</h2>
                                <div style="font-size:12px; color:#64748b; margin-top:4px;">${clienteNom} • ${solicitud.codigo_bunker_cliente}</div>
                            </div>
                            <div style="padding:22px 24px; font-size:14px; line-height:1.55; color:#334155;">
                                <p style="margin-top:0;">${cuerpoHtml}</p>
                                ${cleanQrBase64 ? `
                                <div style="text-align:center; margin:16px 0;">
                                    <img src="cid:qr_domicilio_lamda" alt="QR Domicilio" style="width:170px; height:170px; border:1px solid #e2e8f0; border-radius:8px; padding:6px; background:#ffffff;" />
                                </div>` : ''}
                                <div style="text-align:center; margin:18px 0;">
                                    <a href="${urlPublica}" target="_blank" style="display:inline-block; background:#7c3aed; color:#ffffff; text-decoration:none; padding:12px 22px; border-radius:8px; font-weight:700;">
                                        👉 Cargar Mi Ubicación de Entrega
                                    </a>
                                </div>
                                <p style="font-size:12px; color:#64748b; word-break:break-all;">Enlace directo (sin usuario ni contraseña, válido 7 días): ${urlPublica}</p>
                            </div>
                        </div>
                    </body>
                    </html>
                `;

                const emailRes = await emailService.enviarEmail({
                    to: emailList.join(', '),
                    subject,
                    htmlBody,
                    attachments
                });

                resultados.email = {
                    success: true,
                    destinatarios: emailList,
                    simulated: Boolean(emailRes.simulated),
                    messageId: emailRes.messageId || null
                };
            } catch (emailErr) {
                resultados.email = {
                    success: false,
                    destinatarios: emailList,
                    error: emailErr.message
                };
            }
        }

        let waGuardadoEnFicha = false;
        if (guardar_wa_manual_numero && String(guardar_wa_manual_numero).replace(/\D/g, '').length >= 8) {
            try {
                waGuardadoEnFicha = await DomicilioSolicitudesService.guardarWhatsappManualEnFicha(
                    solicitud.bunker_cliente_id,
                    guardar_wa_manual_numero
                );
            } catch (_) {}
        }

        const waOk = !usarWa || Boolean(resultados.whatsapp?.success);
        const emailOk = !usarEmail || Boolean(resultados.email?.success);
        const alMenosUnoOk = Boolean((usarWa && resultados.whatsapp?.success) || (usarEmail && resultados.email?.success));

        if (alMenosUnoOk) {
            await DomicilioSolicitudesService.registrarUltimoEnvio(solicitud.id, resultados).catch(() => {});
        }

        return res.status(alMenosUnoOk ? 200 : 500).json({
            success: alMenosUnoOk,
            parcial: alMenosUnoOk && (!waOk || !emailOk),
            wa_guardado_en_ficha: waGuardadoEnFicha,
            resultados
        });
    } catch (error) {
        console.error('❌ [DOM-SOLICITUDES] Error en enviarSolicitudOmnicanal:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
};

exports.obtenerSolicitudPublica = async (req, res) => {
    try {
        if (!verificarRateLimit(req, 60)) {
            return res.status(429).json({ ok: false, error: 'Demasiadas consultas seguidas. Esperá un momento.' });
        }
        const { token } = req.params;
        const data = await DomicilioSolicitudesService.obtenerSolicitudPublicaPorToken(token);
        return res.status(data.ok ? 200 : (data.status || 404)).json(data);
    } catch (error) {
        console.error('❌ [DOM-PUBLICO] Error obteniendo solicitud:', error.message);
        return res.status(500).json({ ok: false, error: 'No se pudo cargar la solicitud.' });
    }
};

exports.geocodificarPublico = async (req, res) => {
    try {
        if (!verificarRateLimit(req, 45)) {
            return res.status(429).json({ ok: false, error: 'Demasiadas búsquedas seguidas. Esperá unos segundos.' });
        }
        const { token } = req.params;
        const check = await DomicilioSolicitudesService.obtenerSolicitudPublicaPorToken(token);
        if (!check.ok || check.solicitud?.estado !== 'PENDIENTE') {
            return res.status(403).json({ ok: false, error: 'Enlace no habilitado para geocodificación.' });
        }
        const q = String(req.query.q || '').trim();
        const data = await geocodificarDireccionArgentina(q);
        return res.json({ ok: true, ...data });
    } catch (error) {
        console.error('❌ [DOM-PUBLICO] Error geocodificando:', error.message);
        return res.status(500).json({ ok: false, error: 'No se pudo buscar la dirección.' });
    }
};

exports.geocodificarInversoPublico = async (req, res) => {
    try {
        if (!verificarRateLimit(req, 60)) {
            return res.status(429).json({ ok: false, error: 'Demasiadas consultas seguidas.' });
        }
        const { token } = req.params;
        const check = await DomicilioSolicitudesService.obtenerSolicitudPublicaPorToken(token);
        if (!check.ok || check.solicitud?.estado !== 'PENDIENTE') {
            return res.status(403).json({ ok: false, error: 'Enlace no habilitado para geocodificación.' });
        }
        const data = await geocodificarInversoArgentina(req.query.lat, req.query.lng);
        return res.json({ ok: true, ...data });
    } catch (error) {
        console.error('❌ [DOM-PUBLICO] Error geocodificación inversa:', error.message);
        return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Error en geocodificación inversa.' });
    }
};

exports.confirmarSolicitudPublica = async (req, res) => {
    try {
        if (!verificarRateLimit(req, 20)) {
            return res.status(429).json({ ok: false, error: 'Demasiados intentos. Esperá un momento.' });
        }
        const { token } = req.params;
        const resultado = await DomicilioSolicitudesService.confirmarSolicitudPublica(token, req.body || {}, {
            ip: req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip,
            userAgent: req.headers['user-agent']
        });
        return res.status(resultado.ok ? 200 : (resultado.status || 400)).json(resultado);
    } catch (error) {
        console.error('❌ [DOM-PUBLICO] Error confirmando solicitud:', error.message);
        return res.status(500).json({ ok: false, error: 'No se pudo guardar el domicilio. Intentá nuevamente.' });
    }
};
