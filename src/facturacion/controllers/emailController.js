const emailService = require('../services/emailService');
const facturaService = require('../services/facturaService');
const { generarPDF: generarPDFServicio } = require('../pdf/generador');

/**
 * Enviar Factura PDF por Correo Electrónico
 * POST /api/facturacion/email/facturas/:id/enviar
 */
const enviarFactura = async (req, res) => {
    const { id } = req.params;
    console.log(`📧 [EMAIL-CTRL] Petición de envío por Email para factura ID: ${id}`);

    try {
        // 1. Obtener la factura de la base de datos con datos completos (incluye razón social, email_facturas, etc.)
        const factura = await facturaService.obtenerPorId(parseInt(id));
        if (!factura) {
            return res.status(404).json({
                success: false,
                error: 'Factura no encontrada'
            });
        }

        const items = factura.items;

        // 2. Resolver destinatarios de correo
        let emailDestinos = '';
        let origenContacto = '';

        // Si se proveen destinatarios explícitos en el request body (seleccionados en UI)
        let tieneDestinatariosBody = false;
        if (req.body && req.body.destinatarios !== undefined) {
            tieneDestinatariosBody = true;
            if (Array.isArray(req.body.destinatarios)) {
                emailDestinos = req.body.destinatarios.filter(n => n && String(n).trim().length > 0).join(', ');
            } else if (typeof req.body.destinatarios === 'string') {
                emailDestinos = req.body.destinatarios;
            }
            origenContacto = 'Selección interactiva (UI)';
        }

        // Si no se proveyeron en el body, usar los configurados en la ficha del cliente
        if (!tieneDestinatariosBody && (!emailDestinos || !emailDestinos.trim())) {
            emailDestinos = factura.email_facturas || '';
            origenContacto = 'Ficha del Cliente (Búnker)';
        }

        // Si es formato JSON array, extraer solo los emails predeterminados
        if (!tieneDestinatariosBody && emailDestinos && emailDestinos.trim().startsWith('[')) {
            try {
                const parsed = JSON.parse(emailDestinos);
                if (Array.isArray(parsed)) {
                    const hasDefault = parsed.some(c => c.default_factura === true);
                    const hasEmailConfig = parsed.some(c => c.default_factura !== undefined);
                    
                    let filtered = [];
                    if (hasDefault) {
                        filtered = parsed.filter(c => c.default_factura === true);
                    } else if (hasEmailConfig) {
                        filtered = []; // Configured but unchecked all
                    } else {
                        filtered = parsed;
                    }
                    emailDestinos = filtered
                        .map(item => (typeof item === 'object' && item) ? item.email : item)
                        .filter(e => e && String(e).trim().length > 0)
                        .join(', ');
                }
            } catch (e) {
                console.error('Error parseando email_facturas JSON en backend:', e);
            }
        }

        if (!emailDestinos || !emailDestinos.trim()) {
            if (tieneDestinatariosBody) {
                return res.json({
                    success: true,
                    message: 'No se seleccionaron destinatarios de correo. Envío omitido.',
                    data: { destinatarios: '', origen: origenContacto }
                });
            }
            return res.status(400).json({
                success: false,
                error: 'Sin contacto de correo',
                message: 'No hay direcciones de correo electrónico configuradas para este cliente. Por favor, edite los destinatarios en la sección de Clientes.'
            });
        }

        // 3. Generar buffer del PDF
        console.log(`📄 [EMAIL-CTRL] Generando PDF para Factura ID ${id}...`);
        const pdfBuffer = await generarPDFServicio(factura, items);

        // Formatear número de factura amigable (ej: "0032-00000005")
        const ptoVtaPad = String(factura.pto_vta || '0').padStart(4, '0');
        const cbtePad = String(factura.cbte_nro || factura.nro_interno || id).padStart(8, '0');
        const nroComp = `${ptoVtaPad}-${cbtePad}`;

        // 4. Enviar por Email usando el servicio de correo
        console.log(`📧 [EMAIL-CTRL] Enviando por email a destinatario(s): ${emailDestinos} (Origen: ${origenContacto})`);
        const resultado = await emailService.enviarFacturaPdf(factura, pdfBuffer, emailDestinos, nroComp);

        // Marcar factura como enviada en DB
        try {
            await pool.query(
                `UPDATE public.factura_facturas 
                 SET es_enviado = true, enviado_at = NOW(), 
                     enviado_canal = CASE WHEN enviado_canal IS NULL OR enviado_canal = '' THEN 'Email' ELSE enviado_canal || ', Email' END 
                 WHERE id = $1`,
                [factura.id]
            );
        } catch (dbErr) {
            console.warn('⚠️ No se pudo actualizar flag es_enviado en DB:', dbErr.message);
        }

        res.json({
            success: true,
            message: 'Envío de correo electrónico procesado.',
            data: {
                destinatarios: resultado.recipients.join(', '),
                origen: origenContacto,
                messageId: resultado.messageId
            }
        });

    } catch (error) {
        console.error(`❌ [EMAIL-CTRL] Error al enviar factura ID ${id} por email:`, error);
        res.status(500).json({
            success: false,
            error: 'Error interno en el servidor al enviar por email',
            message: error.message
        });
    }
};

