/**
 * Servicio de Integración de WhatsApp (Módulo Facturación)
 * Utiliza whatsapp-web.js para levantar un cliente headless de WhatsApp Web y enviar PDFs.
 */

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const crmWhatsappDb = require('../../services/crmWhatsappDbService');
const whatsappAudioTranscriber = require('../../services/whatsappAudioTranscriberService');

const _audiosEnTranscripcion = new Set();
const _audiosYaTranscritos = new Set();

// Asegurar tablas CRM al cargar el servicio
crmWhatsappDb.asegurarTablasCrmWhatsapp().catch(() => {});


function esModoLaboratorioWa() {
    const dbName = String(process.env.DB_NAME || '').trim().toLowerCase();
    const flagLab = String(process.env.LAMDA_MODO_LABORATORIO || '').trim().toLowerCase();
    return dbName === 'etiquetas_pruebas' || flagLab === 'true' || flagLab === '1';
}

function esModoEspejoWa() {
    const flagEspejo = String(process.env.WHATSAPP_MODO_ESPEJO || '').trim().toLowerCase();
    return flagEspejo === 'true' || flagEspejo === '1';
}

function interceptarEnvioEnModoSeguro(numeros, tipoEnvio, detalle = '') {
    if (!esModoLaboratorioWa() && !esModoEspejoWa()) return null;
    const modo = esModoLaboratorioWa() ? 'MODO_LABORATORIO (etiquetas_pruebas)' : 'WHATSAPP_MODO_ESPEJO (Fase 3)';
    const lista = String(numeros || '')
        .split(',')
        .map(n => n.replace(/[^0-9]/g, '').trim())
        .filter(Boolean);
    console.log(`🔒 [WHATSAPP-GUARD] Envío real de ${tipoEnvio} BLOQUEADO preventivamente por ${modo}. Destinatarios simulados: [${lista.join(', ')}] ${detalle}`);
    return lista.map(numero => ({
        numero,
        success: true,
        simulated: true,
        blockedByGuard: modo
    }));
}

let client = null;
let qrCodeDataUrl = null;
let connectionStatus = 'DESCONECTADO'; // 'DESCONECTADO', 'ESPERANDO_QR', 'CONECTADO', 'CONECTANDO'
let connectionStep = 0;
let connectionStepText = '';
let lastError = null;
let initializeTimeout = null;

/**
 * Limpiar lockfiles residuales físicos en disco de Chromium
 */
const limpiarLockFiles = (sessionPath) => {
    try {
        if (!fs.existsSync(sessionPath)) return;
        const lockFiles = ['lockfile', 'SingletonLock', 'SingletonCookie', 'Singleton Socket'];
        lockFiles.forEach(file => {
            const filePath = path.join(sessionPath, file);
            if (fs.existsSync(filePath)) {
                try {
                    console.log(`🧹 [WHATSAPP-SERVICE] Eliminando lockfile residual: ${file}`);
                    fs.unlinkSync(filePath);
                } catch (e) {
                    console.warn(`⚠️ [WHATSAPP-SERVICE] No se pudo eliminar lockfile ${file}:`, e.message);
                }
            }
        });
        const files = fs.readdirSync(sessionPath);
        files.forEach(file => {
            if (file.toLowerCase().includes('lock')) {
                const filePath = path.join(sessionPath, file);
                try {
                    const stat = fs.statSync(filePath);
                    if (stat.isFile()) {
                        console.log(`🧹 [WHATSAPP-SERVICE] Eliminando residuo de lock encontrado: ${file}`);
                        fs.unlinkSync(filePath);
                    }
                } catch (e) {
                    // Ignorar
                }
            }
        });
    } catch (err) {
        console.error('⚠️ [WHATSAPP-SERVICE] Error en limpieza de lockfiles:', err.message);
    }
};

/**
 * Forzar el cierre de cualquier proceso de Chrome huérfano que retenga los candados
 * sobre el directorio de sesión session-lamda-billing en Windows.
 */
const killZombieChrome = () => {
    return new Promise((resolve) => {
        if (process.platform !== 'win32') {
            return resolve();
        }
        
        console.log('🧹 [WHATSAPP-SERVICE] Buscando procesos de Chrome huérfanos con candados de sesión...');
        
        // Buscamos procesos chrome.exe o chromium.exe que contengan 'session-lamda-billing' en su línea de comandos de lanzamiento
        const cmd = `powershell -Command "Get-CimInstance Win32_Process -Filter \\"Name = 'chrome.exe' OR Name = 'chromium.exe'\\" | Where-Object CommandLine -like '*session-lamda-billing*' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`;
        
        exec(cmd, (err, stdout, stderr) => {
            if (err) {
                console.warn('⚠️ [WHATSAPP-SERVICE] No se pudieron limpiar procesos de Chrome huérfanos:', err.message);
            } else {
                console.log('✅ [WHATSAPP-SERVICE] Limpieza de procesos zombies de Chrome completada con éxito.');
            }
            resolve();
        });
    });
};

/**
 * Inicializar cliente de WhatsApp
 */
