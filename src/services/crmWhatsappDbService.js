/**
 * Servicio Compartido de Base de Datos y Cruce Inteligente para WhatsApp CRM Horizontal
 * Sistema LAMDA
 * 
 * Conecta el motor bidireccional de WhatsApp (puerto 3004) con la Pizarra y Consola CRM (puerto 3000).
 */

const pool = require('../usuarios/pool');
const nodosCaptacionCrm = require('./nodosCaptacionCrmService');

let tablasVerificadas = false;
let cacheClientesBunker = null;
let cacheClientesTs = 0;
let cacheProveedores = null;
let cacheProveedoresTs = 0;
let cacheAislados = null;
let cacheAisladosTs = 0;
const CACHE_TTL_MS = 20000; // 20 segundos de caché para cruce ultrarrápido en ráfagas de mensajes

const TIPOS_MENSAJE_PROTOCOLO_IGNORADOS = new Set([
    'e2e_notification',
    'notification_template',
    'call_log',
    'revoked',
    'rich_response',
    'gp2',
    'protocol',
    'biz_content_placeholder',
    'ciphertext',
    'notification',
    'broadcast_notification',
    'group_notification',
    'unknown',
    'oversized',
    'hsm'
]);

const CATEGORIAS_CONTACTO_VALIDAS = new Set([
    'CLIENTE_BUNKER',
    'PROSPECTO',
    'PROSPECTO_NODO',
    'PROVEEDOR',
    'PERSONAL',
    'IGNORADO_BOT'
]);

/**
 * Determina si un evento/mensaje de WhatsApp es ruido técnico de protocolo (no conversacional)
 * que jamás debe guardarse como burbuja ni disparar alertas de "No leído".
 */
function esTipoMensajeProtocoloIgnorado(tipoMensaje, cuerpo = '') {
    const tipo = String(tipoMensaje || '').trim().toLowerCase();
    if (tipo && TIPOS_MENSAJE_PROTOCOLO_IGNORADOS.has(tipo)) {
        return true;
    }
    const txt = String(cuerpo || '').trim();
    if (/^💬\s*\[(e2e_notification|notification_template|call_log|revoked|rich_response|gp2|protocol|biz_content_placeholder|ciphertext|notification|broadcast_notification|group_notification|unknown)\]/i.test(txt)) {
        return true;
    }
    return false;
}

function normalizarTextoSimple(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9@\s]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function extraerTokensNombrePersona(texto) {
    const stopwords = new Set([
        'srl', 'soc', 'del', 'las', 'los', 'con', 'sin', 'por', 'para', 'contacto', 'lomas',
        'hermano', 'hermana', 'titular', 'cliente', 'tel', 'telefono', 'whatsapp', 'casa',
        'local', 'sucursal', 'dietetica', 'almacen', 'verduleria', 'mercado', 'sin', 'gluten',
        'calle', 'av', 'nro', 'num', 'la', 'el', 'de', 'y'
    ]);
    return normalizarTextoSimple(texto)
        .split(' ')
        .filter(w => w.length >= 3 && !/^\d+$/.test(w) && !stopwords.has(w));
}

function invalidarCacheCategoriasCrm() {
    cacheAislados = null;
    cacheAisladosTs = 0;
    cacheProveedores = null;
    cacheProveedoresTs = 0;
}

function esContactoBotOSpam(telefono, pushname, contactoNombre) {
    const tel = String(telefono || '').replace(/\D/g, '');
    if (!tel || tel === '0' || tel.length < 8) return true;
    const rawNames = [pushname, contactoNombre].map(s => String(s || '').trim()).filter(Boolean);
    for (const rn of rawNames) {
        if (rn.startsWith('@')) return true;
        const norm = normalizarTextoSimple(rn);
        if (/^(whatsapp|meta\s*ai|andreani|correo\s*argentino|oca\b|mercado\s*(libre|pago)|promociones\b|movistar\b|personal\s*flow|claro\b|claroargentina|tuenti\b|banco\s+|galicia\b|santander\b|bbva\b|macro\b|naranja\s*x|uala\b|brubank\b|pedidosya\b|rappi\b|uber\b|cabify\b|afip\b|arca\b|arba\b|edelap\b|camuzzi\b|absa\b)/i.test(norm)) {
            return true;
        }
    }
    return false;
}

function esContactoProveedorPorNombre(pushname, contactoNombre) {
    const comb = normalizarTextoSimple(`${pushname || ''} ${contactoNombre || ''}`);
    if (!comb) return false;
    return /\b(logistica|transporte|flete|fletes|expreso|mayorista|distribuidora|proveedor|kennilar|dicomere|villares|rtc|molino|frigorifico|importadora)\b/i.test(comb);
}

function esContactoProspectoPorTexto(pushname, contactoNombre, cuerpo = '', mediaFilename = '') {
    const fn = normalizarTextoSimple(mediaFilename || '');
    if (/(cotizacion|lista.*precio|presupuesto|prospecto|catalogo)/i.test(fn)) return true;

    const c = normalizarTextoSimple(cuerpo || '');
    if (/(cotizacion_consulta_de_precios|prospecto|lista de precios lamda|portal b2b|invitacion.*portal)/i.test(c)) return true;

    const rawNom = String(pushname || contactoNombre || '').trim();
    // Código legacy numérico al inicio del nombre agendado (ej: "670 Abril")
    if (/^\d{2,4}\s+[a-záéíóúñ]/i.test(rawNom)) return true;

    const nomNorm = normalizarTextoSimple(rawNom);
    if (/\b(dietetica|almacen|verduleria|sin gluten|fiambreria|panaderia|kiosco|autoservicio|minimercado|granola|frutos secos|naturales|don emilio|pivara|sizglu)\b/i.test(nomNorm)) {
        return true;
    }
    return false;
}

async function obtenerDirectorioProveedores(forceRefresh = false) {
    const ahora = Date.now();
    if (!forceRefresh && cacheProveedores && (ahora - cacheProveedoresTs) < 60000) {
        return cacheProveedores;
    }
    try {
        const res = await pool.query(`SELECT id, nombre, contacto, telefono FROM public.proveedores`);
        const lista = res.rows.map(r => {
            const infoTel = analizarTelefono(r.telefono);
            return {
                id: r.id,
                nombreNorm: normalizarTextoSimple(r.nombre),
                contactoNorm: normalizarTextoSimple(r.contacto),
                cola10: infoTel.cola10,
                cola8: infoTel.cola8
            };
        });
        cacheProveedores = lista;
        cacheProveedoresTs = ahora;
        return lista;
    } catch (_) {
        cacheProveedores = [];
        cacheProveedoresTs = ahora;
        return [];
    }
}

async function obtenerContextoAisladosPersonales(forceRefresh = false) {
    const ahora = Date.now();
    if (!forceRefresh && cacheAislados && (ahora - cacheAisladosTs) < 15000) {
        return cacheAislados;
    }
    try {
        const res = await pool.query(`
            SELECT bunker_cliente_id, cliente_nombre, contacto_nombre, pushname_wa
            FROM public.crm_whatsapp_chats
            WHERE (bunker_cliente_id IS NOT NULL AND (modo_privacidad = 'OCULTO' OR categoria_contacto = 'PERSONAL'))
               OR (categoria_manual = true AND categoria_contacto = 'PERSONAL')
        `);
        const bunkerIdsAislados = new Set();
        const gruposTokensPersona = [];
        for (const r of res.rows) {
            if (r.bunker_cliente_id) bunkerIdsAislados.add(Number(r.bunker_cliente_id));
            // Construir conjuntos de tokens de nombre (ej. "edit agustina nunez" -> ['edit','agustina','nunez'])
            const tokens = Array.from(new Set([
                ...extraerTokensNombrePersona(r.cliente_nombre),
                ...extraerTokensNombrePersona(r.pushname_wa),
                ...extraerTokensNombrePersona(r.contacto_nombre)
            ]));
            if (tokens.length >= 2) {
                gruposTokensPersona.push(new Set(tokens));
            }
        }
        cacheAislados = { bunkerIdsAislados, gruposTokensPersona };
        cacheAisladosTs = ahora;
        return cacheAislados;
    } catch (_) {
        return { bunkerIdsAislados: new Set(), gruposTokensPersona: [] };
    }
}

