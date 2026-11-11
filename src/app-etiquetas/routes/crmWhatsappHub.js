/**
 * Rutas Horizontales de WhatsApp Bidireccional & Consola CRM (Puerto 3000)
 * Sistema LAMDA
 */

const express = require('express');
const router = express.Router();
const pool = require('../../usuarios/pool');
const crmWhatsappDb = require('../../services/crmWhatsappDbService');
const whatsappAudioTranscriber = require('../../services/whatsappAudioTranscriberService');
const agenteHibridoLlm = require('../../services/whatsappAgenteHibridoLlmService');
const { calcularComposicionSaldo } = require('../../logistica/services/composicionSaldoService');
const salvavidasService = require('../../logistica/services/salvavidasService');
const historialPreciosService = require('../../produccion/services/historialPreciosService');

// Asegurar tablas al montar el router
crmWhatsappDb.asegurarTablasCrmWhatsapp().catch(() => {});

/**
 * GET /api/crm/whatsapp/alertas-pizarra
 * Retorna los chats de clientes Búnker que escribieron y están esperando respuesta,
 * respetando el filtro dinámico de privacidad (Modo Personal / Silenciado / Oculto).
 */
router.get('/crm/whatsapp/alertas-pizarra', async (req, res) => {
    try {
        await crmWhatsappDb.asegurarTablasCrmWhatsapp();

        const queryAlertas = `
            SELECT 
                id, chat_id, telefono_normalizado,
                bunker_cliente_id, cliente_nombre, codigo_bunker_cliente,
                contacto_nombre, contacto_cargo, pushname_wa,
                es_cliente_bunker, modo_privacidad, silenciado_hasta,
                etiqueta_crm, esperando_respuesta, no_leidos,
                ultimo_mensaje_texto, ultimo_mensaje_from_me, ultimo_mensaje_ack,
                ultimo_mensaje_at
            FROM public.crm_whatsapp_chats
            WHERE esperando_respuesta = true
              AND es_cliente_bunker = true
              AND modo_privacidad = 'ACTIVO'
              AND (silenciado_hasta IS NULL OR silenciado_hasta <= NOW())
            ORDER BY ultimo_mensaje_at DESC
            LIMIT 25
        `;

        const queryContadores = `
            SELECT
                COUNT(*) FILTER (
                    WHERE esperando_respuesta = true 
                      AND es_cliente_bunker = true 
                      AND modo_privacidad = 'ACTIVO'
                      AND (silenciado_hasta IS NULL OR silenciado_hasta <= NOW())
                )::int AS clientes_sin_responder,
                COUNT(*) FILTER (
                    WHERE esperando_respuesta = true 
                      AND es_cliente_bunker = false 
                      AND modo_privacidad = 'ACTIVO'
                )::int AS no_agendados_sin_responder,
                COUNT(*) FILTER (
                    WHERE modo_privacidad != 'OCULTO'
                )::int AS total_chats_visibles,
                COUNT(*) FILTER (
                    WHERE modo_privacidad IN ('SILENCIADO_PIZARRA', 'OCULTO')
                       OR (silenciado_hasta IS NOT NULL AND silenciado_hasta > NOW())
                )::int AS total_privados_o_silenciados
            FROM public.crm_whatsapp_chats
        `;

        const [resAlertas, resCont] = await Promise.all([
            pool.query(queryAlertas),
            pool.query(queryContadores)
        ]);

        res.json({
            success: true,
            alertas: resAlertas.rows,
            contadores: resCont.rows[0] || {
                clientes_sin_responder: 0,
                no_agendados_sin_responder: 0,
                total_chats_visibles: 0,
                total_privados_o_silenciados: 0
            }
        });
    } catch (error) {
        console.error('❌ [CRM-WA-HUB] Error en alertas-pizarra:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

let multiContactosSembradosEnHub = false;

function generarTokensCodigoCliente(r) {
    const tokensExactos = new Set();
    const textosCodigo = [];

    const lomasRaw = String(r.lomas_soft_id || '').trim().toLowerCase();
    if (lomasRaw) {
        textosCodigo.push(lomasRaw, `#${lomasRaw}`);
        tokensExactos.add(lomasRaw);
        tokensExactos.add(`#${lomasRaw}`);
        const soloDig = lomasRaw.replace(/\D/g, '');
        if (soloDig) {
            const numInt = String(parseInt(soloDig, 10));
            const pad3 = numInt.padStart(3, '0');
            const pad4 = numInt.padStart(4, '0');
            [numInt, pad3, pad4, `#${numInt}`, `#${pad3}`, `#${pad4}`, `n${numInt}`, `nro${numInt}`].forEach(v => {
                tokensExactos.add(v);
                textosCodigo.push(v);
            });
        }
    }

    const codBunkerRaw = String(r.codigo_bunker_cliente || r.bunker_codigo_cliente || '').trim().toLowerCase();
    if (codBunkerRaw) {
        const sinGuion = codBunkerRaw.replace(/[^a-z0-9]/g, '');
        [codBunkerRaw, `#${codBunkerRaw}`, sinGuion, `#${sinGuion}`].forEach(v => {
            tokensExactos.add(v);
            textosCodigo.push(v);
        });
        const soloDigB = codBunkerRaw.replace(/\D/g, '');
        if (soloDigB) {
            const numIntB = String(parseInt(soloDigB, 10));
            const pad3B = numIntB.padStart(3, '0');
            const pad4B = numIntB.padStart(4, '0');
            [
                numIntB, pad3B, pad4B,
                `#${numIntB}`, `#${pad3B}`, `#${pad4B}`,
                `cb-${numIntB}`, `cb-${pad3B}`, `cb-${pad4B}`,
                `cb${numIntB}`, `cb${pad3B}`, `cb${pad4B}`
            ].forEach(v => {
                tokensExactos.add(v);
                textosCodigo.push(v);
            });
        }
    }

    return {
        tokensExactos,
        bolsaCodigo: textosCodigo.join(' ')
    };
}

/**
 * GET /api/crm/whatsapp/chats
 * Lista de conversaciones para la Columna 1 de la Consola de 3 Columnas
 * Filtros: SIN_RESPONDER | CLIENTES | NO_AGENDADOS | PRIVADOS | TODOS
 */
router.get('/crm/whatsapp/chats', async (req, res) => {
    try {
        await crmWhatsappDb.asegurarTablasCrmWhatsapp();
        if (!multiContactosSembradosEnHub && typeof crmWhatsappDb.sembrarDirectorioClientesEnChats === 'function') {
            multiContactosSembradosEnHub = true;
            await crmWhatsappDb.sembrarDirectorioClientesEnChats();
        }

        const filtro = String(req.query.filtro || 'CLIENTES').toUpperCase();
        const q = String(req.query.q || '').trim().toLowerCase();

        let whereClause = `WHERE 1=1`;
        if (filtro === 'SIN_RESPONDER') {
            whereClause += ` AND c.esperando_respuesta = true AND c.modo_privacidad != 'OCULTO'`;
        } else if (filtro === 'CLIENTES') {
            whereClause += ` AND c.es_cliente_bunker = true AND c.modo_privacidad != 'OCULTO'`;
        } else if (filtro === 'NO_AGENDADOS') {
            whereClause += ` AND c.es_cliente_bunker = false AND c.modo_privacidad != 'OCULTO'`;
        } else if (filtro === 'PRIVADOS') {
            whereClause += ` AND (c.modo_privacidad IN ('SILENCIADO_PIZARRA', 'OCULTO') OR (c.silenciado_hasta IS NOT NULL AND c.silenciado_hasta > NOW()))`;
        } else {
            // TODOS (excepto ocultos puros, a menos que busque en PRIVADOS)
            whereClause += ` AND c.modo_privacidad != 'OCULTO'`;
        }

        const query = `
            SELECT 
                c.*,
                COALESCE(c.cliente_nombre, bc.cliente_nombre) AS cliente_nombre,
                COALESCE(c.codigo_bunker_cliente, bc.codigo_bunker_cliente) AS codigo_bunker_cliente,
                bc.razon_social AS bunker_razon_social,
                bc.lomas_soft_id,
                (c.silenciado_hasta IS NOT NULL AND c.silenciado_hasta > NOW()) AS esta_silenciado_temporal,
                COALESCE(ms.cant_mensajes_reales, 0)::int AS cant_mensajes_reales,
                COALESCE(ms.in_hoy, 0)::int AS in_hoy,
                COALESCE(ms.out_hoy, 0)::int AS out_hoy,
                ms.real_ultimo_mensaje_at
            FROM public.crm_whatsapp_chats c
            LEFT JOIN public.bunker_clientes bc ON bc.id = c.bunker_cliente_id
            LEFT JOIN (
                SELECT 
                    chat_id,
                    COUNT(*)::int AS cant_mensajes_reales,
                    COUNT(*) FILTER (WHERE fecha_mensaje >= CURRENT_DATE AND from_me = false)::int AS in_hoy,
                    COUNT(*) FILTER (WHERE fecha_mensaje >= CURRENT_DATE AND from_me = true)::int AS out_hoy,
                    MAX(fecha_mensaje) AS real_ultimo_mensaje_at
                FROM public.crm_whatsapp_mensajes
                GROUP BY chat_id
            ) ms ON ms.chat_id = c.chat_id
            ${whereClause}
            ORDER BY 
                c.esperando_respuesta DESC,
                COALESCE(ms.real_ultimo_mensaje_at, CASE WHEN c.ultimo_mensaje_texto = 'Cliente Búnker vinculado' THEN NULL ELSE c.ultimo_mensaje_at END) DESC NULLS LAST
            LIMIT 800
        `;

        const result = await pool.query(query);
        let rows = result.rows;

        // Normalizar fecha real de comunicación en cada fila (ignorando placeholders sin mensajes)
        for (const r of rows) {
            const esPlaceholderSinMsgs = (r.ultimo_mensaje_texto === 'Cliente Búnker vinculado' && Number(r.cant_mensajes_reales || 0) === 0);
            if (esPlaceholderSinMsgs) {
                r.ultimo_mensaje_at = null;
                r.tiene_comunicacion_real = false;
            } else {
                r.ultimo_mensaje_at = r.real_ultimo_mensaje_at || r.ultimo_mensaje_at || null;
                r.tiene_comunicacion_real = Boolean(r.ultimo_mensaje_at);
            }
        }

        // Unificar chats duplicados (@c.us vs @lid) del mismo contacto/cliente Búnker
        // Sin fusionar dos teléfonos distintos (@c.us) aunque compartan nombre de pila
        const filasUnificadas = [];
        for (const r of rows) {
            if (r.bunker_cliente_id) {
                const esLidR = String(r.chat_id || '').endsWith('@lid');
                const nombreR = String(r.contacto_nombre || '').trim().toLowerCase();
                const digR = String(r.ultimos_digitos || '').trim();

                const existente = filasUnificadas.find(ex => {
                    if (ex.bunker_cliente_id !== r.bunker_cliente_id) return false;
                    const esLidEx = String(ex.chat_id || '').endsWith('@lid');
                    const nombreEx = String(ex.contacto_nombre || '').trim().toLowerCase();
                    const digEx = String(ex.ultimos_digitos || '').trim();

                    // Mismo teléfono real (cola de 8 dígitos)
                    if (!esLidR && !esLidEx && digR && digEx && digR === digEx) return true;
                    // Espejo @lid <-> @c.us del mismo contacto por nombre
                    if ((esLidR || esLidEx) && nombreR && nombreEx && nombreR === nombreEx) return true;
                    return false;
                });

                if (existente) {
                    existente.esperando_respuesta = Boolean(existente.esperando_respuesta || r.esperando_respuesta);
                    existente.no_leidos = Math.max(Number(existente.no_leidos || 0), Number(r.no_leidos || 0));
                    existente.cant_mensajes_reales = Number(existente.cant_mensajes_reales || 0) + Number(r.cant_mensajes_reales || 0);
                    existente.in_hoy = Number(existente.in_hoy || 0) + Number(r.in_hoy || 0);
                    existente.out_hoy = Number(existente.out_hoy || 0) + Number(r.out_hoy || 0);
                    existente.tiene_comunicacion_real = Boolean(existente.tiene_comunicacion_real || r.tiene_comunicacion_real);
                    if (!existente.etiqueta_crm && r.etiqueta_crm) existente.etiqueta_crm = r.etiqueta_crm;
                    if (!existente.nota_rapida && r.nota_rapida) existente.nota_rapida = r.nota_rapida;
                    const fechaEx = existente.ultimo_mensaje_at ? new Date(existente.ultimo_mensaje_at).getTime() : 0;
                    const fechaR = r.ultimo_mensaje_at ? new Date(r.ultimo_mensaje_at).getTime() : 0;
                    if (fechaR > fechaEx) {
                        existente.ultimo_mensaje_at = r.ultimo_mensaje_at;
                        if (r.ultimo_mensaje_texto && r.ultimo_mensaje_texto !== 'Cliente Búnker vinculado') {
                            existente.ultimo_mensaje_texto = r.ultimo_mensaje_texto;
                        }
                        existente.ultimo_mensaje_from_me = r.ultimo_mensaje_from_me;
                        existente.ultimo_mensaje_ack = r.ultimo_mensaje_ack;
                    } else if (existente.ultimo_mensaje_texto === 'Cliente Búnker vinculado' && r.ultimo_mensaje_texto && r.ultimo_mensaje_texto !== 'Cliente Búnker vinculado') {
                        existente.ultimo_mensaje_texto = r.ultimo_mensaje_texto;
                    }
                    // Preferir el chat_id @c.us como primario si el existente era @lid
                    if (String(existente.chat_id || '').endsWith('@lid') && String(r.chat_id || '').endsWith('@c.us')) {
                        existente.id = r.id;
                        existente.chat_id = r.chat_id;
                        existente.telefono_normalizado = r.telefono_normalizado || existente.telefono_normalizado;
                        existente.ultimos_digitos = r.ultimos_digitos || existente.ultimos_digitos;
                    }
                    continue;
                }
            }
            filasUnificadas.push(r);
        }
        rows = filasUnificadas;

        // Filtrado acumulativo (Política Universal de Búsqueda LAMDA: espacios = AND)
        // Soporta búsqueda por Número Legacy (lomas_soft_id), Código Búnker (CB-XXXX), Nombre de Cliente, Contacto, Teléfono o Mensaje
        if (q.length > 0) {
            const terminos = q.split(/\s+/).filter(Boolean);
            const esBusquedaCodigoCorto = terminos.length === 1 && /^#?(?:cb-?)?\d{1,4}$/i.test(terminos[0]);

            if (esBusquedaCodigoCorto) {
                const t = terminos[0];
                const clientesExactos = new Set();
                const clientesParcialesCodigo = new Set();

                for (const r of rows) {
                    if (!r.bunker_cliente_id) continue;
                    const { tokensExactos, bolsaCodigo } = generarTokensCodigoCliente(r);
                    if (tokensExactos.has(t)) {
                        clientesExactos.add(r.bunker_cliente_id);
                    } else if (bolsaCodigo.includes(t.replace(/^#/, ''))) {
                        clientesParcialesCodigo.add(r.bunker_cliente_id);
                    }
                }

                if (clientesExactos.size > 0 || clientesParcialesCodigo.size > 0) {
                    rows = rows
                        .filter(r => clientesExactos.has(r.bunker_cliente_id) || clientesParcialesCodigo.has(r.bunker_cliente_id))
                        .sort((a, b) => {
                            const exA = clientesExactos.has(a.bunker_cliente_id) ? 1 : 0;
                            const exB = clientesExactos.has(b.bunker_cliente_id) ? 1 : 0;
                            if (exA !== exB) return exB - exA;
                            return 0;
                        });
                } else {
                    // Fallback si el número corto no coincide con ningún código de cliente
                    rows = rows.filter(r => {
                        const { bolsaCodigo } = generarTokensCodigoCliente(r);
                        const bolsa = [
                            r.cliente_nombre,
                            r.bunker_razon_social,
                            bolsaCodigo,
                            r.contacto_nombre,
                            r.contacto_cargo,
                            r.pushname_wa,
                            r.telefono_normalizado,
                            r.ultimo_mensaje_texto,
                            r.etiqueta_crm,
                            r.nota_rapida
                        ].filter(Boolean).join(' ').toLowerCase();
                        return terminos.every(term => bolsa.includes(term));
                    });
                }
            } else {
                const clientesCoincidentes = new Set();
                const filasDirectasIds = new Set();

                for (const r of rows) {
                    const { bolsaCodigo } = generarTokensCodigoCliente(r);
                    const bolsa = [
                        r.cliente_nombre,
                        r.bunker_razon_social,
                        bolsaCodigo,
                        r.contacto_nombre,
                        r.contacto_cargo,
                        r.pushname_wa,
                        r.telefono_normalizado,
                        r.ultimo_mensaje_texto,
                        r.etiqueta_crm,
                        r.nota_rapida
                    ].filter(Boolean).join(' ').toLowerCase();

                    if (terminos.every(t => bolsa.includes(t))) {
                        filasDirectasIds.add(r.id);
                        if (r.bunker_cliente_id) {
                            clientesCoincidentes.add(r.bunker_cliente_id);
                        }
                    }
                }

                // Si un cliente coincide (por su nombre, código o alguno de sus contactos),
                // traer todos los contactos de ese cliente para mantener el grupo unido en la columna izquierda
                rows = rows.filter(r => filasDirectasIds.has(r.id) || (r.bunker_cliente_id && clientesCoincidentes.has(r.bunker_cliente_id)));
            }
        }

        res.json({
            success: true,
            data: rows
        });
    } catch (error) {
        console.error('❌ [CRM-WA-HUB] Error listando chats:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/crm/whatsapp/chats/:id/detalle
 * Retorna el historial de burbujas (Columna 2) + Rayos X comercial del cliente (Columna 3)
 */
router.get('/crm/whatsapp/chats/:id/detalle', async (req, res) => {
    try {
        await crmWhatsappDb.asegurarTablasCrmWhatsapp();
        const chatPk = parseInt(req.params.id);
        if (isNaN(chatPk)) {
            return res.status(400).json({ success: false, error: 'ID de chat inválido' });
        }

        const chatRes = await pool.query(`
            SELECT c.*,
                   COALESCE(c.cliente_nombre, bc.cliente_nombre) AS cliente_nombre,
                   COALESCE(c.codigo_bunker_cliente, bc.codigo_bunker_cliente) AS codigo_bunker_cliente,
                   bc.lomas_soft_id,
                   (c.silenciado_hasta IS NOT NULL AND c.silenciado_hasta > NOW()) AS esta_silenciado_temporal
            FROM public.crm_whatsapp_chats c
            LEFT JOIN public.bunker_clientes bc ON bc.id = c.bunker_cliente_id
            WHERE c.id = $1
            LIMIT 1
        `, [chatPk]);

        if (chatRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Conversación no encontrada' });
        }

        const chat = chatRes.rows[0];

        // Buscar todos los chat_id hermanos (@c.us y @lid) del mismo contacto/cliente para unificar historial
        let chatIdsUnificados = [chat.chat_id];
        if (chat.bunker_cliente_id) {
            const subNombre = String(chat.contacto_nombre || '').trim().toLowerCase();
            const subDigitos = String(chat.ultimos_digitos || '').trim();
            const hermanosRes = await pool.query(`
                SELECT chat_id, contacto_nombre, ultimos_digitos
                FROM public.crm_whatsapp_chats
                WHERE bunker_cliente_id = $1
            `, [chat.bunker_cliente_id]);
            if (hermanosRes.rows.length > 0) {
                const esLidActual = String(chat.chat_id || '').endsWith('@lid');
                for (const h of hermanosRes.rows) {
                    const esLidH = String(h.chat_id || '').endsWith('@lid');
                    const hDig = String(h.ultimos_digitos || '').trim();
                    const hNom = String(h.contacto_nombre || '').trim().toLowerCase();
                    if (!esLidActual && !esLidH && subDigitos && hDig && subDigitos === hDig) {
                        chatIdsUnificados.push(h.chat_id);
                    } else if ((esLidActual || esLidH) && subNombre && hNom && subNombre === hNom) {
                        chatIdsUnificados.push(h.chat_id);
                    }
                }
                chatIdsUnificados = Array.from(new Set(chatIdsUnificados));
            }
        }

        // 1. Obtener los últimos 80 mensajes ordenados cronológicamente (ASC para el chat)
        const msgRes = await pool.query(`
            SELECT * FROM (
                SELECT 
                    id, msg_id, chat_id, from_me, cuerpo, tipo_mensaje,
                    media_filename, media_mimetype, ack, origen_envio, fecha_mensaje
                FROM public.crm_whatsapp_mensajes
                WHERE chat_id = ANY($1)
                ORDER BY fecha_mensaje DESC, id DESC
                LIMIT 80
            ) sub
            ORDER BY fecha_mensaje ASC, id ASC
        `, [chatIdsUnificados]);

        // 2. Construir Rayos X Comerciales (Columna 3) si está vinculado a un cliente Búnker
        let rayosX = {
            vinculado: Boolean(chat.bunker_cliente_id),
            cliente: null,
            pedidos_recientes: [],
            cuenta_corriente: {
                tiene_cuenta: false,
                saldo_actual: 0,
                ultimos_movimientos: []
            },
            ultimas_facturas: [],
            seguimientos: []
        };

        if (chat.bunker_cliente_id) {
            const bcRes = await pool.query(`
                SELECT 
                    bc.id, bc.cliente_nombre, bc.razon_social, bc.codigo_bunker_cliente,
                    bc.cuit_cuil, bc.condicion_iva, bc.domicilio_fiscal,
                    bc.whatsapp_facturas, bc.lomas_soft_id,
                    c.telefono as lomas_telefono, c.celular as lomas_celular,
                    c.domicilio as lomas_domicilio, c.localidad as lomas_localidad,
                    EXISTS (
                        SELECT 1
                        FROM public.bunker_cliente_listas_precios bclp
                        WHERE bclp.bunker_cliente_id = bc.id
                    ) AS tiene_lista_asignada,
                    (
                        SELECT bclp.bunker_lista_precio_id 
                        FROM public.bunker_cliente_listas_precios bclp 
                        WHERE bclp.bunker_cliente_id = bc.id 
                        ORDER BY bclp.id ASC LIMIT 1
                    ) AS lista_asignada_id_real,
                    COALESCE((
                        SELECT bclp.bunker_lista_precio_id 
                        FROM public.bunker_cliente_listas_precios bclp 
                        WHERE bclp.bunker_cliente_id = bc.id 
                        ORDER BY bclp.id ASC LIMIT 1
                    ), 1) AS lista_asignada_id,
                    COALESCE((
                        SELECT blp.nombre 
                        FROM public.bunker_cliente_listas_precios bclp 
                        JOIN public.bunker_listas_precios blp ON blp.id = bclp.bunker_lista_precio_id
                        WHERE bclp.bunker_cliente_id = bc.id 
                        ORDER BY bclp.id ASC LIMIT 1
                    ), 'Sin lista asignada') AS lista_asignada_nombre
                FROM public.bunker_clientes bc
                LEFT JOIN public.clientes c 
                    ON (CASE WHEN bc.lomas_soft_id ~ '^\\d+$' THEN bc.lomas_soft_id::integer ELSE NULL END) = c.cliente_id
                WHERE bc.id = $1
                LIMIT 1
            `, [chat.bunker_cliente_id]);

            if (bcRes.rows.length > 0) {
                const cli = bcRes.rows[0];
                rayosX.cliente = cli;
                const listaClienteId = parseInt(cli.lista_asignada_id) || 1;

                const lomasIdNum = (cli.lomas_soft_id && /^\d+$/.test(String(cli.lomas_soft_id).trim()))
                    ? parseInt(String(cli.lomas_soft_id).trim())
                    : null;

                // 2.a Pedidos / Presupuestos recientes
                if (lomasIdNum !== null) {
                    try {
                        const pedRes = await pool.query(`
                            SELECT 
                                p.id, p.fecha, p.estado, p.secuencia, p.estado_logistico, p.nota,
                                COALESCE((SELECT SUM(pd.cantidad * pd.precio1) FROM public.presupuestos_detalles pd WHERE pd.id_presupuesto = p.id), 0) as total
                            FROM public.presupuestos p
                            WHERE NULLIF(regexp_replace(p.id_cliente::text, '^0+', ''), '')::integer = $1
                              AND (p.estado IS NULL OR LOWER(TRIM(p.estado)) NOT IN ('anulado', 'anulada', 'cancelado', 'cancelada', 'baja', 'eliminado', 'eliminada'))
                              AND (p.activo IS NULL OR p.activo = true)
                              AND (p.archivado IS NULL OR p.archivado = false)
                            ORDER BY p.id DESC
                            LIMIT 5
                        `, [lomasIdNum]);
                        rayosX.pedidos_recientes = pedRes.rows;
                    } catch (ePed) {
                        console.warn('⚠️ [CRM-WA-HUB] Error consultando pedidos cliente:', ePed.message);
                    }

                    // 2.b Últimas facturas emitidas (con detalle de ítems y cruce contra la Lista de Precios asignada al Cliente en Búnker)
                    try {
                        const facRes = await pool.query(`
                            SELECT 
                                f.id, f.tipo_cbte, f.pto_vta, f.cbte_nro, f.fecha_emision,
                                f.imp_neto, f.imp_iva, f.imp_total, f.emitida_en, f.es_enviado, f.enviado_at,
                                f.presupuesto_id, f.estado, f.factura_asociada_id, f.stock_descontado,
                                COALESCE((
                                    SELECT json_agg(json_build_object(
                                        'id', nc.id,
                                        'tipo_cbte', nc.tipo_cbte,
                                        'pto_vta', nc.pto_vta,
                                        'cbte_nro', nc.cbte_nro,
                                        'estado', nc.estado,
                                        'imp_total', nc.imp_total,
                                        'fecha_emision', nc.fecha_emision
                                    ) ORDER BY nc.id DESC)
                                    FROM public.factura_facturas nc
                                    WHERE nc.factura_asociada_id = f.id
                                      AND nc.estado != 'ANULADA'
                                ), '[]'::json) AS ncs_asociadas,
                                COALESCE((
                                    SELECT json_agg(json_build_object(
                                        'id', fi.id,
                                        'articulo_id', fi.articulo_id,
                                        'descripcion', fi.descripcion,
                                        'qty', fi.qty,
                                        'p_unit', fi.p_unit,
                                        'imp_neto', fi.imp_neto,
                                        'imp_iva', fi.imp_iva,
                                        'iva_pct', COALESCE(ba.porcentaje_iva, 21),
                                        'lista_cliente_id', $2::integer,
                                        'coincide_alguna_lista', EXISTS (
                                            SELECT 1 FROM public.bunker_lista_articulos bla_m
                                            WHERE LOWER(TRIM(bla_m.articulo_numero)) = LOWER(TRIM(fi.articulo_id))
                                              AND COALESCE(bla_m.disponible, false) = true
                                              AND ABS(ROUND(bla_m.precio_final / (1 + (COALESCE(ba.porcentaje_iva, 21) / 100.0)), 2) - fi.p_unit) <= 5
                                        ),
                                        'precio_bunker_neto', CASE WHEN bla.precio_final IS NOT NULL THEN ROUND(bla.precio_final / (1 + (COALESCE(ba.porcentaje_iva, 21) / 100.0)), 2) ELSE NULL END,
                                        'precio_bunker_final', CASE WHEN bla.precio_final IS NOT NULL THEN ROUND(ROUND(bla.precio_final / (1 + (COALESCE(ba.porcentaje_iva, 21) / 100.0)), 2) * (1 + (COALESCE(ba.porcentaje_iva, 21) / 100.0)), 2) ELSE NULL END,
                                        'listas_bunker', COALESCE((
                                            SELECT json_agg(json_build_object(
                                                'lista_id', bla_l.lista_id,
                                                'lista_nombre', COALESCE(blp_l.nombre, 'Lista ' || bla_l.lista_id),
                                                'es_lista_cliente', (bla_l.lista_id = $2::integer),
                                                'precio_neto', ROUND(bla_l.precio_final / (1 + (COALESCE(ba.porcentaje_iva, 21) / 100.0)), 2),
                                                'precio_final', ROUND(ROUND(bla_l.precio_final / (1 + (COALESCE(ba.porcentaje_iva, 21) / 100.0)), 2) * (1 + (COALESCE(ba.porcentaje_iva, 21) / 100.0)), 2)
                                            ) ORDER BY (CASE WHEN bla_l.lista_id = $2::integer THEN 0 ELSE 1 END), bla_l.lista_id ASC)
                                            FROM public.bunker_lista_articulos bla_l
                                            LEFT JOIN public.bunker_listas_precios blp_l ON blp_l.id = bla_l.lista_id
                                            WHERE LOWER(TRIM(bla_l.articulo_numero)) = LOWER(TRIM(fi.articulo_id))
                                              AND COALESCE(bla_l.disponible, false) = true
                                        ), '[]'::json)
                                    ) ORDER BY fi.orden ASC, fi.id ASC)
                                    FROM public.factura_factura_items fi
                                    LEFT JOIN public.bunker_articulos ba ON LOWER(TRIM(ba.articulo_id)) = LOWER(TRIM(fi.articulo_id))
                                    LEFT JOIN public.bunker_lista_articulos bla ON LOWER(TRIM(bla.articulo_numero)) = LOWER(TRIM(fi.articulo_id)) AND bla.lista_id = $2::integer AND COALESCE(bla.disponible, false) = true
                                    WHERE fi.factura_id = f.id
                                ), '[]'::json) AS items
                            FROM public.factura_facturas f
                            WHERE f.cliente_id = $1
                            ORDER BY f.id DESC
                            LIMIT 8
                        `, [lomasIdNum, listaClienteId]);
                        rayosX.ultimas_facturas = facRes.rows;
                    } catch (eFac) {
                        console.warn('⚠️ [CRM-WA-HUB] Error consultando facturas cliente:', eFac.message);
                    }
                }

                // 2.c Cuenta Corriente en Búnker
                if (cli.codigo_bunker_cliente) {
                    try {
                        const ccRes = await pool.query(`
                            SELECT id, codigo_bunker_cliente, nombre_cuenta, moneda, saldo, saldo_apertura, estado, actualizada_en
                            FROM public.factura_cuentas_corrientes
                            WHERE TRIM(codigo_bunker_cliente) = TRIM($1)
                            ORDER BY creada_en ASC, id ASC
                        `, [cli.codigo_bunker_cliente]);

                        if (ccRes.rows.length > 0) {
                            const cc = ccRes.rows[0];
                            const movRes = await pool.query(`
                                SELECT id, cuenta_corriente_id, fecha_movimiento, tipo_movimiento,
                                       tipo_comprobante, tipo_comprobante AS origen_tipo,
                                       comprobante_id, presupuesto_id, descripcion, monto, saldo_resultante
                                FROM public.factura_cuenta_corriente_movimientos
                                WHERE cuenta_corriente_id = $1
                                ORDER BY fecha_movimiento DESC, id DESC
                                LIMIT 6
                            `, [cc.id]);

                            // Usar el saldo consolidado de la cuenta (o suma si tuviera más de una cuenta abierta),
                            // con fallback seguro al saldo_resultante del último movimiento o saldo_apertura
                            const saldoPrincipal = (cc.saldo !== null && cc.saldo !== undefined)
                                ? parseFloat(cc.saldo)
                                : (movRes.rows.length > 0
                                    ? parseFloat(movRes.rows[0].saldo_resultante || 0)
                                    : parseFloat(cc.saldo_apertura || 0));

                            const saldoConsolidado = ccRes.rows.length > 1
                                ? ccRes.rows.reduce((acc, row) => acc + (parseFloat(row.saldo) || 0), 0)
                                : saldoPrincipal;

                            let composicion = null;
                            let salvavidas = null;
                            try {
                                composicion = await calcularComposicionSaldo(cc.id, pool);
                                salvavidas = await salvavidasService.calcularSimulacionCuenta(cc.id, { persistir_sombra: false }, pool);
                            } catch (eComp) {
                                console.warn('⚠️ [CRM-WA-HUB] Error calculando composición/financiación de saldo CC:', eComp.message);
                            }

                            rayosX.cuenta_corriente = {
                                tiene_cuenta: true,
                                cuenta_id: cc.id,
                                nombre_cuenta: cc.nombre_cuenta || 'Cuenta Principal',
                                moneda: cc.moneda || 'ARS',
                                saldo_actual: saldoConsolidado,
                                saldo_apertura: parseFloat(cc.saldo_apertura || 0),
                                ultimos_movimientos: movRes.rows,
                                salvavidas: salvavidas ? {
                                    estado_general: salvavidas.estado_general || 'EN_TERMINO',
                                    financiacion_total: Number(salvavidas.financiacion_total || 0),
                                    financiacion_iva: Number(salvavidas.financiacion_iva || 0),
                                    financiacion_total_con_iva: Number(salvavidas.financiacion_total_con_iva || 0),
                                    saldo_total_proyectado: Number(salvavidas.saldo_total_proyectado || saldoConsolidado),
                                    saldo_total_proyectado_con_iva: Number(salvavidas.saldo_total_proyectado_con_iva || saldoConsolidado),
                                    capas_simuladas: salvavidas.capas_simuladas || [],
                                    reglas_aplicadas: salvavidas.reglas_aplicadas || null
                                } : null,
                                composicion: composicion ? {
                                    capas: composicion.capas || [],
                                    comprobantes_cancelados: composicion.comprobantes_cancelados || [],
                                    antiguedad_maxima_dias: composicion.antiguedad_maxima_dias || 0,
                                    antiguedad_promedio_dias: composicion.antiguedad_promedio_dias || 0,
                                    condicion_comercial: composicion.condicion_comercial || 'AL_DIA_OPTIMO',
                                    condicion_comercial_texto: composicion.condicion_comercial_texto || '',
                                    texto_whatsapp_composicion: composicion.texto_whatsapp_composicion || ''
                                } : null
                            };
                        }
                    } catch (eCc) {
                        console.warn('⚠️ [CRM-WA-HUB] Error consultando CC cliente:', eCc.message);
                    }
                }

                // 2.d Seguimientos programados para este cliente
                try {
                    const segRes = await pool.query(`
                        SELECT id, contacto_nombre, telefono_destino,
                               TO_CHAR(fecha_programada, 'YYYY-MM-DD') as fecha_programada,
                               TO_CHAR(hora_programada, 'HH24:MI') as hora_programada,
                               mensajes, nota_interna, estado
                        FROM public.crm_seguimientos_whatsapp
                        WHERE bunker_cliente_id = $1
                        ORDER BY estado ASC, fecha_programada DESC
                        LIMIT 6
                    `, [chat.bunker_cliente_id]);
                    rayosX.seguimientos = segRes.rows;
                } catch (eSeg) {
                    console.warn('⚠️ [CRM-WA-HUB] Error consultando seguimientos cliente:', eSeg.message);
                }
            }
        }

        // Filtrar cualquier duplicado eventual en memoria (mismo from_me + mismo cuerpo dentro de 25s)
        const mensajesUnicos = [];
        for (const m of msgRes.rows) {
            const cuerpoNorm = String(m.cuerpo || '').trim();
            const tsM = m.fecha_mensaje ? new Date(m.fecha_mensaje).getTime() : 0;
            const yaExiste = cuerpoNorm.length > 0 && mensajesUnicos.some(prev => {
                const tsPrev = prev.fecha_mensaje ? new Date(prev.fecha_mensaje).getTime() : 0;
                return Boolean(prev.from_me) === Boolean(m.from_me)
                    && String(prev.cuerpo || '').trim() === cuerpoNorm
                    && Math.abs(tsM - tsPrev) <= 25000;
            });
            if (!yaExiste) {
                mensajesUnicos.push(m);
            }
        }

        // Si entre los últimos 4 mensajes hay algún audio entrante sin transcribir ("🎤 Mensaje de audio"), transcribirlo en caliente
        const ultimos4 = mensajesUnicos.slice(-4);
        const audiosSinTranscribir = ultimos4.filter(m =>
            !m.from_me &&
            (m.tipo_mensaje === 'ptt' || m.tipo_mensaje === 'audio') &&
            (!m.cuerpo || String(m.cuerpo).trim() === '🎤 Mensaje de audio')
        );
        if (audiosSinTranscribir.length > 0 && chat.chat_id) {
            try {
                const resTr = await Promise.race([
                    whatsappAudioTranscriber.transcribirAudiosDeChatViaDevTools({
                        chatId: chat.chat_id,
                        msgIds: audiosSinTranscribir.map(m => m.msg_id).filter(Boolean),
                        maxAudios: 3
                    }),
                    new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 3500))
                ]);
                if (resTr && resTr.success && Array.isArray(resTr.resultados) && resTr.resultados.length > 0) {
                    const mapaTr = new Map(resTr.resultados.map(r => [String(r.msgId), r.cuerpo]));
                    mensajesUnicos.forEach(m => {
                        const shortId = String(m.msg_id || '').split('_').pop();
                        if (mapaTr.has(shortId)) {
                            m.cuerpo = mapaTr.get(shortId);
                        }
                    });
                    const ultimoTr = resTr.resultados[0];
                    if (ultimoTr && chat.ultimo_mensaje_texto === '🎤 Mensaje de audio') {
                        chat.ultimo_mensaje_texto = ultimoTr.cuerpo;
                    }
                }
            } catch (eTrDetalle) {
                console.warn('⚠️ [CRM-WA-HUB] No se pudo transcribir audio en detalle de chat:', eTrDetalle.message);
            }
        }

        res.json({
            success: true,
            chat,
            mensajes: mensajesUnicos,
            rayos_x: rayosX
        });
    } catch (error) {
        console.error('❌ [CRM-WA-HUB] Error en detalle de chat:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/crm/whatsapp/chats/:id/transcribir-audios
 * Desencripta y transcribe bajo demanda los últimos audios del chat usando Whisper local.
 */
router.post('/crm/whatsapp/chats/:id/transcribir-audios', async (req, res) => {
    try {
        const chatPk = parseInt(req.params.id);
        const chatRes = await pool.query('SELECT * FROM public.crm_whatsapp_chats WHERE id = $1 LIMIT 1', [chatPk]);
        if (chatRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Chat no encontrado.' });
        }
        const chat = chatRes.rows[0];
        const msgIds = Array.isArray(req.body?.msgIds) ? req.body.msgIds : [];
        const maxAudios = parseInt(req.body?.maxAudios) || 4;

        const resultado = await whatsappAudioTranscriber.transcribirAudiosDeChatViaDevTools({
            chatId: chat.chat_id,
            msgIds,
            maxAudios
        });
        res.json(resultado);
    } catch (error) {
        console.error('❌ [CRM-WA-HUB] Error en transcribir-audios:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/crm/whatsapp/chats/:id/enviar
 * Envía un mensaje de WhatsApp desde la Consola o desde la Respuesta Rápida de Pizarra
 * y apaga automáticamente el alerta de espera de respuesta.
 */
router.post('/crm/whatsapp/chats/:id/enviar', async (req, res) => {
    try {
        const chatPk = parseInt(req.params.id);
        const { mensajeTexto } = req.body;

        if (!mensajeTexto || !String(mensajeTexto).trim()) {
            return res.status(400).json({ success: false, error: 'El mensaje no puede estar vacío.' });
        }

        const chatRes = await pool.query('SELECT * FROM public.crm_whatsapp_chats WHERE id = $1 LIMIT 1', [chatPk]);
        if (chatRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Chat no encontrado.' });
        }

        const chat = chatRes.rows[0];
        const response = await fetch('http://localhost:3004/facturacion/whatsapp/enviar-mensaje', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                destinatarios: chat.telefono_normalizado,
                mensajeTexto: String(mensajeTexto).trim()
            })
        });

        const data = await response.json();
        if (!response.ok || !data.success) {
            let detalleError = (Array.isArray(data.detalles) && data.detalles[0]?.error)
                ? data.detalles[0].error
                : (data.error || data.message || 'No se pudo enviar el mensaje por WhatsApp.');
            if (/No LID for user/i.test(detalleError)) {
                detalleError = `El número +${chat.telefono_normalizado} no tiene una cuenta de WhatsApp activa.`;
            }
            return res.status(response.status || 500).json({
                success: false,
                error: detalleError,
                detalles: data.detalles || []
            });
        }

        // Asegurar apagado inmediato de alerta en BD
        await pool.query(`
            UPDATE public.crm_whatsapp_chats
            SET esperando_respuesta = false,
                no_leidos = 0,
                ultimo_mensaje_texto = $2,
                ultimo_mensaje_from_me = true,
                ultimo_mensaje_at = NOW(),
                updated_at = NOW()
            WHERE id = $1
        `, [chatPk, String(mensajeTexto).trim()]);

        res.json({
            success: true,
            message: 'Mensaje enviado correctamente.',
            data
        });
    } catch (error) {
        console.error('❌ [CRM-WA-HUB] Error enviando respuesta:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/crm/whatsapp/enviar-directo
 * Envía un mensaje de WhatsApp a un número de teléfono cuando aún no existe un chatId en crm_whatsapp_chats
 * o desde el Asistente Comercial Híbrido directo por cliente.
 */
router.post('/crm/whatsapp/enviar-directo', async (req, res) => {
    try {
        const { telefono, mensaje, mensajeTexto } = req.body || {};
        const textoFinal = String(mensajeTexto || mensaje || '').trim();
        const telLimpio = String(telefono || '').replace(/[^0-9]/g, '').trim();

        if (!telLimpio) {
            return res.status(400).json({ success: false, error: 'El número de teléfono de destino es obligatorio.' });
        }
        if (!textoFinal) {
            return res.status(400).json({ success: false, error: 'El mensaje no puede estar vacío.' });
        }

        const response = await fetch('http://localhost:3004/facturacion/whatsapp/enviar-mensaje', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                destinatarios: telLimpio,
                mensajeTexto: textoFinal
            })
        });

        const data = await response.json();
        if (!response.ok || !data.success) {
            let detalleError = (Array.isArray(data.detalles) && data.detalles[0]?.error)
                ? data.detalles[0].error
                : (data.error || data.message || 'No se pudo enviar el mensaje directo por WhatsApp.');
            if (/No LID for user/i.test(detalleError)) {
                detalleError = `El número +${telLimpio} no tiene una cuenta de WhatsApp activa.`;
            }
            return res.status(response.status || 500).json({
                success: false,
                error: detalleError,
                detalles: data.detalles || []
            });
        }

        await pool.query(`
            UPDATE public.crm_whatsapp_chats
            SET esperando_respuesta = false,
                no_leidos = 0,
                ultimo_mensaje_texto = $2,
                ultimo_mensaje_from_me = true,
                ultimo_mensaje_at = NOW(),
                updated_at = NOW()
            WHERE RIGHT(REGEXP_REPLACE(COALESCE(telefono_normalizado, ''), '[^0-9]', '', 'g'), 10) = RIGHT($1, 10)
        `, [telLimpio, textoFinal]).catch(() => {});

        res.json({
            success: true,
            message: 'Mensaje directo enviado correctamente.',
            data
        });
    } catch (error) {
        console.error('❌ [CRM-WA-HUB] Error en /crm/whatsapp/enviar-directo:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/crm/whatsapp/enviar-documento
 * Proxy directo en CRM para despachar un documento PDF adjunto vía microservicio 3004
 * y apagar simultáneamente el alerta de espera en crm_whatsapp_chats.
 */
router.post('/crm/whatsapp/enviar-documento', async (req, res) => {
    try {
        const { destinatarios, pdfBase64, filename, mensajeTexto, chatId } = req.body || {};
        if (!destinatarios || !pdfBase64) {
            return res.status(400).json({
                success: false,
                error: 'Faltan parámetros requeridos (destinatarios, pdfBase64).'
            });
        }

        const response = await fetch('http://localhost:3004/facturacion/whatsapp/enviar-documento', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                destinatarios,
                pdfBase64,
                filename: filename || 'Lista_de_Precios_LAMDA.pdf',
                mensajeTexto: mensajeTexto || '📄 Lista de Precios LAMDA'
            })
        });

        const data = await response.json();
        if (!response.ok || !data.success) {
            let detalleError = (Array.isArray(data.detalles) && data.detalles[0]?.error)
                ? data.detalles[0].error
                : (data.error || data.message || 'No se pudo enviar el documento PDF por WhatsApp.');
            return res.status(response.status || 500).json({
                success: false,
                error: detalleError,
                detalles: data.detalles || []
            });
        }

        const resumenDoc = `📄 [${filename || 'Documento.pdf'}] ${String(mensajeTexto || '').trim()}`.trim();
        if (chatId) {
            await pool.query(`
                UPDATE public.crm_whatsapp_chats
                SET esperando_respuesta = false,
                    no_leidos = 0,
                    ultimo_mensaje_texto = $2,
                    ultimo_mensaje_from_me = true,
                    ultimo_mensaje_at = NOW(),
                    updated_at = NOW()
                WHERE id = $1
            `, [parseInt(chatId, 10), resumenDoc]).catch(() => {});
        }

        res.json(data);
    } catch (error) {
        console.error('❌ [CRM-WA-HUB] Error en /crm/whatsapp/enviar-documento:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/crm/whatsapp/chats/:id/marcar-atendido
 * Apaga manualmente la alerta de "Esperando respuesta" sin necesidad de enviar un mensaje
 * (ej: cuando el cliente solo dice "Ok, gracias!")
 */
router.post('/crm/whatsapp/chats/:id/marcar-atendido', async (req, res) => {
    try {
        const chatPk = parseInt(req.params.id);
        const result = await pool.query(`
            UPDATE public.crm_whatsapp_chats
            SET esperando_respuesta = false,
                no_leidos = 0,
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `, [chatPk]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Chat no encontrado' });
        }

        const chat = result.rows[0];
        // Sincronizar también el visto hacia WhatsApp Web para que no vuelva a encenderse como no leído
        fetch('http://localhost:3004/facturacion/whatsapp/sincronizar-chats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ marcarVistoChatId: chat.chat_id })
        }).catch(() => {});

        res.json({ success: true, data: chat });
    } catch (error) {
        console.error('❌ [CRM-WA-HUB] Error marcando chat atendido:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PATCH /api/crm/whatsapp/chats/:id/config
 * Modifica dinámicamente la privacidad (Modo Comercial / Modo Personal / Silenciar 24h / Ocultar),
 * etiquetas CRM, notas rápidas o vinculación manual con un cliente de Búnker.
 */
router.patch('/crm/whatsapp/chats/:id/config', async (req, res) => {
    try {
        const chatPk = parseInt(req.params.id);
        const {
            modo_privacidad,
            silenciar_horas,
            etiqueta_crm,
            nota_rapida,
            bunker_cliente_id,
            contacto_nombre,
            contacto_cargo,
            desvincular_cliente
        } = req.body;

        const chatRes = await pool.query('SELECT * FROM public.crm_whatsapp_chats WHERE id = $1 LIMIT 1', [chatPk]);
        if (chatRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Chat no encontrado' });
        }

        const actual = chatRes.rows[0];
        let nuevoModo = modo_privacidad !== undefined ? modo_privacidad : actual.modo_privacidad;
        let nuevoSilenciadoHasta = actual.silenciado_hasta;

        if (silenciar_horas !== undefined) {
            if (silenciar_horas === null || silenciar_horas === 0) {
                nuevoSilenciadoHasta = null;
            } else {
                const hs = parseFloat(silenciar_horas) || 24;
                nuevoSilenciadoHasta = new Date(Date.now() + hs * 3600 * 1000);
            }
        }

        let nuevoBunkerId = actual.bunker_cliente_id;
        let nuevoClienteNombre = actual.cliente_nombre;
        let nuevoCodigoBunker = actual.codigo_bunker_cliente;
        let nuevoEsCliente = actual.es_cliente_bunker;
        let nuevaVinculacionManual = actual.vinculacion_manual;

        if (desvincular_cliente === true) {
            nuevoBunkerId = null;
            nuevoClienteNombre = null;
            nuevoCodigoBunker = null;
            nuevoEsCliente = false;
            nuevaVinculacionManual = true;
        } else if (bunker_cliente_id !== undefined && bunker_cliente_id !== null && bunker_cliente_id !== '') {
            const bcRes = await pool.query(
                'SELECT id, cliente_nombre, razon_social, codigo_bunker_cliente FROM public.bunker_clientes WHERE id = $1 LIMIT 1',
                [parseInt(bunker_cliente_id)]
            );
            if (bcRes.rows.length > 0) {
                const bc = bcRes.rows[0];
                nuevoBunkerId = bc.id;
                nuevoClienteNombre = bc.cliente_nombre || bc.razon_social;
                nuevoCodigoBunker = bc.codigo_bunker_cliente;
                nuevoEsCliente = true;
                nuevaVinculacionManual = true;
            }
        }

        const nuevaEtiqueta = etiqueta_crm !== undefined ? (etiqueta_crm || null) : actual.etiqueta_crm;
        const nuevaNota = nota_rapida !== undefined ? nota_rapida : actual.nota_rapida;
        const nuevoContactoNombre = contacto_nombre !== undefined ? contacto_nombre : actual.contacto_nombre;
        const nuevoContactoCargo = contacto_cargo !== undefined ? contacto_cargo : actual.contacto_cargo;

        const updRes = await pool.query(`
            UPDATE public.crm_whatsapp_chats
            SET modo_privacidad = $2,
                silenciado_hasta = $3,
                etiqueta_crm = $4,
                nota_rapida = $5,
                bunker_cliente_id = $6,
                cliente_nombre = $7,
                codigo_bunker_cliente = $8,
                es_cliente_bunker = $9,
                vinculacion_manual = $10,
                contacto_nombre = $11,
                contacto_cargo = $12,
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `, [
            chatPk,
            nuevoModo,
            nuevoSilenciadoHasta,
            nuevaEtiqueta,
            nuevaNota,
            nuevoBunkerId,
            nuevoClienteNombre,
            nuevoCodigoBunker,
            nuevoEsCliente,
            nuevaVinculacionManual,
            nuevoContactoNombre,
            nuevoContactoCargo
        ]);

        res.json({
            success: true,
            data: updRes.rows[0]
        });
    } catch (error) {
        console.error('❌ [CRM-WA-HUB] Error actualizando configuración del chat:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/crm/whatsapp/iniciar-chat-cliente
 * Abre o inicializa una ficha de chat para cualquier cliente de Búnker aunque aún no tenga mensajes registrados
 */
router.post('/crm/whatsapp/iniciar-chat-cliente', async (req, res) => {
    try {
        await crmWhatsappDb.asegurarTablasCrmWhatsapp();
        const { bunker_cliente_id, telefono, contacto_nombre, contacto_cargo } = req.body;

        if (!telefono) {
            return res.status(400).json({ success: false, error: 'Se requiere un número de teléfono.' });
        }

        const infoTel = crmWhatsappDb.analizarTelefono(telefono);
        if (!infoTel.limpio) {
            return res.status(400).json({ success: false, error: 'Número de teléfono no válido.' });
        }

        const chatId = `${infoTel.limpio}@c.us`;
        const existente = await pool.query('SELECT * FROM public.crm_whatsapp_chats WHERE chat_id = $1 LIMIT 1', [chatId]);

        if (existente.rows.length > 0) {
            return res.json({ success: true, data: existente.rows[0] });
        }

        let cliNombre = null;
        let codBunker = null;
        let esCliente = false;

        if (bunker_cliente_id) {
            const bcRes = await pool.query(
                'SELECT id, cliente_nombre, razon_social, codigo_bunker_cliente FROM public.bunker_clientes WHERE id = $1 LIMIT 1',
                [parseInt(bunker_cliente_id)]
            );
            if (bcRes.rows.length > 0) {
                cliNombre = bcRes.rows[0].cliente_nombre || bcRes.rows[0].razon_social;
                codBunker = bcRes.rows[0].codigo_bunker_cliente;
                esCliente = true;
            }
        }

        const insRes = await pool.query(`
            INSERT INTO public.crm_whatsapp_chats (
                chat_id, telefono_normalizado, ultimos_digitos,
                bunker_cliente_id, cliente_nombre, codigo_bunker_cliente,
                contacto_nombre, contacto_cargo, es_cliente_bunker,
                modo_privacidad, esperando_respuesta, no_leidos,
                ultimo_mensaje_texto, ultimo_mensaje_from_me, ultimo_mensaje_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVO', false, 0, 'Conversación iniciada desde LAMDA', true, NOW())
            RETURNING *
        `, [
            chatId,
            infoTel.limpio,
            infoTel.cola8,
            bunker_cliente_id ? parseInt(bunker_cliente_id) : null,
            cliNombre,
            codBunker,
            contacto_nombre || cliNombre || infoTel.limpio,
            contacto_cargo || '',
            esCliente
        ]);

        res.json({ success: true, data: insRes.rows[0] });
    } catch (error) {
        console.error('❌ [CRM-WA-HUB] Error iniciando chat cliente:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/crm/whatsapp/sincronizar
 * Dispara la sincronización bajo demanda de los chats recientes desde WhatsApp Web (puerto 3004)
 * y re-cruza todos los teléfonos contra bunker_clientes.
 */
router.post('/crm/whatsapp/sincronizar', async (req, res) => {
    try {
        await crmWhatsappDb.asegurarTablasCrmWhatsapp();
        const rematch = await crmWhatsappDb.rematchearChatsConBunker();

        let syncRemoto = { success: false, message: 'No conectado' };
        try {
            const response = await fetch('http://localhost:3004/facturacion/whatsapp/sincronizar-chats', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body || {})
            });
            syncRemoto = await response.json();
        } catch (errFetch) {
            console.warn('⚠️ [CRM-WA-HUB] Microservicio 3004 no respondió a sincronizar-chats:', errFetch.message);
        }

        res.json({
            success: true,
            rematch,
            sync: syncRemoto
        });
    } catch (error) {
        console.error('❌ [CRM-WA-HUB] Error en sincronizar:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/crm/whatsapp/facturas/:facturaId/generar-documentos-arca
 * Deposita en la Bandeja de Facturas (estado BORRADOR, pre-ARCA) la Nota de Crédito
 * y (opcionalmente) la Nueva Factura con el precio corregido tras recibir el OK del cliente.
 */
router.post('/crm/whatsapp/facturas/:facturaId/generar-documentos-arca', async (req, res) => {
    const client = await pool.connect();
    try {
        const facturaId = parseInt(req.params.facturaId, 10);
        if (isNaN(facturaId) || facturaId <= 0) {
            return res.status(400).json({ success: false, error: 'ID de factura inválido' });
        }

        const {
            chatPk = null,
            alcance = 'ITEMS_SELECCIONADOS', // 'ITEMS_SELECCIONADOS' | 'COMPROBANTE_COMPLETO' | 'SOLO_NC'
            mover_stock = true,
            reemplazar_borrador = false,
            items_seleccionados = [],
            condicion = ''
        } = req.body || {};

        await client.query('BEGIN');

        // 1. Obtener factura original y bloquear fila
        const facOrigRes = await client.query(
            'SELECT * FROM public.factura_facturas WHERE id = $1 FOR UPDATE',
            [facturaId]
        );
        if (facOrigRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: `La factura #${facturaId} no existe` });
        }

        const facturaOrig = facOrigRes.rows[0];
        const tipoOrig = Number(facturaOrig.tipo_cbte);
        const mapaTipoNC = { 1: 3, 6: 8, 11: 13 };
        const tipoNC = mapaTipoNC[tipoOrig];

        if (!tipoNC) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: `El comprobante original (tipo ${tipoOrig}) no es una Factura A/B/C admisible para generar Nota de Crédito.`
            });
        }

        // 2. Verificar si ya existe un Borrador de Nota de Crédito asociado a esta factura
        const existingNcRes = await client.query(`
            SELECT id, tipo_cbte, pto_vta, imp_total, estado, created_at
            FROM public.factura_facturas
            WHERE factura_asociada_id = $1
              AND estado IN ('BORRADOR', 'APROBADA', 'APROBADA_LOCAL')
            ORDER BY id DESC
        `, [facturaId]);

        const borradoresNcExistentes = existingNcRes.rows.filter(r => r.estado === 'BORRADOR');
        const emitidasNcExistentes = existingNcRes.rows.filter(r => r.estado !== 'BORRADOR');

        if (emitidasNcExistentes.length > 0 && !reemplazar_borrador) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                code: 'NC_YA_EMITIDA',
                nc_existente: emitidasNcExistentes[0],
                error: `Esta factura ya posee una Nota de Crédito emitida (#${emitidasNcExistentes[0].id} por $${Number(emitidasNcExistentes[0].imp_total || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}).`
            });
        }

        if (borradoresNcExistentes.length > 0 && !reemplazar_borrador) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                code: 'BORRADOR_EXISTENTE',
                borrador_nc: borradoresNcExistentes[0],
                error: `Ya existe un Borrador de Nota de Crédito (#${borradoresNcExistentes[0].id} por $${Number(borradoresNcExistentes[0].imp_total || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}) depositado en la Bandeja de Facturas ARCA para este comprobante.`
            });
        }

        if (borradoresNcExistentes.length > 0 && reemplazar_borrador) {
            for (const bNc of borradoresNcExistentes) {
                await client.query(`
                    DELETE FROM public.factura_facturas
                    WHERE id = $1
                      AND estado = 'BORRADOR'
                      AND cae IS NULL
                `, [bNc.id]);
            }
        }

        // 3. Obtener todos los ítems de la factura original
        const itemsOrigRes = await client.query(
            'SELECT * FROM public.factura_factura_items WHERE factura_id = $1 ORDER BY orden ASC, id ASC',
            [facturaId]
        );
        const itemsOrig = itemsOrigRes.rows;
        if (itemsOrig.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'La factura original no posee ítems detallados.' });
        }

        // Mapear selección enviada desde el modal
        const selPorId = new Map();
        const selPorCodigo = new Map();
        (Array.isArray(items_seleccionados) ? items_seleccionados : []).forEach(s => {
            if (s && s.id) selPorId.set(Number(s.id), s);
            if (s && s.articulo_id) selPorCodigo.set(String(s.articulo_id).trim().toUpperCase(), s);
        });

        const buscarSeleccion = (itemOrig) => {
            if (selPorId.has(Number(itemOrig.id))) return selPorId.get(Number(itemOrig.id));
            const cod = String(itemOrig.articulo_id || '').trim().toUpperCase();
            if (cod && selPorCodigo.has(cod)) return selPorCodigo.get(cod);
            return null;
        };

        const itemsFiltradosSeleccion = itemsOrig.filter(it => Boolean(buscarSeleccion(it)));
        const itemsParaNC = (alcance === 'COMPROBANTE_COMPLETO')
            ? itemsOrig
            : (itemsFiltradosSeleccion.length > 0 ? itemsFiltradosSeleccion : itemsOrig);

        const obtenerPctIva = (alicId, tipoCbte) => {
            if (Number(tipoCbte) === 11 || Number(tipoCbte) === 13) return 0;
            const idNum = Number(alicId || 5);
            if (idNum === 4) return 10.5;
            if (idNum === 6) return 27;
            if (idNum === 3) return 0;
            return 21;
        };

        // Helper para pre-asignar cbte_nro secuencial en borradores
        const preasignarCbteNro = async (ptoVta, tCbte) => {
            const resNum = await client.query(
                `SELECT COALESCE(MAX(cbte_nro), 0) as max_nro FROM public.factura_facturas WHERE pto_vta = $1 AND tipo_cbte = $2`,
                [ptoVta, tCbte]
            );
            const resAfipNum = await client.query(
                `SELECT ultimo_cbte_afip FROM public.factura_numeracion_afip WHERE pto_vta = $1 AND tipo_cbte = $2`,
                [ptoVta, tCbte]
            );
            const maxNro = parseInt(resNum.rows[0]?.max_nro || 0, 10);
            const afipNro = parseInt(resAfipNum.rows[0]?.ultimo_cbte_afip || 0, 10);
            return Math.max(maxNro, afipNro) + 1;
        };

        // =========================================================================
        // 4. CREAR DOCUMENTO 1: BORRADOR DE NOTA DE CRÉDITO (vinculado a facturaOrig)
        // =========================================================================
        let ncImpNeto = 0;
        let ncImpIva = 0;
        let ncCostoTotal = 0;
        let ncMercTotal = 0;
        let ncMoTotal = 0;
        let ncInsTotal = 0;
        const descDecimalOrig = Number(facturaOrig.descuento || 0);

        const itemsNcPreparados = itemsParaNC.map((it, idx) => {
            const sel = buscarSeleccion(it);
            const qtyOrig = Number(it.qty || 1);
            const qty = (sel && sel.qty_elegida !== undefined && Number(sel.qty_elegida) > 0)
                ? Number(sel.qty_elegida)
                : qtyOrig;
            const pUnit = Number(it.p_unit || 0);
            const alicIvaId = Number(it.alic_iva_id || 5);
            const ivaPct = obtenerPctIva(alicIvaId, tipoNC);
            const factorDesc = descDecimalOrig > 0 ? (1 - descDecimalOrig) : 1;
            const impNeto = +(qty * pUnit * factorDesc).toFixed(2);
            const impIva = +(impNeto * (ivaPct / 100)).toFixed(2);

            const cUnit = Number(it.costo_unitario || 0);
            const cMerc = (it.costo_mercaderia_unitario !== null && it.costo_mercaderia_unitario !== undefined)
                ? Number(it.costo_mercaderia_unitario)
                : cUnit;
            const cMo = Number(it.costo_mano_obra_unitario || 0);
            const cIns = Number(it.costo_insumos_unitario || 0);

            ncImpNeto += impNeto;
            ncImpIva += impIva;
            ncCostoTotal += +(qty * cUnit).toFixed(2);
            ncMercTotal += +(qty * cMerc).toFixed(2);
            ncMoTotal += +(qty * cMo).toFixed(2);
            ncInsTotal += +(qty * cIns).toFixed(2);

            return {
                articulo_id: it.articulo_id,
                descripcion: it.descripcion,
                qty,
                p_unit: pUnit,
                alic_iva_id: alicIvaId,
                imp_iva: impIva,
                imp_neto: impNeto,
                orden: idx + 1,
                costo_unitario: cUnit,
                costo_mercaderia_unitario: cMerc,
                costo_mano_obra_unitario: cMo,
                costo_insumos_unitario: cIns,
                es_saldo_ingrediente: Boolean(it.es_saldo_ingrediente),
                kilos_saldo: Number(it.kilos_saldo || 0)
            };
        });

        ncImpNeto = +ncImpNeto.toFixed(2);
        ncImpIva = +ncImpIva.toFixed(2);
        const ncImpTotal = +(ncImpNeto + ncImpIva).toFixed(2);
        ncCostoTotal = +ncCostoTotal.toFixed(2);
        ncMercTotal = +ncMercTotal.toFixed(2);
        ncMoTotal = +ncMoTotal.toFixed(2);
        ncInsTotal = +ncInsTotal.toFixed(2);
        const ncImpIibb = +(ncImpTotal * 0.04).toFixed(2);
        const ncImpDifIva = +Math.max(0, ncImpIva - ((ncMercTotal + ncInsTotal) * 0.21)).toFixed(2);
        const ncGananciaSinIibb = +(ncImpNeto - ncCostoTotal - ncImpIibb).toFixed(2);
        const ncGananciaReal = +(ncGananciaSinIibb - ncImpDifIva).toFixed(2);

        const ptoVtaNc = facturaOrig.pto_vta || 32;
        const cbteNroNc = await preasignarCbteNro(ptoVtaNc, tipoNC);

        const insNcRes = await client.query(`
            INSERT INTO public.factura_facturas (
                tipo_cbte, pto_vta, cbte_nro, concepto, fecha_emision,
                cliente_id, doc_tipo, doc_nro, condicion_iva_id,
                moneda, mon_cotiz,
                imp_neto, imp_iva, imp_trib, imp_total,
                estado, requiere_afip,
                factura_asociada_id, presupuesto_id, stock_descontado, descuento,
                costo_estimado_total, costo_mercaderia_total, costo_mano_obra_total, costo_insumos_total,
                imp_iibb, imp_dif_iva, ganancia_sin_iibb_total, ganancia_real_total, foto_capturada,
                emitida_en, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, CURRENT_DATE,
                $5, $6, $7, $8,
                $9, $10,
                $11, $12, 0, $13,
                'BORRADOR', $14,
                $15, $16, $17, $18,
                $19, $20, $21, $22,
                $23, $24, $25, $26, true,
                NOW(), NOW(), NOW()
            ) RETURNING *
        `, [
            tipoNC,
            ptoVtaNc,
            cbteNroNc,
            facturaOrig.concepto || 1,
            facturaOrig.cliente_id,
            facturaOrig.doc_tipo,
            facturaOrig.doc_nro,
            facturaOrig.condicion_iva_id,
            facturaOrig.moneda || 'PES',
            facturaOrig.mon_cotiz || 1,
            ncImpNeto,
            ncImpIva,
            ncImpTotal,
            facturaOrig.requiere_afip !== false,
            facturaOrig.id,
            facturaOrig.presupuesto_id,
            !mover_stock,
            descDecimalOrig,
            ncCostoTotal,
            ncMercTotal,
            ncMoTotal,
            ncInsTotal,
            ncImpIibb,
            ncImpDifIva,
            ncGananciaSinIibb,
            ncGananciaReal
        ]);

        const borradorNc = insNcRes.rows[0];

        for (const itNc of itemsNcPreparados) {
            await client.query(`
                INSERT INTO public.factura_factura_items (
                    factura_id, articulo_id, descripcion, qty,
                    p_unit, alic_iva_id, imp_iva, imp_neto, orden,
                    costo_unitario, costo_mercaderia_unitario, costo_mano_obra_unitario, costo_insumos_unitario,
                    es_saldo_ingrediente, kilos_saldo, created_at
                ) VALUES (
                    $1, $2, $3, $4,
                    $5, $6, $7, $8, $9,
                    $10, $11, $12, $13,
                    $14, $15, NOW()
                )
            `, [
                borradorNc.id,
                itNc.articulo_id,
                itNc.descripcion,
                itNc.qty,
                itNc.p_unit,
                itNc.alic_iva_id,
                itNc.imp_iva,
                itNc.imp_neto,
                itNc.orden,
                itNc.costo_unitario,
                itNc.costo_mercaderia_unitario,
                itNc.costo_mano_obra_unitario,
                itNc.costo_insumos_unitario,
                itNc.es_saldo_ingrediente,
                itNc.kilos_saldo
            ]);
        }

        // =========================================================================
        // 5. CREAR DOCUMENTO 2: BORRADOR DE NUEVA FACTURA (OPCIONAL)
        // =========================================================================
        let borradorNuevaFactura = null;
        let itemsNuevaFacPreparados = [];

        if (alcance !== 'SOLO_NC') {
            let nfImpNeto = 0;
            let nfImpIva = 0;
            let nfCostoTotal = 0;
            let nfMercTotal = 0;
            let nfMoTotal = 0;
            let nfInsTotal = 0;

            itemsNuevaFacPreparados = itemsParaNC.map((it, idx) => {
                const sel = buscarSeleccion(it);
                const pUnitElegido = (sel && sel.p_real_neto_elegido !== undefined && sel.p_real_neto_elegido !== null && Number(sel.p_real_neto_elegido) > 0)
                    ? +Number(sel.p_real_neto_elegido).toFixed(2)
                    : Number(it.p_unit || 0);

                const qty = (sel && sel.qty_elegida !== undefined && Number(sel.qty_elegida) > 0)
                    ? Number(sel.qty_elegida)
                    : Number(it.qty || 1);
                const alicIvaId = Number(it.alic_iva_id || 5);
                const ivaPct = obtenerPctIva(alicIvaId, tipoOrig);
                const impNeto = +(qty * pUnitElegido).toFixed(2);
                const impIva = +(impNeto * (ivaPct / 100)).toFixed(2);

                const cUnit = Number(it.costo_unitario || 0);
                const cMerc = (it.costo_mercaderia_unitario !== null && it.costo_mercaderia_unitario !== undefined)
                    ? Number(it.costo_mercaderia_unitario)
                    : cUnit;
                const cMo = Number(it.costo_mano_obra_unitario || 0);
                const cIns = Number(it.costo_insumos_unitario || 0);

                nfImpNeto += impNeto;
                nfImpIva += impIva;
                nfCostoTotal += +(qty * cUnit).toFixed(2);
                nfMercTotal += +(qty * cMerc).toFixed(2);
                nfMoTotal += +(qty * cMo).toFixed(2);
                nfInsTotal += +(qty * cIns).toFixed(2);

                return {
                    articulo_id: it.articulo_id,
                    descripcion: it.descripcion,
                    qty,
                    p_unit: pUnitElegido,
                    alic_iva_id: alicIvaId,
                    imp_iva: impIva,
                    imp_neto: impNeto,
                    orden: idx + 1,
                    costo_unitario: cUnit,
                    costo_mercaderia_unitario: cMerc,
                    costo_mano_obra_unitario: cMo,
                    costo_insumos_unitario: cIns,
                    es_saldo_ingrediente: Boolean(it.es_saldo_ingrediente),
                    kilos_saldo: Number(it.kilos_saldo || 0)
                };
            });

            nfImpNeto = +nfImpNeto.toFixed(2);
            nfImpIva = +nfImpIva.toFixed(2);
            const nfImpTotal = +(nfImpNeto + nfImpIva).toFixed(2);
            nfCostoTotal = +nfCostoTotal.toFixed(2);
            nfMercTotal = +nfMercTotal.toFixed(2);
            nfMoTotal = +nfMoTotal.toFixed(2);
            nfInsTotal = +nfInsTotal.toFixed(2);
            const nfImpIibb = +(nfImpTotal * 0.04).toFixed(2);
            const nfImpDifIva = +Math.max(0, nfImpIva - ((nfMercTotal + nfInsTotal) * 0.21)).toFixed(2);
            const nfGananciaSinIibb = +(nfImpNeto - nfCostoTotal - nfImpIibb).toFixed(2);
            const nfGananciaReal = +(nfGananciaSinIibb - nfImpDifIva).toFixed(2);

            const cbteNroNf = await preasignarCbteNro(ptoVtaNc, tipoOrig);

            const insNfRes = await client.query(`
                INSERT INTO public.factura_facturas (
                    tipo_cbte, pto_vta, cbte_nro, concepto, fecha_emision,
                    cliente_id, doc_tipo, doc_nro, condicion_iva_id,
                    moneda, mon_cotiz,
                    imp_neto, imp_iva, imp_trib, imp_total,
                    estado, requiere_afip,
                    factura_asociada_id, presupuesto_id, stock_descontado, descuento,
                    costo_estimado_total, costo_mercaderia_total, costo_mano_obra_total, costo_insumos_total,
                    imp_iibb, imp_dif_iva, ganancia_sin_iibb_total, ganancia_real_total, foto_capturada,
                    emitida_en, created_at, updated_at
                ) VALUES (
                    $1, $2, $3, $4, CURRENT_DATE,
                    $5, $6, $7, $8,
                    $9, $10,
                    $11, $12, 0, $13,
                    'BORRADOR', $14,
                    NULL, NULL, $15, 0,
                    $16, $17, $18, $19,
                    $20, $21, $22, $23, true,
                    NOW(), NOW(), NOW()
                ) RETURNING *
            `, [
                tipoOrig,
                ptoVtaNc,
                cbteNroNf,
                facturaOrig.concepto || 1,
                facturaOrig.cliente_id,
                facturaOrig.doc_tipo,
                facturaOrig.doc_nro,
                facturaOrig.condicion_iva_id,
                facturaOrig.moneda || 'PES',
                facturaOrig.mon_cotiz || 1,
                nfImpNeto,
                nfImpIva,
                nfImpTotal,
                facturaOrig.requiere_afip !== false,
                !mover_stock,
                nfCostoTotal,
                nfMercTotal,
                nfMoTotal,
                nfInsTotal,
                nfImpIibb,
                nfImpDifIva,
                nfGananciaSinIibb,
                nfGananciaReal
            ]);

            borradorNuevaFactura = insNfRes.rows[0];

            for (const itNf of itemsNuevaFacPreparados) {
                await client.query(`
                    INSERT INTO public.factura_factura_items (
                        factura_id, articulo_id, descripcion, qty,
                        p_unit, alic_iva_id, imp_iva, imp_neto, orden,
                        costo_unitario, costo_mercaderia_unitario, costo_mano_obra_unitario, costo_insumos_unitario,
                        es_saldo_ingrediente, kilos_saldo, created_at
                    ) VALUES (
                        $1, $2, $3, $4,
                        $5, $6, $7, $8, $9,
                        $10, $11, $12, $13,
                        $14, $15, NOW()
                    )
                `, [
                    borradorNuevaFactura.id,
                    itNf.articulo_id,
                    itNf.descripcion,
                    itNf.qty,
                    itNf.p_unit,
                    itNf.alic_iva_id,
                    itNf.imp_iva,
                    itNf.imp_neto,
                    itNf.orden,
                    itNf.costo_unitario,
                    itNf.costo_mercaderia_unitario,
                    itNf.costo_mano_obra_unitario,
                    itNf.costo_insumos_unitario,
                    itNf.es_saldo_ingrediente,
                    itNf.kilos_saldo
                ]);
            }
        }

        // =========================================================================
        // 6. ACTUALIZAR HUELLA CRM EN EL CHAT DE WHATSAPP (SI SE INFORMÓ chatPk)
        // =========================================================================
        const tipoLetraOrig = tipoOrig === 1 ? 'Factura A' : (tipoOrig === 6 ? 'Factura B' : 'Factura C');
        const nroCompOrig = `${String(facturaOrig.pto_vta || 32).padStart(4, '0')}-${String(facturaOrig.cbte_nro || 0).padStart(8, '0')}`;
        const hoyStr = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
        const ncMontoFmt = Number(borradorNc.imp_total || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const nfMontoFmt = borradorNuevaFactura
            ? Number(borradorNuevaFactura.imp_total || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : null;
        const difNetaTotal = borradorNuevaFactura
            ? +(Number(borradorNuevaFactura.imp_total || 0) - Number(borradorNc.imp_total || 0)).toFixed(2)
            : -Number(borradorNc.imp_total || 0);

        const huellaCrm = borradorNuevaFactura
            ? `[${hoyStr} ✅ OK CLIENTE · EN BANDEJA ARCA] ${tipoLetraOrig} ${nroCompOrig}: Depositados Borrador NC #${borradorNc.id} (-$${ncMontoFmt}) + Borrador Nueva Factura #${borradorNuevaFactura.id} ($${nfMontoFmt}) listos para solicitar CAE.`
            : `[${hoyStr} ✅ OK CLIENTE · EN BANDEJA ARCA] ${tipoLetraOrig} ${nroCompOrig}: Depositado Borrador NC #${borradorNc.id} (-$${ncMontoFmt}) listo para solicitar CAE.`;

        if (chatPk) {
            const chatRes = await client.query('SELECT id, nota_rapida FROM public.crm_whatsapp_chats WHERE id = $1 LIMIT 1', [parseInt(chatPk, 10)]);
            if (chatRes.rows.length > 0) {
                const notaPrevia = chatRes.rows[0].nota_rapida || '';
                const lineasPrevias = notaPrevia.split('\n').map(l => l.trim()).filter(l => l && !l.includes(nroCompOrig));
                const notaActualizada = [huellaCrm, ...lineasPrevias].join('\n');
                await client.query(`
                    UPDATE public.crm_whatsapp_chats
                    SET nota_rapida = $1,
                        etiqueta_crm = 'RECLAMO',
                        updated_at = NOW()
                    WHERE id = $2
                `, [notaActualizada, parseInt(chatPk, 10)]);
            }
        }

        await client.query('COMMIT');

        console.log(`✅ [CRM-WA-ARCA] Depositados en Bandeja ARCA desde ${tipoLetraOrig} ${nroCompOrig}: Borrador NC #${borradorNc.id} ($${borradorNc.imp_total})${borradorNuevaFactura ? ` + Borrador Nueva Factura #${borradorNuevaFactura.id} ($${borradorNuevaFactura.imp_total})` : ''}`);

        res.json({
            success: true,
            factura_original: {
                id: facturaOrig.id,
                tipo_letra: tipoLetraOrig,
                numero: nroCompOrig
            },
            borrador_nc: {
                ...borradorNc,
                items: itemsNcPreparados
            },
            borrador_nueva_factura: borradorNuevaFactura ? {
                ...borradorNuevaFactura,
                items: itemsNuevaFacPreparados
            } : null,
            diferencia_neta_total: difNetaTotal,
            mover_stock: Boolean(mover_stock),
            huella_crm: huellaCrm
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ [CRM-WA-ARCA] Error generando documentos en Bandeja ARCA:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
});

// =========================================================================
// MEMORIA Y SÍNTESIS INCREMENTAL DEL CLIENTE (1ra LECTURA PROFUNDA + DELTAS)
// =========================================================================
let _tablaSintesisAsegurada = false;
async function asegurarTablaSintesisMemoriaCliente() {
    if (_tablaSintesisAsegurada) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.crm_cliente_sintesis_memoria (
            cliente_bunker_id INTEGER PRIMARY KEY,
            codigo_bunker_cliente VARCHAR(64),
            cliente_nombre TEXT,
            lomas_soft_id INTEGER,
            articulos_habituales_json JSONB DEFAULT '[]'::jsonb,
            ciclo_compra_json JSONB DEFAULT '{}'::jsonb,
            comportamiento_pago_json JSONB DEFAULT '{}'::jsonb,
            contactos_hilo_json JSONB DEFAULT '{}'::jsonb,
            ultima_factura_id_procesada INTEGER DEFAULT 0,
            ultimo_presupuesto_id_procesado INTEGER DEFAULT 0,
            ultimo_movimiento_cc_id_procesado INTEGER DEFAULT 0,
            version_sintesis INTEGER DEFAULT 1,
            razonamiento_ia_json JSONB DEFAULT NULL,
            ultimo_msg_id_razonado BIGINT DEFAULT 0,
            primera_lectura_en TIMESTAMP DEFAULT NOW(),
            ultima_actualizacion_en TIMESTAMP DEFAULT NOW()
        );
        ALTER TABLE public.crm_cliente_sintesis_memoria
            ADD COLUMN IF NOT EXISTS razonamiento_ia_json JSONB DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS ultimo_msg_id_razonado BIGINT DEFAULT 0;
    `);
    _tablaSintesisAsegurada = true;
}
asegurarTablaSintesisMemoriaCliente().catch(() => {});

/**
 * GET /api/crm/whatsapp/clientes/:clienteId/sintesis-hibrida
 * - 1ra vez (o ?forzar=1): hace la lectura profunda completa del historial de compras,
 *   facturas, presupuestos, pagos en cuenta corriente y estilo de saludo en el chat,
 *   y guarda la síntesis consolidada en public.crm_cliente_sintesis_memoria.
 * - Próximas veces: levanta la síntesis guardada en milisegundos y SOLO consulta si hubo
 *   novedades (facturas, movimientos o mensajes con ID mayor al último procesado).
 */
router.get('/crm/whatsapp/clientes/:clienteId/sintesis-hibrida', async (req, res) => {
    const t0 = Date.now();
    try {
        await asegurarTablaSintesisMemoriaCliente();
        const clienteId = parseInt(req.params.clienteId, 10);
        const chatId = req.query.chatId ? parseInt(req.query.chatId, 10) : 0;
        let forzarCompleta = req.query.forzar === '1' || req.query.forzar === 'true';

        if (!clienteId || Number.isNaN(clienteId)) {
            return res.status(400).json({ success: false, error: 'clienteId inválido' });
        }

        // Buscar síntesis existente
        const memRes = await pool.query(
            'SELECT * FROM public.crm_cliente_sintesis_memoria WHERE cliente_bunker_id = $1 LIMIT 1',
            [clienteId]
        );
        const existente = memRes.rows[0] || null;

        // Obtener datos básicos del cliente en Búnker
        const bcRes = await pool.query(`
            SELECT id, cliente_nombre, razon_social, codigo_bunker_cliente, lomas_soft_id,
                   EXISTS (
                       SELECT 1
                       FROM public.bunker_cliente_listas_precios bclp
                       WHERE bclp.bunker_cliente_id = bc.id
                   ) AS tiene_lista_asignada,
                   (
                       SELECT bclp.bunker_lista_precio_id
                       FROM public.bunker_cliente_listas_precios bclp
                       WHERE bclp.bunker_cliente_id = bc.id
                       ORDER BY bclp.id ASC LIMIT 1
                   ) AS lista_asignada_id_real,
                   COALESCE((
                       SELECT bclp.bunker_lista_precio_id
                       FROM public.bunker_cliente_listas_precios bclp
                       WHERE bclp.bunker_cliente_id = bc.id
                       ORDER BY bclp.id ASC LIMIT 1
                   ), 1) AS lista_asignada_id
            FROM public.bunker_clientes bc
            WHERE bc.id = $1
            LIMIT 1
        `, [clienteId]);

        if (bcRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Cliente no encontrado en Búnker' });
        }

        const cli = bcRes.rows[0];
        const lomasIdNum = (cli.lomas_soft_id && /^\d+$/.test(String(cli.lomas_soft_id).trim()))
            ? parseInt(String(cli.lomas_soft_id).trim(), 10)
            : null;

        let modoLectura = 'PRIMERA_LECTURA_PROFUNDA';
        let novedadesIncorporadas = { nuevas_facturas: 0, nuevos_presupuestos: 0, nuevos_movimientos_cc: 0, nuevos_mensajes: 0 };

        let habitualesMap = new Map();
        let fechasComprasMs = [];
        let cicloCompra = { dias_desde_ultima_compra: null, fecha_ultima_compra_txt: '', frecuencia_media_dias: null, fechas_ms: [] };
        let compPago = { medio_pago_habitual: 'Sin pagos registrados aún', detalle_comportamiento_pago: '', bancos_detectados: [], cantidad_pagos: 0, ultimo_pago_fecha: '', saldo_actual: 0 };
        let contactosHilo = {};
        let ultFacId = 0;
        let ultPresId = 0;
        let ultMovCcId = 0;
        let versionSintesis = 1;

        // Si la síntesis guardada tenía códigos de barras numéricos sin resolver (ej. 3116844585), auto-reparar
        if (existente && !forzarCompleta && Array.isArray(existente.articulos_habituales_json)) {
            const tieneCodigosBarrasCrudos = existente.articulos_habituales_json.some(a => /^\d{7,}$/.test(String(a?.articulo_id || '').trim()));
            if (tieneCodigosBarrasCrudos) {
                forzarCompleta = true;
            }
        }

        if (existente && !forzarCompleta) {
            modoLectura = 'SINTESIS_INCREMENTAL';
            versionSintesis = Number(existente.version_sintesis || 1);
            ultFacId = Number(existente.ultima_factura_id_procesada || 0);
            ultPresId = Number(existente.ultimo_presupuesto_id_procesado || 0);
            ultMovCcId = Number(existente.ultimo_movimiento_cc_id_procesado || 0);

            const arrHab = Array.isArray(existente.articulos_habituales_json) ? existente.articulos_habituales_json : [];
            arrHab.forEach(a => {
                if (a && a.articulo_id) habitualesMap.set(String(a.articulo_id).toUpperCase(), a);
            });
            cicloCompra = existente.ciclo_compra_json || cicloCompra;
            fechasComprasMs = Array.isArray(cicloCompra.fechas_ms) ? [...cicloCompra.fechas_ms] : [];
            compPago = existente.comportamiento_pago_json || compPago;
            contactosHilo = existente.contactos_hilo_json || {};
        }

        // 1. Procesar Facturas y Presupuestos (Completo la 1ra vez, o SOLO ID > ultFacId / ultPresId en lecturas siguientes)
        if (lomasIdNum !== null) {
            const facDeltaRes = await pool.query(`
                SELECT f.id, f.tipo_cbte, f.fecha_emision, f.emitida_en,
                       COALESCE((
                           SELECT json_agg(json_build_object(
                               'articulo_id', COALESCE(ba.articulo_id, a.numero, fi.articulo_id),
                               'descripcion', COALESCE(ba.descripcion_generada, ba.descripcion, a.nombre, fi.descripcion, fi.articulo_id),
                               'qty', fi.qty,
                               'p_unit', fi.p_unit,
                               'precio_final', ROUND(fi.p_unit * (1 + (COALESCE(ba.porcentaje_iva, 21) / 100.0)), 2)
                           ))
                           FROM public.factura_factura_items fi
                           LEFT JOIN public.articulos a
                             ON (TRIM(a.codigo_barras::text) = TRIM(fi.articulo_id::text) OR LOWER(TRIM(a.numero::text)) = LOWER(TRIM(fi.articulo_id::text)))
                           LEFT JOIN public.bunker_articulos ba
                             ON LOWER(TRIM(ba.articulo_id::text)) = LOWER(TRIM(COALESCE(a.numero, fi.articulo_id)::text))
                           WHERE fi.factura_id = f.id
                       ), '[]'::json) AS items
                FROM public.factura_facturas f
                WHERE f.cliente_id = $1
                  AND f.id > $2
                  AND COALESCE(f.estado, '') != 'ANULADA'
                ORDER BY COALESCE(f.fecha_emision, f.emitida_en) ASC, f.id ASC
            `, [lomasIdNum, ultFacId]);

            if (facDeltaRes.rows.length > 0) {
                novedadesIncorporadas.nuevas_facturas = facDeltaRes.rows.length;
                facDeltaRes.rows.forEach(f => {
                    if (f.id > ultFacId) ultFacId = f.id;
                    // No sumar Notas de Crédito como compras
                    if ([3, 8, 13].includes(Number(f.tipo_cbte))) return;
                    const rawF = f.fecha_emision || f.emitida_en;
                    const msCompra = rawF ? new Date(rawF).getTime() : 0;
                    if (Number.isFinite(msCompra) && msCompra > 0) fechasComprasMs.push(msCompra);

                    (f.items || []).forEach(it => {
                        const cod = String(it.articulo_id || '').trim();
                        if (!cod) return;
                        const key = cod.toUpperCase();
                        const precioFin = Number(it.precio_final || it.p_unit || 0);
                        const prev = habitualesMap.get(key);
                        if (prev) {
                            prev.frecuencia_compra = Number(prev.frecuencia_compra || 1) + 1;
                            const msPrev = prev.ultima_compra ? new Date(prev.ultima_compra).getTime() : 0;
                            if (!msPrev || msCompra >= msPrev) {
                                prev.ultima_compra = rawF || prev.ultima_compra;
                                if (precioFin > 0) prev.ultimo_precio_unitario = precioFin;
                            }
                        } else {
                            habitualesMap.set(key, {
                                articulo_id: cod,
                                descripcion: String(it.descripcion || cod).trim(),
                                frecuencia_compra: 1,
                                ultima_compra: rawF || null,
                                ultimo_precio_unitario: precioFin
                            });
                        }
                    });
                });
            }

            const presDeltaRes = await pool.query(`
                SELECT p.id, p.fecha,
                       COALESCE((
                           SELECT json_agg(json_build_object(
                               'articulo_id', COALESCE(ba.articulo_id, a.numero, pd.articulo),
                               'descripcion', COALESCE(ba.descripcion_generada, ba.descripcion, a.nombre, pd.articulo),
                               'cantidad', pd.cantidad,
                               'precio1', pd.precio1
                           ))
                           FROM public.presupuestos_detalles pd
                           LEFT JOIN public.articulos a
                             ON (TRIM(a.codigo_barras::text) = TRIM(pd.articulo::text) OR LOWER(TRIM(a.numero::text)) = LOWER(TRIM(pd.articulo::text)))
                           LEFT JOIN public.bunker_articulos ba
                             ON LOWER(TRIM(ba.articulo_id::text)) = LOWER(TRIM(COALESCE(a.numero, pd.articulo)::text))
                           WHERE pd.id_presupuesto = p.id
                       ), '[]'::json) AS items
                FROM public.presupuestos p
                WHERE NULLIF(regexp_replace(p.id_cliente::text, '^0+', ''), '')::integer = $1
                  AND p.id > $2
                  AND (p.estado IS NULL OR LOWER(TRIM(p.estado)) NOT IN ('anulado', 'anulada', 'cancelado', 'cancelada', 'baja', 'eliminado', 'eliminada'))
                  AND (p.activo IS NULL OR p.activo = true)
                  AND (p.archivado IS NULL OR p.archivado = false)
                ORDER BY p.fecha ASC, p.id ASC
            `, [lomasIdNum, ultPresId]);

            if (presDeltaRes.rows.length > 0) {
                novedadesIncorporadas.nuevos_presupuestos = presDeltaRes.rows.length;
                presDeltaRes.rows.forEach(p => {
                    if (p.id > ultPresId) ultPresId = p.id;
                    const msCompra = p.fecha ? new Date(p.fecha).getTime() : 0;
                    if (Number.isFinite(msCompra) && msCompra > 0) fechasComprasMs.push(msCompra);

                    (p.items || []).forEach(it => {
                        const cod = String(it.articulo_id || '').trim();
                        if (!cod) return;
                        const key = cod.toUpperCase();
                        const precioFin = Number(it.precio1 || 0);
                        const prev = habitualesMap.get(key);
                        if (prev) {
                            prev.frecuencia_compra = Number(prev.frecuencia_compra || 1) + 1;
                            const msPrev = prev.ultima_compra ? new Date(prev.ultima_compra).getTime() : 0;
                            if (!msPrev || msCompra >= msPrev) {
                                prev.ultima_compra = p.fecha || prev.ultima_compra;
                                if (precioFin > 0) prev.ultimo_precio_unitario = precioFin;
                            }
                        } else {
                            habitualesMap.set(key, {
                                articulo_id: cod,
                                descripcion: String(it.descripcion || cod).trim(),
                                frecuencia_compra: 1,
                                ultima_compra: p.fecha || null,
                                ultimo_precio_unitario: precioFin
                            });
                        }
                    });
                });
            }
        }

        // Recalcular ciclo de compra sobre las fechas acumuladas
        fechasComprasMs.sort((a, b) => b - a);
        const fechasUnicasMs = [];
        fechasComprasMs.forEach(ms => {
            if (fechasUnicasMs.length === 0 || Math.abs(fechasUnicasMs[fechasUnicasMs.length - 1] - ms) > (18 * 3600 * 1000)) {
                fechasUnicasMs.push(ms);
            }
        });
        const topFechasMs = fechasUnicasMs.slice(0, 25);
        let diasDesdeUltimaCompra = null;
        let fechaUltimaCompraTxt = '';
        let frecuenciaMediaDias = null;
        if (topFechasMs.length > 0) {
            diasDesdeUltimaCompra = Math.max(0, Math.round((Date.now() - topFechasMs[0]) / (1000 * 3600 * 24)));
            try {
                fechaUltimaCompraTxt = new Date(topFechasMs[0]).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
            } catch (_) {}
        }
        if (topFechasMs.length >= 2) {
            const diffs = [];
            for (let i = 0; i < topFechasMs.length - 1; i++) {
                const d = Math.round((topFechasMs[i] - topFechasMs[i + 1]) / (1000 * 3600 * 24));
                if (d >= 2 && d <= 150) diffs.push(d);
            }
            if (diffs.length > 0) {
                frecuenciaMediaDias = Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
            }
        }
        cicloCompra = {
            dias_desde_ultima_compra: diasDesdeUltimaCompra,
            fecha_ultima_compra_txt: fechaUltimaCompraTxt,
            frecuencia_media_dias: frecuenciaMediaDias,
            fechas_ms: topFechasMs
        };

        // 2. Procesar Comportamiento de Pago y Saldo en Cuenta Corriente (solo movimientos con ID > ultMovCcId)
        if (cli.codigo_bunker_cliente) {
            const ccRes = await pool.query(`
                SELECT id, saldo
                FROM public.factura_cuentas_corrientes
                WHERE TRIM(codigo_bunker_cliente) = TRIM($1)
                ORDER BY id ASC
            `, [cli.codigo_bunker_cliente]);

            if (ccRes.rows.length > 0) {
                const ccIds = ccRes.rows.map(r => r.id);
                const saldoActual = ccRes.rows.reduce((acc, r) => acc + (parseFloat(r.saldo) || 0), 0);
                compPago.saldo_actual = saldoActual;

                try {
                    const compViva = await calcularComposicionSaldo(ccRes.rows[0].id, pool);
                    const salvVivo = await salvavidasService.calcularSimulacionCuenta(ccRes.rows[0].id, { persistir_sombra: false }, pool);
                    if (salvVivo) {
                        compPago.salvavidas = {
                            estado_general: salvVivo.estado_general || 'EN_TERMINO',
                            financiacion_total: Number(salvVivo.financiacion_total || 0),
                            financiacion_iva: Number(salvVivo.financiacion_iva || 0),
                            financiacion_total_con_iva: Number(salvVivo.financiacion_total_con_iva || 0),
                            saldo_total_proyectado: Number(salvVivo.saldo_total_proyectado || saldoActual),
                            saldo_total_proyectado_con_iva: Number(salvVivo.saldo_total_proyectado_con_iva || saldoActual)
                        };
                    }
                    if (compViva) {
                        compPago.composicion = {
                            capas: compViva.capas || [],
                            comprobantes_cancelados: compViva.comprobantes_cancelados || [],
                            antiguedad_maxima_dias: compViva.antiguedad_maxima_dias || 0,
                            antiguedad_promedio_dias: compViva.antiguedad_promedio_dias || 0,
                            condicion_comercial: compViva.condicion_comercial || 'AL_DIA_OPTIMO'
                        };
                    }
                } catch (_) {}

                const movDeltaRes = await pool.query(`
                    SELECT id, fecha_movimiento, tipo_movimiento, tipo_comprobante, descripcion, monto
                    FROM public.factura_cuenta_corriente_movimientos
                    WHERE cuenta_corriente_id = ANY($1::int[])
                      AND id > $2
                    ORDER BY id ASC
                `, [ccIds, ultMovCcId]);

                if (movDeltaRes.rows.length > 0) {
                    novedadesIncorporadas.nuevos_movimientos_cc = movDeltaRes.rows.length;
                    const bancosSet = new Set(Array.isArray(compPago.bancos_detectados) ? compPago.bancos_detectados : []);
                    let cantPagos = Number(compPago.cantidad_pagos || 0);
                    let ultimoPagoFecha = compPago.ultimo_pago_fecha || '';
                    let textosPagos = compPago.medio_pago_habitual || '';

                    movDeltaRes.rows.forEach(m => {
                        if (m.id > ultMovCcId) ultMovCcId = m.id;
                        const strMov = `${m.tipo_movimiento || ''} ${m.tipo_comprobante || ''} ${m.descripcion || ''}`;
                        const esNotaCredito = /nota[_\s]*de?[_\s]*cr[eé]dito|\bnc\b/i.test(strMov);
                        const esPago = !esNotaCredito && /recibo|pago|haber|acredit|cobro|cr[eé]dito|transferencia/i.test(strMov);
                        if (esPago) {
                            cantPagos++;
                            const desc = String(m.descripcion || '');
                            textosPagos += ' ' + desc;
                            if (/galicia/i.test(desc)) bancosSet.add('Galicia');
                            if (/provincia|bapro/i.test(desc)) bancosSet.add('Provincia');
                            if (/mercado\s*pago/i.test(desc)) bancosSet.add('Mercado Pago');
                            if (/santander/i.test(desc)) bancosSet.add('Santander');
                            if (/bbva|franc[eé]s/i.test(desc)) bancosSet.add('BBVA');
                            if (m.fecha_movimiento) {
                                try {
                                    ultimoPagoFecha = new Date(m.fecha_movimiento).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                } catch (_) {}
                            }
                        }
                    });

                    const bancosArr = Array.from(bancosSet);
                    let medioPago = compPago.medio_pago_habitual;
                    if (/transferencia/i.test(textosPagos)) {
                        medioPago = `Transferencia Bancaria${bancosArr.length > 0 ? ` (${bancosArr.join('/')})` : ''}`;
                    } else if (/efectivo|caja/i.test(textosPagos)) {
                        medioPago = 'Efectivo';
                    } else if (/cheque|echeq/i.test(textosPagos)) {
                        medioPago = 'Cheque / E-Cheq';
                    } else if (cantPagos > 0) {
                        medioPago = 'Pago en Cuenta Corriente';
                    }

                    const compPrevio = compPago.composicion || null;
                    compPago = {
                        medio_pago_habitual: medioPago,
                        bancos_detectados: bancosArr,
                        cantidad_pagos: cantPagos,
                        ultimo_pago_fecha: ultimoPagoFecha,
                        detalle_comportamiento_pago: cantPagos > 0
                            ? `${cantPagos} ${cantPagos === 1 ? 'pago registrado' : 'pagos registrados'}${ultimoPagoFecha ? ` (último: ${ultimoPagoFecha})` : ''}`
                            : '',
                        saldo_actual: saldoActual,
                        composicion: compPrevio
                    };
                }
            }
        }

        // 3. Procesar Mensajes de WhatsApp del chatId activo (solo ID > ultimo_mensaje_id_procesado)
        let mensajesRecientesChat = [];
        if (chatId > 0) {
            const keyChat = String(chatId);
            const infoChatPrevia = contactosHilo[keyChat] || { ultimo_mensaje_id: 0, ultimo_saludo_nuestro: '', nombre_pila_detectado: '' };
            const ultMsgIdPrevio = forzarCompleta ? 0 : Number(infoChatPrevia.ultimo_mensaje_id || 0);

            const chatRowRes = await pool.query(`
                SELECT id, chat_id, bunker_cliente_id, contacto_nombre, ultimos_digitos
                FROM public.crm_whatsapp_chats
                WHERE id = $1
                LIMIT 1
            `, [chatId]);

            if (chatRowRes.rows.length > 0) {
                const chatRow = chatRowRes.rows[0];
                let chatIdsUnificados = [chatRow.chat_id];
                if (chatRow.bunker_cliente_id) {
                    const subClave = String(chatRow.contacto_nombre || chatRow.ultimos_digitos || '').trim().toLowerCase();
                    const hermanosRes = await pool.query(`
                        SELECT chat_id
                        FROM public.crm_whatsapp_chats
                        WHERE bunker_cliente_id = $1
                          AND LOWER(TRIM(COALESCE(NULLIF(contacto_nombre, ''), NULLIF(ultimos_digitos, ''), ''))) = $2
                    `, [chatRow.bunker_cliente_id, subClave]);
                    if (hermanosRes.rows.length > 0) {
                        chatIdsUnificados = Array.from(new Set(hermanosRes.rows.map(r => r.chat_id).concat([chatRow.chat_id])));
                    }
                }

                const msgDeltaRes = await pool.query(`
                    SELECT id, msg_id, chat_id, from_me, cuerpo, tipo_mensaje, ack, origen_envio, fecha_mensaje
                    FROM public.crm_whatsapp_mensajes
                    WHERE chat_id = ANY($1)
                      AND id > $2
                    ORDER BY fecha_mensaje ASC, id ASC
                `, [chatIdsUnificados, ultMsgIdPrevio]);

                if (msgDeltaRes.rows.length > 0) {
                    novedadesIncorporadas.nuevos_mensajes = msgDeltaRes.rows.length;
                    let maxMsgId = ultMsgIdPrevio;
                    let ultSaludo = infoChatPrevia.ultimo_saludo_nuestro || '';
                    let nomDetectado = infoChatPrevia.nombre_pila_detectado || '';
                    let cierreDetectado = infoChatPrevia.cierre_habitual || '';

                    const regexAutoSistema = /entrega confirmada|extracto de cuenta corriente|comprobante de pago recibido|te contamos que en el taller|prueba interna/i;

                    msgDeltaRes.rows.forEach(m => {
                        if (m.id > maxMsgId) maxMsgId = m.id;
                        if (m.from_me && m.cuerpo) {
                            const txt = String(m.cuerpo).trim();
                            if (regexAutoSistema.test(txt)) return;

                            const matchHola = txt.match(/^(?:¡?hola|buen\s+d[ií]a|buenos\s+d[ií]as|buenas\s+tardes|buenas)[,\s]+([A-ZÁÉÍÓÚÑa-záéíóúñ]{2,15})\b/i);
                            if (matchHola && matchHola[1] && !/^(como|cómo|todo|que|qué|te|les|ya|acá|aca|encargado|negocio|buen|buenos|buenas|estimado|estimada)$/i.test(matchHola[1])) {
                                nomDetectado = matchHola[1].charAt(0).toUpperCase() + matchHola[1].slice(1).toLowerCase();
                                ultSaludo = txt.split('\n')[0].slice(0, 75);
                            } else if (/^(?:¡?hola|buen\s+d[ií]a|buenas)/i.test(txt)) {
                                ultSaludo = txt.split('\n')[0].slice(0, 75);
                            }

                            const matchCierre = txt.match(/(?:estoy|quedo|quedamos|estamos)\s+atent[oa]s?(?:\s+por\s+cualquier\s+cosa)?[!.]?/i);
                            if (matchCierre && matchCierre[0]) {
                                cierreDetectado = matchCierre[0].trim();
                            }
                        }
                    });

                    contactosHilo[keyChat] = {
                        ultimo_mensaje_id: maxMsgId,
                        ultimo_saludo_nuestro: ultSaludo,
                        nombre_pila_detectado: nomDetectado,
                        cierre_habitual: cierreDetectado
                    };
                }

                // Traer las últimas 25 burbujas del chat para tener el contexto completo de conversaciones de ayer/esta semana
                const ult25Res = await pool.query(`
                    SELECT id, msg_id, chat_id, from_me, cuerpo, tipo_mensaje, ack, origen_envio, fecha_mensaje
                    FROM (
                        SELECT id, msg_id, chat_id, from_me, cuerpo, tipo_mensaje, ack, origen_envio, fecha_mensaje
                        FROM public.crm_whatsapp_mensajes
                        WHERE chat_id = ANY($1)
                        ORDER BY fecha_mensaje DESC, id DESC
                        LIMIT 25
                    ) sub
                    ORDER BY fecha_mensaje ASC, id ASC
                `, [chatIdsUnificados]);
                mensajesRecientesChat = ult25Res.rows;

                // Si entre las últimas 4 burbujas hay algún audio entrante sin transcribir ("🎤 Mensaje de audio"), transcribirlo antes de armar la respuesta del asistente
                const ult4Sint = mensajesRecientesChat.slice(-4);
                const audiosSinTrSint = ult4Sint.filter(m =>
                    !m.from_me &&
                    (m.tipo_mensaje === 'ptt' || m.tipo_mensaje === 'audio') &&
                    (!m.cuerpo || String(m.cuerpo).trim() === '🎤 Mensaje de audio')
                );
                if (audiosSinTrSint.length > 0 && chatRow.chat_id) {
                    try {
                        const resTr = await Promise.race([
                            whatsappAudioTranscriber.transcribirAudiosDeChatViaDevTools({
                                chatId: chatRow.chat_id,
                                msgIds: audiosSinTrSint.map(m => m.msg_id).filter(Boolean),
                                maxAudios: 3
                            }),
                            new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 7500))
                        ]);
                        if (resTr && resTr.success && Array.isArray(resTr.resultados) && resTr.resultados.length > 0) {
                            const mapaTr = new Map(resTr.resultados.map(r => [String(r.msgId), r.cuerpo]));
                            mensajesRecientesChat.forEach(m => {
                                const shortId = String(m.msg_id || '').split('_').pop();
                                if (mapaTr.has(shortId)) {
                                    m.cuerpo = mapaTr.get(shortId);
                                }
                            });
                            novedadesIncorporadas.nuevos_mensajes = (novedadesIncorporadas.nuevos_mensajes || 0) + resTr.resultados.length;
                        }
                    } catch (eTrSint) {
                        console.warn('⚠️ [CRM-SINTESIS-MEMORIA] No se pudo transcribir audio en síntesis:', eTrSint.message);
                    }
                }
            }
        }

        // Filtrar habituales estrictamente contra la lista de precios asignada del cliente (solo artículos con disponible = true y precio_final > 0)
        const listaClienteSintesisId = parseInt(cli.lista_asignada_id, 10) || 1;
        const activosListaRes = await pool.query(`
            SELECT LOWER(TRIM(articulo_numero)) AS art_key
            FROM public.bunker_lista_articulos
            WHERE lista_id = $1
              AND COALESCE(disponible, false) = true
              AND COALESCE(precio_final, 0) > 0
        `, [listaClienteSintesisId]);
        const setActivosEnLista = new Set(activosListaRes.rows.map(r => r.art_key));

        const articulosHabitualesArr = Array.from(habitualesMap.values())
            .filter(a => {
                const k = String(a?.articulo_id || '').trim().toLowerCase();
                return k && setActivosEnLista.has(k);
            })
            .sort((a, b) => (Number(b.frecuencia_compra || 0) - Number(a.frecuencia_compra || 0)))
            .slice(0, 20);

        const huboCambios = !existente
            || forzarCompleta
            || novedadesIncorporadas.nuevas_facturas > 0
            || novedadesIncorporadas.nuevos_presupuestos > 0
            || novedadesIncorporadas.nuevos_movimientos_cc > 0
            || novedadesIncorporadas.nuevos_mensajes > 0;

        if (huboCambios) {
            const nuevaVersion = existente && !forzarCompleta ? (versionSintesis + 1) : 1;
            versionSintesis = nuevaVersion;
            await pool.query(`
                INSERT INTO public.crm_cliente_sintesis_memoria (
                    cliente_bunker_id, codigo_bunker_cliente, cliente_nombre, lomas_soft_id,
                    articulos_habituales_json, ciclo_compra_json, comportamiento_pago_json, contactos_hilo_json,
                    ultima_factura_id_procesada, ultimo_presupuesto_id_procesado, ultimo_movimiento_cc_id_procesado,
                    version_sintesis, primera_lectura_en, ultima_actualizacion_en
                ) VALUES (
                    $1, $2, $3, $4,
                    $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb,
                    $9, $10, $11,
                    $12, NOW(), NOW()
                )
                ON CONFLICT (cliente_bunker_id) DO UPDATE SET
                    codigo_bunker_cliente = EXCLUDED.codigo_bunker_cliente,
                    cliente_nombre = EXCLUDED.cliente_nombre,
                    lomas_soft_id = EXCLUDED.lomas_soft_id,
                    articulos_habituales_json = EXCLUDED.articulos_habituales_json,
                    ciclo_compra_json = EXCLUDED.ciclo_compra_json,
                    comportamiento_pago_json = EXCLUDED.comportamiento_pago_json,
                    contactos_hilo_json = EXCLUDED.contactos_hilo_json,
                    ultima_factura_id_procesada = EXCLUDED.ultima_factura_id_procesada,
                    ultimo_presupuesto_id_procesado = EXCLUDED.ultimo_presupuesto_id_procesado,
                    ultimo_movimiento_cc_id_procesado = EXCLUDED.ultimo_movimiento_cc_id_procesado,
                    version_sintesis = EXCLUDED.version_sintesis,
                    ultima_actualizacion_en = NOW()
            `, [
                clienteId,
                cli.codigo_bunker_cliente || '',
                cli.cliente_nombre || '',
                lomasIdNum,
                JSON.stringify(articulosHabitualesArr),
                JSON.stringify(cicloCompra),
                JSON.stringify(compPago),
                JSON.stringify(contactosHilo),
                ultFacId,
                ultPresId,
                ultMovCcId,
                nuevaVersion
            ]);
        }

        const ultimoMsgIdActual = mensajesRecientesChat.length > 0
            ? Number(mensajesRecientesChat[mensajesRecientesChat.length - 1].id || 0)
            : 0;
        const razonamientoIaGuardado = (
            !forzarCompleta &&
            !huboCambios &&
            existente &&
            existente.razonamiento_ia_json &&
            existente.razonamiento_ia_json.usando_ia_real &&
            Number(existente.ultimo_msg_id_razonado || 0) === ultimoMsgIdActual &&
            ultimoMsgIdActual > 0
        ) ? existente.razonamiento_ia_json : null;

        const duracionMs = Date.now() - t0;
        res.json({
            success: true,
            modo_lectura: modoLectura,
            duracion_ms: duracionMs,
            version_sintesis: versionSintesis,
            novedades_incorporadas: novedadesIncorporadas,
            cliente_bunker_id: clienteId,
            codigo_bunker_cliente: cli.codigo_bunker_cliente,
            articulos_habituales: articulosHabitualesArr,
            ciclo_compra: cicloCompra,
            comportamiento_pago: compPago,
            contacto_hilo: chatId ? (contactosHilo[String(chatId)] || null) : null,
            mensajes_recientes: mensajesRecientesChat,
            razonamiento_ia_guardado: razonamientoIaGuardado,
            ia_cognitiva: agenteHibridoLlm.obtenerModoCredencialGemini()
        });
    } catch (error) {
        console.error('❌ [CRM-SINTESIS-MEMORIA] Error en sintesis-hibrida:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/crm/whatsapp/asistente-hibrido/razonar
 * Ejecuta el Comité de Agentes Cognitivos (Gemini 2.5 Flash) sobre la base determinista
 * del cliente, el historial del chat y el catálogo real de LAMDA, y persiste el razonamiento
 * en public.crm_cliente_sintesis_memoria para lectura instantánea en próximas aperturas.
 */
router.post('/crm/whatsapp/asistente-hibrido/razonar', async (req, res) => {
    try {
        const body = req.body || {};
        const mensajesArr = Array.isArray(body.mensajesRecientes) ? body.mensajesRecientes : [];
        const resultado = await agenteHibridoLlm.razonarAsistenciaHibridaClienteWa({
            clienteNombre: body.clienteNombre || '',
            contactoNombre: body.contactoNombre || '',
            apodoSugerido: body.apodoSugerido || '',
            mensajesRecientes: mensajesArr,
            catalogoCompacto: Array.isArray(body.catalogoCompacto) ? body.catalogoCompacto : [],
            habitualesCliente: Array.isArray(body.habitualesCliente) ? body.habitualesCliente : [],
            estadoCuentaDeterminista: body.estadoCuentaDeterminista || {},
            linkPortalCliente: body.linkPortalCliente || '',
            instruccionOperador: body.instruccionOperador || '',
            forzarRecalculo: Boolean(body.forzarRecalculo)
        });

        const cliIdNum = parseInt(body.clienteId, 10);
        const ultMsgId = mensajesArr.length > 0 ? Number(mensajesArr[mensajesArr.length - 1].id || 0) : 0;
        if (cliIdNum > 0 && resultado && resultado.usando_ia_real) {
            await asegurarTablaSintesisMemoriaCliente().catch(() => {});
            await pool.query(`
                UPDATE public.crm_cliente_sintesis_memoria
                SET razonamiento_ia_json = $1::jsonb,
                    ultimo_msg_id_razonado = $2,
                    ultima_actualizacion_en = NOW()
                WHERE cliente_bunker_id = $3
            `, [JSON.stringify(resultado), ultMsgId, cliIdNum]).catch(() => {});
        }

        res.json({ success: true, razonamiento: resultado });
    } catch (error) {
        console.error('❌ [CRM-ASISTENTE-HIBRIDO-LLM] Error crítico en conexión Gemini:', error.message);
        res.status(503).json({
            success: false,
            usando_ia_real: false,
            error: error.message
        });
    }
});

/**
 * POST /api/crm/whatsapp/asistente-hibrido/transcribir-instruccion-voz
 * Transcribe un audio grabado por el operador desde el micrófono del navegador (wav/ogg)
 * usando Gemini multimodal para instruir al Comité de Agentes Híbridos.
 */
router.post('/crm/whatsapp/asistente-hibrido/transcribir-instruccion-voz', async (req, res) => {
    try {
        const { audioBase64, mimeType } = req.body || {};
        const cleanB64 = String(audioBase64 || '').replace(/^data:audio\/[^;]+;base64,/, '').trim();
        if (!cleanB64 || cleanB64.length < 32) {
            return res.status(400).json({ success: false, error: 'Audio de instrucción vacío o inválido.' });
        }
        const buf = Buffer.from(cleanB64, 'base64');
        const texto = await agenteHibridoLlm.transcribirAudioOggConGemini(buf, mimeType || 'audio/wav');
        res.json({ success: true, texto });
    } catch (error) {
        console.error('❌ [CRM-ASISTENTE-VOZ] Error transcribiendo instrucción de voz:', error.message);
        res.status(503).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/crm/whatsapp/clientes/:id/pdf-config
 * Obtiene la configuración determinista de PDF guardada para el cliente en PostgreSQL.
 */
router.get('/crm/whatsapp/clientes/:id/pdf-config', async (req, res) => {
    try {
        const clienteId = String(req.params.id || '').trim();
        const config = await historialPreciosService.obtenerConfigInformeCliente(clienteId);
        res.json({ success: true, cliente_id: clienteId, config });
    } catch (error) {
        console.error('❌ [CRM-PDF-CONFIG-GET] Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/crm/whatsapp/clientes/:id/pdf-config
 * Guarda como default determinista la configuración de PDF elegida para el cliente.
 */
router.post('/crm/whatsapp/clientes/:id/pdf-config', async (req, res) => {
    try {
        const clienteId = String(req.params.id || '').trim();
        const config = await historialPreciosService.guardarConfigInformeCliente(clienteId, req.body || {});
        res.json({ success: true, cliente_id: clienteId, config });
    } catch (error) {
        console.error('❌ [CRM-PDF-CONFIG-POST] Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