/**
 * Enviar Resumen de Cuenta Corriente PDF por Correo Electrónico
 * POST /api/facturacion/email/cuentas-corrientes/enviar
 */
const enviarResumenCuenta = async (req, res) => {
    console.log(`📧 [EMAIL-CTRL] Petición de envío de resumen de cuenta corriente por Email`);

    try {
        const { cliente, destinatarios, pdfBase64, fechaCorte, saldoActual, avisoSaldoExcedidoHtml } = req.body;

        if (!destinatarios || !destinatarios.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Sin contacto de correo',
                message: 'No hay direcciones de correo electrónico configuradas para este envío.'
            });
        }

        if (!pdfBase64) {
            return res.status(400).json({
                success: false,
                error: 'Sin archivo',
                message: 'No se recibió el documento PDF en formato base64.'
            });
        }

        const pdfBuffer = Buffer.from(pdfBase64, 'base64');
        const resultado = await emailService.enviarResumenCuentaPdf(cliente, pdfBuffer, destinatarios, fechaCorte, saldoActual, { avisoSaldoExcedidoHtml });

        res.json({
            success: true,
            message: 'Envío de correo electrónico del resumen de cuenta corriente procesado.',
            data: {
                destinatarios: resultado.recipients.join(', '),
                messageId: resultado.messageId
            }
        });

    } catch (error) {
        console.error(`❌ [EMAIL-CTRL] Error al enviar resumen de cuenta corriente por email:`, error);
        res.status(500).json({
            success: false,
            error: 'Error interno en el servidor al enviar resumen de cuenta por email',
            message: error.message
        });
    }
};

/**
 * Enviar Presupuesto PDF por Correo Electrónico
 * POST /api/facturacion/email/presupuestos/enviar
 */
const enviarPresupuesto = async (req, res) => {
    console.log(`📧 [EMAIL-CTRL] Petición de envío de presupuesto por Email`);

    try {
        const { cliente, destinatarios, pdfBase64, nroComprobante } = req.body;

        if (!destinatarios || !destinatarios.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Sin contacto de correo',
                message: 'No hay direcciones de correo electrónico configuradas para este envío.'
            });
        }

        if (!pdfBase64) {
            return res.status(400).json({
                success: false,
                error: 'Sin archivo',
                message: 'No se recibió el documento PDF en formato base64.'
            });
        }

        const pdfBuffer = Buffer.from(pdfBase64, 'base64');
        const resultado = await emailService.enviarPresupuestoPdf(cliente, pdfBuffer, destinatarios, nroComprobante);

        res.json({
            success: true,
            message: 'Envío de correo electrónico de presupuesto procesado.',
            data: {
                destinatarios: resultado.recipients.join(', '),
                messageId: resultado.messageId
            }
        });

    } catch (error) {
        console.error(`❌ [EMAIL-CTRL] Error al enviar presupuesto por email:`, error);
        res.status(500).json({
            success: false,
            error: 'Error interno en el servidor al enviar presupuesto por email',
            message: error.message
        });
    }
};

/**
 * Enviar Comprobante PDF por Correo Electrónico
 * POST /api/facturacion/email/comprobantes/enviar
 */