async function inicializarWhatsApp(force = false, isFallback = false) {
    if (connectionStatus === 'CONECTANDO' || connectionStatus === 'CONECTADO' || connectionStatus === 'ESPERANDO_QR') {
        if (!force && !isFallback) {
            console.log(`🔌 [WHATSAPP-SERVICE] El servicio ya está en estado ${connectionStatus}. Omitiendo inicialización.`);
            return { success: true, status: connectionStatus, message: 'Servicio ya activo o en proceso.' };
        }
        console.log('🔌 [WHATSAPP-SERVICE] Forzando reinicio de servicio...');
        await shutdown();
    }

    console.log(`🔌 [WHATSAPP-SERVICE] Iniciando servicio de WhatsApp (isFallback: ${isFallback})...`);
    connectionStatus = 'CONECTANDO';
    connectionStep = 1;
    connectionStepText = '[Paso 1/4] Iniciando entorno del navegador interno...';
    qrCodeDataUrl = null;
    lastError = null;

    // 🧹 Matar instancias huérfanas de Chrome para evitar bloqueos en el sistema de archivos
    await killZombieChrome();

    try {
        // Asegurar que exista la carpeta de auth
        const authPath = path.join(__dirname, '../.wwebjs_auth');
        if (!fs.existsSync(authPath)) {
            fs.mkdirSync(authPath, { recursive: true });
        }

        const sessionPath = path.join(authPath, 'session-lamda-billing');

        if (force) {
            console.log('🧹 [WHATSAPP-SERVICE] Forzando limpieza de sesión en disco por reinicio manual...');
            try {
                if (fs.existsSync(sessionPath)) {
                    fs.rmSync(sessionPath, { recursive: true, force: true });
                }
            } catch (e) {
                console.warn('⚠️ [WHATSAPP-SERVICE] No se pudo limpiar la sesión en disco:', e.message);
            }
        }

        // Determinar si una sesión previa existe para inicializar
        const sessionExistsAfterForce = fs.existsSync(sessionPath);

        // Limpiar lockfiles residuales si existen
        limpiarLockFiles(sessionPath);

        client = new Client({
            authStrategy: new LocalAuth({
                clientId: 'lamda-billing',
                dataPath: authPath
            }),
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
            webVersionCache: {
                type: 'local'
            },
            puppeteer: {
                headless: true,
                protocolTimeout: 120000,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
                    '--disable-extensions',
                    '--disable-background-networking',
                    '--disable-default-apps',
                    '--disable-sync',
                    '--disable-translate',
                    '--hide-scrollbars',
                    '--metrics-recording-only',
                    '--mute-audio',
                    '--safebrowsing-disable-auto-update'
                ]
            }
        });

        const clearInitTimeout = () => {
            if (initializeTimeout) {
                clearTimeout(initializeTimeout);
                initializeTimeout = null;
            }
        };

        // Configurar Event Listeners
        client.on('qr', async (qr) => {
            console.log('📱 [WHATSAPP-SERVICE] Nuevo código QR recibido. Generando Data URL...');
            clearInitTimeout();
            connectionStatus = 'ESPERANDO_QR';
            connectionStep = 4;
            connectionStepText = '[Paso 4/4] ¡Listo! Renderizando QR en pantalla.';
            try {
                qrCodeDataUrl = await qrcode.toDataURL(qr);
            } catch (err) {
                console.error('❌ [WHATSAPP-SERVICE] Error generando QR Data URL:', err.message);
            }
        });

        client.on('ready', () => {
            console.log('✅ [WHATSAPP-SERVICE] Cliente de WhatsApp Web listo y conectado.');
            clearInitTimeout();
            connectionStatus = 'CONECTADO';
            connectionStep = 4;
            connectionStepText = '¡Listo! Dispositivo conectado.';
            qrCodeDataUrl = null;

            if (esModoEspejoWa() || esModoLaboratorioWa()) {
                console.log("🔒 [WHATSAPP-GUARD] Modo Espejo/Laboratorio activo: se omite sincronización CRM en segundo plano para evitar colisiones.");
                return;
            }
            // Sincronizar en segundo plano los chats recientes con clientes Búnker al conectar
            setTimeout(() => {
                sincronizarChatsRecientes({ maxChats: 45, mensajesPorChat: 15 }).catch(err => {
                    console.warn('⚠️ [WHATSAPP-SERVICE] Error en sincronización inicial CRM:', err.message);
                });
            }, 4000);

            // Sincronización periódica ligera de estado "No Leído / Visto" (unreadCount) desde el teléfono
            iniciarMonitorNoLeidos();
        });

        // 💬 Escucha bidireccional en tiempo real (Mensajes entrantes de clientes + salientes desde tu celular o sistema)
        client.on('message_create', async (msg) => {
            try {
                if (!msg) return;
                let chatId = msg.fromMe ? msg.to : msg.from;
                if (!chatId || chatId.endsWith('@g.us') || chatId.includes('broadcast') || chatId.endsWith('@newsletter')) {
                    return;
                }

                let pushnameWa = !msg.fromMe ? (msg._data?.notifyName || null) : null;

                // Si WhatsApp entrega un JID @lid (Linked Identity), resolver su número telefónico @c.us real desde WAWebChatCollection
                if (chatId.endsWith('@lid') && client && client.pupPage) {
                    try {
                        const resolved = await client.pupPage.evaluate((lid) => {
                            try {
                                const ChatCollection = window.require('WAWebChatCollection').ChatCollection;
                                const chat = ChatCollection.get(lid);
                                if (chat && chat.contact && chat.contact.phoneNumber) {
                                    return {
                                        phone: chat.contact.phoneNumber._serialized || (chat.contact.phoneNumber.user + '@c.us'),
                                        name: chat.name || chat.formattedTitle || null
                                    };
                                }
                            } catch (e) {}
                            return null;
                        }, chatId);
                        if (resolved && resolved.phone) {
                            chatId = resolved.phone;
                            if (!pushnameWa && resolved.name) pushnameWa = resolved.name;
                        }
                    } catch (eLid) {}
                }

                const timestampMs = msg.timestamp ? msg.timestamp * 1000 : Date.now();
                const rawBody = (msg.type === 'chat' ? msg.body : (msg._data?.caption || msg.body || '')) || '';
                const cuerpo = String(rawBody).startsWith('/9j/') ? (msg._data?.caption || '') : rawBody;
                const cleanMsgId = msg.id?.id || (msg.id?._serialized ? String(msg.id._serialized).split('_').pop() : null);

                const resRegMsg = await crmWhatsappDb.registrarMensajeWhatsapp({
                    msgId: cleanMsgId,
                    chatId,
                    telefono: chatId,
                    fromMe: Boolean(msg.fromMe),
                    cuerpo,
                    tipoMensaje: msg.type || 'chat',
                    mediaFilename: msg._data?.filename || null,
                    mediaMimetype: msg._data?.mimetype || null,
                    ack: typeof msg.ack === 'number' ? msg.ack : 1,
                    pushnameWa,
                    origenEnvio: msg.fromMe ? 'celular_o_sistema' : 'cliente',
                    timestampMs
                });

                // 🎙️ Solo transcribir automáticamente en segundo plano si es un audio ENTRANTE (!msg.fromMe)
                // y pertenece estrictamente a un Cliente Búnker (nunca chats personales ni audios propios)
                const directPathAudio = msg._data?.directPath || msg.directPath || null;
                const mediaKeyAudio = msg._data?.mediaKey || msg.mediaKey || null;
                if (
                    !msg.fromMe &&
                    resRegMsg &&
                    resRegMsg.es_cliente_bunker &&
                    (msg.type === 'ptt' || msg.type === 'audio') &&
                    cleanMsgId &&
                    directPathAudio &&
                    mediaKeyAudio
                ) {
                    enfilelarTranscripcionAudioWa({
                        msgId: cleanMsgId,
                        chatId,
                        directPath: directPathAudio,
                        mediaKey: mediaKeyAudio
                    });
                }
            } catch (errMsg) {
                console.warn('⚠️ [WHATSAPP-SERVICE] Error procesando message_create para CRM:', errMsg.message);
            }
        });

        // ✓✓ Escucha de confirmación de entrega y lectura (Tilde simple, doble tilde, doble tilde azul)
        client.on('message_ack', async (msg, ack) => {
            try {
                if (!msg || !msg.id?._serialized) return;
                const chatId = msg.fromMe ? msg.to : msg.from;
                await crmWhatsappDb.actualizarAckMensaje(msg.id._serialized, chatId, ack);
            } catch (errAck) {
                console.warn('⚠️ [WHATSAPP-SERVICE] Error procesando message_ack para CRM:', errAck.message);
            }
        });

        client.on('authenticated', () => {
            console.log('🔒 [WHATSAPP-SERVICE] Cliente autenticado.');
            clearInitTimeout();
            connectionStatus = 'CONECTANDO';
            connectionStep = 4;
            connectionStepText = 'Autenticado. Sincronizando chats y preparando sesión...';
            qrCodeDataUrl = null;
        });

        client.on('auth_failure', async (msg) => {
            console.error('❌ [WHATSAPP-SERVICE] Fallo de autenticación:', msg);
            clearInitTimeout();
            connectionStatus = 'DESCONECTADO';
            connectionStep = 0;
            connectionStepText = `Fallo de autenticación: ${msg}`;
            lastError = msg;
            qrCodeDataUrl = null;
            await shutdown();
        });

        client.on('disconnected', async (reason) => {
            console.log('❌ [WHATSAPP-SERVICE] El dispositivo se desconectó:', reason);
            clearInitTimeout();
            connectionStatus = 'DESCONECTADO';
            connectionStep = 0;
            connectionStepText = 'Dispositivo desconectado.';
            qrCodeDataUrl = null;
            
            await shutdown();

            // Re-inicializar después de 10 segundos ante caída
            setTimeout(() => {
                if (connectionStatus === 'DESCONECTADO') {
                    console.log('🔄 [WHATSAPP-SERVICE] Intentando reconexión automática...');
                    inicializarWhatsApp(false);
                }
            }, 10000);
        });

        // Configurar el timeout de inicialización (120s si existía sesión previa, 60s si es limpia)
        const initTimeoutMs = sessionExistsAfterForce ? 120000 : 60000;
        initializeTimeout = setTimeout(async () => {
            if (connectionStatus === 'CONECTANDO') {
                console.error(`❌ [WHATSAPP-SERVICE] Tiempo de espera de inicialización agotado (${initTimeoutMs / 1000}s).`);
                
                if (sessionExistsAfterForce && !isFallback) {
                    console.log('🔄 [WHATSAPP-SERVICE] Detectada lentitud al restaurar la sesión previa. Reintentando iniciar conexión...');
                    connectionStatus = 'DESCONECTADO'; // Forzar reseteo de estado para re-inicializar
                    connectionStepText = 'Tiempo de espera agotado. Reintentando conectar...';
                    await shutdown();
                    
                    inicializarWhatsApp(false, true);
                } else {
                    connectionStatus = 'DESCONECTADO';
                    connectionStep = 0;
                    connectionStepText = `Error: Tiempo de espera agotado (${initTimeoutMs / 1000}s).`;
                    lastError = `Tiempo de espera de inicialización agotado (${initTimeoutMs / 1000}s). Por favor reintente la conexión.`;
                    await shutdown();
                }
            }
        }, initTimeoutMs);

        connectionStep = 2;
        connectionStepText = '[Paso 2/4] Conectando con los servidores de WhatsApp Web...';
        console.log('📱 [WHATSAPP-SERVICE] ' + connectionStepText);

        // Timer para Paso 3 (espera de QR)
        setTimeout(() => {
            if (connectionStatus === 'CONECTANDO' && connectionStep === 2) {
                connectionStep = 3;
                connectionStepText = '[Paso 3/4] Esperando generación de código QR de sincronización...';
                console.log('📱 [WHATSAPP-SERVICE] ' + connectionStepText);
            }
        }, 5000);

        client.initialize().catch(async err => {
            console.error('❌ [WHATSAPP-SERVICE] Error en initialize():', err.message);
            clearInitTimeout();
            connectionStatus = 'DESCONECTADO';
            connectionStep = 0;
            connectionStepText = `Error al inicializar: ${err.message}`;
            lastError = err.message;
            await shutdown();
        });

    } catch (error) {
        console.error('❌ [WHATSAPP-SERVICE] Error inicializando WhatsApp:', error.message);
        clearInitTimeout();
        connectionStatus = 'DESCONECTADO';
        connectionStep = 0;
        connectionStepText = `Error: ${error.message}`;
        lastError = error.message;
    }
}

