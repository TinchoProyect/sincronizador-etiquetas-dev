/**
 * Controlador de Pagos en Efectivo Ensobrados (Módulo Logística)
 */

const PagosEfectivoService = require('../services/pagosEfectivoService');

exports.listarSobres = async (req, res) => {
    try {
        const { estado, cliente_id, modalidad, sync } = req.query;
        const forzar_sync = sync === '1' || sync === 'true';
        const sobres = await PagosEfectivoService.listarSobres({ estado, cliente_id, modalidad, forzar_sync });
        res.json({
            success: true,
            total: sobres.length,
            sobres
        });
    } catch (error) {
        console.error('❌ [PAGOS-EFECTIVO-CTRL] Error al listar sobres:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

exports.sincronizarSobres = async (req, res) => {
    try {
        const syncRes = await PagosEfectivoService.sincronizarConSupabase({ force: true, timeoutMs: 12000 });
        const sobres = await PagosEfectivoService.listarSobres({ omitir_sync: true });
        res.json({
            success: true,
            sync: syncRes,
            total: sobres.length,
            sobres
        });
    } catch (error) {
        console.error('❌ [PAGOS-EFECTIVO-CTRL] Error al sincronizar sobres:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

exports.obtenerSobre = async (req, res) => {
    try {
        const { id } = req.params;
        const sobre = await PagosEfectivoService.obtenerSobre(id);
        res.json({
            success: true,
            sobre
        });
    } catch (error) {
        console.error('❌ [PAGOS-EFECTIVO-CTRL] Error al obtener sobre:', error.message);
        res.status(404).json({
            success: false,
            error: error.message
        });
    }
};

exports.aprobarYAcreditar = async (req, res) => {
    try {
        const { id } = req.params;
        const { monto_auditado, operador, observaciones_admin, desglose_auditado, diferencias_arqueo, modo_facturacion_interes } = req.body;

        const resultado = await PagosEfectivoService.aprobarYAcreditar({
            sobreId: id,
            montoAuditado: monto_auditado,
            operador: operador || (req.user ? req.user.nombre : 'Administración'),
            observacionesAdmin: observaciones_admin,
            desgloseAuditado: desglose_auditado,
            diferenciasArqueo: diferencias_arqueo,
            modoFacturacionInteres: modo_facturacion_interes
        });

        res.json({
            success: true,
            mensaje: 'Sobre auditado y acreditado exitosamente en la cuenta corriente.',
            ...resultado
        });
    } catch (error) {
        console.error('❌ [PAGOS-EFECTIVO-CTRL] Error al acreditar sobre:', error.message);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
};

exports.actualizarEstado = async (req, res) => {
    try {
        const { id } = req.params;
        const { estado, chofer_nombre, observaciones, operador, modalidad_entrega } = req.body;

        if (!estado) {
            return res.status(400).json({
                success: false,
                error: 'El campo estado es obligatorio.'
            });
        }

        const sobre = await PagosEfectivoService.actualizarEstado({
            sobreId: id,
            nuevoEstado: estado,
            choferNombre: chofer_nombre,
            observaciones,
            operador: operador || (req.user ? req.user.nombre : undefined),
            modalidadEntrega: modalidad_entrega
        });

        res.json({
            success: true,
            mensaje: `Estado del sobre actualizado a ${estado}.`,
            sobre
        });
    } catch (error) {
        console.error('❌ [PAGOS-EFECTIVO-CTRL] Error al actualizar estado de sobre:', error.message);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Enviar invitación / derivación de ensobrado por correo electrónico
 * POST /api/logistica/pagos-efectivo/enviar-email-derivacion
 */
exports.enviarEmailDerivacion = async (req, res) => {
    try {
        const { email, nombreColaborador, monto, codigoSobre, urlEnsobrado, titular, nota } = req.body;

        if (!email || !email.includes('@')) {
            return res.status(400).json({
                success: false,
                error: 'Dirección de correo electrónico inválida.'
            });
        }

        if (!urlEnsobrado || !codigoSobre) {
            return res.status(400).json({
                success: false,
                error: 'Faltan parámetros obligatorios (urlEnsobrado, codigoSobre).'
            });
        }

        // Sanitizar URL pública de Cloudflare
        let finalUrlEnsobrado = urlEnsobrado;
        const activeCloudflareDomain = 'https://proud-darkness-ac3d.miserrano75.workers.dev';
        if (finalUrlEnsobrado.includes('localhost') || finalUrlEnsobrado.includes('127.0.0.1') || finalUrlEnsobrado.includes('torch-dresser-79a.workers.dev')) {
            const tokenMatch = finalUrlEnsobrado.match(/ensobrado[\/#]([a-zA-Z0-9_\-]+)/);
            if (tokenMatch && tokenMatch[1]) {
                finalUrlEnsobrado = `${activeCloudflareDomain}/#ensobrado/${tokenMatch[1]}`;
            } else {
                finalUrlEnsobrado = finalUrlEnsobrado.replace(/^https?:\/\/[^\/]+/, activeCloudflareDomain);
            }
        }

        const emailService = require('../../facturacion/services/emailService');

        const formatCurrency = (val) => {
            return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(parseFloat(val) || 0);
        };

        const montoStr = monto && parseFloat(monto) > 0 ? formatCurrency(monto) : 'A definir durante el conteo';
        const titularStr = titular || 'Tu empresa / comercio';
        const colabStr = nombreColaborador || 'Colaborador';

        const subject = `📦 Gestión de Ensobrado de Efectivo [${codigoSobre}] - ${titularStr}`;

        const datosDetalle = [
            { etiqueta: 'Código Asignado', valor: codigoSobre },
            { etiqueta: 'Empresa / Titular', valor: titularStr },
            { etiqueta: 'Monto a Preparar', valor: montoStr }
        ];

        if (nota) {
            datosDetalle.push({ etiqueta: 'Instrucción Especial', valor: nota });
        }

        const mensajePrincipal = `
            Hola <strong>${colabStr}</strong>,<br><br>
            <strong>${titularStr}</strong> te ha derivado la preparación y sellado del sobre de efectivo correspondiente a su cuenta en LAMDA.<br><br>
            Para realizar el conteo guiado de billetes, verificar el arqueo, sellar el paquete y tomar las fotografías de seguridad, ingresa en el siguiente botón desde tu teléfono o computadora:
        `;

        const htmlBody = `
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f1f5f9; color: #0f172a; margin: 0; padding: 0; }
                    .container { max-width: 600px; margin: 30px auto; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.06); overflow: hidden; border-top: 6px solid #8e4785; }
                    .header { padding: 25px; text-align: center; background: #faf5ff; border-bottom: 1px solid #f3e8ff; }
                    .header h1 { margin: 10px 0 0 0; font-size: 20px; color: #8e4785; font-weight: 800; }
                    .content { padding: 30px 25px; }
                    .message { font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 25px; }
                    .card-info { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin-bottom: 25px; }
                    .card-item { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed #e2e8f0; font-size: 14px; }
                    .card-item:last-child { border-bottom: none; }
                    .btn-action { display: block; width: 260px; margin: 25px auto; padding: 14px 20px; background-color: #8e4785; color: #ffffff !important; text-decoration: none; text-align: center; font-weight: 700; border-radius: 8px; font-size: 15px; box-shadow: 0 4px 12px rgba(142, 71, 133, 0.3); }
                    .footer { padding: 20px; text-align: center; font-size: 12px; color: #64748b; background: #f8fafc; border-top: 1px solid #e2e8f0; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>📦 Tarea de Ensobrado de Efectivo</h1>
                        <span style="font-size: 13px; color: #64748b; font-weight: 600;">Sistema LAMDA • Portal de Clientes B2B</span>
                    </div>
                    <div class="content">
                        <div class="message">${mensajePrincipal}</div>
                        
                        <div class="card-info">
                            ${datosDetalle.map(d => `
                                <div class="card-item">
                                    <span style="color: #64748b; font-weight: 600;">${d.etiqueta}:</span>
                                    <strong style="color: #0f172a;">${d.valor}</strong>
                                </div>
                            `).join('')}
                        </div>

                        <a href="${finalUrlEnsobrado}" class="btn-action" target="_blank">
                            👉 Abrir Asistente de Ensobrado
                        </a>

                        <p style="font-size: 12px; color: #94a3b8; text-align: center; margin-top: 15px;">
                            No necesitas usuario ni contraseña para ingresar. Este enlace es único y seguro para este sobre.
                        </p>
                    </div>
                    <div class="footer">
                        LAMDA Logística & Distribución | Av. 19 Nº 406 | Tel: 221-6615746<br>
                        Este es un correo automático generado a solicitud del titular de la cuenta.
                    </div>
                </div>
            </body>
            </html>
        `;

        const resultado = await emailService.enviarEmail({
            to: email,
            subject,
            htmlBody
        });

        res.json({
            success: true,
            mensaje: `Correo enviado exitosamente a ${email}`,
            messageId: resultado.messageId
        });

    } catch (error) {
        console.error('❌ [PAGOS-EFECTIVO-CTRL] Error al enviar email de derivación:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Crear sobre derivado de pago en efectivo (desde app móvil o panel administrativo)
 * POST /api/logistica/pagos-efectivo/crear-sobre-derivado
 */
exports.crearSobreDerivado = async (req, res) => {
    try {
        const { cliente_id, monto_declarado, colaborador_nombre, colaborador_telefono, colaborador_email, observaciones, derivado_por } = req.body;

        if (!cliente_id) {
            return res.status(400).json({
                success: false,
                error: 'El campo cliente_id es obligatorio.'
            });
        }

        const resultado = await PagosEfectivoService.crearSobreDerivado({
            clienteId: cliente_id,
            montoDeclarado: monto_declarado === undefined ? null : monto_declarado,
            colaboradorNombre: colaborador_nombre,
            colaboradorTelefono: colaborador_telefono,
            colaboradorEmail: colaborador_email,
            observaciones,
            derivadoPor: derivado_por || (req.user ? req.user.nombre : 'Chofer / Móvil LAMDA')
        });

        res.json({
            success: true,
            mensaje: 'Sobre de ensobrado generado exitosamente.',
            ...resultado
        });
    } catch (error) {
        console.error('❌ [PAGOS-EFECTIVO-CTRL] Error al crear sobre derivado:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Despacho omnicanal administrativo (Motor WhatsApp :3004 y/o Email SMTP)
 * POST /api/logistica/pagos-efectivo/enviar-solicitud-omnicanal
 */
exports.enviarSolicitudOmnicanal = async (req, res) => {
    try {
        const {
            codigo_sobre,
            url_ensobrado,
            qr_data_url,
            cliente_nombre,
            monto_sugerido,
            canales = {},
            destinatarios_whatsapp = [],
            destinatarios_email = [],
            asunto_email,
            mensaje_whatsapp,
            mensaje_email,
            adjuntar_qr_wa = true
        } = req.body || {};

        if (!url_ensobrado || !codigo_sobre) {
            return res.status(400).json({
                success: false,
                error: 'Faltan parámetros obligatorios (codigo_sobre, url_ensobrado).'
            });
        }

        const usarWa = Boolean(canales.whatsapp);
        const usarEmail = Boolean(canales.email);
        if (!usarWa && !usarEmail) {
            return res.status(400).json({
                success: false,
                error: 'Seleccioná al menos un canal de envío (WhatsApp o Email).'
            });
        }

        const waList = (Array.isArray(destinatarios_whatsapp) ? destinatarios_whatsapp : String(destinatarios_whatsapp || '').split(','))
            .map(v => String(v || '').trim())
            .filter(v => v.replace(/\D/g, '').length >= 8);

        const emailList = (Array.isArray(destinatarios_email) ? destinatarios_email : String(destinatarios_email || '').split(','))
            .map(v => String(v || '').trim())
            .filter(v => v.includes('@'));

        if (usarWa && waList.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Seleccioná o ingresá al menos un número de WhatsApp válido.'
            });
        }

        if (usarEmail && emailList.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Seleccioná o ingresá al menos una dirección de Email válida.'
            });
        }

        const resultados = { whatsapp: null, email: null };

        if (usarWa) {
            const factBaseUrl = (process.env.FACTURACION_API_URL || `http://127.0.0.1:${process.env.FACTURACION_PORT || 3004}`).replace(/\/+$/, '');
            const cleanQrBase64 = String(qr_data_url || '').replace(/^data:image\/png;base64,/i, '').trim();
            const textoWa = String(mensaje_whatsapp || '').trim() || `📦 Solicitud de ensobrado ${codigo_sobre}: ${url_ensobrado}`;

            try {
                const endpoint = (adjuntar_qr_wa && cleanQrBase64)
                    ? `${factBaseUrl}/facturacion/whatsapp/enviar-imagen`
                    : `${factBaseUrl}/facturacion/whatsapp/enviar-mensaje`;
                const payload = (adjuntar_qr_wa && cleanQrBase64)
                    ? {
                        destinatarios: waList.join(', '),
                        base64Data: cleanQrBase64,
                        mimeType: 'image/png',
                        filename: `QR_Ensobrado_${codigo_sobre}.png`,
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
                resultados.whatsapp = {
                    success: true,
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
                const titularStr = String(cliente_nombre || 'Cliente').trim();
                const montoNum = monto_sugerido !== null && monto_sugerido !== undefined && String(monto_sugerido).trim() !== ''
                    ? parseFloat(monto_sugerido)
                    : null;
                const montoHtml = (montoNum && montoNum > 0)
                    ? `$ ${montoNum.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (sugerido / editable por titular)`
                    : 'A definir libremente por el titular';

                const subject = String(asunto_email || '').trim()
                    || `📦 Solicitud de Ensobrado de Efectivo [${codigo_sobre}] - ${titularStr}`;

                const cuerpoTexto = String(mensaje_email || '').trim();
                const cuerpoHtml = cuerpoTexto
                    ? cuerpoTexto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
                    : `Te enviamos el acceso directo para preparar el sobre de efectivo <strong>${codigo_sobre}</strong>.`;

                const cleanQrBase64 = String(qr_data_url || '').replace(/^data:image\/png;base64,/i, '').trim();
                const attachments = cleanQrBase64
                    ? [{
                        filename: `QR_Ensobrado_${codigo_sobre}.png`,
                        content: Buffer.from(cleanQrBase64, 'base64'),
                        cid: 'qr_ensobrado_lamda'
                    }]
                    : [];

                const htmlBody = `
                    <!DOCTYPE html>
                    <html lang="es">
                    <head><meta charset="UTF-8"></head>
                    <body style="font-family:'Segoe UI',sans-serif; background:#f1f5f9; color:#0f172a; padding:20px;">
                        <div style="max-width:580px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; border-top:6px solid #0d9488; box-shadow:0 4px 12px rgba(0,0,0,0.06);">
                            <div style="padding:20px 24px; background:#f0fdfa; border-bottom:1px solid #ccfbf1;">
                                <h2 style="margin:0; color:#0f766e; font-size:19px;">📦 Solicitud de Ensobrado de Efectivo</h2>
                                <div style="font-size:12px; color:#64748b; margin-top:4px;">${titularStr} • Código ${codigo_sobre}</div>
                            </div>
                            <div style="padding:22px 24px; font-size:14px; line-height:1.55; color:#334155;">
                                <p style="margin-top:0;">${cuerpoHtml}</p>
                                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px 14px; margin:16px 0;">
                                    <div><strong>Código de sobre:</strong> ${codigo_sobre}</div>
                                    <div><strong>Importe:</strong> ${montoHtml}</div>
                                </div>
                                ${cleanQrBase64 ? `
                                <div style="text-align:center; margin:16px 0;">
                                    <img src="cid:qr_ensobrado_lamda" alt="QR Ensobrado" style="width:180px; height:180px; border:1px solid #e2e8f0; border-radius:8px; padding:6px; background:#ffffff;" />
                                </div>` : ''}
                                <div style="text-align:center; margin:18px 0;">
                                    <a href="${url_ensobrado}" target="_blank" style="display:inline-block; background:#0d9488; color:#ffffff; text-decoration:none; padding:12px 22px; border-radius:8px; font-weight:700;">
                                        👉 Abrir Asistente de Ensobrado
                                    </a>
                                </div>
                                <p style="font-size:12px; color:#64748b; word-break:break-all;">Enlace directo: ${url_ensobrado}</p>
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

        const waOk = !usarWa || Boolean(resultados.whatsapp?.success);
        const emailOk = !usarEmail || Boolean(resultados.email?.success);
        const alMenosUnoOk = Boolean((usarWa && resultados.whatsapp?.success) || (usarEmail && resultados.email?.success));

        return res.status(alMenosUnoOk ? 200 : 500).json({
            success: alMenosUnoOk,
            parcial: alMenosUnoOk && (!waOk || !emailOk),
            resultados
        });
    } catch (error) {
        console.error('❌ [PAGOS-EFECTIVO-CTRL] Error en enviarSolicitudOmnicanal:', error.message);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

exports.obtenerSobrePublico = async (req, res) => {
    try {
        const { token } = req.params;
        const resultado = await PagosEfectivoService.obtenerSobrePublicoPorToken(token);
        if (!resultado.ok) {
            return res.status(resultado.status || 404).json(resultado);
        }
        return res.json(resultado);
    } catch (error) {
        console.error('❌ [PAGOS-EFECTIVO-CTRL] Error en obtenerSobrePublico:', error.message);
        return res.status(500).json({ ok: false, error: error.message });
    }
};

exports.delegarSobrePublico = async (req, res) => {
    try {
        const { token } = req.params;
        const { monto, colaborador_nombre, nota, fijado_por } = req.body || {};
        const resultado = await PagosEfectivoService.delegarSobreDesdeDueno({
            tokenDueno: token,
            monto,
            colaboradorNombre: colaborador_nombre,
            nota,
            fijadoPor: fijado_por
        });
        if (!resultado.ok) {
            return res.status(resultado.status || 400).json(resultado);
        }
        return res.json(resultado);
    } catch (error) {
        console.error('❌ [PAGOS-EFECTIVO-CTRL] Error en delegarSobrePublico:', error.message);
        return res.status(500).json({ ok: false, error: error.message });
    }
};

exports.completarSobrePublico = async (req, res) => {
    try {
        const { token } = req.params;
        const {
            monto,
            desglose_billetes,
            foto_frente_url,
            foto_dorso_url,
            modalidad_entrega,
            colaborador_nombre,
            observaciones
        } = req.body || {};

        const resultado = await PagosEfectivoService.completarSobrePublico({
            token,
            monto,
            desgloseBilletes: desglose_billetes,
            fotoFrenteUrl: foto_frente_url,
            fotoDorsoUrl: foto_dorso_url,
            modalidadEntrega: modalidad_entrega,
            colaboradorNombre: colaborador_nombre,
            observaciones
        });
        if (!resultado.ok) {
            return res.status(resultado.status || 400).json(resultado);
        }
        return res.json(resultado);
    } catch (error) {
        console.error('❌ [PAGOS-EFECTIVO-CTRL] Error en completarSobrePublico:', error.message);
        return res.status(500).json({ ok: false, error: error.message });
    }
};
