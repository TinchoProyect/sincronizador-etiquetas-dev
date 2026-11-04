/**
 * Servicio Compartido de Base de Datos y Cruce Inteligente para WhatsApp CRM Horizontal
 * Sistema LAMDA
 * 
 * Conecta el motor bidireccional de WhatsApp (puerto 3004) con la Pizarra y Consola CRM (puerto 3000).
 */

const pool = require('../usuarios/pool');

let tablasVerificadas = false;
let cacheClientesBunker = null;
let cacheClientesTs = 0;
const CACHE_TTL_MS = 20000; // 20 segundos de caché para cruce ultrarrápido en ráfagas de mensajes

/**
 * Extrae únicamente dígitos y calcula colas de comparación (8 y 10 dígitos)
 * para tolerar cualquier formato argentino (0, 15, +54, 549, guiones, espacios).
 */
function analizarTelefono(raw) {
    if (!raw) return { limpio: '', cola10: '', cola8: '' };
    // Quitar sufijo @c.us o @s.whatsapp.net si viene un JID
    const sinDominio = String(raw).split('@')[0];
    let limpio = sinDominio.replace(/[^0-9]/g, '').trim();

    if (!limpio) return { limpio: '', cola10: '', cola8: '' };

    // Normalizar prefijos argentinos comunes para obtener número nacional
    let nacional = limpio;
    if (nacional.startsWith('549') && nacional.length >= 12) {
        nacional = nacional.substring(3);
    } else if (nacional.startsWith('54') && nacional.length >= 11) {
        nacional = nacional.substring(2);
    }
    if (nacional.startsWith('0')) {
        nacional = nacional.substring(1);
    }

    const cola10 = nacional.length >= 10 ? nacional.slice(-10) : nacional;
    const cola8 = nacional.length >= 8 ? nacional.slice(-8) : nacional;
    const cola7 = nacional.length >= 7 ? nacional.slice(-7) : nacional;

    // Formato canónico 549...
    let canonico = limpio;
    if (cola10.length === 10 && !limpio.startsWith('54')) {
        canonico = '549' + cola10;
    }

    return { limpio: canonico, cola10, cola8, cola7 };
}

/**
 * Asegura la existencia de las tablas de WhatsApp CRM Bidireccional en PostgreSQL
 */