/**
 * Obtener estado de la conexión y QR activo
 */
const obtenerEstado = () => {
    return {
        status: connectionStatus,
        qr: qrCodeDataUrl,
        step: connectionStep,
        stepText: connectionStepText,
        error: lastError
    };
};

/**
 * Desconectar sesión activa y borrar credenciales locales
 */
const cerrarSesion = async () => {
    console.log('🔌 [WHATSAPP-SERVICE] Solicitando cierre de sesión...');
    
    // Apagar cliente primero
    await shutdown();

    // 🧹 Matar procesos zombies remanentes para liberar el candado sobre el disco
    await killZombieChrome();

    // Borrar físicamente el directorio de sesión para forzar una limpieza completa
    const authPath = path.join(__dirname, '../.wwebjs_auth');
    const sessionPath = path.join(authPath, 'session-lamda-billing');
    try {
        if (fs.existsSync(sessionPath)) {
            console.log('🧹 [WHATSAPP-SERVICE] Borrando sesión en disco:', sessionPath);
            fs.rmSync(sessionPath, { recursive: true, force: true });
        }
    } catch (e) {
        console.error('❌ [WHATSAPP-SERVICE] No se pudo borrar el directorio de sesión:', e.message);
    }

    connectionStatus = 'DESCONECTADO';
    qrCodeDataUrl = null;
    connectionStep = 0;
    connectionStepText = 'Sesión cerrada y limpiada.';

    return { success: true, message: 'Sesión cerrada y limpiada con éxito.' };
};

/**
 * Sanitizar número telefónico argentino y resolver JID canónico de WhatsApp
 */
async function resolverChatId(numero) {
    let sanitizado = String(numero).replace(/[^0-9]/g, '').trim();
    if (sanitizado.length === 10) {
        sanitizado = '549' + sanitizado;
    } else if (sanitizado.length === 11 && sanitizado.startsWith('15')) {
        sanitizado = '549' + sanitizado.substring(2);
    } else if (sanitizado.length === 11 && sanitizado.startsWith('0')) {
        sanitizado = '549' + sanitizado.substring(1);
    } else if (sanitizado.length === 11 && !sanitizado.startsWith('54')) {
        sanitizado = '54' + sanitizado;
    } else if (sanitizado.length === 12 && sanitizado.startsWith('9')) {
        sanitizado = '54' + sanitizado;
    }

    let targetChatId = `${sanitizado}@c.us`;
    let numberExists = true;
    try {
        if (client) {
            const numberDetails = await client.getNumberId(sanitizado);
            if (numberDetails && numberDetails._serialized) {
                targetChatId = numberDetails._serialized;
            } else if (numberDetails === null) {
                numberExists = false;
            }
        }
    } catch (idErr) {
        console.warn(`⚠️ [WHATSAPP-SERVICE] Error getNumberId para ${sanitizado}:`, idErr.message);
    }
    if (!numberExists) {
        throw new Error(`El número +${sanitizado} no tiene una cuenta de WhatsApp activa (verificá si es un teléfono fijo o si el contacto cambió de número).`);
    }
    return { sanitizado, targetChatId, canonicalChatId: `${sanitizado}@c.us` };
}

/**
 * Enviar Factura PDF a una lista de números telefónicos
 * 
 * @param {number|string} facturaId - ID de la factura
 * @param {Buffer} pdfBuffer - Buffer del PDF generado
 * @param {string} numeros - Números telefónicos separados por comas
 * @param {string} [nroComprobante] - Número de comprobante formateado (ej: "0032-00000005")
 * @returns {Promise<Array>} Resultados del envío por cada número
 */
