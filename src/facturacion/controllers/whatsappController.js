/**
 * Controlador para WhatsApp (Módulo Facturación)
 */

const { pool } = require('../config/database');
const whatsappService = require('../services/whatsappService');
const { generarPDF: generarPDFServicio } = require('../pdf/generador');
const facturaService = require('../services/facturaService');

/**
 * Obtener estado de conexión y código QR de WhatsApp
 */
const obtenerEstado = async (req, res) => {
    try {
        const info = whatsappService.obtenerEstado();
        res.json({
            success: true,
            data: info
        });
    } catch (error) {
        console.error('❌ [WHATSAPP-CTRL] Error al obtener estado:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener estado del servicio de WhatsApp',
            message: error.message
        });
    }
};

/**
 * Cerrar sesión activa de WhatsApp
 */
const cerrarSesion = async (req, res) => {
    try {
        const resultado = await whatsappService.cerrarSesion();
        if (resultado.success) {
            res.json({
                success: true,
                message: resultado.message
            });
        } else {
            res.status(400).json({
                success: false,
                error: resultado.error
            });
        }
    } catch (error) {
        console.error('❌ [WHATSAPP-CTRL] Error al cerrar sesión:', error);
        res.status(500).json({
            success: false,
            error: 'Error al cerrar sesión',
            message: error.message
        });
    }
};

/**
 * Enviar Factura PDF por WhatsApp
 * POST /api/facturacion/whatsapp/facturas/:id/enviar
 */