async function asegurarTablasCrmWhatsapp() {
    if (tablasVerificadas) return;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS public.crm_whatsapp_chats (
                id SERIAL PRIMARY KEY,
                chat_id VARCHAR(120) UNIQUE NOT NULL,
                telefono_normalizado VARCHAR(40) NOT NULL,
                ultimos_digitos VARCHAR(15),
                bunker_cliente_id INTEGER REFERENCES public.bunker_clientes(id) ON DELETE SET NULL,
                cliente_nombre VARCHAR(255),
                codigo_bunker_cliente VARCHAR(60),
                contacto_nombre VARCHAR(255),
                contacto_cargo VARCHAR(120),
                pushname_wa VARCHAR(255),
                es_cliente_bunker BOOLEAN DEFAULT false,
                vinculacion_manual BOOLEAN DEFAULT false,
                modo_privacidad VARCHAR(40) DEFAULT 'ACTIVO',
                silenciado_hasta TIMESTAMP NULL,
                etiqueta_crm VARCHAR(60) NULL,
                nota_rapida TEXT NULL,
                esperando_respuesta BOOLEAN DEFAULT false,
                no_leidos INTEGER DEFAULT 0,
                ultimo_mensaje_texto TEXT,
                ultimo_mensaje_from_me BOOLEAN DEFAULT false,
                ultimo_mensaje_ack INTEGER DEFAULT 0,
                ultimo_mensaje_at TIMESTAMP DEFAULT NOW(),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_crm_wa_chats_bunker_id ON public.crm_whatsapp_chats(bunker_cliente_id);
            CREATE INDEX IF NOT EXISTS idx_crm_wa_chats_esperando ON public.crm_whatsapp_chats(esperando_respuesta, modo_privacidad);
            CREATE INDEX IF NOT EXISTS idx_crm_wa_chats_ultimo_at ON public.crm_whatsapp_chats(ultimo_mensaje_at DESC);

            CREATE TABLE IF NOT EXISTS public.crm_whatsapp_mensajes (
                id SERIAL PRIMARY KEY,
                msg_id VARCHAR(180) UNIQUE NOT NULL,
                chat_id VARCHAR(120) NOT NULL,
                bunker_cliente_id INTEGER NULL,
                from_me BOOLEAN NOT NULL DEFAULT false,
                cuerpo TEXT,
                tipo_mensaje VARCHAR(40) DEFAULT 'chat',
                media_filename VARCHAR(255) NULL,
                media_mimetype VARCHAR(100) NULL,
                ack INTEGER DEFAULT 1,
                origen_envio VARCHAR(50) DEFAULT 'whatsapp',
                fecha_mensaje TIMESTAMP NOT NULL DEFAULT NOW(),
                created_at TIMESTAMP DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_crm_wa_msg_chat_fecha ON public.crm_whatsapp_mensajes(chat_id, fecha_mensaje DESC);
        `);
        await pool.query(`
            ALTER TABLE public.factura_cuenta_corriente_movimientos
            ADD COLUMN IF NOT EXISTS origen_tipo VARCHAR(100) GENERATED ALWAYS AS (tipo_comprobante) STORED;
        `).catch(() => {});
        tablasVerificadas = true;
        console.log('✅ [CRM-WHATSAPP-DB] Tablas crm_whatsapp_chats y crm_whatsapp_mensajes verificadas.');
        await sembrarDirectorioClientesEnChats();
    } catch (error) {
        console.error('❌ [CRM-WHATSAPP-DB] Error verificando tablas:', error.message);
    }
}

/**
 * Carga y parsea el directorio de clientes de Búnker + Lomasoft para cruce de números
 */
async function obtenerDirectorioClientes(forceRefresh = false) {
    const ahora = Date.now();
    if (!forceRefresh && cacheClientesBunker && (ahora - cacheClientesTs) < CACHE_TTL_MS) {
        return cacheClientesBunker;
    }

    const query = `
        SELECT 
            bc.id as bunker_cliente_id,
            bc.cliente_nombre,
            bc.razon_social,
            bc.codigo_bunker_cliente,
            bc.whatsapp_facturas,
            bc.lomas_soft_id,
            c.telefono as lomas_telefono,
            c.celular as lomas_celular
        FROM public.bunker_clientes bc
        LEFT JOIN public.clientes c 
            ON (CASE WHEN bc.lomas_soft_id ~ '^\\d+$' THEN bc.lomas_soft_id::integer ELSE NULL END) = c.cliente_id
        ORDER BY bc.id ASC
    `;
    const res = await pool.query(query);
    const directorio = [];

    for (const row of res.rows) {
        const contactos = [];
        if (row.whatsapp_facturas) {
            try {
                const parsed = typeof row.whatsapp_facturas === 'string'
                    ? JSON.parse(row.whatsapp_facturas)
                    : row.whatsapp_facturas;
                if (Array.isArray(parsed)) {
                    parsed.forEach(ct => {
                        if (ct && ct.numero) {
                            const infoTel = analizarTelefono(ct.numero);
                            if (infoTel.cola7.length >= 7) {
                                contactos.push({
                                    nombre: ct.nombre || 'Contacto',
                                    cargo: ct.cargo || '',
                                    numeroOriginal: ct.numero,
                                    esExplicito: true,
                                    ...infoTel
                                });
                            }
                        }
                    });
                } else if (typeof row.whatsapp_facturas === 'string') {
                    row.whatsapp_facturas.split(',').forEach(part => {
                        const infoTel = analizarTelefono(part);
                        if (infoTel.cola7.length >= 7) {
                            contactos.push({
                                nombre: row.cliente_nombre || 'Cliente',
                                cargo: '',
                                numeroOriginal: part.trim(),
                                esExplicito: true,
                                ...infoTel
                            });
                        }
                    });
                }
            } catch (e) {
                String(row.whatsapp_facturas).split(',').forEach(part => {
                    const infoTel = analizarTelefono(part);
                    if (infoTel.cola7.length >= 7) {
                        contactos.push({
                            nombre: row.cliente_nombre || 'Cliente',
                            cargo: '',
                            numeroOriginal: part.trim(),
                            esExplicito: true,
                            ...infoTel
                        });
                    }
                });
            }
        }

        // También incluir celular y teléfono de Lomasoft como fallback (evitando duplicar el mismo número)
        [row.lomas_celular, row.lomas_telefono].forEach(telLomas => {
            if (telLomas) {
                const infoTel = analizarTelefono(telLomas);
                if (infoTel.cola7.length >= 7) {
                    const yaExiste = contactos.some(ex => (ex.cola10 && infoTel.cola10 && ex.cola10 === infoTel.cola10) || (ex.cola8 && infoTel.cola8 && ex.cola8 === infoTel.cola8));
                    if (!yaExiste) {
                        contactos.push({
                            nombre: row.cliente_nombre || 'Titular',
                            cargo: 'Teléfono Ficha',
                            numeroOriginal: telLomas,
                            esExplicito: false,
                            ...infoTel
                        });
                    }
                }
            }
        });

        directorio.push({
            bunker_cliente_id: row.bunker_cliente_id,
            cliente_nombre: row.cliente_nombre || row.razon_social || `Cliente #${row.bunker_cliente_id}`,
            razon_social: row.razon_social || '',
            codigo_bunker_cliente: row.codigo_bunker_cliente || '',
            lomas_soft_id: row.lomas_soft_id,
            contactos
        });
    }

    cacheClientesBunker = directorio;
    cacheClientesTs = ahora;
    return directorio;
}

/**
 * Cruza un número de teléfono entrante/saliente contra bunker_clientes
 */