const enviarFacturaPdf = async (facturaId, pdfBuffer, numeros, nroComprobante = '', mensajeTextoCustom = null) => {
    const simRes = interceptarEnvioEnModoSeguro(numeros, "FACTURA_PDF", `Factura #${nroComprobante || facturaId}`);
    if (simRes) return simRes;
    if (connectionStatus !== 'CONECTADO') {
        throw new Error('El servicio de WhatsApp no está conectado. Por favor, vincule su dispositivo primero desde el panel.');
    }

    if (!numeros || !numeros.trim()) {
        throw new Error('No se especificaron números telefónicos de destino.');
    }

    const listaNumeros = numeros.split(',')
        .map(n => n.replace(/[^0-9]/g, '').trim())
        .filter(n => n.length > 0);

    if (listaNumeros.length === 0) {
        throw new Error('Ninguno de los números telefónicos provistos es válido.');
    }

    console.log(`📱 [WHATSAPP-SERVICE] Enviando PDF de Factura ID ${facturaId} a ${listaNumeros.length} destinatarios.`);

    // Obtener datos de la factura para personalizar mensaje
    let pto_vta = 32;
    let tipo_cbte = 6;
    try {
        const { pool } = require('../config/database');
        const resFactura = await pool.query('SELECT pto_vta, tipo_cbte FROM factura_facturas WHERE id = $1', [facturaId]);
        if (resFactura.rows.length > 0) {
            pto_vta = resFactura.rows[0].pto_vta;
            tipo_cbte = resFactura.rows[0].tipo_cbte;
        }
    } catch (err) {
        console.warn('⚠️ [WHATSAPP-SERVICE] No se pudo obtener datos de factura:', err.message);
    }

    const isNC = [3, 8, 13].includes(parseInt(tipo_cbte));
    const label = pto_vta === 90 ? (isNC ? 'nota_credito_entrega' : 'presupuesto_aprobado') : (isNC ? 'nota_credito' : 'factura');
    const filename = `${label}-${nroComprobante || facturaId}.pdf`;
    const media = new MessageMedia('application/pdf', pdfBuffer.toString('base64'), filename);

    const transferInfo = '\n\n*Datos para transferencia:*\n*Banco:* Banco Galicia\n*Cuenta (CTA):* 4007844-1 373-4\n*CBU:* 0070373230004007844141\n*Alias:* lamda.ser.martin';
    let mensajeTexto = mensajeTextoCustom;
    if (!mensajeTexto) {
        if (isNC) {
            mensajeTexto = 'Te enviamos la nota de crédito emitida por Lamda. Saludos, muchas gracias.';
        } else if (pto_vta === 90) {
            mensajeTexto = 'Te enviamos el presupuesto aprobado interno.' + transferInfo;
        } else {
            mensajeTexto = 'Te enviamos la factura emitida por Lamda. Saludos, muchas gracias.' + transferInfo;
        }
    }

    const resultados = [];

    for (let numero of listaNumeros) {
        try {
            const { sanitizado, targetChatId, canonicalChatId } = await resolverChatId(numero);
            console.log(`📱 [WHATSAPP-SERVICE] Enviando mensaje con adjunto a: ${targetChatId}`);

            // Enviar mensaje con adjunto y texto como caption
            const sentMsg = await client.sendMessage(targetChatId, media, { caption: mensajeTexto, sendMediaAsDocument: true });
            
            crmWhatsappDb.registrarMensajeWhatsapp({
                msgId: sentMsg?.id?._serialized || null,
                chatId: canonicalChatId || `${sanitizado}@c.us`,
                telefono: sanitizado,
                fromMe: true,
                cuerpo: `📄 [${filename}] ${mensajeTexto || ''}`.trim(),
                tipoMensaje: 'document',
                mediaFilename: filename,
                mediaMimetype: 'application/pdf',
                ack: 1,
                origenEnvio: 'lamda_factura'
            }).catch(() => {});

            console.log(`✅ [WHATSAPP-SERVICE] Enviado con éxito a: ${sanitizado}`);
            resultados.push({ numero: sanitizado, success: true });
        } catch (err) {
            console.error(`❌ [WHATSAPP-SERVICE] Error enviando a ${numero}:`, err.message);
            resultados.push({ numero, success: false, error: err.message });
        }
    }

    return resultados;
};

/**
 * Enviar un documento PDF genérico a una lista de números telefónicos
 * 
 * @param {Buffer} pdfBuffer - Buffer del PDF
 * @param {string} numeros - Números telefónicos separados por comas
 * @param {string} filename - Nombre del archivo PDF (ej: "reporte.pdf")
 * @param {string} [mensajeTexto] - Mensaje a adjuntar
 * @returns {Promise<Array>} Resultados del envío por cada número
 */
const enviarDocumentoPdf = async (pdfBuffer, numeros, filename, mensajeTexto = 'Te enviamos el documento solicitado. Saludos.') => {
    const simRes = interceptarEnvioEnModoSeguro(numeros, "DOCUMENTO_PDF", filename);
    if (simRes) return simRes;
    if (connectionStatus !== 'CONECTADO') {
        throw new Error('El servicio de WhatsApp no está conectado. Por favor, vincule su dispositivo primero desde el panel.');
    }

    if (!numeros || !numeros.trim()) {
        throw new Error('No se especificaron números telefónicos de destino.');
    }

    const listaNumeros = numeros.split(',')
        .map(n => n.replace(/[^0-9]/g, '').trim())
        .filter(n => n.length > 0);

    if (listaNumeros.length === 0) {
        throw new Error('Ninguno de los números telefónicos provistos es válido.');
    }

    console.log(`📱 [WHATSAPP-SERVICE] Enviando PDF genérico "${filename}" a ${listaNumeros.length} destinatarios.`);

    const media = new MessageMedia('application/pdf', pdfBuffer.toString('base64'), filename);

    const resultados = [];

    for (let numero of listaNumeros) {
        try {
            const { sanitizado, targetChatId, canonicalChatId } = await resolverChatId(numero);
            console.log(`📱 [WHATSAPP-SERVICE] Enviando documento con adjunto a: ${targetChatId}`);

            const sentMsg = await client.sendMessage(targetChatId, media, { caption: mensajeTexto, sendMediaAsDocument: true });
            
            crmWhatsappDb.registrarMensajeWhatsapp({
                msgId: sentMsg?.id?._serialized || null,
                chatId: canonicalChatId || `${sanitizado}@c.us`,
                telefono: sanitizado,
                fromMe: true,
                cuerpo: `📄 [${filename}] ${mensajeTexto || ''}`.trim(),
                tipoMensaje: 'document',
                mediaFilename: filename,
                mediaMimetype: 'application/pdf',
                ack: 1,
                origenEnvio: 'lamda_documento'
            }).catch(() => {});

            console.log(`✅ [WHATSAPP-SERVICE] Enviado con éxito a: ${sanitizado}`);
            resultados.push({ numero: sanitizado, success: true });
        } catch (err) {
            console.error(`❌ [WHATSAPP-SERVICE] Error enviando a ${numero}:`, err.message);
            resultados.push({ numero, success: false, error: err.message });
        }
    }

    return resultados;
};