const enviarComprobante = async (req, res) => {
    console.log(`\ud83d\udce7 [EMAIL-CTRL] Peticion de envio de comprobante de pago por Email`);

    try {
        const { cliente, destinatarios, pdfBase64, nroComprobante, mensajeTexto } = req.body;

        if (!destinatarios || !destinatarios.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Sin contacto de correo',
                message: 'No hay direcciones de correo electrónico configuradas para este envio.'
            });
        }

        if (!pdfBase64) {
            return res.status(400).json({
                success: false,
                error: 'Sin archivo',
                message: 'No se recibio el documento PDF en formato base64.'
            });
        }

        const pdfBuffer = Buffer.from(pdfBase64, 'base64');
        const resultado = await emailService.enviarComprobantePdf(cliente, pdfBuffer, destinatarios, nroComprobante, mensajeTexto);

        res.json({
            success: true,
            message: 'Envio de correo electrónico de comprobante procesado.',
            data: {
                destinatarios: resultado.recipients.join(', '),
                messageId: resultado.messageId
            }
        });

    } catch (error) {
        console.error(`\u274c [EMAIL-CTRL] Error al enviar comprobante por email:`, error);
        res.status(500).json({
            success: false,
            error: 'Error interno en el servidor al enviar comprobante por email',
            message: error.message
        });
    }
};

/**
 * Enviar Cotización PDF por Correo Electrónico
 * POST /api/facturacion/email/cotizaciones/enviar
 */
const enviarCotizacion = async (req, res) => {
    console.log('📧 [EMAIL-CTRL] Petición de envío de cotización por Email');

    try {
        const { clienteNombre, destinatarios, pdfBase64, tituloInforme, mensajeTexto } = req.body;

        if (!destinatarios || !destinatarios.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Sin contacto de correo',
                message: 'No hay direcciones de correo electrónico configuradas para este envío.'
            });
        }

        if (!pdfBase64) {
            return res.status(400).json({
                success: false,
                error: 'Sin archivo',
                message: 'No se recibió el documento PDF en formato base64.'
            });
        }

        const pdfBuffer = Buffer.from(pdfBase64, 'base64');
        const resultado = await emailService.enviarCotizacionPdf(clienteNombre, pdfBuffer, destinatarios, tituloInforme, mensajeTexto);

        res.json({
            success: true,
            message: 'Envío de correo electrónico de cotización procesado.',
            data: {
                destinatarios: resultado.recipients.join(', '),
                messageId: resultado.messageId
            }
        });

    } catch (error) {
        console.error('❌ [EMAIL-CTRL] Error al enviar cotización por email:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en el servidor al enviar cotización por email',
            message: error.message
        });
    }
};

/**
 * Enviar Notificación general por Correo Electrónico (ej. aviso de stock disponible)
 * POST /api/facturacion/email/notificacion/enviar
 */
const enviarNotificacion = async (req, res) => {
    console.log('📧 [EMAIL-CTRL] Petición de envío de notificación por Email');

    try {
        const { clienteNombre, destinatarios, asunto, mensajeTexto } = req.body;

        let emailDestinos = '';
        if (Array.isArray(destinatarios)) {
            emailDestinos = destinatarios.map(e => String(e).trim()).filter(e => e.includes('@')).join(', ');
        } else if (typeof destinatarios === 'string') {
            emailDestinos = destinatarios.trim();
        }

        if (!emailDestinos) {
            return res.status(400).json({
                success: false,
                error: 'Sin contacto de correo',
                message: 'No hay direcciones de correo válidas especificadas.'
            });
        }

        if (!mensajeTexto || !mensajeTexto.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Sin mensaje',
                message: 'El contenido del mensaje de texto es obligatorio.'
            });
        }

        const htmlBody = emailService.obtenerPlantillaHtml({
            titulo: asunto || 'Aviso de Stock Disponible',
            clienteNombre: clienteNombre || 'Estimado Cliente',
            mensajePrincipal: mensajeTexto.replace(/\n/g, '<br>'),
            piePagina: 'Sistema LAMDA - Gestión Comercial y Depósito',
            mostrarTransferencia: false
        });

        const resultado = await emailService.enviarEmail({
            to: emailDestinos,
            subject: asunto || 'Aviso de Stock Disponible - LAMDA',
            htmlBody
        });

        res.json({
            success: true,
            message: 'Envío de notificación por correo procesado.',
            data: {
                destinatarios: resultado.recipients.join(', '),
                messageId: resultado.messageId
            }
        });

    } catch (error) {
        console.error('❌ [EMAIL-CTRL] Error al enviar notificación por email:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en el servidor al enviar notificación por email',
            message: error.message
        });
    }
};

module.exports = {
    enviarFactura,
    enviarResumenCuenta,
    enviarPresupuesto,
    enviarComprobante,
    enviarCotizacion,
    enviarNotificacion
};
