const nodemailer = require('nodemailer');
const { formatearFecha } = require('../config/timezone');

// Obtener variables de entorno (GMAIL_USER y GMAIL_APP_PASSWORD)
const getTransporter = () => {
    const user = process.env.GMAIL_USER || 'miserrano75@gmail.com';
    const pass = process.env.GMAIL_APP_PASSWORD;

    if (!pass) {
        console.warn('⚠️ [EMAIL-SERVICE] GMAIL_APP_PASSWORD no está definida en el archivo .env. Los envíos de correo fallarán.');
    }

    return nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass }
    });
};

/**
 * Servicio genérico para enviar correos electrónicos con adjuntos (Base Modular y Escalable)
 * @param {Object} params
 * @param {string} params.to - Direcciones de correo electrónico (separadas por comas)
 * @param {string} params.subject - Asunto del correo
 * @param {string} params.htmlBody - Cuerpo del correo en HTML
 * @param {Array} [params.attachments] - Adjuntos de nodemailer (ej. [{ filename, content }])
 * @returns {Promise<Object>} Resultado del envío
 */
function esModoLaboratorioEmail() {
    const dbName = String(process.env.DB_NAME || '').trim().toLowerCase();
    const flagLab = String(process.env.LAMDA_MODO_LABORATORIO || '').trim().toLowerCase();
    return dbName === 'etiquetas_pruebas' || flagLab === 'true' || flagLab === '1';
}

function esModoPruebaNubeEmail() {
    return false;
}