/**
 * Enviar un mensaje de texto plano a una lista de números telefónicos
 * 
 * @param {string} numeros - Números telefónicos separados por comas
 * @param {string} mensajeTexto - Mensaje a enviar
 * @returns {Promise<Array>} Resultados del envío por cada número
 */
const enviarMensajeTexto = async (numeros, mensajeTexto) => {
    const simRes = interceptarEnvioEnModoSeguro(numeros, "MENSAJE_TEXTO", String(mensajeTexto || "").slice(0, 60));
    if (simRes) return simRes;
    if (connectionStatus !== 'CONECTADO') {
        throw new Error('El servicio de WhatsApp no está conectado. Por favor, vincule su dispositivo primero desde el panel.');
    }

    if (!numeros || !numeros.trim()) {
        throw new Error('No se especificaron números telefónicos de destino.');
    }

    if (!mensajeTexto || !mensajeTexto.trim()) {
        throw new Error('El mensaje de texto no puede estar vacío.');
    }

    const listaNumeros = numeros.split(',')
        .map(n => n.replace(/[^0-9]/g, '').trim())
        .filter(n => n.length > 0);

    if (listaNumeros.length === 0) {
        throw new Error('Ninguno de los números telefónicos provistos es válido.');
    }

    console.log(`📱 [WHATSAPP-SERVICE] Enviando mensaje de texto plano a ${listaNumeros.length} destinatarios.`);

    const resultados = [];

    for (let numero of listaNumeros) {
        try {
            const { sanitizado, targetChatId, canonicalChatId } = await resolverChatId(numero);
            console.log(`📱 [WHATSAPP-SERVICE] Enviando mensaje de texto a: ${targetChatId}`);

            const sentMsg = await client.sendMessage(targetChatId, mensajeTexto);
            
            crmWhatsappDb.registrarMensajeWhatsapp({
                msgId: sentMsg?.id?._serialized || null,
                chatId: canonicalChatId || `${sanitizado}@c.us`,
                telefono: sanitizado,
                fromMe: true,
                cuerpo: mensajeTexto,
                tipoMensaje: 'chat',
                ack: 1,
                origenEnvio: 'lamda_crm'
            }).catch(() => {});

            console.log(`✅ [WHATSAPP-SERVICE] Enviado con éxito a: ${sanitizado}`);
            resultados.push({ numero: sanitizado, success: true });
        } catch (err) {
            console.error(`❌ [WHATSAPP-SERVICE] Error enviando a ${numero}:`, err.message);
            resultados.push({ numero, success: false, error: err.message });
        }
    }

    return resultados;
};

/**
 * Enviar un mensaje con una imagen adjunta (Base64) a una lista de números telefónicos
 * 
 * @param {string} numeros - Números telefónicos separados por comas
 * @param {string} base64Data - Imagen en formato Base64 (sin prefijo data:image/...)
 * @param {string} mimeType - Tipo MIME de la imagen (ej: 'image/jpeg')
 * @param {string} filename - Nombre del archivo a enviar
 * @param {string} mensajeTexto - Texto/caption del mensaje
 * @returns {Promise<Array>} Resultados del envío por cada número
 */
const enviarImagenBase64 = async (numeros, base64Data, mimeType, filename, mensajeTexto = '') => {
    const simRes = interceptarEnvioEnModoSeguro(numeros, "IMAGEN_BASE64", filename);
    if (simRes) return simRes;
    if (connectionStatus !== 'CONECTADO') {
        throw new Error('El servicio de WhatsApp no está conectado. Por favor, vincule su dispositivo primero desde el panel.');
    }

    if (!numeros || !numeros.trim()) {
        throw new Error('No se especificaron números telefónicos de destino.');
    }

    if (!base64Data) {
        throw new Error('La imagen en Base64 es requerida.');
    }

    const listaNumeros = numeros.split(',')
        .map(n => n.replace(/[^0-9]/g, '').trim())
        .filter(n => n.length > 0);

    if (listaNumeros.length === 0) {
        throw new Error('Ninguno de los números telefónicos provistos es válido.');
    }

    console.log(`📱 [WHATSAPP-SERVICE] Enviando imagen "${filename}" a ${listaNumeros.length} destinatarios.`);

    const media = new MessageMedia(mimeType, base64Data, filename);
    const resultados = [];

    for (let numero of listaNumeros) {
        try {
            const { sanitizado, targetChatId, canonicalChatId } = await resolverChatId(numero);
            console.log(`📱 [WHATSAPP-SERVICE] Enviando imagen a: ${targetChatId}`);

            const sentMsg = await client.sendMessage(targetChatId, media, { caption: mensajeTexto });
            
            crmWhatsappDb.registrarMensajeWhatsapp({
                msgId: sentMsg?.id?._serialized || null,
                chatId: canonicalChatId || `${sanitizado}@c.us`,
                telefono: sanitizado,
                fromMe: true,
                cuerpo: `📷 [${filename}] ${mensajeTexto || ''}`.trim(),
                tipoMensaje: 'image',
                mediaFilename: filename,
                mediaMimetype: mimeType,
                ack: 1,
                origenEnvio: 'lamda_imagen'
            }).catch(() => {});

            console.log(`✅ [WHATSAPP-SERVICE] Imagen enviada con éxito a: ${sanitizado}`);
            resultados.push({ numero: sanitizado, success: true });
        } catch (err) {
            console.error(`❌ [WHATSAPP-SERVICE] Error enviando imagen a ${numero}:`, err.message);
            resultados.push({ numero, success: false, error: err.message });
        }
    }

    return resultados;
};

/**
 * Extrae únicamente la lista de chats actualmente No Leídos (unreadCount > 0 o -1) desde WhatsApp Web
 * y apaga en BD todos los que ya fueron vistos en el celular (unreadCount === 0).
 */
let monitorNoLeidosInterval = null;
let sincronizandoNoLeidos = false;