const enviarFactura = async (req, res) => {
    const { id } = req.params;
    console.log(`📱 [WHATSAPP-CTRL] Petición de envío para factura ID: ${id}`);

    try {
        // 1. Obtener la factura de la base de datos con datos completos (incluye razón social, descuento, etc.)
        const factura = await facturaService.obtenerPorId(parseInt(id));
        if (!factura) {
            return res.status(404).json({
                success: false,
                error: 'Factura no encontrada'
            });
        }

        if (!factura.cliente_id) {
            return res.status(400).json({
                success: false,
                error: 'La factura no tiene un cliente_id asociado'
            });
        }

        const items = factura.items;

        // 3. Resolver número telefónico de WhatsApp
        let whatsappDestinos = '';
        let origenContacto = '';

        // Si se proveen destinatarios explícitos en el request body (seleccionados en UI)
        let tieneDestinatariosBody = false;
        if (req.body && req.body.destinatarios !== undefined) {
            tieneDestinatariosBody = true;
            if (Array.isArray(req.body.destinatarios)) {
                whatsappDestinos = req.body.destinatarios.filter(n => n && String(n).trim().length > 0).join(', ');
            } else if (typeof req.body.destinatarios === 'string') {
                whatsappDestinos = req.body.destinatarios;
            }
            origenContacto = 'Selección interactiva (UI)';
        }

        if (!tieneDestinatariosBody && (!whatsappDestinos || !whatsappDestinos.trim())) {
            // Buscar primero en los clientes de Búnker locales
            const queryBunker = `
                SELECT codigo_bunker_cliente, cliente_nombre, whatsapp_facturas 
                FROM public.bunker_clientes 
                WHERE (CASE WHEN lomas_soft_id ~ '^\\d+$' THEN lomas_soft_id::integer ELSE NULL END) = $1
                LIMIT 1
            `;
            const resBunker = await pool.query(queryBunker, [parseInt(factura.cliente_id)]);

            if (resBunker.rows.length > 0 && resBunker.rows[0].whatsapp_facturas) {
                whatsappDestinos = resBunker.rows[0].whatsapp_facturas;
                origenContacto = `Búnker (${resBunker.rows[0].codigo_bunker_cliente})`;
            } else {
                // Fallback: buscar en la tabla general de clientes sincronizados de Lomasoft
                const queryLomas = 'SELECT telefono, celular FROM public.clientes WHERE cliente_id = $1 LIMIT 1';
                const resLomas = await pool.query(queryLomas, [parseInt(factura.cliente_id)]);

                if (resLomas.rows.length > 0) {
                    const c = resLomas.rows[0];
                    // Preferir celular si existe, si no, teléfono
                    whatsappDestinos = c.celular || c.telefono || '';
                    origenContacto = 'Lomasoft (Sincronizado)';
                }
            }

            // Si el valor está en formato JSON (contactos múltiples estructurados)
            if (whatsappDestinos && whatsappDestinos.trim().startsWith('[')) {
                try {
                    const contactos = JSON.parse(whatsappDestinos);
                    
                    // Filtrar contactos:
                    // 1. Aquellos que tengan default_factura === true
                    // 2. Si hay configuración explícita guardada pero todos false, enviar a ninguno
                    // 3. Si ninguno, aquellos que tengan default === true
                    // 4. Si ninguno, todos
                    const hasTypeDefault = contactos.some(c => c.default_factura === true);
                    const hasWpConfig = contactos.some(c => c.default_factura !== undefined);
                    const hasGeneralDefault = !hasTypeDefault && contactos.some(c => c.default === true);
                    
                    let filteredContactos = [];
                    if (hasTypeDefault) {
                        filteredContactos = contactos.filter(c => c.default_factura === true);
                    } else if (hasWpConfig) {
                        filteredContactos = []; // Configured but unchecked all
                    } else if (hasGeneralDefault) {
                        filteredContactos = contactos.filter(c => c.default === true);
                    } else {
                        filteredContactos = contactos;
                    }
                    
                    whatsappDestinos = filteredContactos.map(c => c.numero).filter(n => n && n.trim()).join(', ');
                } catch (err) {
                    console.error('❌ [WHATSAPP-CTRL] Error parseando JSON de contactos:', err.message);
                }
            }
        }

        if (!whatsappDestinos || !whatsappDestinos.trim()) {
            if (tieneDestinatariosBody) {
                return res.json({
                    success: true,
                    message: 'No se seleccionaron destinatarios de WhatsApp. Envío omitido.',
                    data: { destinatarios: '', origen: origenContacto }
                });
            }
            return res.status(400).json({
                success: false,
                error: 'Sin contacto',
                message: 'No hay números de WhatsApp configurados para este cliente. Por favor, edite la ficha del cliente en la sección de Clientes de Búnker.'
            });
        }

        // 4. Generar buffer del PDF
        console.log(`📄 [WHATSAPP-CTRL] Generando PDF para Factura ID ${id}...`);
        const pdfBuffer = await generarPDFServicio(factura, items);

        // Formatear número de factura amigable (ej: "0032-00000005")
        const ptoVtaPad = String(factura.pto_vta || '0').padStart(4, '0');
        const cbtePad = String(factura.cbte_nro || factura.nro_interno || id).padStart(8, '0');
        const nroComp = `${ptoVtaPad}-${cbtePad}`;

        // 5. Enviar por WhatsApp usando el servicio
        const envios = await whatsappService.enviarFacturaPdf(factura.id, pdfBuffer, whatsappDestinos, nroComp, req.body.mensajeTexto);

        const fallidos = envios.filter(e => !e.success);
        
        if (fallidos.length === envios.length) {
            // Todos fallaron
            return res.status(502).json({
                success: false,
                error: 'Error al enviar por WhatsApp',
                detalles: envios
            });
        }

        // Marcar factura como enviada en DB
        try {
            await pool.query(
                `UPDATE public.factura_facturas 
                 SET es_enviado = true, enviado_at = NOW(), 
                     enviado_canal = CASE WHEN enviado_canal IS NULL OR enviado_canal = '' THEN 'WhatsApp' ELSE enviado_canal || ', WhatsApp' END 
                 WHERE id = $1`,
                [factura.id]
            );
        } catch (dbErr) {
            console.warn('⚠️ No se pudo actualizar flag es_enviado en DB:', dbErr.message);
        }

        res.json({
            success: true,
            message: 'Envío de WhatsApp procesado.',
            data: {
                destinatarios: whatsappDestinos,
                origen: origenContacto,
                resultados: envios
            }
        });

    } catch (error) {
        console.error(`❌ [WHATSAPP-CTRL] Error al enviar factura ID ${id}:`, error);
        res.status(500).json({
            success: false,
            error: 'Error interno en el servidor al enviar por WhatsApp',
            message: error.message
        });
    }
};