async function resolverClienteBunkerPorTelefono(telefonoRaw, forceRefresh = false) {
    const info = analizarTelefono(telefonoRaw);
    if (!info.cola7 || info.cola7.length < 7) {
        return { es_cliente_bunker: false, ...info };
    }

    const directorio = await obtenerDirectorioClientes(forceRefresh);

    // Pasada 1: Coincidencia exacta de últimos 10 dígitos (código de área + número)
    if (info.cola10.length === 10) {
        for (const cli of directorio) {
            for (const ct of cli.contactos) {
                if (ct.cola10 && ct.cola10 === info.cola10) {
                    return {
                        es_cliente_bunker: true,
                        bunker_cliente_id: cli.bunker_cliente_id,
                        cliente_nombre: cli.cliente_nombre,
                        codigo_bunker_cliente: cli.codigo_bunker_cliente,
                        contacto_nombre: ct.nombre,
                        contacto_cargo: ct.cargo,
                        ...info
                    };
                }
            }
        }
    }

    // Pasada 2: Coincidencia por últimos 8 dígitos (tolera diferencias de prefijo 15 o código de área)
    if (info.cola8.length >= 8) {
        for (const cli of directorio) {
            for (const ct of cli.contactos) {
                if (ct.cola8 && ct.cola8 === info.cola8) {
                    return {
                        es_cliente_bunker: true,
                        bunker_cliente_id: cli.bunker_cliente_id,
                        cliente_nombre: cli.cliente_nombre,
                        codigo_bunker_cliente: cli.codigo_bunker_cliente,
                        contacto_nombre: ct.nombre,
                        contacto_cargo: ct.cargo,
                        ...info
                    };
                }
            }
        }
    }

    return {
        es_cliente_bunker: false,
        bunker_cliente_id: null,
        cliente_nombre: null,
        codigo_bunker_cliente: null,
        contacto_nombre: null,
        contacto_cargo: null,
        ...info
    };
}

/**
 * Registra un mensaje entrante o saliente en la base de datos y actualiza el estado del chat.
 * Si fromMe = true (enviado desde celular o desde LAMDA), apaga automáticamente la alerta (esperando_respuesta = false).
 */