const sincronizarNoLeidosRapido = async () => {
    if (sincronizandoNoLeidos || connectionStatus !== 'CONECTADO' || !client || !client.pupPage) {
        return;
    }
    sincronizandoNoLeidos = true;
    try {
        const chatsNoLeidos = await client.pupPage.evaluate(() => {
            const lista = [];
            try {
                if (typeof window.require !== 'function') return lista;
                const mod = window.require('WAWebChatCollection');
                const rawChats = (mod && mod.ChatCollection && typeof mod.ChatCollection.getModelsArray === 'function')
                    ? (mod.ChatCollection.getModelsArray() || [])
                    : [];

                for (let i = 0; i < rawChats.length; i++) {
                    try {
                        const c = rawChats[i];
                        if (!c || !c.id || c.isGroup) continue;
                        const rawId = c.id._serialized || '';
                        if (!rawId || rawId.endsWith('@g.us') || rawId.includes('broadcast') || rawId.endsWith('@newsletter')) continue;

                        const unreadVal = (c.unreadCount === -1 || c.markedUnread) ? -1 : (c.unreadCount || 0);
                        if (unreadVal === 0) continue;

                        let phoneChatId = rawId;
                        if (rawId.endsWith('@lid') && c.contact && c.contact.phoneNumber) {
                            phoneChatId = c.contact.phoneNumber._serialized || (c.contact.phoneNumber.user ? `${c.contact.phoneNumber.user}@c.us` : rawId);
                        }
                        if (!phoneChatId.endsWith('@c.us')) continue;

                        const pushnameWa = c.name || c.formattedTitle || (c.contact && (c.contact.pushname || c.contact.name)) || null;
                        const rawMsgs = (c.msgs && typeof c.msgs.getModelsArray === 'function')
                            ? c.msgs.getModelsArray()
                            : [];
                        const ultimos = rawMsgs.slice(-5);
                        const mensajes = [];
                        for (let j = 0; j < ultimos.length; j++) {
                            try {
                                const m = ultimos[j];
                                if (!m || !m.id) continue;
                                const rawBody = (m.type === 'chat' ? m.body : (m.caption || m.body || '')) || '';
                                const cleanBody = String(rawBody).startsWith('/9j/') ? (m.caption || '') : rawBody;
                                mensajes.push({
                                    msgId: m.id._serialized || m.id.id || null,
                                    fromMe: Boolean(m.id.fromMe || m.fromMe),
                                    cuerpo: cleanBody,
                                    tipoMensaje: m.type || 'chat',
                                    mediaFilename: m.filename || null,
                                    mediaMimetype: m.mimetype || null,
                                    directPath: (m.type === 'ptt' || m.type === 'audio') ? (m.directPath || null) : null,
                                    mediaKey: (m.type === 'ptt' || m.type === 'audio') ? (m.mediaKey || null) : null,
                                    ack: typeof m.ack === 'number' ? m.ack : 2,
                                    timestamp: m.t || 0
                                });
                            } catch (eM) {}
                        }

                        lista.push({
                            chatId: phoneChatId,
                            pushnameWa,
                            unreadCount: unreadVal,
                            timestampChat: c.t || 0,
                            mensajes
                        });
                    } catch (eC) {}
                }
            } catch (eG) {}
            return lista;
        });

        await crmWhatsappDb.sincronizarEstadoNoLeidosDesdeWa(chatsNoLeidos || []);

        const umbralAudioRecienteSeg = Math.floor(Date.now() / 1000) - (24 * 3600);
        for (const ch of (chatsNoLeidos || [])) {
            for (const m of (ch.mensajes || [])) {
                if (!m.fromMe && (m.tipoMensaje === 'ptt' || m.tipoMensaje === 'audio') && m.msgId && m.directPath && m.mediaKey && (!m.timestamp || m.timestamp >= umbralAudioRecienteSeg)) {
                    enfilelarTranscripcionAudioWa({
                        msgId: m.msgId,
                        chatId: ch.chatId,
                        directPath: m.directPath,
                        mediaKey: m.mediaKey
                    });
                }
            }
        }
    } catch (e) {
        // Silencioso en segundo plano
    } finally {
        sincronizandoNoLeidos = false;
    }
};

function iniciarMonitorNoLeidos() {
    if (monitorNoLeidosInterval) clearInterval(monitorNoLeidosInterval);
    monitorNoLeidosInterval = setInterval(() => {
        sincronizarNoLeidosRapido().catch(() => {});
    }, 6000);
}

let sincronizandoChatsRecientesEnCurso = false;

/**
 * Sincronizar las conversaciones recientes de WhatsApp con la base de datos local CRM
 */