function coincidePersonaAisladaPorNombre(gruposTokensPersona, ...textos) {
    if (!gruposTokensPersona || gruposTokensPersona.length === 0) return false;
    const tokensCandidato = Array.from(new Set(textos.flatMap(t => extraerTokensNombrePersona(t))));
    if (tokensCandidato.length < 2) return false;
    for (const grupoSet of gruposTokensPersona) {
        let matches = 0;
        for (const tk of tokensCandidato) {
            if (grupoSet.has(tk)) matches++;
        }
        if (matches >= 2) return true;
    }
    return false;
}

async function determinarCategoriaContactoAutomatica({
    telefono,
    pushname,
    contactoNombre,
    bunkerClienteId = null,
    esClienteBunker = false,
    modoPrivacidad = 'ACTIVO',
    cuerpo = '',
    mediaFilename = '',
    tienePdfComercial = false
}) {
    const aislados = await obtenerContextoAisladosPersonales(false);

    // 1. Cliente Búnker: es CLIENTE_BUNKER salvo que su ficha esté aislada como OCULTO/PERSONAL
    if (bunkerClienteId || esClienteBunker) {
        if (modoPrivacidad === 'OCULTO' || (bunkerClienteId && aislados.bunkerIdsAislados.has(Number(bunkerClienteId)))) {
            return 'PERSONAL';
        }
        return 'CLIENTE_BUNKER';
    }

    // 2. Bots / Spam / Operadoras / Couriers automáticos
    if (esContactoBotOSpam(telefono, pushname, contactoNombre)) {
        return 'IGNORADO_BOT';
    }

    // 2b. Señal explícita de Captación de Nodos (contacto externo sin ficha Búnker) -> PROSPECTO_NODO activo
    if (nodosCaptacionCrm.esTextoSenalNodosParaCategoria(cuerpo, mediaFilename)) {
        return 'PROSPECTO_NODO';
    }

    // 3. Propagación por nombre a 2dos teléfonos de personas marcadas como OCULTO / PERSONAL (ej. Edit Agustina)
    if (modoPrivacidad === 'OCULTO' || coincidePersonaAisladaPorNombre(aislados.gruposTokensPersona, pushname, contactoNombre)) {
        return 'PERSONAL';
    }

    // 4. Proveedores (cruce por teléfono en public.proveedores o nombre comercial de proveedor/transporte)
    const proveedores = await obtenerDirectorioProveedores(false);
    const infoTel = analizarTelefono(telefono);
    const matchProvTel = proveedores.some(p =>
        (p.cola10 && infoTel.cola10 && p.cola10.length === 10 && p.cola10 === infoTel.cola10) ||
        (p.cola8 && infoTel.cola8 && p.cola8.length >= 8 && p.cola8 === infoTel.cola8)
    );
    if (matchProvTel || esContactoProveedorPorNombre(pushname, contactoNombre)) {
        return 'PROVEEDOR';
    }

    // 5. Prospecto comercial (PDF/cotización enviada o comercio/código legacy) vs Personal
    if (tienePdfComercial || esContactoProspectoPorTexto(pushname, contactoNombre, cuerpo, mediaFilename)) {
        return 'PROSPECTO';
    }

    return 'PERSONAL';
}

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
            ALTER TABLE public.crm_whatsapp_chats
            ADD COLUMN IF NOT EXISTS categoria_contacto VARCHAR(24) NOT NULL DEFAULT 'SIN_CLASIFICAR';

            ALTER TABLE public.crm_whatsapp_chats
            ADD COLUMN IF NOT EXISTS categoria_manual BOOLEAN NOT NULL DEFAULT false;

            CREATE INDEX IF NOT EXISTS idx_crm_wa_chats_categoria
            ON public.crm_whatsapp_chats(categoria_contacto, esperando_respuesta);

            ALTER TABLE public.crm_whatsapp_chats
            ADD COLUMN IF NOT EXISTS rol_operativo VARCHAR(32) NULL;

            ALTER TABLE public.crm_whatsapp_chats
            ADD COLUMN IF NOT EXISTS rol_manual BOOLEAN NOT NULL DEFAULT false;

            ALTER TABLE public.crm_whatsapp_chats
            ADD COLUMN IF NOT EXISTS apodo_preferido VARCHAR(60) NULL;

            ALTER TABLE public.crm_whatsapp_chats
            ADD COLUMN IF NOT EXISTS memoria_trato_json JSONB NOT NULL DEFAULT '{}'::jsonb;

            CREATE INDEX IF NOT EXISTS idx_crm_wa_chats_rol_operativo
            ON public.crm_whatsapp_chats(rol_operativo);

            ALTER TABLE public.crm_whatsapp_chats
            ADD COLUMN IF NOT EXISTS frente_activo VARCHAR(30) NOT NULL DEFAULT 'AUTO';

            ALTER TABLE public.crm_whatsapp_chats
            ADD COLUMN IF NOT EXISTS nodo_captacion_json JSONB NOT NULL DEFAULT '{}'::jsonb;

            CREATE INDEX IF NOT EXISTS idx_crm_wa_chats_frente_activo
            ON public.crm_whatsapp_chats(frente_activo, categoria_contacto);
        `);
        await pool.query(`
            ALTER TABLE public.factura_cuenta_corriente_movimientos
            ADD COLUMN IF NOT EXISTS origen_tipo VARCHAR(100) GENERATED ALWAYS AS (tipo_comprobante) STORED;
        `).catch(() => {});
        tablasVerificadas = true;
        console.log('✅ [CRM-WHATSAPP-DB] Tablas crm_whatsapp_chats y crm_whatsapp_mensajes verificadas.');
        await sembrarDirectorioClientesEnChats();
        await deduplicarAdjuntosSalientesDuplicados().catch(errDup => {
            console.warn('⚠️ [CRM-WHATSAPP-DB] Error en deduplicación inicial de adjuntos:', errDup.message);
        });
        await limpiarMensajesProtocoloHistoricos().catch(errProto => {
            console.warn('⚠️ [CRM-WHATSAPP-DB] Error limpiando mensajes de protocolo:', errProto.message);
        });
        await clasificarChatsExistentesIdempotente().catch(errCat => {
            console.warn('⚠️ [CRM-WHATSAPP-DB] Error clasificando categorías iniciales de chats:', errCat.message);
        });
        await clasificarRolesOperativosExistentesIdempotente().catch(errRol => {
            console.warn('⚠️ [CRM-WHATSAPP-DB] Error clasificando roles operativos iniciales:', errRol.message);
        });
        await clasificarFrenteNodosExistentesIdempotente().catch(errNodos => {
            console.warn('⚠️ [CRM-WHATSAPP-DB] Error clasificando hilos de Captación de Nodos iniciales:', errNodos.message);
        });
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
                                    rol_operativo: ROLES_OPERATIVOS_VALIDOS.has(String(ct.rol_operativo || '').toUpperCase())
                                        ? String(ct.rol_operativo).toUpperCase()
                                        : null,
                                    flagsBunker: {
                                        default_factura: ct.default_factura,
                                        default_resumen: ct.default_resumen,
                                        default_presupuesto: ct.default_presupuesto,
                                        default_difusion: ct.default_difusion
                                    },
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

function limpiarPrefijoAdjuntoCuerpo(texto) {
    return String(texto || '')
        .replace(/^(?:📄|📷|📎)\s*\[[^\]]+\]\s*/u, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function tienePrefijoAdjuntoCuerpo(texto) {
    return /^(?:📄|📷|📎)\s*\[[^\]]+\]/u.test(String(texto || '').trim());
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
    // Filtro estricto de eventos de protocolo WhatsApp (jamás persistir ni activar alertas falsas)
    if (esTipoMensajeProtocoloIgnorado(tipoMensaje, cuerpo)) {
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
    const cuerpoNormalizadoSinPrefijo = limpiarPrefijoAdjuntoCuerpo(textoResumen);

    try {
        // 1. Verificar si ya existe el mensaje en ESTE chat (por msg_id, por texto exacto, por texto normalizado sin prefijo 📄/📷 [archivo], o por media_filename en ventana de 35s)
        const msgExistente = await pool.query(`
            SELECT id, msg_id, ack, cuerpo, media_filename, media_mimetype
            FROM public.crm_whatsapp_mensajes
            WHERE (msg_id = $1 AND chat_id = $2)
               OR (
                   chat_id = $2
                   AND from_me = $3
                   AND ABS(EXTRACT(EPOCH FROM (fecha_mensaje - $5::timestamp))) <= 35
                   AND (
                       (TRIM(COALESCE(cuerpo, '')) = TRIM($4) AND TRIM($4) <> '')
                       OR (
                           $6 <> ''
                           AND REGEXP_REPLACE(
                                   REGEXP_REPLACE(TRIM(COALESCE(cuerpo, '')), '^(📄|📷|📎)\\s*\\[[^\\]]+\\]\\s*', ''),
                                   '\\s+', ' ', 'g'
                               ) = $6
                       )
                       OR (
                           $7::text IS NOT NULL AND $7::text <> ''
                           AND media_filename IS NOT NULL
                           AND LOWER(TRIM(media_filename)) = LOWER(TRIM($7::text))
                       )
                   )
               )
            ORDER BY (msg_id = $1) DESC, id ASC
            LIMIT 1
        `, [idUnicoMsg, chatId, Boolean(fromMe), textoResumen, fechaMsg, cuerpoNormalizadoSinPrefijo, mediaFilename || null]);
        const esMensajeNuevo = msgExistente.rows.length === 0;

        // Preservar transcripciones de audio y también prefijo visible de adjunto ("📄 [archivo.pdf] ...")
        let textoResumenEfectivo = textoResumen;
        const cuerpoPrevioMsg = msgExistente.rows[0]?.cuerpo ? String(msgExistente.rows[0].cuerpo).trim() : '';
        if ((cuerpoPrevioMsg.startsWith('🎤 Audio:') || (cuerpoPrevioMsg.startsWith('🎤') && cuerpoPrevioMsg !== '🎤 Mensaje de audio')) && (textoResumenEfectivo === '🎤 Mensaje de audio' || !cuerpoLimpio)) {
            textoResumenEfectivo = cuerpoPrevioMsg;
        } else if (tienePrefijoAdjuntoCuerpo(cuerpoPrevioMsg) && !tienePrefijoAdjuntoCuerpo(textoResumenEfectivo)) {
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

            // Resolver categoría automática solo si el operador no fijó una categoría manual
            let nuevaCategoria = chatActual.categoria_contacto || 'SIN_CLASIFICAR';
            let nuevoModoPriv = chatActual.modo_privacidad || 'ACTIVO';
            const esSenalNodosMsg = nodosCaptacionCrm.esTextoSenalNodosParaCategoria(textoResumenEfectivo, mediaFilename);
            const esPdfComercialEnvio = Boolean(fromMe) && esContactoProspectoPorTexto('', '', textoResumenEfectivo, mediaFilename);
            if (!chatActual.categoria_manual) {
                if (!bunkerIdFinal && esSenalNodosMsg && ['SIN_CLASIFICAR', 'PERSONAL', 'PROSPECTO'].includes(nuevaCategoria)) {
                    nuevaCategoria = 'PROSPECTO_NODO';
                    nuevoModoPriv = 'ACTIVO';
                } else if (nuevaCategoria === 'SIN_CLASIFICAR' || (bunkerIdFinal && nuevaCategoria !== 'CLIENTE_BUNKER' && nuevaCategoria !== 'PERSONAL') || (esPdfComercialEnvio && nuevaCategoria === 'PERSONAL' && !bunkerIdFinal)) {
                    nuevaCategoria = await determinarCategoriaContactoAutomatica({
                        telefono: infoTel.limpio,
                        pushname: pushnameWa || chatActual.pushname_wa,
                        contactoNombre: contactoNombreFinal || chatActual.contacto_nombre,
                        bunkerClienteId: bunkerIdFinal,
                        esClienteBunker: esClienteFinal,
                        modoPrivacidad: nuevoModoPriv,
                        cuerpo: textoResumenEfectivo,
                        mediaFilename,
                        tienePdfComercial: esPdfComercialEnvio
                    });
                }
                if (nuevaCategoria === 'IGNORADO_BOT') {
                    nuevoModoPriv = 'OCULTO';
                } else if ((nuevaCategoria === 'PROSPECTO' && esPdfComercialEnvio && nuevoModoPriv === 'OCULTO')
                    || (nuevaCategoria === 'PROSPECTO_NODO' && nuevoModoPriv === 'OCULTO')) {
                    nuevoModoPriv = 'ACTIVO';
                }
            }

            // Actualizar metadatos de frente Nodos si entra/sale señal explícita de Nodos (sin pisar si fue bloqueado en MAYORISTA)
            let nuevoNodoJson = (chatActual.nodo_captacion_json && typeof chatActual.nodo_captacion_json === 'object')
                ? { ...chatActual.nodo_captacion_json }
                : {};
            let cambioNodoJson = false;
            if (esSenalNodosMsg && String(chatActual.frente_activo || 'AUTO').toUpperCase() !== 'MAYORISTA') {
                const esPdfNodo = /(proyecto.*nodo|propuesta.*nodo|nodo.*lamda)/i.test(String(mediaFilename || ''));
                if (!nuevoNodoJson.activo) {
                    nuevoNodoJson.activo = true;
                    nuevoNodoJson.origen = nuevoNodoJson.origen || 'auto_hilo';
                    nuevoNodoJson.etapa = nuevoNodoJson.etapa || (esPdfNodo ? 'PROPUESTA_ENVIADA' : 'INVITACION_INICIAL');
                    nuevoNodoJson.actualizado_en = new Date().toISOString();
                    cambioNodoJson = true;
                } else if (esPdfNodo && (!nuevoNodoJson.etapa || nuevoNodoJson.etapa === 'INVITACION_INICIAL')) {
                    nuevoNodoJson.etapa = 'PROPUESTA_ENVIADA';
                    nuevoNodoJson.actualizado_en = new Date().toISOString();
                    cambioNodoJson = true;
                }
            }

            if (esMasReciente || tieneUnreadExplicito || nuevaCategoria !== chatActual.categoria_contacto || cambioNodoJson) {
                let nuevoEsperando = tieneUnreadExplicito
                    ? esNoLeidoExplicito
                    : (fromMe ? false : (esMensajeNuevo ? true : Boolean(chatActual.esperando_respuesta)));
                let nuevoNoLeidos = tieneUnreadExplicito
                    ? cantNoLeidosExplicito
                    : (fromMe ? 0 : (esMensajeNuevo ? (parseInt(chatActual.no_leidos || 0) + 1) : parseInt(chatActual.no_leidos || 0)));

                if (nuevaCategoria === 'IGNORADO_BOT') {
                    nuevoEsperando = false;
                    nuevoNoLeidos = 0;
                }

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
                        categoria_contacto = $16,
                        modo_privacidad = $17,
                        nodo_captacion_json = $18::jsonb,
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
                    esMasReciente,
                    nuevaCategoria,
                    nuevoModoPriv,
                    JSON.stringify(nuevoNodoJson)
                ]);
            }
        } else {
            // Crear el chat por primera vez con categoría automática (Negocio / Nodos vs Personal / Proveedor / Bot)
            const esSenalNodosMsg = nodosCaptacionCrm.esTextoSenalNodosParaCategoria(textoResumenEfectivo, mediaFilename);
            const esPdfComercialEnvio = Boolean(fromMe) && esContactoProspectoPorTexto('', '', textoResumenEfectivo, mediaFilename);
            const categoriaInicial = await determinarCategoriaContactoAutomatica({
                telefono: infoTel.limpio,
                pushname: pushnameWa,
                contactoNombre: contactoNombreFinal,
                bunkerClienteId: bunkerIdFinal,
                esClienteBunker: esClienteFinal,
                modoPrivacidad: 'ACTIVO',
                cuerpo: textoResumenEfectivo,
                mediaFilename,
                tienePdfComercial: esPdfComercialEnvio
            });
            const modoPrivInicial = (categoriaInicial === 'IGNORADO_BOT' || categoriaInicial === 'PERSONAL')
                ? 'OCULTO'
                : (categoriaInicial === 'PROVEEDOR' ? 'SILENCIADO_PIZARRA' : 'ACTIVO');
            const esperandoInicial = categoriaInicial === 'IGNORADO_BOT'
                ? false
                : (tieneUnreadExplicito ? esNoLeidoExplicito : (fromMe ? false : true));
            const noLeidosInicial = categoriaInicial === 'IGNORADO_BOT'
                ? 0
                : (tieneUnreadExplicito ? cantNoLeidosExplicito : (fromMe ? 0 : 1));
            const nodoJsonInicial = (categoriaInicial === 'PROSPECTO_NODO' || esSenalNodosMsg)
                ? {
                    activo: true,
                    etapa: /(proyecto.*nodo|propuesta.*nodo|nodo.*lamda)/i.test(String(mediaFilename || '')) ? 'PROPUESTA_ENVIADA' : 'INVITACION_INICIAL',
                    origen: 'auto_hilo',
                    actualizado_en: new Date().toISOString()
                }
                : {};

            await pool.query(`
                INSERT INTO public.crm_whatsapp_chats (
                    chat_id, telefono_normalizado, ultimos_digitos,
                    bunker_cliente_id, cliente_nombre, codigo_bunker_cliente,
                    contacto_nombre, contacto_cargo, pushname_wa,
                    es_cliente_bunker, modo_privacidad, categoria_contacto,
                    nodo_captacion_json,
                    esperando_respuesta, no_leidos,
                    ultimo_mensaje_texto, ultimo_mensaje_from_me, ultimo_mensaje_ack, ultimo_mensaje_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16, $17, $18, $19)
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
                modoPrivInicial,
                categoriaInicial,
                JSON.stringify(nodoJsonInicial),
                esperandoInicial,
                noLeidosInicial,
                textoResumenEfectivo,
                fromMe,
                ack || 1,
                fechaMsg
            ]);
        }

        // 3. Insertar o actualizar el mensaje en el historial (sin duplicar burbujas, reconciliando msg_id lamda-* -> 3EB0... real y preservando adjunto/transcripción)
        if (!esMensajeNuevo && msgExistente.rows[0]) {
            const filaExist = msgExistente.rows[0];
            const prevEsTemporal = String(filaExist.msg_id || '').startsWith('lamda-');
            const nuevoEsReal = idUnicoMsg && !String(idUnicoMsg).startsWith('lamda-');
            let msgIdReconciliado = filaExist.msg_id;
            if (prevEsTemporal && nuevoEsReal && idUnicoMsg !== filaExist.msg_id) {
                const colision = await pool.query(
                    'SELECT id FROM public.crm_whatsapp_mensajes WHERE msg_id = $1 AND id <> $2 LIMIT 1',
                    [idUnicoMsg, filaExist.id]
                );
                if (colision.rows.length === 0) {
                    msgIdReconciliado = idUnicoMsg;
                }
            }

            await pool.query(`
                UPDATE public.crm_whatsapp_mensajes
                SET msg_id = $2,
                    ack = GREATEST(ack, $3),
                    media_filename = COALESCE(media_filename, $5),
                    media_mimetype = COALESCE(media_mimetype, $6),
                    cuerpo = CASE
                        WHEN (cuerpo LIKE '🎤 Audio:%' OR (cuerpo LIKE '🎤%' AND cuerpo <> '🎤 Mensaje de audio')) AND ($4 = '🎤 Mensaje de audio' OR $4 = '') THEN cuerpo
                        ELSE COALESCE(NULLIF($4, ''), cuerpo)
                    END
                WHERE id = $1
            `, [filaExist.id, msgIdReconciliado, ack || 1, textoResumenEfectivo, mediaFilename || null, mediaMimetype || null]);
        } else {
            await pool.query(`
                INSERT INTO public.crm_whatsapp_mensajes (
                    msg_id, chat_id, bunker_cliente_id, from_me,
                    cuerpo, tipo_mensaje, media_filename, media_mimetype,
                    ack, origen_envio, fecha_mensaje
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                ON CONFLICT (msg_id) DO UPDATE
                SET ack = GREATEST(public.crm_whatsapp_mensajes.ack, EXCLUDED.ack),
                    media_filename = COALESCE(public.crm_whatsapp_mensajes.media_filename, EXCLUDED.media_filename),
                    media_mimetype = COALESCE(public.crm_whatsapp_mensajes.media_mimetype, EXCLUDED.media_mimetype),
                    cuerpo = CASE
                        WHEN (public.crm_whatsapp_mensajes.cuerpo LIKE '🎤 Audio:%' OR (public.crm_whatsapp_mensajes.cuerpo LIKE '🎤%' AND public.crm_whatsapp_mensajes.cuerpo <> '🎤 Mensaje de audio'))
                             AND (EXCLUDED.cuerpo = '🎤 Mensaje de audio' OR EXCLUDED.cuerpo = '')
                        THEN public.crm_whatsapp_mensajes.cuerpo
                        WHEN public.crm_whatsapp_mensajes.cuerpo ~ '^(📄|📷|📎)\s*\[[^\]]+\]'
                             AND NOT (COALESCE(EXCLUDED.cuerpo, '') ~ '^(📄|📷|📎)\s*\[[^\]]+\]')
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
            await pool.query(`
                UPDATE public.crm_cliente_sintesis_memoria
                SET razonamiento_ia_json = NULL,
                    ultimo_msg_id_razonado = 0,
                    ultima_actualizacion_en = NOW()
                WHERE cliente_bunker_id = $1
            `, [cliId]).catch(() => {});
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
    const rawId = String(msgId).split('_').pop();
    try {
        await pool.query(`
            UPDATE public.crm_whatsapp_mensajes
            SET ack = GREATEST(ack, $2)
            WHERE msg_id = $1 OR msg_id = $3
        `, [rawId, nuevoAck, String(msgId)]);

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
 * Rutina idempotente de saneamiento: fusiona pares duplicados donde un envío saliente de LAMDA
 * quedó con `msg_id LIKE 'lamda-%'` y segundos después ingresó su eco real (`3EB0...`) desde WhatsApp Web.
 * Conserva la fila con el `msg_id` real y su `ack`, enriquecida con el prefijo del adjunto (`📄 [archivo.pdf]`),
 * y elimina únicamente la fila temporal redundante. Nunca toca mensajes únicos.
 */
async function deduplicarAdjuntosSalientesDuplicados() {
    const pares = await pool.query(`
        SELECT DISTINCT ON (a.id)
            a.id AS temp_id,
            a.cuerpo AS temp_cuerpo,
            a.media_filename AS temp_filename,
            a.media_mimetype AS temp_mimetype,
            a.ack AS temp_ack,
            b.id AS real_id,
            b.cuerpo AS real_cuerpo,
            b.ack AS real_ack
        FROM public.crm_whatsapp_mensajes a
        JOIN public.crm_whatsapp_mensajes b
          ON b.chat_id = a.chat_id
         AND b.from_me = TRUE
         AND b.id <> a.id
         AND b.msg_id NOT LIKE 'lamda-%'
         AND ABS(EXTRACT(EPOCH FROM (a.fecha_mensaje - b.fecha_mensaje))) <= 35
         AND (
             (
                 a.media_filename IS NOT NULL AND a.media_filename <> ''
                 AND b.media_filename IS NOT NULL
                 AND LOWER(TRIM(a.media_filename)) = LOWER(TRIM(b.media_filename))
             )
             OR (
                 REGEXP_REPLACE(
                     REGEXP_REPLACE(TRIM(COALESCE(a.cuerpo, '')), '^(📄|📷|📎)\\s*\\[[^\\]]+\\]\\s*', ''),
                     '\\s+', ' ', 'g'
                 ) = REGEXP_REPLACE(
                     REGEXP_REPLACE(TRIM(COALESCE(b.cuerpo, '')), '^(📄|📷|📎)\\s*\\[[^\\]]+\\]\\s*', ''),
                     '\\s+', ' ', 'g'
                 )
                 AND TRIM(COALESCE(b.cuerpo, '')) <> ''
             )
         )
        WHERE a.from_me = TRUE
          AND a.msg_id LIKE 'lamda-%'
        ORDER BY a.id ASC, ABS(EXTRACT(EPOCH FROM (a.fecha_mensaje - b.fecha_mensaje))) ASC
    `);

    if (pares.rows.length === 0) return 0;

    let fusionados = 0;
    for (const p of pares.rows) {
        const cuerpoFinal = (tienePrefijoAdjuntoCuerpo(p.temp_cuerpo) && !tienePrefijoAdjuntoCuerpo(p.real_cuerpo))
            ? p.temp_cuerpo
            : (p.real_cuerpo || p.temp_cuerpo);

        await pool.query(`
            UPDATE public.crm_whatsapp_mensajes
            SET cuerpo = $2,
                media_filename = COALESCE(media_filename, $3),
                media_mimetype = COALESCE(media_mimetype, $4),
                ack = GREATEST(ack, $5)
            WHERE id = $1
        `, [p.real_id, cuerpoFinal, p.temp_filename || null, p.temp_mimetype || null, p.temp_ack || 1]);

        await pool.query('DELETE FROM public.crm_whatsapp_mensajes WHERE id = $1', [p.temp_id]);
        fusionados++;
    }

    if (fusionados > 0) {
        console.log(`🧹 [CRM-WHATSAPP-DB] Fusionados ${fusionados} pares de mensajes/adjuntos salientes duplicados (lamda-* -> msg_id real).`);
    }
    return fusionados;
}

/**
 * Rutina idempotente de saneamiento: elimina eventos técnicos de protocolo WhatsApp
 * (call_log, notification_template, e2e_notification, revoked, rich_response, etc.)
 * y recalcula ultimo_mensaje_* y esperando_respuesta de los chats afectados.
 */
async function limpiarMensajesProtocoloHistoricos() {
    const tiposArr = Array.from(TIPOS_MENSAJE_PROTOCOLO_IGNORADOS);
    const delRes = await pool.query(`
        DELETE FROM public.crm_whatsapp_mensajes
        WHERE LOWER(COALESCE(tipo_mensaje, '')) = ANY($1::text[])
           OR TRIM(COALESCE(cuerpo, '')) ~* '^💬\\s*\\[(e2e_notification|notification_template|call_log|revoked|rich_response|gp2|protocol|biz_content_placeholder|ciphertext|notification|broadcast_notification|group_notification|unknown)\\]'
        RETURNING chat_id
    `, [tiposArr]);

    const chatsAfectados = new Set(delRes.rows.map(r => r.chat_id));

    // Detectar también chats cuyo ultimo_mensaje_texto todavía exhibe una etiqueta de protocolo
    const chatsTextoProto = await pool.query(`
        SELECT chat_id
        FROM public.crm_whatsapp_chats
        WHERE TRIM(COALESCE(ultimo_mensaje_texto, '')) ~* '^💬\\s*\\[(e2e_notification|notification_template|call_log|revoked|rich_response|gp2|protocol|biz_content_placeholder|ciphertext|notification|broadcast_notification|group_notification|unknown)\\]'
    `);
    chatsTextoProto.rows.forEach(r => chatsAfectados.add(r.chat_id));

    let chatsRecalculados = 0;
    for (const cid of chatsAfectados) {
        const ultRes = await pool.query(`
            SELECT cuerpo, from_me, ack, fecha_mensaje
            FROM public.crm_whatsapp_mensajes
            WHERE chat_id = $1
            ORDER BY fecha_mensaje DESC, id DESC
            LIMIT 1
        `, [cid]);

        if (ultRes.rows.length > 0) {
            const ult = ultRes.rows[0];
            await pool.query(`
                UPDATE public.crm_whatsapp_chats
                SET ultimo_mensaje_texto = $2,
                    ultimo_mensaje_from_me = $3,
                    ultimo_mensaje_ack = $4,
                    ultimo_mensaje_at = $5,
                    esperando_respuesta = CASE WHEN $3 = true THEN false ELSE esperando_respuesta END,
                    no_leidos = CASE WHEN $3 = true THEN 0 ELSE no_leidos END,
                    updated_at = NOW()
                WHERE chat_id = $1
            `, [cid, ult.cuerpo, Boolean(ult.from_me), ult.ack || 1, ult.fecha_mensaje]);
        } else {
            await pool.query(`
                UPDATE public.crm_whatsapp_chats
                SET ultimo_mensaje_texto = NULL,
                    ultimo_mensaje_from_me = false,
                    ultimo_mensaje_ack = 0,
                    ultimo_mensaje_at = NULL,
                    esperando_respuesta = false,
                    no_leidos = 0,
                    updated_at = NOW()
                WHERE chat_id = $1
            `, [cid]);
        }
        chatsRecalculados++;
    }

    if (delRes.rowCount > 0 || chatsRecalculados > 0) {
        console.log(`🧹 [CRM-WHATSAPP-DB] Limpieza de protocolo WA: ${delRes.rowCount} eventos eliminados, ${chatsRecalculados} chats recalculados.`);
    }
    return { eliminados: delRes.rowCount, chatsRecalculados };
}

/**
 * Propaga el aislamiento PERSONAL / OCULTO a todos los teléfonos del mismo cliente Búnker
 * y también a posibles segundos números no vinculados que compartan nombre y apellido (>=2 tokens).
 */
async function propagarCategoriaPersonalEnCliente({ bunkerClienteId = null, clienteNombre = '', contactoNombre = '', pushnameWa = '' } = {}) {
    let propagados = 0;
    if (bunkerClienteId) {
        const resB = await pool.query(`
            UPDATE public.crm_whatsapp_chats
            SET categoria_contacto = 'PERSONAL',
                modo_privacidad = 'OCULTO',
                esperando_respuesta = false,
                no_leidos = 0,
                updated_at = NOW()
            WHERE bunker_cliente_id = $1
              AND (categoria_contacto <> 'PERSONAL' OR modo_privacidad <> 'OCULTO' OR esperando_respuesta = true)
        `, [Number(bunkerClienteId)]);
        propagados += resB.rowCount;
    }

    const tokensBase = Array.from(new Set([
        ...extraerTokensNombrePersona(clienteNombre),
        ...extraerTokensNombrePersona(contactoNombre),
        ...extraerTokensNombrePersona(pushnameWa)
    ]));
    if (tokensBase.length >= 2) {
        const baseSet = new Set(tokensBase);
        const sinVinc = await pool.query(`
            SELECT id, contacto_nombre, pushname_wa
            FROM public.crm_whatsapp_chats
            WHERE bunker_cliente_id IS NULL
              AND categoria_manual = false
              AND (categoria_contacto <> 'PERSONAL' OR modo_privacidad <> 'OCULTO' OR esperando_respuesta = true)
        `);
        for (const r of sinVinc.rows) {
            if (coincidePersonaAisladaPorNombre([baseSet], r.pushname_wa, r.contacto_nombre)) {
                await pool.query(`
                    UPDATE public.crm_whatsapp_chats
                    SET categoria_contacto = 'PERSONAL',
                        modo_privacidad = 'OCULTO',
                        esperando_respuesta = false,
                        no_leidos = 0,
                        updated_at = NOW()
                    WHERE id = $1
                `, [r.id]);
                propagados++;
            }
        }
    }
    invalidarCacheCategoriasCrm();
    return propagados;
}

/**
 * Clasificación idempotente inicial y de respaldo para todos los chats en crm_whatsapp_chats
 * que aún no tienen categoría manual (categoria_manual = false).
 * Garantiza separación estricta: CLIENTE_BUNKER, PROSPECTO, PROVEEDOR, PERSONAL, IGNORADO_BOT.
 */
async function clasificarChatsExistentesIdempotente() {
    invalidarCacheCategoriasCrm();
    await obtenerDirectorioProveedores(true);
    await obtenerContextoAisladosPersonales(true);

    // 1. Propagar primero aislamiento a todos los teléfonos de fichas Búnker OCULTO/PERSONAL o marcadas manualmente como PERSONAL
    const ocultosRes = await pool.query(`
        SELECT DISTINCT bunker_cliente_id, cliente_nombre, contacto_nombre, pushname_wa
        FROM public.crm_whatsapp_chats
        WHERE (bunker_cliente_id IS NOT NULL AND (modo_privacidad = 'OCULTO' OR categoria_contacto = 'PERSONAL'))
           OR (categoria_manual = true AND categoria_contacto = 'PERSONAL')
    `);
    for (const oc of ocultosRes.rows) {
        await propagarCategoriaPersonalEnCliente({
            bunkerClienteId: oc.bunker_cliente_id,
            clienteNombre: oc.cliente_nombre,
            contactoNombre: oc.contacto_nombre,
            pushnameWa: oc.pushname_wa
        });
    }

    // 2. Identificar chats sin bunker_cliente_id a los que LAMDA ya envió PDFs/cotizaciones comerciales
    const pdfComRes = await pool.query(`
        SELECT DISTINCT chat_id
        FROM public.crm_whatsapp_mensajes
        WHERE from_me = true
          AND (
              LOWER(COALESCE(media_filename, '')) ~ '(cotizacion|lista|presupuesto|prospecto|catalogo)'
              OR LOWER(COALESCE(cuerpo, '')) ~ '(cotizacion_consulta_de_precios|prospecto|lista de precios lamda|portal b2b)'
          )
    `);
    const chatsConPdfComercial = new Set(pdfComRes.rows.map(r => r.chat_id));

    // 3. Evaluar chats no manuales (o SIN_CLASIFICAR), preservando siempre PROSPECTO_NODO activos
    const chatsRes = await pool.query(`
        SELECT id, chat_id, telefono_normalizado, bunker_cliente_id, es_cliente_bunker,
               cliente_nombre, contacto_nombre, pushname_wa, modo_privacidad,
               categoria_contacto, categoria_manual, ultimo_mensaje_texto, esperando_respuesta,
               frente_activo, nodo_captacion_json
        FROM public.crm_whatsapp_chats
        WHERE (categoria_manual = false OR categoria_contacto = 'SIN_CLASIFICAR')
          AND categoria_contacto <> 'PROSPECTO_NODO'
          AND COALESCE(frente_activo, 'AUTO') <> 'NODOS'
          AND NOT (bunker_cliente_id IS NULL AND COALESCE((nodo_captacion_json->>'activo')::boolean, false) = true)
    `);

    let actualizados = 0;
    const resumen = { CLIENTE_BUNKER: 0, PROSPECTO: 0, PROSPECTO_NODO: 0, PROVEEDOR: 0, PERSONAL: 0, IGNORADO_BOT: 0 };

    for (const ch of chatsRes.rows) {
        const catNueva = await determinarCategoriaContactoAutomatica({
            telefono: ch.telefono_normalizado || ch.chat_id,
            pushname: ch.pushname_wa,
            contactoNombre: ch.contacto_nombre,
            bunkerClienteId: ch.bunker_cliente_id,
            esClienteBunker: Boolean(ch.es_cliente_bunker),
            modoPrivacidad: ch.modo_privacidad || 'ACTIVO',
            cuerpo: ch.ultimo_mensaje_texto || '',
            mediaFilename: '',
            tienePdfComercial: chatsConPdfComercial.has(ch.chat_id)
        });
        resumen[catNueva] = (resumen[catNueva] || 0) + 1;

        let nuevoModo = ch.modo_privacidad || 'ACTIVO';
        let nuevoEsp = Boolean(ch.esperando_respuesta);
        let limpiarNoLeidos = false;

        if (catNueva === 'IGNORADO_BOT') {
            nuevoModo = 'OCULTO';
            nuevoEsp = false;
            limpiarNoLeidos = true;
        } else if (catNueva === 'PROSPECTO_NODO') {
            nuevoModo = 'ACTIVO';
        } else if (catNueva === 'PERSONAL') {
            nuevoModo = 'OCULTO';
            if (!ch.bunker_cliente_id) {
                nuevoEsp = false;
                limpiarNoLeidos = true;
            }
        } else if (catNueva === 'PROVEEDOR' && nuevoModo === 'ACTIVO') {
            nuevoModo = 'SILENCIADO_PIZARRA';
        }

        if (catNueva !== ch.categoria_contacto || nuevoModo !== ch.modo_privacidad || nuevoEsp !== Boolean(ch.esperando_respuesta)) {
            await pool.query(`
                UPDATE public.crm_whatsapp_chats
                SET categoria_contacto = $2,
                    modo_privacidad = $3,
                    esperando_respuesta = $4,
                    no_leidos = CASE WHEN $5::boolean THEN 0 ELSE no_leidos END,
                    updated_at = NOW()
                WHERE id = $1
            `, [ch.id, catNueva, nuevoModo, nuevoEsp, limpiarNoLeidos]);
            actualizados++;
        }
    }

    if (actualizados > 0) {
        console.log(`🏷️ [CRM-WHATSAPP-DB] Clasificación automática de chats actualizada (${actualizados} cambios):`, JSON.stringify(resumen));
    }
    return { actualizados, resumen };
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
                const rolInferidoSiembra = inferirRolOperativoDeterminista({
                    rolExplicito: ct.rol_operativo || null,
                    cargo: ct.cargo || '',
                    nombre: ct.nombre || '',
                    clienteNombre: cli.cliente_nombre || '',
                    flagsBunker: ct.flagsBunker || null
                });

                await pool.query(`
                    INSERT INTO public.crm_whatsapp_chats (
                        chat_id, telefono_normalizado, ultimos_digitos,
                        bunker_cliente_id, cliente_nombre, codigo_bunker_cliente,
                        contacto_nombre, contacto_cargo, rol_operativo, es_cliente_bunker,
                        modo_privacidad, esperando_respuesta, no_leidos,
                        ultimo_mensaje_texto, ultimo_mensaje_from_me, ultimo_mensaje_ack, ultimo_mensaje_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, 'ACTIVO', false, 0, 'Cliente Búnker vinculado', true, 2, NULL)
                    ON CONFLICT (chat_id) DO UPDATE SET
                        bunker_cliente_id = EXCLUDED.bunker_cliente_id,
                        cliente_nombre = EXCLUDED.cliente_nombre,
                        codigo_bunker_cliente = EXCLUDED.codigo_bunker_cliente,
                        contacto_nombre = COALESCE(NULLIF(EXCLUDED.contacto_nombre, ''), public.crm_whatsapp_chats.contacto_nombre),
                        contacto_cargo = COALESCE(NULLIF(EXCLUDED.contacto_cargo, ''), public.crm_whatsapp_chats.contacto_cargo),
                        rol_operativo = CASE
                            WHEN public.crm_whatsapp_chats.rol_manual THEN public.crm_whatsapp_chats.rol_operativo
                            ELSE COALESCE(NULLIF(EXCLUDED.rol_operativo, ''), public.crm_whatsapp_chats.rol_operativo)
                        END,
                        es_cliente_bunker = true
                `, [
                    chatId,
                    ct.limpio,
                    ct.cola8,
                    cli.bunker_cliente_id,
                    cli.cliente_nombre,
                    cli.codigo_bunker_cliente,
                    ct.nombre || cli.cliente_nombre,
                    ct.cargo || '',
                    rolInferidoSiembra
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

            const rawMensajes = Array.isArray(item.mensajes) ? item.mensajes : [];
            const mensajesReales = rawMensajes.filter(m => !esTipoMensajeProtocoloIgnorado(m?.tipoMensaje, m?.cuerpo));

            // Si WhatsApp reportó unreadCount pero todos los mensajes del lote son ruido de protocolo, no activar alerta falsa
            if (rawMensajes.length > 0 && mensajesReales.length === 0) {
                continue;
            }
            if (rawMensajes.length === 0 && esTipoMensajeProtocoloIgnorado('', item.ultimoTexto)) {
                continue;
            }

            chatIdsNoLeidos.push(item.chatId);

            const ordenados = [...mensajesReales].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

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
                    SET esperando_respuesta = CASE WHEN categoria_contacto = 'IGNORADO_BOT' THEN false ELSE true END,
                        no_leidos = CASE WHEN categoria_contacto = 'IGNORADO_BOT' THEN 0 ELSE $2 END,
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

/**
 * Taxonomía cerrada de Roles Operativos por contacto / línea WhatsApp (Fase 3.5)
 */
const ROLES_OPERATIVOS_VALIDOS = new Set([
    'DUENO_TITULAR',
    'COMPRAS_PEDIDOS',
    'PAGOS_ADMIN',
    'RECEPCION_LOCAL',
    'COMPARTIDO'
]);

function normalizarTextoRol(str) {
    return String(str || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Infiere de forma 100% determinista ($0 IA) el rol operativo inicial de un contacto
 * a partir de su cargo, nombre vs. razón social y flags en bunker_clientes.whatsapp_facturas.
 * Devuelve null cuando el cargo es ambiguo ("Contacto Lomas", "Teléfono Ficha" o vacío).
 */
function inferirRolOperativoDeterminista({ rolExplicito = null, cargo = '', nombre = '', clienteNombre = '', flagsBunker = null } = {}) {
    const expNorm = String(rolExplicito || '').trim().toUpperCase();
    if (ROLES_OPERATIVOS_VALIDOS.has(expNorm)) return expNorm;

    const cargoNorm = normalizarTextoRol(cargo);
    const nomNorm = normalizarTextoRol(nombre);
    const cliNorm = normalizarTextoRol(clienteNombre);

    if (cargoNorm) {
        if (/(duen[oa]|titular|soci[oa]|propietari|director|gerente)/.test(cargoNorm)) {
            return 'DUENO_TITULAR';
        }
        if (/(pago|pagos|admin|administracion|contad|tesorer|cobranz|factur)/.test(cargoNorm)) {
            return 'PAGOS_ADMIN';
        }
        if (/(compra|compras|pedido|pedidos|encargad)/.test(cargoNorm)) {
            return 'COMPRAS_PEDIDOS';
        }
        if (/(recepci|emplead|deposito|mostrador|vendedor|caja|logistica|sucursal)/.test(cargoNorm)) {
            return 'RECEPCION_LOCAL';
        }
        if (/(empresa|negocio|institucional|compartid|general|oficina|central|local)/.test(cargoNorm)) {
            return 'COMPARTIDO';
        }
    }

    if (nomNorm && cliNorm && nomNorm.length >= 3 && (nomNorm === cliNorm || /^(empresa|negocio|local|mostrador|administracion|compras)$/.test(nomNorm))) {
        if (nomNorm === 'administracion') return 'PAGOS_ADMIN';
        if (nomNorm === 'compras') return 'COMPRAS_PEDIDOS';
        return 'COMPARTIDO';
    }

    if (flagsBunker && flagsBunker.default_resumen === true && flagsBunker.default_presupuesto === false && flagsBunker.default_difusion === false) {
        return 'PAGOS_ADMIN';
    }

    return null;
}

/**
 * Clasifica de forma idempotente el rol_operativo inicial en todos los chats comerciales sin rol fijado manualmente.
 */
async function clasificarRolesOperativosExistentesIdempotente() {
    const { rows } = await pool.query(`
        SELECT id, bunker_cliente_id, telefono_normalizado, contacto_nombre, contacto_cargo, cliente_nombre, rol_operativo, rol_manual
        FROM public.crm_whatsapp_chats
        WHERE rol_operativo IS NULL
          AND COALESCE(rol_manual, false) = false
          AND categoria_contacto IN ('CLIENTE_BUNKER', 'PROSPECTO')
    `);
    if (rows.length === 0) return { revisados: 0, actualizados: 0 };

    // Indexar contactos estructurados de bunker_clientes.whatsapp_facturas por bunker_cliente_id
    const dir = await obtenerDirectorioClientes(false).catch(() => []);
    const mapaDir = new Map(dir.map(d => [Number(d.bunker_cliente_id), d]));

    let actualizados = 0;
    for (const ch of rows) {
        const cliDir = ch.bunker_cliente_id ? mapaDir.get(Number(ch.bunker_cliente_id)) : null;
        const infoTel = analizarTelefono(ch.telefono_normalizado);
        const matchCt = cliDir?.contactos?.find(ct =>
            (ct.cola10 && infoTel.cola10 && ct.cola10 === infoTel.cola10) ||
            (ct.cola8 && infoTel.cola8 && ct.cola8 === infoTel.cola8)
        ) || null;

        const rolInf = inferirRolOperativoDeterminista({
            rolExplicito: matchCt?.rol_operativo || null,
            cargo: ch.contacto_cargo || matchCt?.cargo || '',
            nombre: ch.contacto_nombre || matchCt?.nombre || '',
            clienteNombre: ch.cliente_nombre || cliDir?.cliente_nombre || '',
            flagsBunker: matchCt?.flagsBunker || null
        });

        if (rolInf) {
            await pool.query(
                `UPDATE public.crm_whatsapp_chats SET rol_operativo = $2 WHERE id = $1 AND rol_operativo IS NULL AND COALESCE(rol_manual, false) = false`,
                [ch.id, rolInf]
            );
            actualizados++;
        }
    }
    if (actualizados > 0) {
        console.log(`🏷️ [CRM-WHATSAPP-DB] Roles operativos iniciales inferidos: ${actualizados}/${rows.length} chats.`);
    }
    return { revisados: rows.length, actualizados };
}

/**
 * Sincroniza rol_operativo de vuelta hacia el objeto de contacto coincidente (últimos 10 dígitos)
 * dentro de public.bunker_clientes.whatsapp_facturas SIN pisar cargo ni flags existentes.
 */
async function sincronizarRolOperativoEnBunkerWhatsapp(bunkerClienteId, telefonoNormalizado, nuevoRolOperativo) {
    const cliId = parseInt(bunkerClienteId, 10);
    if (!cliId || !telefonoNormalizado) return { sincronizado: false };

    const rolValido = nuevoRolOperativo && ROLES_OPERATIVOS_VALIDOS.has(String(nuevoRolOperativo).toUpperCase())
        ? String(nuevoRolOperativo).toUpperCase()
        : null;

    try {
        const res = await pool.query(
            `SELECT id, whatsapp_facturas FROM public.bunker_clientes WHERE id = $1 LIMIT 1`,
            [cliId]
        );
        if (res.rows.length === 0 || !res.rows[0].whatsapp_facturas) {
            return { sincronizado: false };
        }
        const raw = res.rows[0].whatsapp_facturas;
        let parsed;
        try {
            parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch (_) {
            return { sincronizado: false };
        }
        if (!Array.isArray(parsed) || parsed.length === 0) {
            return { sincronizado: false };
        }

        const targetInfo = analizarTelefono(telefonoNormalizado);
        let modificado = false;
        const actualizado = parsed.map(ct => {
            if (!ct || !ct.numero) return ct;
            const ctInfo = analizarTelefono(ct.numero);
            const coincide = (targetInfo.cola10 && ctInfo.cola10 && targetInfo.cola10 === ctInfo.cola10)
                || (targetInfo.cola8 && ctInfo.cola8 && targetInfo.cola8 === ctInfo.cola8);
            if (!coincide) return ct;
            modificado = true;
            const copia = { ...ct };
            if (rolValido) {
                copia.rol_operativo = rolValido;
            } else {
                delete copia.rol_operativo;
            }
            return copia;
        });

        if (!modificado) return { sincronizado: false };

        await pool.query(
            `UPDATE public.bunker_clientes SET whatsapp_facturas = $2 WHERE id = $1`,
            [cliId, JSON.stringify(actualizado)]
        );
        cacheClientesBunker = null;
        cacheClientesTs = 0;
        return { sincronizado: true, rol_operativo: rolValido };
    } catch (err) {
        console.warn('⚠️ [CRM-WHATSAPP-DB] Error sincronizando rol_operativo en bunker_clientes:', err.message);
        return { sincronizado: false, error: err.message };
    }
}

/**
 * Backfill idempotente de hilos existentes que ya hablan de Captación de Nodos
 * (o coordinación explícita de reuniones) para poblar la solapa 🌐 Nodos sin pisar
 * configuraciones manuales ni chats marcados como MAYORISTA.
 */
async function clasificarFrenteNodosExistentesIdempotente() {
    const resChats = await pool.query(`
        SELECT id, chat_id, bunker_cliente_id, cliente_nombre, contacto_nombre, pushname_wa,
               categoria_contacto, categoria_manual, modo_privacidad, frente_activo, nodo_captacion_json
        FROM public.crm_whatsapp_chats
        WHERE categoria_contacto <> 'IGNORADO_BOT'
          AND COALESCE(frente_activo, 'AUTO') = 'AUTO'
          AND COALESCE((nodo_captacion_json->>'activo')::boolean, false) = false
          AND ultimo_mensaje_at IS NOT NULL
        ORDER BY ultimo_mensaje_at DESC NULLS LAST
        LIMIT 250
    `);

    let actualizados = 0;
    for (const ch of resChats.rows) {
        const mRes = await pool.query(`
            SELECT id, from_me, cuerpo, tipo_mensaje, media_filename, fecha_mensaje
            FROM public.crm_whatsapp_mensajes
            WHERE chat_id = $1
            ORDER BY fecha_mensaje DESC, id DESC
            LIMIT 14
        `, [ch.chat_id]);
        if (mRes.rows.length === 0) continue;

        const msgs = mRes.rows.reverse();
        const det = nodosCaptacionCrm.detectarContextoHiloNodosWa({
            mensajesRecientes: msgs,
            categoriaContacto: ch.categoria_contacto,
            frenteActivo: ch.frente_activo,
            nodoCaptacionJson: ch.nodo_captacion_json,
            clienteNombre: ch.cliente_nombre || '',
            contactoNombre: ch.contacto_nombre || ch.pushname_wa || '',
            bunkerClienteId: ch.bunker_cliente_id
        });
        if (!det.detectadoAutoPorHilo) continue;

        const nuevoJson = {
            ...(ch.nodo_captacion_json && typeof ch.nodo_captacion_json === 'object' ? ch.nodo_captacion_json : {}),
            activo: true,
            etapa: det.etapaInferida || 'INVITACION_INICIAL',
            perfil_sugerido: det.perfilInferido || '',
            origen: 'auto_hilo',
            motivo_deteccion: det.motivoDeteccion || '',
            actualizado_en: new Date().toISOString()
        };

        const promoverExterno = !ch.bunker_cliente_id
            && !ch.categoria_manual
            && ['PERSONAL', 'SIN_CLASIFICAR', 'PROSPECTO'].includes(String(ch.categoria_contacto || '').toUpperCase());

        if (promoverExterno) {
            await pool.query(`
                UPDATE public.crm_whatsapp_chats
                SET nodo_captacion_json = $2::jsonb,
                    categoria_contacto = 'PROSPECTO_NODO',
                    modo_privacidad = 'ACTIVO',
                    updated_at = NOW()
                WHERE id = $1
            `, [ch.id, JSON.stringify(nuevoJson)]);
        } else {
            await pool.query(`
                UPDATE public.crm_whatsapp_chats
                SET nodo_captacion_json = $2::jsonb,
                    updated_at = NOW()
                WHERE id = $1
            `, [ch.id, JSON.stringify(nuevoJson)]);
        }
        actualizados++;
    }

    if (actualizados > 0) {
        console.log(`🌐 [CRM-WHATSAPP-DB] Hilos de Captación de Nodos detectados automáticamente: ${actualizados}/${resChats.rows.length}.`);
    }
    return { revisados: resChats.rows.length, actualizados };
}

module.exports = {
    TIPOS_MENSAJE_PROTOCOLO_IGNORADOS,
    CATEGORIAS_CONTACTO_VALIDAS,
    ROLES_OPERATIVOS_VALIDOS,
    esTipoMensajeProtocoloIgnorado,
    invalidarCacheCategoriasCrm,
    analizarTelefono,
    asegurarTablasCrmWhatsapp,
    obtenerDirectorioClientes,
    resolverClienteBunkerPorTelefono,
    determinarCategoriaContactoAutomatica,
    inferirRolOperativoDeterminista,
    clasificarRolesOperativosExistentesIdempotente,
    clasificarFrenteNodosExistentesIdempotente,
    sincronizarRolOperativoEnBunkerWhatsapp,
    registrarMensajeWhatsapp,
    verificarAudioYaTranscrito,
    actualizarTranscripcionAudioMensaje,
    actualizarAckMensaje,
    deduplicarAdjuntosSalientesDuplicados,
    limpiarMensajesProtocoloHistoricos,
    propagarCategoriaPersonalEnCliente,
    clasificarChatsExistentesIdempotente,
    rematchearChatsConBunker,
    sembrarDirectorioClientesEnChats,
    sincronizarEstadoNoLeidosDesdeWa
};