async function registrarMensajeWhatsapp({
    msgId,
    chatId,
    telefono,
    fromMe = false,
    cuerpo = '',
    tipoMensaje = 'chat',
    mediaFilename = null,
    mediaMimetype = null,
    ack = 1,
    pushnameWa = null,
    origenEnvio = 'whatsapp',
    timestampMs = null,
    unreadCountWa = null
}) {
    await asegurarTablasCrmWhatsapp();

    if (!chatId) return null;
    // Ignorar grupos, estados e hilos de difusión para mantener la higiene del CRM
    if (chatId.endsWith('@g.us') || chatId.includes('broadcast') || chatId.endsWith('@newsletter')) {
        return null;
    }

    const infoTel = await resolverClienteBunkerPorTelefono(telefono || chatId);
    if (!infoTel.limpio) return null;
    if (String(chatId).endsWith('@lid') && infoTel.limpio && /^549[1-9]\d{9}$/.test(infoTel.limpio)) {
        chatId = `${infoTel.limpio}@c.us`;
    }

    const fechaMsg = timestampMs ? new Date(timestampMs) : new Date();
    const cuerpoLimpio = (cuerpo && !String(cuerpo).trim().startsWith('/9j/'))
        ? String(cuerpo).trim()
        : '';
    const textoResumen = (cuerpoLimpio.length > 0)
        ? cuerpoLimpio
        : (mediaFilename ? `📎 ${mediaFilename}` : (tipoMensaje === 'ptt' || tipoMensaje === 'audio' ? '🎤 Mensaje de audio' : (tipoMensaje === 'image' ? '📷 Imagen' : (tipoMensaje === 'document' ? '📄 Documento' : (tipoMensaje === 'video' ? '🎥 Video' : (tipoMensaje === 'sticker' ? '🏷️ Sticker' : `💬 [${tipoMensaje}]`))))));

    const rawId = msgId ? String(msgId).split('_').pop() : null;
    const idUnicoMsg = rawId || `lamda-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    try {
        // 1. Verificar si ya existe el mensaje (por msg_id o por contenido/timestamp idéntico en ventana de 25s) para evitar duplicar burbujas ni contadores
        const msgExistente = await pool.query(`
            SELECT id, msg_id, ack, cuerpo
            FROM public.crm_whatsapp_mensajes
            WHERE msg_id = $1
               OR (
                   chat_id = $2
                   AND from_me = $3
                   AND TRIM(COALESCE(cuerpo, '')) = TRIM($4)
                   AND TRIM($4) <> ''
                   AND ABS(EXTRACT(EPOCH FROM (fecha_mensaje - $5::timestamp))) <= 25
               )
            ORDER BY id ASC
            LIMIT 1
        `, [idUnicoMsg, chatId, Boolean(fromMe), textoResumen, fechaMsg]);
        const esMensajeNuevo = msgExistente.rows.length === 0;

        // Si el mensaje ya tenía una transcripción de audio ("🎤 Audio: ..."), nunca pisarla con "🎤 Mensaje de audio" genérico en los barridos periódicos
        let textoResumenEfectivo = textoResumen;
        const cuerpoPrevioMsg = msgExistente.rows[0]?.cuerpo ? String(msgExistente.rows[0].cuerpo).trim() : '';
        if ((cuerpoPrevioMsg.startsWith('🎤 Audio:') || (cuerpoPrevioMsg.startsWith('🎤') && cuerpoPrevioMsg !== '🎤 Mensaje de audio')) && (textoResumenEfectivo === '🎤 Mensaje de audio' || !cuerpoLimpio)) {
            textoResumenEfectivo = cuerpoPrevioMsg;
        }

        // 2. Consultar chat actual si existe
        const chatRes = await pool.query(
            'SELECT * FROM public.crm_whatsapp_chats WHERE chat_id = $1 LIMIT 1',
            [chatId]
        );

        let bunkerIdFinal = infoTel.bunker_cliente_id;
        let clienteNombreFinal = infoTel.cliente_nombre;
        let codigoBunkerFinal = infoTel.codigo_bunker_cliente;
        let contactoNombreFinal = infoTel.contacto_nombre || pushnameWa || infoTel.limpio;
        let contactoCargoFinal = infoTel.contacto_cargo || '';
        let esClienteFinal = infoTel.es_cliente_bunker === true;

        // Determinar estado de "No Leído" real según WhatsApp Web si viene informado (unreadCount > 0 o -1 cuando se marca manual no leído)
        const tieneUnreadExplicito = (unreadCountWa !== null && unreadCountWa !== undefined);
        const esNoLeidoExplicito = tieneUnreadExplicito ? (unreadCountWa > 0 || unreadCountWa === -1) : null;
        const cantNoLeidosExplicito = tieneUnreadExplicito
            ? (unreadCountWa === -1 ? -1 : (unreadCountWa > 0 ? unreadCountWa : 0))
            : null;

        if (chatRes.rows.length > 0) {
            const chatActual = chatRes.rows[0];
            if (chatActual.vinculacion_manual) {
                bunkerIdFinal = chatActual.bunker_cliente_id;
                clienteNombreFinal = chatActual.cliente_nombre;
                codigoBunkerFinal = chatActual.codigo_bunker_cliente;
                contactoNombreFinal = chatActual.contacto_nombre || contactoNombreFinal;
                contactoCargoFinal = chatActual.contacto_cargo || contactoCargoFinal;
                esClienteFinal = Boolean(chatActual.bunker_cliente_id || chatActual.es_cliente_bunker);
            } else if (!bunkerIdFinal && chatActual.bunker_cliente_id) {
                bunkerIdFinal = chatActual.bunker_cliente_id;
                clienteNombreFinal = chatActual.cliente_nombre;
                codigoBunkerFinal = chatActual.codigo_bunker_cliente;
                esClienteFinal = true;
            }

            // Actualizar chat existente solo si el mensaje es más reciente o igual al último registrado, o si viene unread explícito
            const ultimoAtActual = chatActual.ultimo_mensaje_at ? new Date(chatActual.ultimo_mensaje_at).getTime() : 0;
            const esMasReciente = fechaMsg.getTime() >= (ultimoAtActual - 5000);

            if (esMasReciente || tieneUnreadExplicito) {
                const nuevoEsperando = tieneUnreadExplicito
                    ? esNoLeidoExplicito
                    : (fromMe ? false : (esMensajeNuevo ? true : Boolean(chatActual.esperando_respuesta)));
                const nuevoNoLeidos = tieneUnreadExplicito
                    ? cantNoLeidosExplicito
                    : (fromMe ? 0 : (esMensajeNuevo ? (parseInt(chatActual.no_leidos || 0) + 1) : parseInt(chatActual.no_leidos || 0)));

                await pool.query(`
                    UPDATE public.crm_whatsapp_chats
                    SET bunker_cliente_id = COALESCE($2, bunker_cliente_id),
                        cliente_nombre = COALESCE($3, cliente_nombre),
                        codigo_bunker_cliente = COALESCE($4, codigo_bunker_cliente),
                        contacto_nombre = COALESCE($5, contacto_nombre),
                        contacto_cargo = COALESCE(NULLIF($6, ''), contacto_cargo),
                        pushname_wa = COALESCE($7, pushname_wa),
                        es_cliente_bunker = $8,
                        esperando_respuesta = $9,
                        no_leidos = $10,
                        ultimo_mensaje_texto = CASE
                            WHEN $15::boolean THEN
                                CASE
                                    WHEN (ultimo_mensaje_texto LIKE '🎤 Audio:%' OR (ultimo_mensaje_texto LIKE '🎤%' AND ultimo_mensaje_texto <> '🎤 Mensaje de audio')) AND $11 = '🎤 Mensaje de audio' THEN ultimo_mensaje_texto
                                    ELSE $11
                                END
                            ELSE ultimo_mensaje_texto
                        END,
                        ultimo_mensaje_from_me = CASE WHEN $15::boolean THEN $12 ELSE ultimo_mensaje_from_me END,
                        ultimo_mensaje_ack = CASE WHEN $15::boolean THEN $13 ELSE ultimo_mensaje_ack END,
                        ultimo_mensaje_at = CASE WHEN $15::boolean THEN $14 ELSE ultimo_mensaje_at END,
                        updated_at = NOW()
                    WHERE chat_id = $1
                `, [
                    chatId,
                    bunkerIdFinal,
                    clienteNombreFinal,
                    codigoBunkerFinal,
                    contactoNombreFinal,
                    contactoCargoFinal,
                    pushnameWa,
                    esClienteFinal,
                    nuevoEsperando,
                    nuevoNoLeidos,
                    textoResumenEfectivo,
                    fromMe,
                    ack || 1,
                    fechaMsg,
                    esMasReciente
                ]);
            }
        } else {
            // Crear el chat por primera vez
            const esperandoInicial = tieneUnreadExplicito ? esNoLeidoExplicito : (fromMe ? false : true);
            const noLeidosInicial = tieneUnreadExplicito ? cantNoLeidosExplicito : (fromMe ? 0 : 1);

            await pool.query(`
                INSERT INTO public.crm_whatsapp_chats (
                    chat_id, telefono_normalizado, ultimos_digitos,
                    bunker_cliente_id, cliente_nombre, codigo_bunker_cliente,
                    contacto_nombre, contacto_cargo, pushname_wa,
                    es_cliente_bunker, modo_privacidad,
                    esperando_respuesta, no_leidos,
                    ultimo_mensaje_texto, ultimo_mensaje_from_me, ultimo_mensaje_ack, ultimo_mensaje_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ACTIVO', $11, $12, $13, $14, $15, $16)
            `, [
                chatId,
                infoTel.limpio,
                infoTel.cola8,
                bunkerIdFinal,
                clienteNombreFinal,
                codigoBunkerFinal,
                contactoNombreFinal,
                contactoCargoFinal,
                pushnameWa,
                esClienteFinal,
                esperandoInicial,
                noLeidosInicial,
                textoResumenEfectivo,
                fromMe,
                ack || 1,
                fechaMsg
            ]);
        }

        // 3. Insertar o actualizar el mensaje en el historial (sin duplicar burbujas ni pisar transcripciones de audio)
        if (!esMensajeNuevo && msgExistente.rows[0]) {
            await pool.query(`
                UPDATE public.crm_whatsapp_mensajes
                SET ack = GREATEST(ack, $2),
                    cuerpo = CASE
                        WHEN (cuerpo LIKE '🎤 Audio:%' OR (cuerpo LIKE '🎤%' AND cuerpo <> '🎤 Mensaje de audio')) AND ($3 = '🎤 Mensaje de audio' OR $3 = '') THEN cuerpo
                        ELSE COALESCE(NULLIF($3, ''), cuerpo)
                    END
                WHERE id = $1
            `, [msgExistente.rows[0].id, ack || 1, textoResumenEfectivo]);
        } else {
            await pool.query(`
                INSERT INTO public.crm_whatsapp_mensajes (
                    msg_id, chat_id, bunker_cliente_id, from_me,
                    cuerpo, tipo_mensaje, media_filename, media_mimetype,
                    ack, origen_envio, fecha_mensaje
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                ON CONFLICT (msg_id) DO UPDATE
                SET ack = GREATEST(public.crm_whatsapp_mensajes.ack, EXCLUDED.ack),
                    cuerpo = CASE
                        WHEN (public.crm_whatsapp_mensajes.cuerpo LIKE '🎤 Audio:%' OR (public.crm_whatsapp_mensajes.cuerpo LIKE '🎤%' AND public.crm_whatsapp_mensajes.cuerpo <> '🎤 Mensaje de audio'))
                             AND (EXCLUDED.cuerpo = '🎤 Mensaje de audio' OR EXCLUDED.cuerpo = '')
                        THEN public.crm_whatsapp_mensajes.cuerpo
                        ELSE COALESCE(NULLIF(EXCLUDED.cuerpo, ''), public.crm_whatsapp_mensajes.cuerpo)
                    END
            `, [
                idUnicoMsg,
                chatId,
                bunkerIdFinal,
                fromMe,
                textoResumenEfectivo,
                tipoMensaje || 'chat',
                mediaFilename,
                mediaMimetype,
                ack || 1,
                origenEnvio || 'whatsapp',
                fechaMsg
            ]);
        }

        return {
            chatId,
            bunker_cliente_id: bunkerIdFinal,
            cliente_nombre: clienteNombreFinal,
            es_cliente_bunker: esClienteFinal,
            fromMe,
            es_mensaje_nuevo: esMensajeNuevo,
            ya_transcrito: textoResumenEfectivo.startsWith('🎤 Audio:') || (textoResumenEfectivo.startsWith('🎤') && textoResumenEfectivo !== '🎤 Mensaje de audio')
        };
    } catch (err) {
        console.error('❌ [CRM-WHATSAPP-DB] Error registrando mensaje:', err.message);
        return null;
    }
}

/**
 * Verifica si un mensaje de audio ya cuenta con transcripción guardada en base de datos
 */
async function verificarAudioYaTranscrito(msgId) {
    if (!msgId) return false;
    const rawId = String(msgId).split('_').pop();
    try {
        const { rows } = await pool.query(
            `SELECT 1 FROM public.crm_whatsapp_mensajes
             WHERE (msg_id = $1 OR msg_id = $2)
               AND (cuerpo LIKE '🎤 Audio:%' OR (cuerpo LIKE '🎤%' AND cuerpo <> '🎤 Mensaje de audio'))
             LIMIT 1`,
            [rawId, String(msgId)]
        );
        return rows.length > 0;
    } catch (_) {
        return false;
    }
}

/**
 * Actualiza el cuerpo de un mensaje de audio con su transcripción e impacta en la cabecera del chat
 */
async function actualizarTranscripcionAudioMensaje({ msgId, chatId, cuerpoFormateado }) {
    if (!msgId || !cuerpoFormateado) return null;
    await asegurarTablasCrmWhatsapp();
    const rawId = String(msgId).split('_').pop();
    try {
        const { rows: updated } = await pool.query(`
            UPDATE public.crm_whatsapp_mensajes
            SET cuerpo = $2
            WHERE msg_id = $1 OR msg_id = $3
            RETURNING id, msg_id, chat_id, bunker_cliente_id, cuerpo, fecha_mensaje
        `, [rawId, cuerpoFormateado, String(msgId)]);

        const targetChatId = chatId || updated[0]?.chat_id;
        if (targetChatId) {
            await pool.query(`
                UPDATE public.crm_whatsapp_chats c
                SET ultimo_mensaje_texto = $2,
                    updated_at = NOW()
                WHERE c.chat_id = $1
                  AND (
                      c.ultimo_mensaje_texto = '🎤 Mensaje de audio'
                      OR c.ultimo_mensaje_texto LIKE '🎤 Audio:%'
                      OR NOT EXISTS (
                          SELECT 1 FROM public.crm_whatsapp_mensajes m
                          WHERE m.chat_id = c.chat_id
                            AND m.fecha_mensaje > COALESCE($3::timestamptz, NOW() - INTERVAL '1 day')
                      )
                  )
            `, [targetChatId, cuerpoFormateado, updated[0]?.fecha_mensaje || null]);
        }

        const cliId = updated[0]?.bunker_cliente_id;
        if (cliId) {
            await pool.query(`DELETE FROM public.crm_cliente_sintesis_memoria WHERE cliente_id = $1`, [cliId]).catch(() => {});
        }
        return updated[0] || null;
    } catch (err) {
        console.warn('⚠️ [CRM-WHATSAPP-DB] Error actualizando transcripción de audio:', err.message);
        return null;
    }
}

/**
 * Actualiza el estado de lectura/entrega (ACK) cuando WhatsApp notifica cambio de tilde
 * ack: 1 = enviado (✓), 2 = recibido en dispositivo (✓✓), 3 = leído azul (✓✓), 4 = reproducido
 */
async function actualizarAckMensaje(msgId, chatId, nuevoAck) {
    if (!msgId || typeof nuevoAck !== 'number') return;
    await asegurarTablasCrmWhatsapp();
    try {
        await pool.query(`
            UPDATE public.crm_whatsapp_mensajes
            SET ack = GREATEST(ack, $2)
            WHERE msg_id = $1
        `, [msgId, nuevoAck]);

        if (chatId) {
            await pool.query(`
                UPDATE public.crm_whatsapp_chats
                SET ultimo_mensaje_ack = GREATEST(ultimo_mensaje_ack, $2),
                    updated_at = NOW()
                WHERE chat_id = $1 AND ultimo_mensaje_from_me = true
            `, [chatId, nuevoAck]);
        }
    } catch (err) {
        console.warn('⚠️ [CRM-WHATSAPP-DB] Error actualizando ACK:', err.message);
    }
}

/**
 * Re-ejecuta el cruce de todos los chats no vinculados manualmente contra bunker_clientes
 */
async function rematchearChatsConBunker() {
    await asegurarTablasCrmWhatsapp();
    const directorio = await obtenerDirectorioClientes(true);
    const chatsRes = await pool.query(`
        SELECT chat_id, telefono_normalizado, vinculacion_manual
        FROM public.crm_whatsapp_chats
        WHERE vinculacion_manual = false
    `);

    let vinculados = 0;
    for (const ch of chatsRes.rows) {
        const match = await resolverClienteBunkerPorTelefono(ch.telefono_normalizado || ch.chat_id, false);
        if (match.es_cliente_bunker && match.bunker_cliente_id) {
            await pool.query(`
                UPDATE public.crm_whatsapp_chats
                SET bunker_cliente_id = $2,
                    cliente_nombre = $3,
                    codigo_bunker_cliente = $4,
                    contacto_nombre = COALESCE(NULLIF($5, ''), contacto_nombre),
                    contacto_cargo = COALESCE(NULLIF($6, ''), contacto_cargo),
                    es_cliente_bunker = true,
                    updated_at = NOW()
                WHERE chat_id = $1
            `, [
                ch.chat_id,
                match.bunker_cliente_id,
                match.cliente_nombre,
                match.codigo_bunker_cliente,
                match.contacto_nombre,
                match.contacto_cargo
            ]);
            vinculados++;
        }
    }
    return { totalRevisados: chatsRes.rows.length, vinculados };
}

/**
 * Siembra inicialmente las fichas de chat para los clientes de Búnker con teléfono configurado
 * e importa el historial de seguimientos ya enviados desde LAMDA para que la consola tenga datos desde el minuto cero.
 */
async function sembrarDirectorioClientesEnChats() {
    try {
        const directorio = await obtenerDirectorioClientes(true);
        for (const cli of directorio) {
            if (!cli.contactos || cli.contactos.length === 0) continue;
            // Sembrar todos los contactos explícitos de WhatsApp del cliente (o el primero de respaldo si no tiene explícitos)
            const explicitos = cli.contactos.filter(c => c.esExplicito);
            const listaASembrar = explicitos.length > 0 ? explicitos : [cli.contactos[0]];
            const vistosClave = new Set();

            for (const ct of listaASembrar) {
                if (!ct || !ct.limpio || ct.limpio.length < 10) continue;
                const claveTel = ct.cola10 || ct.limpio;
                if (vistosClave.has(claveTel)) continue;
                vistosClave.add(claveTel);

                const chatId = `${ct.limpio}@c.us`;

                await pool.query(`
                    INSERT INTO public.crm_whatsapp_chats (
                        chat_id, telefono_normalizado, ultimos_digitos,
                        bunker_cliente_id, cliente_nombre, codigo_bunker_cliente,
                        contacto_nombre, contacto_cargo, es_cliente_bunker,
                        modo_privacidad, esperando_respuesta, no_leidos,
                        ultimo_mensaje_texto, ultimo_mensaje_from_me, ultimo_mensaje_ack, ultimo_mensaje_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, 'ACTIVO', false, 0, 'Cliente Búnker vinculado', true, 2, NULL)
                    ON CONFLICT (chat_id) DO UPDATE SET
                        bunker_cliente_id = EXCLUDED.bunker_cliente_id,
                        cliente_nombre = EXCLUDED.cliente_nombre,
                        codigo_bunker_cliente = EXCLUDED.codigo_bunker_cliente,
                        contacto_nombre = COALESCE(NULLIF(EXCLUDED.contacto_nombre, ''), public.crm_whatsapp_chats.contacto_nombre),
                        contacto_cargo = COALESCE(NULLIF(EXCLUDED.contacto_cargo, ''), public.crm_whatsapp_chats.contacto_cargo),
                        es_cliente_bunker = true
                `, [
                    chatId,
                    ct.limpio,
                    ct.cola8,
                    cli.bunker_cliente_id,
                    cli.cliente_nombre,
                    cli.codigo_bunker_cliente,
                    ct.nombre || cli.cliente_nombre,
                    ct.cargo || ''
                ]);
            }
        }

        // Reparar filas sembradas con texto placeholder: si tienen mensajes reales, usar su fecha/texto real; si no tienen mensajes, dejar ultimo_mensaje_at en NULL
        await pool.query(`
            UPDATE public.crm_whatsapp_chats c
            SET ultimo_mensaje_texto = sub.cuerpo,
                ultimo_mensaje_from_me = sub.from_me,
                ultimo_mensaje_at = sub.fecha_mensaje
            FROM (
                SELECT DISTINCT ON (chat_id) chat_id, cuerpo, from_me, fecha_mensaje
                FROM public.crm_whatsapp_mensajes
                ORDER BY chat_id, fecha_mensaje DESC, id DESC
            ) sub
            WHERE c.chat_id = sub.chat_id
              AND (c.ultimo_mensaje_texto = 'Cliente Búnker vinculado' OR c.ultimo_mensaje_at IS NULL)
        `).catch(() => {});

        await pool.query(`
            UPDATE public.crm_whatsapp_chats c
            SET ultimo_mensaje_at = NULL
            WHERE c.ultimo_mensaje_texto = 'Cliente Búnker vinculado'
              AND NOT EXISTS (SELECT 1 FROM public.crm_whatsapp_mensajes m WHERE m.chat_id = c.chat_id)
        `).catch(() => {});

        // Importar seguimientos previamente enviados desde LAMDA si existen
        try {
            const segRes = await pool.query(`
                SELECT id, bunker_cliente_id, cliente_nombre, contacto_nombre, telefono_destino, mensajes, enviado_at, created_at
                FROM public.crm_seguimientos_whatsapp
                WHERE estado = 'ENVIADO'
                ORDER BY COALESCE(enviado_at, created_at) ASC
                LIMIT 100
            `);
            for (const s of segRes.rows) {
                const infoTel = analizarTelefono(s.telefono_destino);
                if (!infoTel.limpio) continue;
                const chatId = `${infoTel.limpio}@c.us`;
                let msgs = s.mensajes;
                if (typeof msgs === 'string') {
                    try { msgs = JSON.parse(msgs); } catch (e) { msgs = [msgs]; }
                }
                if (!Array.isArray(msgs)) msgs = [msgs];
                const ts = s.enviado_at ? new Date(s.enviado_at).getTime() : (s.created_at ? new Date(s.created_at).getTime() : Date.now());

                for (let i = 0; i < msgs.length; i++) {
                    await registrarMensajeWhatsapp({
                        msgId: `lamda-seg-${s.id}-${i}`,
                        chatId,
                        telefono: infoTel.limpio,
                        fromMe: true,
                        cuerpo: String(msgs[i]),
                        tipoMensaje: 'chat',
                        ack: 2,
                        origenEnvio: 'lamda_seguimiento',
                        timestampMs: ts + i * 1000
                    });
                }
            }
        } catch (eSeg) {
            // Si aún no existe la tabla de seguimientos, ignorar silenciosamente
        }
    } catch (err) {
        console.warn('⚠️ [CRM-WHATSAPP-DB] Aviso en siembra inicial de chats:', err.message);
    }
}

/**
 * Sincroniza exactamente el estado de "No Leídos / Sin Ver" (unreadCount != 0) desde WhatsApp Web.
 * - Los chats que en WhatsApp ya están vistos (unreadCount === 0) pasan a esperando_respuesta = false y no_leidos = 0.
 * - Los chats que en WhatsApp están sin ver (unreadCount > 0) o marcados manualmente como no leídos (unreadCount === -1)
 *   quedan con esperando_respuesta = true.
 */
async function sincronizarEstadoNoLeidosDesdeWa(listaNoLeidosWa = []) {
    await asegurarTablasCrmWhatsapp();
    try {
        // Limpiar cualquier miniatura base64 (/9j/...) que haya ingresado como texto
        await pool.query(`
            UPDATE public.crm_whatsapp_chats
            SET ultimo_mensaje_texto = '📷 Imagen / Multimedia'
            WHERE ultimo_mensaje_texto LIKE '/9j/%'
        `);
        await pool.query(`
            UPDATE public.crm_whatsapp_mensajes
            SET cuerpo = CASE 
                WHEN tipo_mensaje = 'image' THEN '📷 Imagen'
                WHEN tipo_mensaje = 'document' THEN COALESCE('📎 ' || media_filename, '📄 Documento')
                WHEN tipo_mensaje IN ('ptt', 'audio') THEN '🎤 Mensaje de audio'
                ELSE '📎 Multimedia'
            END
            WHERE cuerpo LIKE '/9j/%'
        `);

        const chatIdsNoLeidos = [];

        for (const item of listaNoLeidosWa) {
            if (!item || !item.chatId) continue;
            chatIdsNoLeidos.push(item.chatId);

            const ordenados = Array.isArray(item.mensajes)
                ? [...item.mensajes].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
                : [];

            if (ordenados.length > 0) {
                for (let i = 0; i < ordenados.length; i++) {
                    const m = ordenados[i];
                    const esUltimo = (i === ordenados.length - 1);
                    await registrarMensajeWhatsapp({
                        msgId: m.msgId,
                        chatId: item.chatId,
                        telefono: item.chatId,
                        fromMe: Boolean(m.fromMe),
                        cuerpo: m.cuerpo || '',
                        tipoMensaje: m.tipoMensaje || 'chat',
                        mediaFilename: m.mediaFilename || null,
                        mediaMimetype: m.mediaMimetype || null,
                        ack: typeof m.ack === 'number' ? m.ack : 2,
                        pushnameWa: item.pushnameWa,
                        origenEnvio: 'sincronizacion',
                        timestampMs: m.timestamp ? m.timestamp * 1000 : Date.now(),
                        unreadCountWa: esUltimo ? item.unreadCount : undefined
                    });
                }
            } else {
                const cant = item.unreadCount === -1 ? -1 : (item.unreadCount > 0 ? item.unreadCount : 1);
                const upd = await pool.query(`
                    UPDATE public.crm_whatsapp_chats
                    SET esperando_respuesta = true,
                        no_leidos = $2,
                        updated_at = NOW()
                    WHERE chat_id = $1
                `, [item.chatId, cant]);

                if (upd.rowCount === 0) {
                    await registrarMensajeWhatsapp({
                        msgId: `wa-unread-${item.chatId}`,
                        chatId: item.chatId,
                        telefono: item.chatId,
                        fromMe: false,
                        cuerpo: item.ultimoTexto || '📌 Marcado como no leído en WhatsApp',
                        tipoMensaje: 'chat',
                        ack: 2,
                        pushnameWa: item.pushnameWa,
                        origenEnvio: 'sincronizacion',
                        timestampMs: item.timestampChat ? item.timestampChat * 1000 : Date.now(),
                        unreadCountWa: item.unreadCount
                    });
                }
            }
        }

        // Apagar todos los que en WhatsApp ya fueron vistos (unreadCount === 0)
        if (chatIdsNoLeidos.length > 0) {
            await pool.query(`
                UPDATE public.crm_whatsapp_chats
                SET esperando_respuesta = false,
                    no_leidos = 0,
                    updated_at = NOW()
                WHERE esperando_respuesta = true
                  AND NOT (chat_id = ANY($1::text[]))
            `, [chatIdsNoLeidos]);
        } else {
            await pool.query(`
                UPDATE public.crm_whatsapp_chats
                SET esperando_respuesta = false,
                    no_leidos = 0,
                    updated_at = NOW()
                WHERE esperando_respuesta = true
            `);
        }

        return { success: true, totalNoLeidosWa: chatIdsNoLeidos.length };
    } catch (err) {
        console.error('❌ [CRM-WHATSAPP-DB] Error en sincronizarEstadoNoLeidosDesdeWa:', err.message);
        return { success: false, error: err.message };
    }
}

module.exports = {
    analizarTelefono,
    asegurarTablasCrmWhatsapp,
    obtenerDirectorioClientes,
    resolverClienteBunkerPorTelefono,
    registrarMensajeWhatsapp,
    verificarAudioYaTranscrito,
    actualizarTranscripcionAudioMensaje,
    actualizarAckMensaje,
    rematchearChatsConBunker,
    sembrarDirectorioClientesEnChats,
    sincronizarEstadoNoLeidosDesdeWa
};