const sincronizarChatsRecientes = async ({ maxChats = 45, mensajesPorChat = 15, marcarVistoChatId = null } = {}) => {
    if (connectionStatus !== 'CONECTADO' || !client || !client.pupPage) {
        return {
            success: false,
            status: connectionStatus,
            message: 'El cliente de WhatsApp no está conectado en este momento.'
        };
    }

    if (marcarVistoChatId) {
        try {
            await client.pupPage.evaluate((targetPhoneId) => {
                try {
                    const mod = window.require('WAWebChatCollection');
                    const rawChats = (mod && mod.ChatCollection && typeof mod.ChatCollection.getModelsArray === 'function')
                        ? (mod.ChatCollection.getModelsArray() || [])
                        : [];
                    for (let i = 0; i < rawChats.length; i++) {
                        const c = rawChats[i];
                        if (!c || !c.id) continue;
                        const rawId = c.id._serialized || '';
                        let phoneChatId = rawId;
                        if (rawId.endsWith('@lid') && c.contact && c.contact.phoneNumber) {
                            phoneChatId = c.contact.phoneNumber._serialized || (c.contact.phoneNumber.user ? `${c.contact.phoneNumber.user}@c.us` : rawId);
                        }
                        if (rawId === targetPhoneId || phoneChatId === targetPhoneId) {
                            c.unreadCount = 0;
                            c.markedUnread = false;
                            try {
                                const seenMod = window.require('WAWebSendSeen');
                                if (seenMod && typeof seenMod.sendSeen === 'function') {
                                    seenMod.sendSeen(c);
                                }
                            } catch (eS) {}
                        }
                    }
                } catch (e) {}
            }, marcarVistoChatId);
            return { success: true, marcadoVisto: true };
        } catch (eV) {
            return { success: false, error: eV.message };
        }
    }

    if (sincronizandoChatsRecientesEnCurso) {
        return {
            success: true,
            enCurso: true,
            message: 'Sincronización de chats ya en curso.'
        };
    }
    sincronizandoChatsRecientesEnCurso = true;

    try {
        console.log('🔄 [WHATSAPP-SERVICE] Iniciando sincronización de chats recientes hacia LAMDA CRM...');
        await crmWhatsappDb.rematchearChatsConBunker();

        // Extraer de forma segura directamente desde WAWebChatCollection en Chromium resolviendo JIDs @lid a @c.us
        // Incluye siempre TODOS los chats con unreadCount != 0 (no leídos / marcados como no leídos) + los top limitChats recientes
        const chatsExtraidos = await client.pupPage.evaluate((limitChats, limitMsgs) => {
            const resultado = [];
            try {
                let rawChats = [];
                if (typeof window.require === 'function') {
                    const mod = window.require('WAWebChatCollection');
                    if (mod && mod.ChatCollection && typeof mod.ChatCollection.getModelsArray === 'function') {
                        rawChats = mod.ChatCollection.getModelsArray() || [];
                    }
                } else if (window.Store && window.Store.Chat && typeof window.Store.Chat.getModelsArray === 'function') {
                    rawChats = window.Store.Chat.getModelsArray() || [];
                }

                // Ordenar: primero los no leídos (unreadCount != 0) y luego por actividad más reciente (c.t descendente)
                const sorted = [...rawChats].sort((a, b) => {
                    const uA = (a.unreadCount === -1 || a.markedUnread || a.unreadCount > 0) ? 1 : 0;
                    const uB = (b.unreadCount === -1 || b.markedUnread || b.unreadCount > 0) ? 1 : 0;
                    if (uA !== uB) return uB - uA;
                    return (b.t || 0) - (a.t || 0);
                });

                const mapaPorTelefono = new Map();

                for (let i = 0; i < sorted.length; i++) {
                    try {
                        const c = sorted[i];
                        if (!c || !c.id || c.isGroup) continue;
                        const rawId = c.id._serialized || '';
                        if (!rawId || rawId.endsWith('@g.us') || rawId.includes('broadcast') || rawId.endsWith('@newsletter')) continue;

                        const unreadVal = (c.unreadCount === -1 || c.markedUnread) ? -1 : (c.unreadCount || 0);

                        // Resolver teléfono real @c.us cuando el chat viene como @lid
                        let phoneChatId = rawId;
                        if (rawId.endsWith('@lid') && c.contact && c.contact.phoneNumber) {
                            phoneChatId = c.contact.phoneNumber._serialized || (c.contact.phoneNumber.user ? `${c.contact.phoneNumber.user}@c.us` : rawId);
                        }
                        if (!phoneChatId.endsWith('@c.us')) continue;

                        const yaExiste = mapaPorTelefono.has(phoneChatId);
                        if (!yaExiste && mapaPorTelefono.size >= limitChats && unreadVal === 0) continue;

                        const pushnameWa = c.name || c.formattedTitle || (c.contact && (c.contact.pushname || c.contact.name)) || null;
                        const rawMsgs = (c.msgs && typeof c.msgs.getModelsArray === 'function')
                            ? c.msgs.getModelsArray()
                            : [];

                        const ultimos = rawMsgs.slice(-limitMsgs);
                        const mensajes = [];
                        for (let j = 0; j < ultimos.length; j++) {
                            try {
                                const m = ultimos[j];
                                if (!m || !m.id) continue;
                                const rawBody = (m.type === 'chat' ? m.body : (m.caption || m.body || '')) || '';
                                const cleanBody = String(rawBody).startsWith('/9j/') ? (m.caption || '') : rawBody;
                                mensajes.push({
                                    msgId: m.id._serialized || m.id.id || null,
                                    fromMe: Boolean(m.id.fromMe || m.fromMe),
                                    cuerpo: cleanBody,
                                    tipoMensaje: m.type || 'chat',
                                    mediaFilename: m.filename || null,
                                    mediaMimetype: m.mimetype || null,
                                    directPath: (m.type === 'ptt' || m.type === 'audio') ? (m.directPath || null) : null,
                                    mediaKey: (m.type === 'ptt' || m.type === 'audio') ? (m.mediaKey || null) : null,
                                    ack: typeof m.ack === 'number' ? m.ack : 2,
                                    timestamp: m.t || 0
                                });
                            } catch (eM) {}
                        }

                        if (!yaExiste) {
                            if (mensajes.length > 0 || unreadVal !== 0) {
                                mapaPorTelefono.set(phoneChatId, {
                                    chatId: phoneChatId,
                                    pushnameWa,
                                    unreadCount: unreadVal,
                                    timestampChat: c.t || 0,
                                    mensajes
                                });
                            }
                        } else {
                            const prev = mapaPorTelefono.get(phoneChatId);
                            if (prev.unreadCount === 0 && unreadVal !== 0) {
                                prev.unreadCount = unreadVal;
                            }
                            if (!prev.pushnameWa && pushnameWa) {
                                prev.pushnameWa = pushnameWa;
                            }
                            if ((c.t || 0) > prev.timestampChat) {
                                prev.timestampChat = c.t || 0;
                            }
                            const idsVistos = new Set(prev.mensajes.map(x => x.msgId));
                            for (const m of mensajes) {
                                if (m.msgId && !idsVistos.has(m.msgId)) {
                                    prev.mensajes.push(m);
                                    idsVistos.add(m.msgId);
                                }
                            }
                        }
                    } catch (eC) {}
                }

                for (const val of mapaPorTelefono.values()) {
                    resultado.push(val);
                }
            } catch (eGlobal) {}
            return resultado;
        }, maxChats, mensajesPorChat);

        let chatsProcesados = 0;
        let mensajesImportados = 0;
        let clientesDetectados = 0;
        const chatsNoLeidos = [];

        for (const ch of (chatsExtraidos || [])) {
            try {
                if (ch.unreadCount > 0 || ch.unreadCount === -1) {
                    chatsNoLeidos.push(ch);
                }

                const ordenados = [...(ch.mensajes || [])].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
                let esCliente = false;

                for (let idx = 0; idx < ordenados.length; idx++) {
                    const m = ordenados[idx];
                    const esUltimo = (idx === ordenados.length - 1);
                    const resReg = await crmWhatsappDb.registrarMensajeWhatsapp({
                        msgId: m.msgId,
                        chatId: ch.chatId,
                        telefono: ch.chatId,
                        fromMe: Boolean(m.fromMe),
                        cuerpo: m.cuerpo || '',
                        tipoMensaje: m.tipoMensaje || 'chat',
                        mediaFilename: m.mediaFilename || null,
                        mediaMimetype: m.mediaMimetype || null,
                        ack: typeof m.ack === 'number' ? m.ack : 2,
                        pushnameWa: ch.pushnameWa,
                        origenEnvio: 'sincronizacion',
                        timestampMs: m.timestamp ? m.timestamp * 1000 : Date.now(),
                        unreadCountWa: esUltimo ? ch.unreadCount : undefined
                    });
                    if (resReg && resReg.es_cliente_bunker) esCliente = true;
                    mensajesImportados++;

                    const umbralAudioRecienteSeg = Math.floor(Date.now() / 1000) - (24 * 3600);
                    if (!m.fromMe && resReg && resReg.es_cliente_bunker && (m.tipoMensaje === 'ptt' || m.tipoMensaje === 'audio') && m.msgId && m.directPath && m.mediaKey && !resReg?.ya_transcrito && (!m.timestamp || m.timestamp >= umbralAudioRecienteSeg)) {
                        enfilelarTranscripcionAudioWa({
                            msgId: m.msgId,
                            chatId: ch.chatId,
                            directPath: m.directPath,
                            mediaKey: m.mediaKey
                        });
                    }
                }

                if (esCliente) clientesDetectados++;
                chatsProcesados++;
            } catch (errChat) {
                console.warn('⚠️ [WHATSAPP-SERVICE] Error sincronizando un chat individual:', errChat.message);
            }
        }

        // Sincronizar exactamente cuáles siguen no leídos y apagar los que ya están vistos en el celular
        await crmWhatsappDb.sincronizarEstadoNoLeidosDesdeWa(chatsNoLeidos);

        console.log(`✅ [WHATSAPP-SERVICE] Sincronización CRM completada: ${chatsProcesados} chats (${clientesDetectados} clientes Búnker, ${chatsNoLeidos.length} no leídos), ${mensajesImportados} mensajes.`);
        return {
            success: true,
            chatsProcesados,
            clientesDetectados,
            chatsNoLeidos: chatsNoLeidos.length,
            mensajesImportados
        };
    } catch (error) {
        console.error('❌ [WHATSAPP-SERVICE] Error en sincronizarChatsRecientes:', error.message);
        return {
            success: false,
            error: error.message
        };
    } finally {
        sincronizandoChatsRecientesEnCurso = false;
    }
};