const enviarEmail = async ({ to, subject, htmlBody, attachments = [] }) => {
    console.log(`✉️ [EMAIL-SERVICE] Intentando enviar correo a: ${to} | Asunto: "${subject}"`);
    
    if (!to || !to.trim()) {
        throw new Error('No se especificaron destinatarios de correo electrónico.');
    }

    // Sanitizar destinatarios: separar por comas, eliminar espacios vacíos
    const recipients = to.split(',')
        .map(email => email.trim())
        .filter(email => email && email.includes('@'));

    if (recipients.length === 0) {
        throw new Error('Ninguna de las direcciones de correo electrónico provistas es válida.');
    }

    // 🔒 1) MODO LABORATORIO LOCAL (sin prueba de envío en nube): simular sin disparar SMTP externo
    if (esModoLaboratorioEmail() && !esModoPruebaNubeEmail()) {
        console.log(`🔒 [EMAIL-GUARD] Envío de correo SIMULADO en Modo Laboratorio (No enviado por SMTP). Destinatarios originales: [${recipients.join(', ')}]`);
        return {
            success: true,
            simulated: true,
            messageId: `sim-lab-${Date.now()}`,
            recipients
        };
    }

    // 🧪 2) MODO PRUEBA EN NUBE (SAFE_DELIVERY_REDIRECT): redirigir todos los correos al mail de Martín
    let finalRecipients = recipients;
    let finalSubject = subject;
    let finalHtmlBody = htmlBody;
    if (esModoPruebaNubeEmail()) {
        const safeEmailTo = (process.env.SAFE_REDIRECT_EMAIL_TO || 'miserrano75@gmail.com').trim();
        const originalDestStr = recipients.join(', ');
        finalRecipients = [safeEmailTo];
        finalSubject = `[PRUEBA NUBE - Destino original: ${originalDestStr}] ${subject}`;
        const bannerRedirectHtml = `
            <div style="background:#0f172a;color:#38bdf8;border:2px solid #0284c7;padding:14px 18px;font-family:Segoe UI,sans-serif;font-size:13px;margin-bottom:16px;border-radius:8px;">
                <strong>🧪 [MODO PRUEBA EN NUBE LAMDA — REDIRECCIÓN SEGURA ACTIVA]</strong><br>
                Este correo fue interceptado automáticamente para no molestar al cliente real.<br>
                📌 <strong>Destinatario(s) original(es) bloqueado(s):</strong> <span style="color:#fde68a;">${originalDestStr}</span>
            </div>
        `;
        finalHtmlBody = bannerRedirectHtml + (htmlBody || '');
        console.log(`🧪 [EMAIL-SAFE-REDIRECT] Correo redirigido de [${originalDestStr}] -> [${safeEmailTo}]`);
    }

    // Inyectar el logotipo corporativo como adjunto CID de forma automática si no está ya
    const fs = require('fs');
    const path = require('path');
    const pathLogo = path.join(__dirname, '../../app-etiquetas/img/logo_LAMDA.png');
    if (fs.existsSync(pathLogo) && !attachments.some(a => a.cid === 'logo-lamda')) {
        attachments.push({
            filename: 'logo_LAMDA.png',
            path: pathLogo,
            cid: 'logo-lamda'
        });
    }

    const transporter = getTransporter();
    const fromUser = process.env.GMAIL_USER || 'miserrano75@gmail.com';

    const mailOptions = {
        from: `"Sistema LAMDA" <${fromUser}>`,
        to: finalRecipients.join(', '),
        subject: finalSubject,
        html: finalHtmlBody,
        attachments
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ [EMAIL-SERVICE] Correo enviado exitosamente. MessageID: ${info.messageId}`);
    return {
        success: true,
        messageId: info.messageId,
        recipients: recipients
    };
};

/**
 * Plantilla HTML institucional base para los correos de LAMDA
 */
const obtenerPlantillaHtml = ({ titulo, clienteNombre, mensajePrincipal, datosDetalle, avisoSaldoExcedidoHtml = '', piePagina, mostrarTransferencia = true }) => {
    return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <style>
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background-color: #f1f5f9;
                color: #0f172a;
                margin: 0;
                padding: 0;
            }
            .container {
                max-width: 600px;
                margin: 40px auto;
                background: #ffffff;
                border-radius: 12px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
                overflow: hidden;
                border-top: 6px solid #8b5cf6; /* Identidad de color Púrpura de LAMDA */
            }
            .header {
                background-color: #fafafa;
                padding: 24px;
                text-align: center;
                border-bottom: 1px solid #e2e8f0;
            }
            .content {
                padding: 32px 24px;
                line-height: 1.6;
            }
            .greeting {
                font-size: 16px;
                font-weight: 600;
                margin-bottom: 16px;
                color: #0f172a;
            }
            .message {
                font-size: 15px;
                color: #475569;
                margin-bottom: 24px;
            }
            .details-box {
                background-color: #f8fafc;
                border: 1px solid #e2e8f0;
                border-radius: 8px;
                padding: 20px;
                margin-bottom: 24px;
            }
            .details-box table {
                width: 100%;
                border-collapse: collapse;
            }
            .details-box td {
                padding: 6px 0;
                font-size: 14px;
                color: #334155;
            }
            .details-box td.label {
                font-weight: 600;
                color: #64748b;
                width: 40%;
            }
            .footer {
                background-color: #f8fafc;
                padding: 20px;
                text-align: center;
                font-size: 12px;
                color: #94a3b8;
                border-top: 1px solid #e2e8f0;
            }
            .footer a {
                color: #8b5cf6;
                text-decoration: none;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <img src="cid:logo-lamda" alt="SISTEMA LAMDA" style="height: 48px; max-height: 48px; width: auto; object-fit: contain;">
            </div>
            <div class="content">
                <div class="greeting">Estimado/a ${clienteNombre},</div>
                <div class="message">${mensajePrincipal}</div>
                
                <div class="details-box">
                    <table>
                        <tbody>
                            ${datosDetalle.map(item => `
                                <tr>
                                    <td class="label">${item.label}</td>
                                    <td><strong>${item.value}</strong></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>

                ${avisoSaldoExcedidoHtml || ''}
                
                ${mostrarTransferencia ? `
                <div class="transfer-box" style="margin-top: 24px; padding: 16px; border: 1px dashed #7c3aed; border-radius: 8px; background-color: #faf5ff;">
                    <h3 style="margin-top: 0; color: #6d28d9; font-size: 14px; border-bottom: 1px solid #e9d5ff; padding-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Datos para Transferencia Bancaria</h3>
                    <table style="width: 100%; border-collapse: collapse; font-size: 13px; color: #475569;">
                        <tr><td style="font-weight: 600; width: 35%; padding: 4px 0;">Banco:</td><td style="padding: 4px 0;">Banco Galicia</td></tr>
                        <tr><td style="font-weight: 600; padding: 4px 0;">Cuenta (CTA):</td><td style="padding: 4px 0;">4007844-1 373-4</td></tr>
                        <tr><td style="font-weight: 600; padding: 4px 0;">CBU:</td><td style="padding: 4px 0;">0070373230004007844141</td></tr>
                        <tr><td style="font-weight: 600; padding: 4px 0;">ALIAS:</td><td style="padding: 4px 0; font-weight: 600; color: #6d28d9;">lamda.ser.martin</td></tr>
                    </table>
                </div>
                ` : ''}
                
                <p style="font-size: 14px; color: #64748b; margin-top: 24px;">
                    En el adjunto de este correo electrónico encontrará el comprobante correspondiente en formato PDF.
                </p>
            </div>
            <div class="footer">
                <p>Este correo electrónico fue generado automáticamente por el Sistema LAMDA.</p>
                <p>${piePagina || 'Av. 19 Nº 406 | Tel: 221-6615746'}</p>
            </div>
        </div>
    </body>
    </html>
    `;
};

/**
 * Enviar Factura PDF por Correo Electrónico
 * @param {Object} factura - Datos de la factura
 * @param {Buffer} pdfBuffer - Buffer binario del archivo PDF
 * @param {string} destinatarios - Direcciones de email separadas por comas
 * @param {string} nroComprobante - Número formateado del comprobante (ej: "0001-00000104")
 */
const enviarFacturaPdf = async (factura, pdfBuffer, destinatarios, nroComprobante) => {
    const clienteNombre = factura.razon_social || 'Cliente';
    const tipoComp = factura.tipo_cbte === 1 ? 'Factura A' : (factura.tipo_cbte === 6 ? 'Factura B' : (factura.tipo_cbte === 11 ? 'Factura C' : 'Factura'));
    
    const subject = `LAMDA - Envío de Comprobante Electrónico: ${tipoComp} Nº ${nroComprobante}`;
    
    const mensajePrincipal = `Le hacemos llegar el comprobante electrónico correspondiente a sus operaciones comerciales de forma automatizada.`;
    
    const datosDetalle = [
        { label: 'Tipo de Comprobante', value: tipoComp },
        { label: 'Número de Comprobante', value: nroComprobante },
        { label: 'Fecha de Emisión', value: formatearFecha(factura.fecha_emision) },
        { label: 'Importe Total', value: `$${parseFloat(factura.imp_total).toLocaleString('es-AR', { minimumFractionDigits: 2 })}` }
    ];

    if (factura.cae) {
        datosDetalle.push({ label: 'CAE (Autorización AFIP)', value: factura.cae });
        datosDetalle.push({ label: 'Vencimiento CAE', value: formatearFecha(factura.cae_vto) });
    }

    const htmlBody = obtenerPlantillaHtml({
        titulo: 'Envío de Factura Electrónica',
        clienteNombre,
        mensajePrincipal,
        datosDetalle,
        piePagina: 'LAMDA Facturación | Av. 19 Nº 406 | Tel: 221-6615746'
    });

    const safeFilename = `${tipoComp.replace(/\s+/g, '_')}_${nroComprobante}.pdf`;

    const attachments = [{
        filename: safeFilename,
        content: pdfBuffer,
        contentType: 'application/pdf'
    }];

    return await enviarEmail({
        to: destinatarios,
        subject,
        htmlBody,
        attachments
    });
};

/**
 * Enviar Resumen de Cuenta por Correo Electrónico (Modularidad Futura)
 * @param {Object} cliente - Datos del cliente
 * @param {Buffer} pdfBuffer - Buffer del PDF del resumen
 * @param {string} destinatarios - Emails separados por comas
 * @param {string} fechaCorte - Fecha de corte del resumen (ej: "23/06/2026")
 * @param {number} saldoActual - Saldo pendiente
 * @param {Object} [opciones={}] - Opciones adicionales (ej: avisoSaldoExcedidoHtml)
 */
const enviarResumenCuentaPdf = async (cliente, pdfBuffer, destinatarios, fechaCorte, saldoActual, opciones = {}) => {
    const { avisoSaldoExcedidoHtml = '' } = opciones;
    const clienteNombre = cliente.cliente_nombre || cliente.razon_social || 'Cliente';
    const subject = `LAMDA - Estado de Cuenta y Resumen de Saldo al ${fechaCorte}`;
    
    const mensajePrincipal = `Le hacemos llegar el resumen detallado de su cuenta corriente a la fecha de corte indicada.`;
    
    const datosDetalle = [
        { label: 'Cliente', value: clienteNombre },
        { label: 'Código de cliente', value: cliente.codigo_bunker_cliente || 'N/A' },
        { label: 'Fecha de Corte', value: fechaCorte },
        { label: 'Saldo Pendiente', value: `$${parseFloat(saldoActual).toLocaleString('es-AR', { minimumFractionDigits: 2 })}` }
    ];

    const htmlBody = obtenerPlantillaHtml({
        titulo: 'Estado de Cuenta Corriente',
        clienteNombre,
        mensajePrincipal,
        datosDetalle,
        avisoSaldoExcedidoHtml,
        piePagina: 'LAMDA Logística y Finanzas | Av. 19 Nº 406 | Tel: 221-6615746'
    });

    const safeFilename = `Resumen_Cuenta_${clienteNombre.replace(/\s+/g, '_')}_${fechaCorte.replace(/\//g, '-')}.pdf`;

    const attachments = [{
        filename: safeFilename,
        content: pdfBuffer,
        contentType: 'application/pdf'
    }];

    return await enviarEmail({
        to: destinatarios,
        subject,
        htmlBody,
        attachments
    });
};

/**
 * Enviar Presupuesto PDF por Correo Electrónico
 * @param {Object} cliente - Datos del cliente
 * @param {Buffer} pdfBuffer - Buffer del PDF del presupuesto
 * @param {string} destinatarios - Emails separados por comas
 * @param {string} nroComprobante - Número del presupuesto
 */
const enviarPresupuestoPdf = async (cliente, pdfBuffer, destinatarios, nroComprobante) => {
    const clienteNombre = cliente.cliente_nombre || cliente.razon_social || 'Cliente';
    const subject = `LAMDA - Envío de Presupuesto N° ${nroComprobante}`;
    
    const mensajePrincipal = `Le hacemos llegar el presupuesto solicitado para sus operaciones comerciales.`;
    
    const datosDetalle = [
        { label: 'Cliente', value: clienteNombre },
        { label: 'Código de cliente', value: cliente.codigo_bunker_cliente || 'N/A' },
        { label: 'Número de Presupuesto', value: nroComprobante }
    ];

    const htmlBody = obtenerPlantillaHtml({
        titulo: 'Envío de Presupuesto',
        clienteNombre,
        mensajePrincipal,
        datosDetalle,
        piePagina: 'LAMDA Presupuestos | Av. 19 Nº 406 | Tel: 221-6615746'
    });

    const safeFilename = `Presupuesto_${nroComprobante}_${clienteNombre.replace(/\s+/g, '_')}.pdf`;

    const attachments = [{
        filename: safeFilename,
        content: pdfBuffer,
        contentType: 'application/pdf'
    }];

    return await enviarEmail({
        to: destinatarios,
        subject,
        htmlBody,
        attachments
    });
};

/**
 * Enviar Comprobante PDF por Correo Electrónico
 */
const enviarComprobantePdf = async (cliente, pdfBuffer, destinatarios, nroComprobante, mensajeTexto) => {
    const clienteNombre = cliente.cliente_nombre || cliente.razon_social || 'Cliente';
    const subject = `LAMDA - Envio de Comprobante Nº ${nroComprobante}`;
    
    const mensajePrincipal = mensajeTexto || `Le hacemos llegar el comprobante oficial de su cuenta corriente.`;
    
    const datosDetalle = [
        { label: 'Cliente', value: clienteNombre },
        { label: 'Código de cliente', value: cliente.codigo_bunker_cliente || 'N/A' },
        { label: 'Número de Comprobante', value: nroComprobante }
    ];

    const htmlBody = obtenerPlantillaHtml({
        titulo: 'Envio de Comprobante',
        clienteNombre,
        mensajePrincipal,
        datosDetalle,
        piePagina: 'LAMDA Logística y Finanzas | Av. 19 Nº 406 | Tel: 221-6615746',
        mostrarTransferencia: false
    });

    const safeFilename = `Comprobante_${nroComprobante.replace(/\s+/g, '_')}.pdf`;

    const attachments = [{
        filename: safeFilename,
        content: pdfBuffer,
        contentType: 'application/pdf'
    }];

    return await enviarEmail({
        to: destinatarios,
        subject,
        htmlBody,
        attachments
    });
};

/**
 * Enviar Cotización / Consulta de Precios PDF por Correo Electrónico
 */
const enviarCotizacionPdf = async (clienteNombre, pdfBuffer, destinatarios, tituloInforme, mensajeTexto) => {
    const titulo = tituloInforme && tituloInforme.trim() ? tituloInforme.trim() : 'Consulta de Precios';
    const clienteStr = clienteNombre && clienteNombre.trim() ? clienteNombre.trim() : 'Estimado Cliente';
    const subject = `LAMDA - ${titulo} - ${clienteStr}`;
    
    const mensajePrincipal = mensajeTexto ? mensajeTexto.replace(/solicitada/gi, 'actualizada') : `Le hacemos llegar la consulta de precios actualizada.`;
    
    const hoyFmtStr = new Date().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const datosDetalle = [
        { label: 'Cliente', value: clienteStr },
        { label: 'Informe', value: titulo },
        { label: 'Fecha de Emisión', value: hoyFmtStr }
    ];

    const htmlBody = obtenerPlantillaHtml({
        titulo,
        clienteNombre: clienteStr,
        mensajePrincipal,
        datosDetalle,
        piePagina: 'LAMDA Logística & Finanzas | Av. 19 Nº 406 | Tel: 221-6615746',
        mostrarTransferencia: false
    });

    const cleanName = clienteStr.replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '_');
    const safeFilename = `${titulo.replace(/\s+/g, '_')}_${cleanName}.pdf`;

    const attachments = [{
        filename: safeFilename,
        content: pdfBuffer,
        contentType: 'application/pdf'
    }];

    return await enviarEmail({
        to: destinatarios,
        subject,
        htmlBody,
        attachments
    });
};

module.exports = {
    enviarEmail,
    enviarFacturaPdf,
    enviarResumenCuentaPdf,
    enviarPresupuestoPdf,
    enviarComprobantePdf,
    enviarCotizacionPdf,
    obtenerPlantillaHtml
};