/**
 * Enviar un documento PDF genérico por WhatsApp
 * POST /api/facturacion/whatsapp/enviar-documento
 */
const enviarDocumento = async (req, res) => {
    console.log('📱 [WHATSAPP-CTRL] Petición de envío de documento genérico');
    
    try {
        const { destinatarios, pdfBase64, filename, mensajeTexto } = req.body;
        const destinatariosStr = Array.isArray(destinatarios)
            ? destinatarios.map(n => String(n).trim()).filter(Boolean).join(', ')
            : String(destinatarios || '').trim();
        
        if (!destinatariosStr) {
            return res.status(400).json({
                success: false,
                error: 'Faltan destinatarios',
                message: 'Por favor, especifique el número o números de teléfono de destino.'
            });
        }
        
        const cleanBase64 = String(pdfBase64 || '').replace(/^data:[^;]+;base64,/, '').trim();
        if (!cleanBase64) {
            return res.status(400).json({
                success: false,
                error: 'Falta documento',
                message: 'No se recibió el documento PDF en formato Base64.'
            });
        }
        
        if (!filename || !filename.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Falta nombre de archivo',
                message: 'No se recibió el nombre para el archivo PDF.'
            });
        }
        
        // Convertir Base64 a Buffer
        const pdfBuffer = Buffer.from(cleanBase64, 'base64');
        
        // Despachar el envío por el servicio
        console.log(`📱 [WHATSAPP-CTRL] Despachando documento "${filename}" a destinatario(s): ${destinatariosStr}`);
        const envios = await whatsappService.enviarDocumentoPdf(
            pdfBuffer,
            destinatariosStr,
            filename,
            mensajeTexto || 'Te enviamos el documento solicitado. Saludos.'
        );
        
        const fallidos = envios.filter(e => !e.success);
        
        if (fallidos.length === envios.length) {
            // Todos fallaron
            return res.status(502).json({
                success: false,
                error: 'Error al enviar por WhatsApp',
                detalles: envios
            });
        }
        
        res.json({
            success: true,
            message: 'Envío de WhatsApp de documento procesado.',
            data: {
                destinatarios,
                resultados: envios
            }
        });
        
    } catch (error) {
        console.error('❌ [WHATSAPP-CTRL] Error al enviar documento:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en el servidor al enviar por WhatsApp',
            message: error.message
        });
    }
};

/**
 * Enviar un mensaje de texto plano por WhatsApp
 * POST /api/facturacion/whatsapp/enviar-mensaje
 */
const enviarMensaje = async (req, res) => {
    console.log('📱 [WHATSAPP-CTRL] Petición de envío de mensaje de texto plano');
    
    try {
        const { destinatarios, mensajeTexto } = req.body;
        
        let destinatariosStr = '';
        if (Array.isArray(destinatarios)) {
            destinatariosStr = destinatarios.map(n => String(n).trim()).filter(n => n.length > 0).join(', ');
        } else if (typeof destinatarios === 'string') {
            destinatariosStr = destinatarios.trim();
        }
        
        if (!destinatariosStr) {
            return res.status(400).json({
                success: false,
                error: 'Faltan destinatarios',
                message: 'Por favor, especifique el número o números de teléfono de destino.'
            });
        }
        
        if (!mensajeTexto || !mensajeTexto.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Falta mensaje de texto',
                message: 'El contenido del mensaje de texto es obligatorio.'
            });
        }
        
        // Despachar el envío por el servicio
        console.log(`📱 [WHATSAPP-CTRL] Despachando mensaje de texto a destinatario(s): ${destinatariosStr}`);
        const envios = await whatsappService.enviarMensajeTexto(destinatariosStr, mensajeTexto);
        
        const fallidos = envios.filter(e => !e.success);
        
        if (fallidos.length === envios.length) {
            // Todos fallaron
            return res.status(502).json({
                success: false,
                error: 'Error al enviar por WhatsApp',
                detalles: envios
            });
        }
        
        res.json({
            success: true,
            message: 'Envío de WhatsApp de mensaje de texto procesado.',
            data: {
                destinatarios,
                resultados: envios
            }
        });
        
    } catch (error) {
        console.error('❌ [WHATSAPP-CTRL] Error al enviar mensaje de texto:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en el servidor al enviar por WhatsApp',
            message: error.message
        });
    }
};