/**
 * Encola en segundo plano la desencriptación y transcripción de un mensaje de audio (ptt / audio)
 * garantizando que no se ejecute dos veces sobre el mismo msgId ni sobre audios ya transcritos en BD.
 */
function enfilelarTranscripcionAudioWa({ msgId, chatId, directPath, mediaKey }) {
    if (!msgId || !directPath || !mediaKey) return;
    const rawId = String(msgId).split('_').pop();
    if (_audiosYaTranscritos.has(rawId) || _audiosEnTranscripcion.has(rawId)) return;

    _audiosEnTranscripcion.add(rawId);
    (async () => {
        try {
            const yaEnBd = await crmWhatsappDb.verificarAudioYaTranscrito(rawId);
            if (yaEnBd) {
                _audiosYaTranscritos.add(rawId);
                return;
            }
            const resTr = await whatsappAudioTranscriber.descargarYTranscribirAudioWhatsApp({
                directPath,
                mediaKey
            });
            if (resTr && resTr.ok && resTr.cuerpoFormateado) {
                _audiosYaTranscritos.add(rawId);
                await crmWhatsappDb.actualizarTranscripcionAudioMensaje({
                    msgId: rawId,
                    chatId,
                    cuerpoFormateado: resTr.cuerpoFormateado
                });
                console.log(`🎙️ [WHATSAPP-AUDIO] Transcripción completada (${chatId} / ${rawId}): ${resTr.cuerpoFormateado}`);
            }
        } catch (errTr) {
            console.warn(`⚠️ [WHATSAPP-AUDIO] Error transcribiendo audio ${rawId}:`, errTr.message);
        } finally {
            _audiosEnTranscripcion.delete(rawId);
        }
    })();
}

/**
 * Transcribe bajo demanda los últimos mensajes de audio de un chat específico extrayendo
 * directPath y mediaKey desde WAWebChatCollection en Chromium.
 */
const transcribirAudiosDeChat = async ({ chatId, msgIds = [], maxAudios = 4 } = {}) => {
    if (connectionStatus !== 'CONECTADO' || !client || !client.pupPage) {
        return {
            success: false,
            status: connectionStatus,
            message: 'El cliente de WhatsApp no está conectado en este momento.'
        };
    }
    if (!chatId) {
        return { success: false, message: 'Se requiere chatId.' };
    }

    try {
        const targetPhone = String(chatId).split('@')[0].replace(/\D/g, '');
        const targetSet = Array.isArray(msgIds) && msgIds.length > 0
            ? new Set(msgIds.map(id => String(id).split('_').pop()))
            : null;

        const audiosExtraidos = await client.pupPage.evaluate((phoneDigits, requestedIds, limitCount) => {
            const lista = [];
            try {
                if (typeof window.require !== 'function') return lista;
                const mod = window.require('WAWebChatCollection');
                const rawChats = (mod && mod.ChatCollection && typeof mod.ChatCollection.getModelsArray === 'function')
                    ? (mod.ChatCollection.getModelsArray() || [])
                    : [];

                for (let i = 0; i < rawChats.length; i++) {
                    const c = rawChats[i];
                    if (!c || !c.id || c.isGroup) continue;
                    const rawId = c.id._serialized || '';
                    let phoneChatId = rawId;
                    if (rawId.endsWith('@lid') && c.contact && c.contact.phoneNumber) {
                        phoneChatId = c.contact.phoneNumber._serialized || (c.contact.phoneNumber.user ? `${c.contact.phoneNumber.user}@c.us` : rawId);
                    }
                    const digits = phoneChatId.split('@')[0].replace(/\D/g, '');
                    if (!digits || (digits !== phoneDigits && !digits.endsWith(phoneDigits.slice(-10)))) continue;

                    const rawMsgs = (c.msgs && typeof c.msgs.getModelsArray === 'function')
                        ? c.msgs.getModelsArray()
                        : [];

                    for (let j = rawMsgs.length - 1; j >= 0; j--) {
                        const m = rawMsgs[j];
                        if (!m || !m.id) continue;
                        if (m.type !== 'ptt' && m.type !== 'audio') continue;
                        const shortId = m.id.id || (m.id._serialized ? String(m.id._serialized).split('_').pop() : null);
                        if (!shortId) continue;
                        if (Array.isArray(requestedIds) && requestedIds.length > 0 && !requestedIds.includes(shortId)) continue;
                        if (m.directPath && m.mediaKey) {
                            lista.push({
                                msgId: shortId,
                                serializedId: m.id._serialized || shortId,
                                chatId: phoneChatId,
                                directPath: m.directPath,
                                mediaKey: m.mediaKey,
                                timestamp: m.t || 0
                            });
                            if (lista.length >= limitCount) break;
                        }
                    }
                }
            } catch (e) {}
            return lista;
        }, targetPhone, targetSet ? Array.from(targetSet) : [], maxAudios);

        const resultados = [];
        for (const aud of (audiosExtraidos || [])) {
            try {
                const resTr = await whatsappAudioTranscriber.descargarYTranscribirAudioWhatsApp({
                    directPath: aud.directPath,
                    mediaKey: aud.mediaKey
                });
                if (resTr && resTr.ok && resTr.cuerpoFormateado) {
                    _audiosYaTranscritos.add(aud.msgId);
                    const rowUpd = await crmWhatsappDb.actualizarTranscripcionAudioMensaje({
                        msgId: aud.msgId,
                        chatId: aud.chatId || chatId,
                        cuerpoFormateado: resTr.cuerpoFormateado
                    });
                    resultados.push({
                        msgId: aud.msgId,
                        texto: resTr.texto,
                        cuerpo: resTr.cuerpoFormateado,
                        actualizado: Boolean(rowUpd)
                    });
                }
            } catch (errOne) {
                console.warn(`⚠️ [WHATSAPP-AUDIO] Error transcribiendo bajo demanda ${aud.msgId}:`, errOne.message);
            }
        }

        return {
            success: true,
            encontrados: (audiosExtraidos || []).length,
            transcritos: resultados.length,
            resultados
        };
    } catch (err) {
        return {
            success: false,
            error: err.message
        };
    }
};

/**
 * Apagar cliente de WhatsApp de forma ordenada y limpia
 */
async function shutdown() {
    console.log('🔌 [WHATSAPP-SERVICE] Apagando cliente de WhatsApp...');
    if (client) {
        try {
            await client.destroy();
            console.log('✅ [WHATSAPP-SERVICE] Cliente de WhatsApp destruido correctamente.');
        } catch (err) {
            console.error('❌ [WHATSAPP-SERVICE] Error al destruir cliente de WhatsApp:', err.message);
        }
        client = null;
    }
}

module.exports = {
    inicializarWhatsApp,
    obtenerEstado,
    cerrarSesion,
    enviarFacturaPdf,
    enviarDocumentoPdf,
    enviarMensajeTexto,
    enviarImagenBase64,
    sincronizarChatsRecientes,
    transcribirAudiosDeChat,
    shutdown
};