/**
 * Enviar una imagen en base64 por WhatsApp
 * POST /api/facturacion/whatsapp/enviar-imagen
 */
const enviarImagen = async (req, res) => {
    console.log('📱 [WHATSAPP-CTRL] Petición de envío de imagen Base64');
    try {
        const { destinatarios, base64Data, mimeType, filename, mensajeTexto } = req.body;
        
        if (!destinatarios || !destinatarios.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Faltan destinatarios',
                message: 'Por favor, especifique el número o números de teléfono de destino.'
            });
        }
        
        if (!base64Data || !base64Data.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Falta imagen',
                message: 'No se recibió la imagen en formato Base64.'
            });
        }
        
        const envios = await whatsappService.enviarImagenBase64(
            destinatarios,
            base64Data,
            mimeType || 'image/jpeg',
            filename || 'imagen.jpg',
            mensajeTexto || ''
        );
        
        const fallidos = envios.filter(e => !e.success);
        if (fallidos.length === envios.length) {
            return res.status(502).json({
                success: false,
                error: 'Error al enviar por WhatsApp',
                detalles: envios
            });
        }
        
        res.json({
            success: true,
            message: 'Envío de WhatsApp de imagen procesado.',
            data: {
                destinatarios,
                resultados: envios
            }
        });
    } catch (error) {
        console.error('❌ [WHATSAPP-CTRL] Error al enviar imagen Base64:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en el servidor al enviar por WhatsApp',
            message: error.message
        });
    }
};

/**
 * Iniciar o forzar la conexión de WhatsApp
 */
const conectar = async (req, res) => {
    try {
        const force = req.body && req.body.force === true;
        console.log(`📱 [WHATSAPP-CTRL] Petición de conexión (force: ${force})`);
        whatsappService.inicializarWhatsApp(force);
        res.json({
            success: true,
            message: 'Proceso de conexión de WhatsApp iniciado.'
        });
    } catch (error) {
        console.error('❌ [WHATSAPP-CTRL] Error al conectar WhatsApp:', error);
        res.status(500).json({
            success: false,
            error: 'Error al iniciar conexión de WhatsApp',
            message: error.message
        });
    }
};

/**
 * Sincronizar chats recientes de WhatsApp Web con la base local CRM
 */
const sincronizarChats = async (req, res) => {
    try {
        const maxChats = parseInt(req.body?.maxChats) || 45;
        const mensajesPorChat = parseInt(req.body?.mensajesPorChat) || 15;
        const marcarVistoChatId = req.body?.marcarVistoChatId || null;
        const resultado = await whatsappService.sincronizarChatsRecientes({ maxChats, mensajesPorChat, marcarVistoChatId });
        res.json(resultado);
    } catch (error) {
        console.error('❌ [WHATSAPP-CTRL] Error sincronizando chats:', error);
        res.status(500).json({
            success: false,
            error: 'Error al sincronizar chats de WhatsApp',
            message: error.message
        });
    }
};

/**
 * Transcribir mensajes de audio (ptt / audio) de un chat específico bajo demanda
 */
const transcribirAudiosChat = async (req, res) => {
    try {
        const chatId = req.body?.chatId || req.query?.chatId || null;
        const msgIds = Array.isArray(req.body?.msgIds) ? req.body.msgIds : [];
        const maxAudios = parseInt(req.body?.maxAudios) || 4;
        const resultado = await whatsappService.transcribirAudiosDeChat({ chatId, msgIds, maxAudios });
        res.json(resultado);
    } catch (error) {
        console.error('❌ [WHATSAPP-CTRL] Error transcribiendo audios del chat:', error);
        res.status(500).json({
            success: false,
            error: 'Error al transcribir audios de WhatsApp',
            message: error.message
        });
    }
};

module.exports = {
    obtenerEstado,
    cerrarSesion,
    enviarFactura,
    enviarDocumento,
    enviarMensaje,
    enviarImagen,
    conectar,
    sincronizarChats,
    transcribirAudiosChat
};
