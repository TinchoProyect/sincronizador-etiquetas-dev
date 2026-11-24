/**
 * Rutas Horizontales de WhatsApp Bidireccional & Consola CRM (Puerto 3000)
 * Sistema LAMDA
 */

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const pool = require('../../usuarios/pool');
const crmWhatsappDb = require('../../services/crmWhatsappDbService');
const whatsappAudioTranscriber = require('../../services/whatsappAudioTranscriberService');
const agenteHibridoLlm = require('../../services/whatsappAgenteHibridoLlmService');
const nodosCaptacionCrm = require('../../services/nodosCaptacionCrmService');
const { calcularComposicionSaldo } = require('../../logistica/services/composicionSaldoService');
const salvavidasService = require('../../logistica/services/salvavidasService');
const historialPreciosService = require('../../produccion/services/historialPreciosService');
const {
    parsearContactoWhatsapp,
    sincronizarListasClienteEnNube
} = require('../../logistica/services/b2bDirectorySyncService');

const PROD_SUPABASE_ID_GUARD = 'zysyxtbcvgswancxtpib';
let _cacheJsonEstadosPortalHistorico = null;

function leerMapaHistoricoPortalB2B() {
    if (_cacheJsonEstadosPortalHistorico) return _cacheJsonEstadosPortalHistorico;
    try {
        const jsonPath = path.resolve(__dirname, '../js/b2b-estado-clientes.json');
        if (fs.existsSync(jsonPath)) {
            const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            if (raw && raw.clientes && typeof raw.clientes === 'object') {
                _cacheJsonEstadosPortalHistorico = raw.clientes;
                return _cacheJsonEstadosPortalHistorico;
            }
        }
    } catch (_) {}
    _cacheJsonEstadosPortalHistorico = {};
    return _cacheJsonEstadosPortalHistorico;
}

function esModoLaboratorioOSandboxBloqueadoB2B() {
    const dbName = String(process.env.DB_NAME || '').trim().toLowerCase();
    const flagLab = String(process.env.LAMDA_MODO_LABORATORIO || process.env.MODO_LABORATORIO || '').trim().toLowerCase();
    const flagNube = String(process.env.LAMDA_MODO_PRUEBA_NUBE || '').trim().toLowerCase();
    const isLab = dbName === 'etiquetas_pruebas' || flagLab === 'true' || flagLab === '1';
    const isPruebaNube = flagNube === 'true' || flagNube === '1';
    const supaUrl = String(process.env.SUPABASE_B2B_URL || '').trim().toLowerCase();
    const supaKey = String(process.env.SUPABASE_B2B_SERVICE_KEY || '').trim();
    if (!supaUrl || !supaKey || supaUrl.includes('127.0.0.1') || supaKey === 'modo_laboratorio_desconectado') {
        return true;
    }
    if ((isLab || isPruebaNube) && supaUrl.includes(PROD_SUPABASE_ID_GUARD)) {
        return true;
    }
    const sandboxOk = String(process.env.LAMDA_B2B_SANDBOX_ENABLED || '').trim().toLowerCase() === 'true';
    if (isLab && !sandboxOk) {
        return true;
    }
    return false;
}

const _cacheAuthLoginB2B = new Map();
const _cacheDelegacionesB2B = new Map();
let _delegacionesLabMemoria = null;

function resolverUrlPortalB2BOficialWa() {
    const rawPortalEnv = String(process.env.B2B_PORTAL_URL || '').trim().replace(/\/+$/, '');
    return (!rawPortalEnv || rawPortalEnv.includes('127.0.0.1:59999') || rawPortalEnv.includes('localhost'))
        ? 'https://proud-darkness-ac3d.miserrano75.workers.dev'
        : rawPortalEnv;
}

function normalizarDigitosTelPortalWa(tel) {
    return String(tel || '').replace(/\D/g, '').trim();
}

function telefonosCoincidenPortalWa(telA, telB) {
    const a = normalizarDigitosTelPortalWa(telA);
    const b = normalizarDigitosTelPortalWa(telB);
    if (a.length < 7 || b.length < 7) return false;
    return a === b || a.slice(-8) === b.slice(-8) || a.endsWith(b) || b.endsWith(a);
}

function normalizarNombreSimplePortalWa(txt) {
    return String(txt || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function obtenerStoreDelegacionesLabWa() {
    if (_delegacionesLabMemoria) return _delegacionesLabMemoria;
    // Snapshot espejo de solo lectura para pruebas locales en Modo Laboratorio (0 tráfico hacia Supabase Cloud)
    _delegacionesLabMemoria = new Map([
        ['CB-0003', [
            {
                id: 'cc112be9-d80d-4b25-9f5c-096786d7135e',
                cliente_id: 'CB-0003',
                token: '77e544b524d8a0ded5a3af71b5638853',
                nombre_empresa: 'The Green Corner',
                nombre_colaborador: 'Richard',
                mostrar_precios: true,
                mostrar_sin_iva: true,
                permitir_toggle_iva: true,
                ver_stock: false,
                tipo_enlace: 'permanente',
                listas_ids: [5],
                activo: true,
                telefono_colaborador: '5492215032728',
                aprobador_nombre: 'Cecilia',
                aprobador_telefono: '5492216122330',
                dispositivo_vinculado_hash: null,
                dispositivo_vinculado_en: null,
                expires_at: null,
                created_at: '2026-10-27T16:46:40.74133+00:00'
            }
        ]],
        ['CB-0013', [
            {
                id: '642de9a3-4eb3-4ef2-aaf5-9e917126e8fe',
                cliente_id: 'CB-0013',
                token: '841f5192652eaa6326b32f5c041f0ac6',
                nombre_empresa: 'TITO I SRL',
                nombre_colaborador: 'Fiambrería',
                mostrar_precios: true,
                mostrar_sin_iva: false,
                permitir_toggle_iva: true,
                ver_stock: false,
                tipo_enlace: 'permanente',
                listas_ids: [5],
                activo: true,
                telefono_colaborador: null,
                aprobador_nombre: null,
                aprobador_telefono: null,
                dispositivo_vinculado_hash: null,
                dispositivo_vinculado_en: null,
                expires_at: null,
                created_at: '2026-09-29T14:34:23.660391+00:00'
            }
        ]]
    ]);
    return _delegacionesLabMemoria;
}

/**
 * Consulta las delegaciones activas de Pre-Pedido (clientes_b2b_delegaciones) de un cliente.
 * - En Producción: GET liviano a Supabase Cloud con caché en memoria de 60s.
 * - En Modo Laboratorio: usa exclusivamente el store local en memoria (0 llamadas / 0 escrituras a Supabase Cloud).
 */
async function obtenerDelegacionesActivasClienteB2BWa(codBunker, { forzarRefresco = false } = {}) {
    const cod = String(codBunker || '').trim();
    if (!cod) return [];

    const ahoraMs = Date.now();
    if (esModoLaboratorioOSandboxBloqueadoB2B()) {
        const store = obtenerStoreDelegacionesLabWa();
        const rows = store.get(cod) || [];
        return rows.filter(d => d && d.activo !== false && (!d.expires_at || new Date(d.expires_at).getTime() > ahoraMs));
    }

    if (!forzarRefresco && _cacheDelegacionesB2B.has(cod)) {
        const cached = _cacheDelegacionesB2B.get(cod);
        if (ahoraMs - cached.ts < 60000) {
            return cached.rows;
        }
    }

    const supaUrl = String(process.env.SUPABASE_B2B_URL || '').trim().replace(/\/+$/, '');
    const supaKey = String(process.env.SUPABASE_B2B_SERVICE_KEY || '').trim();
    if (!supaUrl || !supaKey) return [];

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2600);
    try {
        const resp = await fetch(
            `${supaUrl}/rest/v1/clientes_b2b_delegaciones?cliente_id=eq.${encodeURIComponent(cod)}&activo=eq.true&order=created_at.desc`,
            {
                headers: {
                    apikey: supaKey,
                    Authorization: `Bearer ${supaKey}`
                },
                signal: ctrl.signal
            }
        );
        if (!resp.ok) return [];
        const raw = await resp.json().catch(() => []);
        const vigentes = (Array.isArray(raw) ? raw : []).filter(d =>
            d && d.activo !== false && (!d.expires_at || new Date(d.expires_at).getTime() > ahoraMs)
        );
        _cacheDelegacionesB2B.set(cod, { ts: ahoraMs, rows: vigentes });
        return vigentes;
    } catch (_) {
        return [];
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Determina de manera 100% fehaciente si el TITULAR del cliente ya ingresó alguna vez al Portal B2B
 * (evitando falsos positivos de los perfiles pre-provisionados con email placeholder @lamdaclientes.com
 * que nunca iniciaron sesión: solo cuenta como activo si tiene last_sign_in_at real, email real activado,
 * invitación marcada usada o pedido operado desde Portal B2B).
 */
async function resolverEstadoYInvitacionPortalClienteWa(cliRow, { forzarNuevaInvitacion = false, asegurarTokenSiNoIngreso = true } = {}) {
    const portalUrl = resolverUrlPortalB2BOficialWa();
    const codBunker = String(cliRow?.codigo_bunker_cliente || '').trim();
    if (!codBunker) {
        return {
            tipo_acceso_portal: 'TITULAR_ACTIVO',
            ya_ingreso: false,
            requiere_invitacion_inicial: false,
            ultimo_ingreso: null,
            email_registrado: '',
            codigo_activacion: '',
            token_invitacion: '',
            expires_at: null,
            link_portal_general: portalUrl,
            link_invitacion_corto: '',
            modo_link_recomendado: 'PORTAL_GENERAL'
        };
    }

    const mapaHist = leerMapaHistoricoPortalB2B();
    const histCli = mapaHist[codBunker] || null;

    let invLocalUsada = false;
    let operoEnPortalLocal = false;
    let ultimoIngresoIso = histCli?.ultimo_ingreso || null;
    let emailRegistrado = (histCli?.email_registrado && !String(histCli.email_registrado).toLowerCase().endsWith('@lamdaclientes.com'))
        ? String(histCli.email_registrado).trim()
        : ((cliRow?.email_portal && !String(cliRow.email_portal).toLowerCase().endsWith('@lamdaclientes.com'))
            ? String(cliRow.email_portal).trim()
            : '');

    try {
        const invUsadaRes = await pool.query(
            `SELECT created_at FROM public.portal_invitaciones WHERE cliente_id = $1 AND usado = true ORDER BY id DESC LIMIT 1`,
            [codBunker]
        );
        if (invUsadaRes.rows.length > 0) {
            invLocalUsada = true;
            if (!ultimoIngresoIso && invUsadaRes.rows[0].created_at) {
                ultimoIngresoIso = new Date(invUsadaRes.rows[0].created_at).toISOString();
            }
        }
    } catch (_) {}

    const lomasIdNum = (cliRow?.lomas_soft_id && /^\d+$/.test(String(cliRow.lomas_soft_id).trim()))
        ? parseInt(String(cliRow.lomas_soft_id).trim(), 10)
        : null;
    if (lomasIdNum !== null) {
        try {
            const presPortalRes = await pool.query(`
                SELECT MAX(fecha) AS ult_fecha
                FROM public.presupuestos
                WHERE NULLIF(regexp_replace(id_cliente::text, '^0+', ''), '')::integer = $1
                  AND (agente = 'Portal B2B' OR modificado_portal = true)
            `, [lomasIdNum]);
            if (presPortalRes.rows[0]?.ult_fecha) {
                operoEnPortalLocal = true;
                if (!ultimoIngresoIso) {
                    ultimoIngresoIso = new Date(presPortalRes.rows[0].ult_fecha).toISOString();
                }
            }
        } catch (_) {}
    }

    const cloudBloqueadoPorLab = esModoLaboratorioOSandboxBloqueadoB2B();
    const supaUrl = String(process.env.SUPABASE_B2B_URL || '').trim().replace(/\/+$/, '');
    const supaKey = String(process.env.SUPABASE_B2B_SERVICE_KEY || '').trim();
    let tienePerfilSupabaseActivo = false;
    let perfilSupabaseUuid = null;

    if (!cloudBloqueadoPorLab && supaUrl && supaKey) {
        const cachedAuth = _cacheAuthLoginB2B.get(codBunker);
        if (!forzarNuevaInvitacion && cachedAuth && (Date.now() - cachedAuth.ts < 300000)) {
            tienePerfilSupabaseActivo = cachedAuth.activo;
            perfilSupabaseUuid = cachedAuth.uuid;
            if (cachedAuth.emailReal) emailRegistrado = cachedAuth.emailReal;
            if (cachedAuth.ultimoIngreso) ultimoIngresoIso = cachedAuth.ultimoIngreso;
        } else {
            const ctrlSupa = new AbortController();
            const timerSupa = setTimeout(() => ctrlSupa.abort(), 3000);
            try {
                const respProf = await fetch(
                    `${supaUrl}/rest/v1/clientes_b2b_perfiles?cliente_id=eq.${encodeURIComponent(codBunker)}&select=id,email,updated_at&limit=1`,
                    {
                        headers: {
                            apikey: supaKey,
                            Authorization: `Bearer ${supaKey}`
                        },
                        signal: ctrlSupa.signal
                    }
                );
                if (respProf.ok) {
                    const profRows = await respProf.json();
                    if (Array.isArray(profRows) && profRows.length > 0) {
                        const prof = profRows[0];
                        perfilSupabaseUuid = prof.id || null;
                        const emailPerf = String(prof.email || '').trim().toLowerCase();
                        const esPlaceholderLamda = !emailPerf || emailPerf.endsWith('@lamdaclientes.com');
                        let emailRealDetectado = esPlaceholderLamda ? '' : String(prof.email || '').trim();
                        let lastSignInReal = null;

                        // Verificar last_sign_in_at en Supabase Auth para distinguir perfiles pre-creados (@lamdaclientes.com) de logins reales
                        if (perfilSupabaseUuid) {
                            try {
                                const respAuth = await fetch(
                                    `${supaUrl}/auth/v1/admin/users/${encodeURIComponent(perfilSupabaseUuid)}`,
                                    {
                                        headers: {
                                            apikey: supaKey,
                                            Authorization: `Bearer ${supaKey}`
                                        },
                                        signal: ctrlSupa.signal
                                    }
                                );
                                if (respAuth.ok) {
                                    const authData = await respAuth.json().catch(() => null);
                                    const authUser = authData?.user || authData;
                                    if (authUser?.last_sign_in_at) {
                                        lastSignInReal = authUser.last_sign_in_at;
                                    }
                                    const authMail = String(authUser?.email || '').trim().toLowerCase();
                                    if (authMail && !authMail.endsWith('@lamdaclientes.com')) {
                                        emailRealDetectado = String(authUser.email).trim();
                                    }
                                }
                            } catch (_) {}
                        }

                        // Evidencia real de ingreso/activación:
                        //   1) last_sign_in_at no nulo en Auth, OR
                        //   2) email real (no @lamdaclientes.com) activado en perfil
                        // Si el perfil es placeholder @lamdaclientes.com y last_sign_in_at es null -> NO ingresó nunca!
                        if (lastSignInReal) {
                            tienePerfilSupabaseActivo = true;
                            ultimoIngresoIso = lastSignInReal;
                        } else if (!esPlaceholderLamda && emailRealDetectado) {
                            tienePerfilSupabaseActivo = true;
                            if (!ultimoIngresoIso && prof.updated_at) {
                                ultimoIngresoIso = prof.updated_at;
                            }
                        } else {
                            tienePerfilSupabaseActivo = false;
                        }

                        if (emailRealDetectado) {
                            emailRegistrado = emailRealDetectado;
                        }

                        _cacheAuthLoginB2B.set(codBunker, {
                            ts: Date.now(),
                            activo: tienePerfilSupabaseActivo,
                            uuid: perfilSupabaseUuid,
                            emailReal: emailRealDetectado,
                            ultimoIngreso: ultimoIngresoIso
                        });
                    }
                }
            } catch (_) {
                // Si la red tarda o no responde, continuamos con las señales deterministas locales
            } finally {
                clearTimeout(timerSupa);
            }
        }
    }

    const histIngresoValido = Boolean(
        histCli?.ya_ingreso && (
            histCli?.ultimo_ingreso ||
            (histCli?.email_registrado && !String(histCli.email_registrado).toLowerCase().endsWith('@lamdaclientes.com'))
        )
    );

    const yaIngresoReal = Boolean(
        tienePerfilSupabaseActivo ||
        invLocalUsada ||
        operoEnPortalLocal ||
        (cloudBloqueadoPorLab && histIngresoValido)
    );

    // Si YA ingresó al portal y no se pidió expresamente re-generar una invitación de blanqueo,
    // el cliente ya tiene su usuario y contraseña -> enviar el link limpio del portal.
    if (yaIngresoReal && !forzarNuevaInvitacion) {
        return {
            tipo_acceso_portal: 'TITULAR_ACTIVO',
            ya_ingreso: true,
            ya_ingreso_historico: true,
            requiere_invitacion_inicial: false,
            ultimo_ingreso: ultimoIngresoIso,
            email_registrado: emailRegistrado,
            codigo_activacion: '',
            token_invitacion: '',
            expires_at: null,
            link_portal_general: portalUrl,
            link_invitacion_corto: '',
            modo_link_recomendado: 'PORTAL_GENERAL'
        };
    }

    if (!asegurarTokenSiNoIngreso) {
        return {
            tipo_acceso_portal: 'TITULAR_INVITACION_INICIAL',
            ya_ingreso: false,
            ya_ingreso_historico: yaIngresoReal,
            requiere_invitacion_inicial: true,
            ultimo_ingreso: ultimoIngresoIso,
            email_registrado: emailRegistrado,
            codigo_activacion: histCli?.codigo_activacion || '',
            token_invitacion: '',
            expires_at: null,
            link_portal_general: portalUrl,
            link_invitacion_corto: histCli?.link_activacion_corto || '',
            modo_link_recomendado: 'INVITACION_INICIAL'
        };
    }

    // Si se pidió explícitamente re-enviar invitación inicial / blanqueo en Producción, limpiar usuario previo bloqueado en Supabase Auth
    if (forzarNuevaInvitacion && !cloudBloqueadoPorLab && supaUrl && supaKey && perfilSupabaseUuid) {
        _cacheAuthLoginB2B.delete(codBunker);
        try {
            await fetch(`${supaUrl}/auth/v1/admin/users/${encodeURIComponent(perfilSupabaseUuid)}`, {
                method: 'DELETE',
                headers: {
                    apikey: supaKey,
                    Authorization: `Bearer ${supaKey}`
                }
            }).catch(() => {});
        } catch (_) {}
    }

    let tokenActivo = '';
    let codigoActivacionDirecto = '';
    let expiresAt = new Date(Date.now() + 72 * 3600 * 1000);

    if (!forzarNuevaInvitacion) {
        try {
            const vigRes = await pool.query(`
                SELECT token, expires_at
                FROM public.portal_invitaciones
                WHERE cliente_id = $1
                  AND usado = false
                  AND LENGTH(token) = 64
                  AND token ~ '^[0-9a-fA-F]+$'
                  AND created_at > (NOW() - INTERVAL '48 hours')
                  AND expires_at > (NOW() + INTERVAL '12 hours')
                ORDER BY id DESC
                LIMIT 1
            `, [codBunker]);
            if (vigRes.rows.length > 0) {
                tokenActivo = String(vigRes.rows[0].token).trim();
                expiresAt = new Date(vigRes.rows[0].expires_at);
            }
        } catch (_) {}
    }

    if (!tokenActivo && cloudBloqueadoPorLab && !forzarNuevaInvitacion && histCli?.codigo_activacion) {
        codigoActivacionDirecto = String(histCli.codigo_activacion).trim();
    }

    if (!tokenActivo && !codigoActivacionDirecto) {
        tokenActivo = crypto.randomBytes(32).toString('hex');
        expiresAt = new Date(Date.now() + 72 * 3600 * 1000);
        if (!cloudBloqueadoPorLab || forzarNuevaInvitacion) {
            try {
                await pool.query(
                    `INSERT INTO public.portal_invitaciones (token, cliente_id, expires_at, usado)
                     VALUES ($1, $2, $3, false)`,
                    [tokenActivo, codBunker, expiresAt]
                );
            } catch (errIns) {
                console.warn('⚠️ [CRM-PORTAL-INV] Error insertando portal_invitaciones local:', errIns.message);
            }
        }
    }

    const codigoActivacion = codigoActivacionDirecto || tokenActivo.slice(0, 6);
    const linkInvitacionCorto = `${portalUrl}/?t=${codigoActivacion}`;

    // Sincronizar invitación activa + listas del cliente en Supabase Cloud (solo fuera de Modo Laboratorio)
    if (!cloudBloqueadoPorLab && supaUrl && supaKey && tokenActivo) {
        sincronizarListasClienteEnNube(codBunker).catch(() => {});
        try {
            const { contactName, phoneMasked } = parsearContactoWhatsapp(cliRow?.whatsapp_facturas || '');
            const bunkerNumMatch = codBunker.match(/(\d+)/);
            const bunkerNum = bunkerNumMatch ? String(parseInt(bunkerNumMatch[1], 10)) : '';
            const legacyId = cliRow?.lomas_soft_id ? String(cliRow.lomas_soft_id).trim() : null;
            const legacyNum = (legacyId && /^\d+$/.test(legacyId)) ? String(parseInt(legacyId, 10)) : legacyId;
            const cuitClean = cliRow?.cuit_cuil ? String(cliRow.cuit_cuil).replace(/\D/g, '') : null;
            const nombreContactoInferido = (cliRow?.email_portal_nombre && String(cliRow.email_portal_nombre).trim())
                ? String(cliRow.email_portal_nombre).trim()
                : (contactName || null);
            const cleanPortalMail = (cliRow?.email_portal && !String(cliRow.email_portal).toLowerCase().trim().endsWith('@lamdaclientes.com'))
                ? String(cliRow.email_portal).trim()
                : '';

            const metadataCargoJson = JSON.stringify({
                legacy_id: legacyId,
                legacy_num: legacyNum,
                bunker_num: bunkerNum,
                cuit: cuitClean,
                nombre: cliRow?.cliente_nombre || cliRow?.razon_social || codBunker,
                contact_name: nombreContactoInferido || '',
                phone_masked: phoneMasked
            });

            await fetch(`${supaUrl}/rest/v1/clientes_b2b_invitaciones?on_conflict=token`, {
                method: 'POST',
                headers: {
                    apikey: supaKey,
                    Authorization: `Bearer ${supaKey}`,
                    'Content-Type': 'application/json',
                    Prefer: 'resolution=merge-duplicates,return=minimal'
                },
                body: JSON.stringify({
                    token: tokenActivo,
                    cliente_id: codBunker,
                    expires_at: expiresAt.toISOString(),
                    usado: false,
                    razon_social: cliRow?.razon_social || cliRow?.cliente_nombre || codBunker,
                    email_portal: cleanPortalMail,
                    email_portal_nombre: nombreContactoInferido,
                    email_portal_cargo: metadataCargoJson
                })
            }).catch(() => {});
        } catch (_) {}
    }

    return {
        tipo_acceso_portal: 'TITULAR_INVITACION_INICIAL',
        ya_ingreso: false,
        ya_ingreso_historico: yaIngresoReal,
        requiere_invitacion_inicial: true,
        ultimo_ingreso: ultimoIngresoIso,
        email_registrado: emailRegistrado,
        codigo_activacion: codigoActivacion,
        token_invitacion: tokenActivo,
        expires_at: expiresAt.toISOString(),
        link_portal_general: portalUrl,
        link_invitacion_corto: linkInvitacionCorto,
        modo_link_recomendado: 'INVITACION_INICIAL'
    };
}

/**
 * Contrato Único Determinista de Acceso Portal B2B por Rol Operativo:
 *   1. TITULAR_ACTIVO              -> Dueño/Pagos/Compartido con ingreso real al Portal
 *   2. TITULAR_INVITACION_INICIAL  -> Dueño/Pagos/Compartido que nunca ingresó (/?t=<codigo6>)
 *   3. ENCARGADO_ARMADOR_PEDIDO    -> COMPRAS_PEDIDOS / RECEPCION_LOCAL con delegación activa (/#/pre-pedido?token=...)
 *   4. ENCARGADO_ARMADOR_PENDIENTE -> COMPRAS_PEDIDOS / RECEPCION_LOCAL sin delegación personal (bloqueo estricto: jamás cae al link titular)
 */
async function resolverAccesoPortalParaChatWa({
    cli,
    chat = null,
    otrosContactos = [],
    forzarNuevaInvitacion = false,
    asegurarTokenSiNoIngreso = true,
    forzarRefrescoDelegaciones = false
} = {}) {
    const portalUrl = resolverUrlPortalB2BOficialWa();
    const rolNorm = String(chat?.rol_operativo || '').trim().toUpperCase();
    const esRolEmpleado = rolNorm === 'COMPRAS_PEDIDOS' || rolNorm === 'RECEPCION_LOCAL';

    if (!esRolEmpleado) {
        const base = await resolverEstadoYInvitacionPortalClienteWa(cli, {
            forzarNuevaInvitacion,
            asegurarTokenSiNoIngreso
        });
        const tipo = (base.ya_ingreso && !forzarNuevaInvitacion)
            ? 'TITULAR_ACTIVO'
            : 'TITULAR_INVITACION_INICIAL';
        return {
            ...base,
            tipo_acceso_portal: tipo,
            rol_operativo: rolNorm || null,
            es_empleado_armador: false,
            link_armador_pedido: '',
            delegacion_armador: null,
            delegaciones_genericas_cliente: [],
            aprobador_sugerido: null,
            simulado_laboratorio: esModoLaboratorioOSandboxBloqueadoB2B()
        };
    }

    // Rol de empleado (COMPRAS_PEDIDOS / RECEPCION_LOCAL): jamás emitir ni exponer link o invitación del Titular
    const codBunker = String(cli?.codigo_bunker_cliente || chat?.codigo_bunker_cliente || '').trim();
    const delegaciones = codBunker
        ? await obtenerDelegacionesActivasClienteB2BWa(codBunker, { forzarRefresco: forzarRefrescoDelegaciones })
        : [];

    // Resolver aprobador sugerido (Dueño/Titular o Pagos del mismo cliente)
    let hermanos = Array.isArray(otrosContactos) ? otrosContactos : [];
    const cliIdRef = Number(cli?.id || chat?.bunker_cliente_id || 0);
    if (hermanos.length === 0 && cliIdRef > 0) {
        try {
            const rHer = await pool.query(`
                SELECT id, contacto_nombre, contacto_cargo, rol_operativo, apodo_preferido, telefono_normalizado
                FROM public.crm_whatsapp_chats
                WHERE bunker_cliente_id = $1
                  AND id <> $2
                  AND COALESCE(modo_privacidad, 'ACTIVO') <> 'OCULTO'
                ORDER BY
                    CASE rol_operativo
                        WHEN 'DUENO_TITULAR' THEN 1
                        WHEN 'PAGOS_ADMIN' THEN 2
                        ELSE 3
                    END ASC,
                    ultimo_mensaje_at DESC NULLS LAST
                LIMIT 8
            `, [cliIdRef, Number(chat?.id || 0)]);
            hermanos = rHer.rows;
        } catch (_) {}
    }

    const candidatosAprobadores = hermanos
        .filter(h => ['DUENO_TITULAR', 'PAGOS_ADMIN'].includes(String(h.rol_operativo || '').toUpperCase()))
        .map(h => ({
            chat_id: h.id,
            nombre: String(h.apodo_preferido || h.contacto_nombre || '').trim() || 'Titular',
            telefono: normalizarDigitosTelPortalWa(h.telefono_normalizado),
            rol_operativo: String(h.rol_operativo || '').toUpperCase()
        }));
    const aprobadorSugerido = candidatosAprobadores[0] || null;

    const telChat = normalizarDigitosTelPortalWa(chat?.telefono_normalizado);
    const nombresGenericos = new Set(['colaborador', 'colaborador mostrador', 'mostrador', 'local', 'fiambreria', 'deposito', 'compras', 'ventas', 'sucursal', 'operador', 'empleado', 'empleada']);
    const nombreChatNorm = normalizarNombreSimplePortalWa(chat?.contacto_nombre || chat?.apodo_preferido || '');
    const apodoChatNorm = normalizarNombreSimplePortalWa(chat?.apodo_preferido || '');

    // 1. Match personal exacto por teléfono del colaborador
    let delPersonal = delegaciones.find(d => d.telefono_colaborador && telefonosCoincidenPortalWa(d.telefono_colaborador, telChat)) || null;
    // 2. Match personal secundario por nombre exacto no-genérico (solo si esa delegación no pertenece a otro teléfono)
    if (!delPersonal && nombreChatNorm && !nombresGenericos.has(nombreChatNorm)) {
        delPersonal = delegaciones.find(d => {
            if (d.telefono_colaborador && !telefonosCoincidenPortalWa(d.telefono_colaborador, telChat)) return false;
            const nomDel = normalizarNombreSimplePortalWa(d.nombre_colaborador);
            if (!nomDel || nombresGenericos.has(nomDel)) return false;
            return nomDel === nombreChatNorm || (apodoChatNorm && nomDel === apodoChatNorm);
        }) || null;
    }

    // Delegaciones genéricas vigentes del mismo cliente sin teléfono asignado (ej. "Fiambrería" en Tito CB-0013)
    const delegacionesGenericas = delegaciones
        .filter(d => (!delPersonal || d.id !== delPersonal.id) && !normalizarDigitosTelPortalWa(d.telefono_colaborador))
        .map(d => ({
            id: d.id,
            token: d.token,
            nombre_colaborador: d.nombre_colaborador || 'Colaborador',
            mostrar_precios: Boolean(d.mostrar_precios),
            mostrar_sin_iva: Boolean(d.mostrar_sin_iva),
            tipo_enlace: d.tipo_enlace || 'permanente',
            created_at: d.created_at || null,
            link: `${portalUrl}/#/pre-pedido?token=${d.token}`
        }));

    if (delPersonal) {
        const linkArmador = `${portalUrl}/#/pre-pedido?token=${delPersonal.token}`;
        const telColabClean = normalizarDigitosTelPortalWa(delPersonal.telefono_colaborador || '');
        const dispositivoVinculado = Boolean(delPersonal.dispositivo_vinculado_hash && String(delPersonal.dispositivo_vinculado_hash).trim());
        const requiereValidacion4Digitos = Boolean(telColabClean.length >= 4 && !dispositivoVinculado);
        const ultimos4Telefono = telColabClean.length >= 4 ? telColabClean.slice(-4) : '';
        const aprobadorNombre = String(delPersonal.aprobador_nombre || aprobadorSugerido?.nombre || '').trim();
        const aprobadorTelefono = normalizarDigitosTelPortalWa(delPersonal.aprobador_telefono || aprobadorSugerido?.telefono || '');

        return {
            tipo_acceso_portal: 'ENCARGADO_ARMADOR_PEDIDO',
            rol_operativo: rolNorm,
            es_empleado_armador: true,
            ya_ingreso: false,
            requiere_invitacion_inicial: false,
            ultimo_ingreso: null,
            email_registrado: '',
            codigo_activacion: '',
            token_invitacion: '',
            expires_at: delPersonal.expires_at || null,
            link_portal_general: '',
            link_invitacion_corto: '',
            link_armador_pedido: linkArmador,
            modo_link_recomendado: 'ARMADOR_PEDIDO',
            delegacion_armador: {
                id: delPersonal.id,
                token: delPersonal.token,
                nombre_colaborador: delPersonal.nombre_colaborador || chat?.contacto_nombre || 'Operador',
                telefono_colaborador: delPersonal.telefono_colaborador || null,
                aprobador_nombre: aprobadorNombre,
                aprobador_telefono: aprobadorTelefono || null,
                mostrar_precios: Boolean(delPersonal.mostrar_precios),
                mostrar_sin_iva: Boolean(delPersonal.mostrar_sin_iva),
                permitir_toggle_iva: delPersonal.permitir_toggle_iva !== false,
                ver_stock: Boolean(delPersonal.ver_stock),
                tipo_enlace: delPersonal.tipo_enlace || 'permanente',
                dispositivo_vinculado: dispositivoVinculado,
                requiere_validacion_4_digitos: requiereValidacion4Digitos,
                ultimos_4_telefono: ultimos4Telefono,
                link: linkArmador,
                simulado_laboratorio: Boolean(delPersonal.simulado_laboratorio)
            },
            delegaciones_genericas_cliente: delegacionesGenericas,
            aprobador_sugerido: aprobadorSugerido,
            aprobadores_disponibles: candidatosAprobadores,
            simulado_laboratorio: esModoLaboratorioOSandboxBloqueadoB2B()
        };
    }

    return {
        tipo_acceso_portal: 'ENCARGADO_ARMADOR_PENDIENTE',
        rol_operativo: rolNorm,
        es_empleado_armador: true,
        ya_ingreso: false,
        requiere_invitacion_inicial: false,
        ultimo_ingreso: null,
        email_registrado: '',
        codigo_activacion: '',
        token_invitacion: '',
        expires_at: null,
        link_portal_general: '',
        link_invitacion_corto: '',
        link_armador_pedido: '',
        modo_link_recomendado: 'ARMADOR_PENDIENTE',
        delegacion_armador: null,
        delegaciones_genericas_cliente: delegacionesGenericas,
        aprobador_sugerido: aprobadorSugerido,
        aprobadores_disponibles: candidatosAprobadores,
        simulado_laboratorio: esModoLaboratorioOSandboxBloqueadoB2B()
    };
}

/**
 * Fase 3: Resuelve desde PostgreSQL el estado logístico real del último pedido / entrega del cliente
 * (presupuestos + rutas + chofer en usuarios + entregas_eventos + ítems reales en presupuestos_detalles)
 * para los especialistas LOGISTICA_ENTREGAS y POST_ENTREGA.
 */
async function obtenerContextoLogisticoClienteWa(lomasIdNum) {
    if (!lomasIdNum || !Number.isFinite(Number(lomasIdNum))) {
        return {
            estado_normalizado: 'SIN_PEDIDO_ACTIVO',
            ultimo_pedido: null,
            ultimo_entregado: null,
            entregado_reciente_48h: false
        };
    }
    try {
        const resPed = await pool.query(`
            SELECT
                p.id,
                p.fecha,
                p.estado,
                p.secuencia,
                p.estado_logistico,
                p.fecha_asignacion_ruta,
                p.fecha_entrega,
                p.fecha_entrega_estimada,
                p.fecha_entrega_real,
                p.id_ruta,
                p.orden_entrega,
                p.punto_entrega,
                p.motivo_no_entrega,
                r.nombre_ruta,
                r.estado AS ruta_estado,
                r.fecha_salida AS ruta_fecha_salida,
                r.fecha_finalizacion AS ruta_fecha_finalizacion,
                u.nombre_completo AS chofer_nombre,
                ee.receptor_nombre,
                ee.receptor_vinculo,
                ee.fecha_entrega AS evento_fecha_entrega,
                ee.tipo_evento AS evento_tipo,
                COALESCE((SELECT SUM(pd.cantidad * pd.precio1) FROM public.presupuestos_detalles pd WHERE pd.id_presupuesto = p.id), 0) AS total
            FROM public.presupuestos p
            LEFT JOIN public.rutas r ON r.id = p.id_ruta
            LEFT JOIN public.usuarios u ON u.id = r.id_chofer
            LEFT JOIN LATERAL (
                SELECT receptor_nombre, receptor_vinculo, fecha_entrega, tipo_evento
                FROM public.entregas_eventos
                WHERE id_presupuesto = p.id
                ORDER BY fecha_entrega DESC NULLS LAST, id DESC
                LIMIT 1
            ) ee ON true
            WHERE NULLIF(regexp_replace(p.id_cliente::text, '^0+', ''), '')::integer = $1
              AND (p.estado IS NULL OR LOWER(TRIM(p.estado)) NOT IN ('anulado', 'anulada', 'cancelado', 'cancelada', 'baja', 'eliminado', 'eliminada'))
              AND (p.activo IS NULL OR p.activo = true)
            ORDER BY p.id DESC
            LIMIT 6
        `, [Number(lomasIdNum)]);

        if (resPed.rows.length === 0) {
            return {
                estado_normalizado: 'SIN_PEDIDO_ACTIVO',
                ultimo_pedido: null,
                ultimo_entregado: null,
                entregado_reciente_48h: false
            };
        }

        const normalizarEstadoPedido = (row) => {
            const combo = `${row.estado_logistico || ''} ${row.estado || ''} ${row.secuencia || ''} ${row.evento_tipo || ''}`.toLowerCase();
            if (row.fecha_entrega_real || row.evento_fecha_entrega || /entregad/i.test(combo)) {
                return 'ENTREGADO';
            }
            const rutaSt = String(row.ruta_estado || '').toLowerCase();
            if (/en_camino|en camino|en_reparto|reparto|en_curso|despach|salio/i.test(`${combo} ${rutaSt}`) || (row.id_ruta && !/finaliz|cerrad|complet|cancel/i.test(rutaSt) && /curso|activ|reparto|camino|iniciad/i.test(rutaSt))) {
                return 'EN_CAMINO';
            }
            return 'EN_PREPARACION';
        };

        const mapearResumen = (row, items = []) => {
            if (!row) return null;
            const fechaEntReal = row.evento_fecha_entrega || row.fecha_entrega_real || row.fecha_entrega || null;
            return {
                presupuesto_id: Number(row.id),
                estado_normalizado: normalizarEstadoPedido(row),
                estado_raw: row.estado || '',
                estado_logistico: row.estado_logistico || '',
                secuencia: row.secuencia || '',
                fecha_pedido: row.fecha ? new Date(row.fecha).toISOString() : null,
                fecha_entrega_estimada: row.fecha_entrega_estimada ? new Date(row.fecha_entrega_estimada).toISOString() : null,
                fecha_entrega_real: fechaEntReal ? new Date(fechaEntReal).toISOString() : null,
                id_ruta: row.id_ruta ? Number(row.id_ruta) : null,
                nombre_ruta: row.nombre_ruta || '',
                ruta_estado: row.ruta_estado || '',
                chofer_nombre: row.chofer_nombre || '',
                receptor_nombre: row.receptor_nombre || '',
                receptor_vinculo: row.receptor_vinculo || '',
                punto_entrega: row.punto_entrega || '',
                motivo_no_entrega: row.motivo_no_entrega || '',
                total: Number(row.total || 0),
                items_principales: items
            };
        };

        const cargarItemsPedido = async (presId) => {
            if (!presId) return [];
            try {
                const itRes = await pool.query(`
                    SELECT
                        pd.articulo AS codigo,
                        COALESCE(NULLIF(TRIM(ba.descripcion_generada), ''), pd.articulo) AS nombre,
                        pd.cantidad
                    FROM public.presupuestos_detalles pd
                    LEFT JOIN public.bunker_articulos ba ON LOWER(TRIM(ba.articulo_id)) = LOWER(TRIM(pd.articulo))
                    WHERE pd.id_presupuesto = $1
                    ORDER BY (pd.cantidad * COALESCE(pd.precio1, 0)) DESC, pd.id ASC
                    LIMIT 6
                `, [presId]);
                return itRes.rows.map(r => ({
                    codigo: String(r.codigo || '').trim(),
                    nombre: String(r.nombre || '').trim(),
                    cantidad: Number(r.cantidad || 0)
                }));
            } catch (_) {
                return [];
            }
        };

        const primero = resPed.rows[0];
        const estadoPrimero = normalizarEstadoPedido(primero);
        const rowEntregado = estadoPrimero === 'ENTREGADO'
            ? primero
            : (resPed.rows.find(r => normalizarEstadoPedido(r) === 'ENTREGADO') || null);

        const itemsPrimero = await cargarItemsPedido(primero.id);
        const itemsEntregado = (rowEntregado && rowEntregado.id !== primero.id)
            ? await cargarItemsPedido(rowEntregado.id)
            : (rowEntregado ? itemsPrimero : []);

        const ultimoPedido = mapearResumen(primero, itemsPrimero);
        const ultimoEntregado = rowEntregado ? mapearResumen(rowEntregado, itemsEntregado) : null;
        const tsEnt = ultimoEntregado?.fecha_entrega_real ? new Date(ultimoEntregado.fecha_entrega_real).getTime() : 0;
        const entregadoReciente48h = tsEnt > 0 && (Date.now() - tsEnt) <= (72 * 3600 * 1000);

        return {
            estado_normalizado: estadoPrimero,
            ultimo_pedido: ultimoPedido,
            ultimo_entregado: ultimoEntregado,
            entregado_reciente_48h: entregadoReciente48h
        };
    } catch (err) {
        console.warn('⚠️ [CRM-WA-HUB] Error consultando contexto logístico:', err.message);
        return {
            estado_normalizado: 'SIN_PEDIDO_ACTIVO',
            ultimo_pedido: null,
            ultimo_entregado: null,
            entregado_reciente_48h: false
        };
    }
}

/**
 * Fase 3: Enriquece server-side el contexto determinista del cliente para POST /asistente-hibrido/razonar
 * garantizando tramo_real exacto (EN_TERMINO | GRACIA_NATURAL | COMODIN | SALVAVIDAS_FINANCIADO),
 * saldo/capas reales de composicionSaldoService + salvavidasService, logística real y días sin compra.
 */
async function enriquecerContextoDeterministaRazonamientoWa({
    clienteId,
    estadoCuentaBase = {},
    contextoLogisticoBase = null,
    diasSinCompraBase = null
} = {}) {
    const outCuenta = { ...(estadoCuentaBase || {}) };
    let outLogistica = contextoLogisticoBase || null;
    let outDiasSinCompra = (diasSinCompraBase !== null && diasSinCompraBase !== undefined)
        ? Number(diasSinCompraBase)
        : null;

    if (!clienteId || Number(clienteId) <= 0) {
        return {
            estadoCuentaDeterminista: outCuenta,
            contextoLogistico: outLogistica || { estado_normalizado: 'SIN_PEDIDO_ACTIVO', ultimo_pedido: null, ultimo_entregado: null },
            diasSinCompra: outDiasSinCompra
        };
    }

    try {
        const cliRes = await pool.query(`
            SELECT id, codigo_bunker_cliente, lomas_soft_id
            FROM public.bunker_clientes
            WHERE id = $1
            LIMIT 1
        `, [Number(clienteId)]);

        if (cliRes.rows.length > 0) {
            const cli = cliRes.rows[0];
            const lomasIdNum = (cli.lomas_soft_id && /^\d+$/.test(String(cli.lomas_soft_id).trim()))
                ? parseInt(String(cli.lomas_soft_id).trim(), 10)
                : null;

            // 1. Cuenta Corriente determinista (composicionSaldo + salvavidas)
            if (cli.codigo_bunker_cliente) {
                try {
                    const ccRes = await pool.query(`
                        SELECT id, saldo, saldo_apertura
                        FROM public.factura_cuentas_corrientes
                        WHERE TRIM(codigo_bunker_cliente) = TRIM($1)
                        ORDER BY creada_en ASC, id ASC
                    `, [cli.codigo_bunker_cliente]);
                    if (ccRes.rows.length > 0) {
                        const cc = ccRes.rows[0];
                        const saldoConsolidado = ccRes.rows.length > 1
                            ? ccRes.rows.reduce((acc, r) => acc + (parseFloat(r.saldo) || 0), 0)
                            : parseFloat(cc.saldo ?? cc.saldo_apertura ?? 0);

                        let comp = null;
                        let salv = null;
                        try { comp = await calcularComposicionSaldo(cc.id, pool); } catch (_) {}
                        try { salv = await salvavidasService.calcularSimulacionCuenta(cc.id, { persistir_sombra: false }, pool); } catch (_) {}

                        const finConIva = Number(salv?.financiacion_total_con_iva || 0);
                        const saldoTotalProy = finConIva > 1
                            ? Number(salv?.saldo_total_proyectado_con_iva || (saldoConsolidado + finConIva))
                            : saldoConsolidado;
                        const antigMax = Number(comp?.antiguedad_maxima_dias || 0);

                        // Mapear tramo real estricto a las 4 categorías canónicas de LAMDA
                        let tramoReal = 'EN_TERMINO';
                        const estSalv = String(salv?.estado_general || '').toUpperCase();
                        const capasSim = Array.isArray(salv?.capas_simuladas) ? salv.capas_simuladas : [];
                        const tieneCapaSalvavidas = capasSim.some(c => /FINANCIAD|SALVAVIDAS/i.test(String(c.tramo || c.estado || '')) && Number(c.financiacion_con_iva || c.financiacion || 0) > 1);
                        const tieneCapaComodin = capasSim.some(c => /COMODIN/i.test(String(c.tramo || c.estado || '')));

                        if (saldoConsolidado <= 100) {
                            tramoReal = 'EN_TERMINO';
                        } else if (finConIva > 1 || tieneCapaSalvavidas || /FINANCIAD|SALVAVIDAS|MORA|ATRASO_CRITICO/i.test(estSalv)) {
                            tramoReal = 'SALVAVIDAS_FINANCIADO';
                        } else if (tieneCapaComodin || /COMODIN/i.test(estSalv) || (antigMax >= 11 && antigMax <= 14)) {
                            tramoReal = 'COMODIN';
                        } else if (/GRACIA|CORTESIA/i.test(estSalv) || (antigMax >= 8 && antigMax <= 10)) {
                            tramoReal = 'GRACIA_NATURAL';
                        } else {
                            tramoReal = 'EN_TERMINO';
                        }

                        outCuenta.saldo_capital = Math.round(saldoConsolidado * 100) / 100;
                        outCuenta.financiacion_total_con_iva = Math.round(finConIva * 100) / 100;
                        outCuenta.saldo_total = Math.round(saldoTotalProy * 100) / 100;
                        outCuenta.tiene_saldo_a_favor = saldoConsolidado < -10;
                        outCuenta.antiguedad_maxima_dias = antigMax;
                        outCuenta.tramo_real = tramoReal;
                        outCuenta.condicion_comercial = comp?.condicion_comercial || estSalv || tramoReal;
                        outCuenta.capas_abiertas = (Array.isArray(comp?.capas) ? comp.capas : []).slice(0, 5).map(c => ({
                            comprobante: c.comprobante || c.descripcion || '',
                            fecha: c.fecha || '',
                            saldo_pendiente: Number(c.saldo_pendiente || c.monto || 0),
                            dias: Number(c.dias_antiguedad || c.dias || 0)
                        }));
                    }
                } catch (eCc) {
                    console.warn('⚠️ [CRM-WA-RAZONAR] Error enriqueciendo CC determinista:', eCc.message);
                }
            }

            // 2. Contexto logístico real desde PostgreSQL
            if (!outLogistica && lomasIdNum !== null) {
                outLogistica = await obtenerContextoLogisticoClienteWa(lomasIdNum);
            }

            // 3. Días sin compra reales
            if (outDiasSinCompra === null && lomasIdNum !== null) {
                try {
                    const dcRes = await pool.query(`
                        SELECT GREATEST(0, EXTRACT(DAY FROM (NOW() - MAX(COALESCE(fecha_actualizacion, fecha))))::int) AS dias
                        FROM public.presupuestos
                        WHERE NULLIF(regexp_replace(id_cliente::text, '^0+', ''), '')::integer = $1
                          AND (estado IS NULL OR LOWER(TRIM(estado)) NOT IN ('anulado', 'anulada', 'cancelado', 'cancelada', 'baja', 'eliminado', 'eliminada'))
                          AND (activo IS NULL OR activo = true)
                    `, [lomasIdNum]);
                    if (dcRes.rows[0]?.dias !== null && dcRes.rows[0]?.dias !== undefined) {
                        outDiasSinCompra = Number(dcRes.rows[0].dias);
                    }
                } catch (_) {}
            }
        }
    } catch (err) {
        console.warn('⚠️ [CRM-WA-RAZONAR] Error en enriquecimiento determinista:', err.message);
    }

    return {
        estadoCuentaDeterminista: outCuenta,
        contextoLogistico: outLogistica || { estado_normalizado: 'SIN_PEDIDO_ACTIVO', ultimo_pedido: null, ultimo_entregado: null },
        diasSinCompra: outDiasSinCompra
    };
}

/**
 * Fase 3.5: Sugiere un rol operativo a partir de los últimos mensajes del hilo ($0 IA)
 * únicamente cuando chat.rol_operativo aún está sin definir (NULL).
 */
function sugerirRolOperativoPorHistorial(mensajes = []) {
    if (!Array.isArray(mensajes) || mensajes.length === 0) return null;
    const recientes = mensajes.slice(-20);
    let ptsPagos = 0;
    let ptsCompras = 0;
    let ptsRecepcion = 0;

    for (const m of recientes) {
        const txt = String(m?.cuerpo || '').toLowerCase();
        if (!txt) continue;
        if (/entrega confirmada|su pedido #\d+ ha sido entregado|prueba interna/i.test(txt)) continue;
        if (/\b(transferencia|comprobante|cbu|alias|factura|saldo|cuenta corriente|pago|recibo|retencion|afip|arca)\b/i.test(txt)) ptsPagos += (m.from_me ? 1 : 2);
        if (/\b(lista de precios|precio|precios|stock|armame|mandame|necesito|pedido|kilo|kilos|kg|bolsa|almendra|nuez|mix|granola)\b/i.test(txt)) ptsCompras += (m.from_me ? 1 : 2);
        if (/\b(cuando llega|chofer|camion|reparto|horarios|estamos abiertos|recibimos|dejar en el local|mostrador)\b/i.test(txt)) ptsRecepcion += (m.from_me ? 1 : 2);
    }

    const maxPts = Math.max(ptsPagos, ptsCompras, ptsRecepcion);
    if (maxPts < 3) return null;
    if (ptsPagos === maxPts && ptsPagos > ptsCompras) {
        return { rol: 'PAGOS_ADMIN', motivo: 'Intercambia comprobantes, facturas o pagos' };
    }
    if (ptsCompras === maxPts && ptsCompras >= ptsRecepcion) {
        return { rol: 'COMPRAS_PEDIDOS', motivo: 'Consulta precios, stock o realiza pedidos' };
    }
    if (ptsRecepcion === maxPts) {
        return { rol: 'RECEPCION_LOCAL', motivo: 'Coordina recepción y entregas en el local' };
    }
    return null;
}

/**
 * Fase 3.5: Lista negra estricta de palabras que JAMÁS deben aprenderse como apodo de persona
 */
const STOPWORDS_APODO_WA = new Set([
    'hola', 'buen', 'buena', 'buenas', 'buenos', 'dia', 'dias', 'tarde', 'tardes', 'noche', 'noches',
    'como', 'todo', 'toda', 'todos', 'bien', 'que', 'che', 'dale', 'ok', 'okay', 'genial', 'perfecto',
    'bueno', 'gracias', 'muchas', 'porfa', 'por', 'favor', 'escuchame', 'fijate', 'decime', 'mira',
    'avisame', 'contame', 'pasame', 'mandame', 'espera', 'te', 'les', 'se', 'me', 'nos', 'aca', 'ahi',
    'ahora', 'hoy', 'manana', 'ayer', 'siempre', 'nunca', 'solo', 'solamente', 'justo', 'recien',
    'estimado', 'estimada', 'equipo', 'chicos', 'chicas', 'gente', 'amigo', 'amiga', 'maestro',
    'campeon', 'crack', 'genio', 'hermano', 'hermana', 'capo', 'rey', 'pedido', 'orden', 'factura',
    'saldo', 'lista', 'precio', 'precios', 'pago', 'transferencia', 'comprobante', 'reparto', 'envio',
    'entrega', 'martin', 'lamda', 'si', 'no', 'ya', 'paso', 'mando', 'dejo', 'adjunto', 'cualquier',
    'cosa', 'cosita', 'abrazo', 'saludos', 'saludo', 'disculpa', 'perdon', 'consulta', 'duda', 'tema',
    'cliente', 'proveedor', 'dueno', 'duena', 'titular', 'compras', 'pagos', 'local', 'negocio',
    'empresa', 'encargado', 'encargada', 'empleado', 'empleada', 'mostrador', 'deposito', 'sucursal',
    'hace', 'estoy', 'estamos', 'quedo', 'quedamos', 'vamos', 'queres', 'queria', 'necesitas', 'tenes',
    'podes', 'algun', 'alguna', 'algo', 'unos', 'unas', 'para', 'con', 'sin', 'sobre', 'desde', 'hasta'
]);

function normalizarTokenNombreWa(raw) {
    return String(raw || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z]/g, '')
        .trim();
}

function capitalizarNombreWa(raw) {
    const limpio = String(raw || '').trim();
    if (!limpio) return '';
    return limpio.charAt(0).toUpperCase() + limpio.slice(1).toLowerCase();
}

/**
 * Extrae un vocativo personal al inicio de un mensaje de WhatsApp ("Hola Fran...", "Buen día Ale...", "Fran, escuchame...")
 * con validación estricta contra falsos positivos ($0 IA).
 */
function extraerVocativoInicialWa(texto, { descartados = [], nombreComercio = '' } = {}) {
    const txt = String(texto || '').trim();
    if (!txt || txt.length < 4) return null;
    const primeraLinea = txt.split(/\r?\n/)[0].slice(0, 80).trim();
    if (!primeraLinea) return null;

    let candidato = null;
    // Patrón 1: Saludo / conector + Nombre (ej: "Hola Fran, cómo andás", "Buen día Ale!")
    const mSaludo = primeraLinea.match(/^(?:hola|buen\s+d[ií]a|buenos\s+d[ií]as|buenas(?:\s+tardes|\s+noches)?|che|dale|ok|bien|gracias)[,!.\s]+([A-ZÁÉÍÓÚÑa-záéíóúñ]{2,16})(?=[\s,!?.:]|$)/i);
    if (mSaludo && mSaludo[1]) {
        candidato = mSaludo[1];
    } else {
        // Patrón 2: Nombre directo al inicio seguido de coma o signo de exclamación (ej: "Fran, escuchame...", "Ale! Cómo va?")
        const mDirecto = primeraLinea.match(/^([A-ZÁÉÍÓÚÑa-záéíóúñ]{2,16})[,!]\s+\S/);
        if (mDirecto && mDirecto[1]) {
            candidato = mDirecto[1];
        }
    }

    if (!candidato) return null;
    const norm = normalizarTokenNombreWa(candidato);
    if (!norm || norm.length < 2 || norm.length > 16) return null;
    if (STOPWORDS_APODO_WA.has(norm)) return null;

    const setDesc = new Set((Array.isArray(descartados) ? descartados : []).map(normalizarTokenNombreWa).filter(Boolean));
    if (setDesc.has(norm)) return null;

    // Evitar confundir el nombre del comercio con el nombre de pila (ej. "Sopresatta", "Nuts")
    const comercioTokens = String(nombreComercio || '').split(/\s+/).map(normalizarTokenNombreWa).filter(t => t.length >= 4);
    if (comercioTokens.includes(norm)) return null;

    return capitalizarNombreWa(candidato);
}

/**
 * Fase 3.5: Detecta y persiste el aprendizaje de trato/apodo cuando Martín edita un borrador del Asistente
 * ("Hola Alejandro..." -> "Fran, escuchame...") o saluda por otro nombre en el chat directo.
 */
async function procesarAprendizajeTratoAlEnviarWa({ chat, mensajeEnviado, borradorOriginalB1 = '' }) {
    if (!chat || !chat.id || !mensajeEnviado) return null;
    try {
        const memActual = (chat.memoria_trato_json && typeof chat.memoria_trato_json === 'object')
            ? { ...chat.memoria_trato_json }
            : {};
        const descartados = Array.isArray(memActual.descartados) ? memActual.descartados : [];
        const nombreComercio = chat.cliente_nombre || '';

        const vocEnviado = extraerVocativoInicialWa(mensajeEnviado, { descartados, nombreComercio });
        if (!vocEnviado) return null;

        const normEnviado = normalizarTokenNombreWa(vocEnviado);
        const normActualPref = normalizarTokenNombreWa(chat.apodo_preferido || '');
        if (normActualPref && normEnviado === normActualPref) return null;

        const tieneBorrador = String(borradorOriginalB1 || '').trim().length >= 5;
        let debeAprender = false;
        let origen = 'edicion_borrador';
        let apodoAnterior = chat.apodo_preferido || chat.contacto_nombre || '';

        if (tieneBorrador) {
            const vocOriginal = extraerVocativoInicialWa(borradorOriginalB1, { nombreComercio });
            const normOriginal = normalizarTokenNombreWa(vocOriginal || '');
            // Si Martín reemplazó el nombre del borrador (o agregó uno donde no había) -> aprende en 1er envío
            if (normEnviado !== normOriginal) {
                debeAprender = true;
                origen = 'edicion_borrador';
                apodoAnterior = vocOriginal || chat.apodo_preferido || chat.contacto_nombre || '';
            }
        } else {
            // Envío directo en Columna 2: no pisar manual ni líneas compartidas; aprender solo si difiere del nombre de agenda
            if (chat.rol_operativo === 'COMPARTIDO' || memActual.apodo_origen === 'manual') return null;
            const primerNombreAgenda = normalizarTokenNombreWa(String(chat.contacto_nombre || '').split(/[\s,-/]+/)[0] || '');
            if (!chat.apodo_preferido && normEnviado !== primerNombreAgenda) {
                debeAprender = true;
                origen = 'chat_directo';
                apodoAnterior = chat.contacto_nombre || '';
            }
        }

        if (!debeAprender) return null;

        const nuevaMemoria = {
            ...memActual,
            apodo: vocEnviado,
            apodo_origen: origen,
            apodo_reemplaza: String(apodoAnterior || '').trim(),
            detectado_en: new Date().toISOString(),
            descartados
        };

        await pool.query(`
            UPDATE public.crm_whatsapp_chats
            SET apodo_preferido = $2,
                memoria_trato_json = $3::jsonb,
                updated_at = NOW()
            WHERE id = $1
        `, [chat.id, vocEnviado, JSON.stringify(nuevaMemoria)]);

        if (chat.bunker_cliente_id) {
            await pool.query(`
                UPDATE public.crm_cliente_sintesis_memoria
                SET razonamiento_ia_json = NULL,
                    ultimo_msg_id_razonado = 0,
                    ultima_actualizacion_en = NOW()
                WHERE cliente_bunker_id = $1
            `, [chat.bunker_cliente_id]).catch(() => {});
        }

        return {
            tipo: 'APODO',
            valor: vocEnviado,
            anterior: String(apodoAnterior || '').trim(),
            origen
        };
    } catch (err) {
        console.warn('⚠️ [CRM-WA-TRATO] Error procesando aprendizaje de trato:', err.message);
        return null;
    }
}

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
                categoria_contacto, categoria_manual,
                etiqueta_crm, esperando_respuesta, no_leidos,
                ultimo_mensaje_texto, ultimo_mensaje_from_me, ultimo_mensaje_ack,
                ultimo_mensaje_at
            FROM public.crm_whatsapp_chats
            WHERE esperando_respuesta = true
              AND categoria_contacto IN ('CLIENTE_BUNKER', 'PROSPECTO', 'PROSPECTO_NODO')
              AND modo_privacidad = 'ACTIVO'
              AND (silenciado_hasta IS NULL OR silenciado_hasta <= NOW())
            ORDER BY ultimo_mensaje_at DESC
            LIMIT 25
        `;

        const queryContadores = `
            SELECT
                COUNT(*) FILTER (
                    WHERE esperando_respuesta = true 
                      AND categoria_contacto IN ('CLIENTE_BUNKER', 'PROSPECTO', 'PROSPECTO_NODO')
                      AND modo_privacidad = 'ACTIVO'
                      AND (silenciado_hasta IS NULL OR silenciado_hasta <= NOW())
                )::int AS clientes_sin_responder,
                COUNT(*) FILTER (
                    WHERE esperando_respuesta = true 
                      AND categoria_contacto IN ('PROSPECTO', 'PROSPECTO_NODO')
                      AND modo_privacidad = 'ACTIVO'
                      AND (silenciado_hasta IS NULL OR silenciado_hasta <= NOW())
                )::int AS no_agendados_sin_responder,
                COUNT(*) FILTER (
                    WHERE categoria_contacto IN ('CLIENTE_BUNKER', 'PROSPECTO', 'PROSPECTO_NODO')
                      AND modo_privacidad != 'OCULTO'
                )::int AS total_chats_visibles,
                COUNT(*) FILTER (
                    WHERE categoria_contacto IN ('PERSONAL', 'IGNORADO_BOT', 'PROVEEDOR')
                       OR modo_privacidad IN ('SILENCIADO_PIZARRA', 'OCULTO')
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
 * CTEs compartidas de telemetría comercial real para Bandeja de Hoy y Columna 1
 */
const SQL_CTES_TELEMETRIA_CHATS = `
    WITH deuda_cli AS (
        SELECT
            TRIM(codigo_bunker_cliente) AS cod,
            SUM(COALESCE(saldo, 0))::numeric AS saldo_pendiente,
            MAX(actualizada_en) AS cc_actualizada_en
        FROM public.factura_cuentas_corrientes
        WHERE TRIM(COALESCE(codigo_bunker_cliente, '')) <> ''
        GROUP BY TRIM(codigo_bunker_cliente)
    ),
    ult_presup AS (
        SELECT
            NULLIF(regexp_replace(TRIM(p.id_cliente::text), '^0+', ''), '')::integer AS lomas_id,
            MAX(p.fecha) AS ultima_compra_at,
            MAX(CASE WHEN UPPER(COALESCE(p.estado_logistico, '')) LIKE 'ENTREGADO%' THEN COALESCE(p.fecha_actualizacion, p.fecha) END) AS ultimo_entregado_presup_at
        FROM public.presupuestos p
        WHERE (p.activo IS NULL OR p.activo = true)
          AND (p.archivado IS NULL OR p.archivado = false)
          AND (p.estado IS NULL OR LOWER(TRIM(p.estado)) NOT IN ('anulado', 'anulada', 'cancelado', 'cancelada', 'baja', 'eliminado', 'eliminada'))
          AND TRIM(COALESCE(p.id_cliente::text, '')) ~ '^0*[0-9]+$'
        GROUP BY 1
    ),
    entregas_wa AS (
        SELECT
            m.chat_id,
            MAX(m.fecha_mensaje) AS ultimo_entregado_wa_at
        FROM public.crm_whatsapp_mensajes m
        WHERE m.from_me = true
          AND m.fecha_mensaje >= NOW() - INTERVAL '48 hours'
          AND (m.cuerpo ILIKE '%Entrega Confirmada%' OR m.cuerpo ILIKE '%ha sido entregado%')
        GROUP BY m.chat_id
    ),
    ms AS (
        SELECT
            chat_id,
            COUNT(*)::int AS cant_mensajes_reales,
            COUNT(*) FILTER (WHERE fecha_mensaje >= CURRENT_DATE AND from_me = false)::int AS in_hoy,
            COUNT(*) FILTER (WHERE fecha_mensaje >= CURRENT_DATE AND from_me = true)::int AS out_hoy,
            MAX(fecha_mensaje) AS real_ultimo_mensaje_at
        FROM public.crm_whatsapp_mensajes
        GROUP BY chat_id
    )
`;

function unificarYEnriquecerFilasChats(rawRows = []) {
    const ahoraMs = Date.now();
    const LIMITE_ENTREGADO_48H_MS = 48 * 3600 * 1000;

    // 1. Normalizar fecha real de comunicación y métricas comerciales
    for (const r of rawRows) {
        const esPlaceholderSinMsgs = (r.ultimo_mensaje_texto === 'Cliente Búnker vinculado' && Number(r.cant_mensajes_reales || 0) === 0);
        if (esPlaceholderSinMsgs) {
            r.ultimo_mensaje_at = null;
            r.tiene_comunicacion_real = false;
        } else {
            r.ultimo_mensaje_at = r.real_ultimo_mensaje_at || r.ultimo_mensaje_at || null;
            r.tiene_comunicacion_real = Boolean(r.ultimo_mensaje_at);
        }

        r.saldo_pendiente = Number(r.saldo_pendiente || 0);
        r.antiguedad_deuda_dias = Number(r.antiguedad_deuda_dias || 0);
        r.dias_sin_compra = (r.dias_sin_compra !== null && r.dias_sin_compra !== undefined && !isNaN(Number(r.dias_sin_compra)))
            ? Number(r.dias_sin_compra)
            : null;

        const tsPresup = r.ultimo_entregado_presup_at ? new Date(r.ultimo_entregado_presup_at).getTime() : 0;
        const tsWa = r.ultimo_entregado_wa_at ? new Date(r.ultimo_entregado_wa_at).getTime() : 0;
        const tsEntMax = Math.max(tsPresup || 0, tsWa || 0);
        r.ultimo_entregado_at = tsEntMax > 0 ? new Date(tsEntMax).toISOString() : null;
        r.entregado_reciente = Boolean(tsEntMax > 0 && (ahoraMs - tsEntMax) <= LIMITE_ENTREGADO_48H_MS);
    }

    // 2. Unificar chats duplicados (@c.us vs @lid) del mismo contacto/cliente Búnker
    //    Sin fusionar dos teléfonos distintos (@c.us) aunque compartan nombre de pila
    const filasUnificadas = [];
    for (const r of rawRows) {
        if (r.bunker_cliente_id) {
            const esLidR = String(r.chat_id || '').endsWith('@lid');
            const nombreR = String(r.contacto_nombre || '').trim().toLowerCase();
            const digR = String(r.ultimos_digitos || '').trim();

            const existente = filasUnificadas.find(ex => {
                if (ex.bunker_cliente_id !== r.bunker_cliente_id) return false;
                const esLidEx = String(ex.chat_id || '').endsWith('@lid');
                const nombreEx = String(ex.contacto_nombre || '').trim().toLowerCase();
                const digEx = String(ex.ultimos_digitos || '').trim();

                if (!esLidR && !esLidEx && digR && digEx && digR === digEx) return true;
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
                existente.saldo_pendiente = Math.max(Number(existente.saldo_pendiente || 0), Number(r.saldo_pendiente || 0));
                existente.antiguedad_deuda_dias = Math.max(Number(existente.antiguedad_deuda_dias || 0), Number(r.antiguedad_deuda_dias || 0));
                if (existente.dias_sin_compra === null && r.dias_sin_compra !== null) {
                    existente.dias_sin_compra = r.dias_sin_compra;
                }
                if (r.entregado_reciente) {
                    existente.entregado_reciente = true;
                    const tsExE = existente.ultimo_entregado_at ? new Date(existente.ultimo_entregado_at).getTime() : 0;
                    const tsRE = r.ultimo_entregado_at ? new Date(r.ultimo_entregado_at).getTime() : 0;
                    if (tsRE > tsExE) existente.ultimo_entregado_at = r.ultimo_entregado_at;
                }
                if (!existente.etiqueta_crm && r.etiqueta_crm) existente.etiqueta_crm = r.etiqueta_crm;
                if (!existente.nota_rapida && r.nota_rapida) existente.nota_rapida = r.nota_rapida;
                if (String(r.frente_activo || '').toUpperCase() === 'NODOS') existente.frente_activo = 'NODOS';
                if (!existente.nodo_captacion_json?.activo && r.nodo_captacion_json?.activo) {
                    existente.nodo_captacion_json = r.nodo_captacion_json;
                }
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
    return filasUnificadas;
}

const SQL_CONDICION_FRENTE_NODOS = `
    c.modo_privacidad != 'OCULTO'
    AND COALESCE(c.frente_activo, 'AUTO') <> 'MAYORISTA'
    AND (
        c.categoria_contacto = 'PROSPECTO_NODO'
        OR COALESCE(c.frente_activo, 'AUTO') = 'NODOS'
        OR COALESCE((c.nodo_captacion_json->>'activo')::boolean, false) = true
        OR c.etiqueta_crm IN ('PROSPECTO_NODO', 'REUNION_NODO')
    )
`;

async function calcularContadoresTabsConsolaWa() {
    const res = await pool.query(`
        SELECT
            COUNT(DISTINCT COALESCE(c.bunker_cliente_id::text, 'raw_' || c.id::text)) FILTER (
                WHERE c.esperando_respuesta = true
                  AND c.categoria_contacto IN ('CLIENTE_BUNKER', 'PROSPECTO', 'PROSPECTO_NODO')
                  AND c.modo_privacidad = 'ACTIVO'
                  AND (c.silenciado_hasta IS NULL OR c.silenciado_hasta <= NOW())
            )::int AS por_atender,
            COUNT(DISTINCT COALESCE(c.bunker_cliente_id::text, 'raw_' || c.id::text)) FILTER (
                WHERE c.categoria_contacto = 'CLIENTE_BUNKER'
                  AND c.modo_privacidad != 'OCULTO'
            )::int AS clientes,
            COUNT(DISTINCT COALESCE(c.bunker_cliente_id::text, 'raw_' || c.id::text)) FILTER (
                WHERE ${SQL_CONDICION_FRENTE_NODOS}
            )::int AS nodos,
            COUNT(*) FILTER (
                WHERE c.categoria_contacto IN ('PROSPECTO', 'PROVEEDOR', 'PERSONAL', 'IGNORADO_BOT', 'SIN_CLASIFICAR')
                   OR c.modo_privacidad IN ('SILENCIADO_PIZARRA', 'OCULTO')
                   OR (c.silenciado_hasta IS NOT NULL AND c.silenciado_hasta > NOW())
            )::int AS otros
        FROM public.crm_whatsapp_chats c
    `);
    return res.rows[0] || { por_atender: 0, clientes: 0, nodos: 0, otros: 0 };
}

/**
 * GET /api/crm/whatsapp/bandeja-hoy
 * Portada operativa "Bandeja de Hoy" (Carril Entrante + Agenda Saliente con 3 KPIs reales + Contadores de 3 Solapas)
 */
router.get('/crm/whatsapp/bandeja-hoy', async (req, res) => {
    try {
        await crmWhatsappDb.asegurarTablasCrmWhatsapp();
        if (!multiContactosSembradosEnHub && typeof crmWhatsappDb.sembrarDirectorioClientesEnChats === 'function') {
            multiContactosSembradosEnHub = true;
            await crmWhatsappDb.sembrarDirectorioClientesEnChats();
        }

        const query = `
            ${SQL_CTES_TELEMETRIA_CHATS}
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
                ms.real_ultimo_mensaje_at,
                COALESCE(dc.saldo_pendiente, 0)::numeric AS saldo_pendiente,
                COALESCE(
                    NULLIF(sm.comportamiento_pago_json->'composicion'->>'antiguedad_maxima_dias', '')::int,
                    CASE WHEN COALESCE(dc.saldo_pendiente, 0) > 100 AND dc.cc_actualizada_en IS NOT NULL
                         THEN GREATEST(0, EXTRACT(DAY FROM (NOW() - dc.cc_actualizada_en))::int)
                         ELSE 0 END
                )::int AS antiguedad_deuda_dias,
                COALESCE(
                    CASE WHEN up.ultima_compra_at IS NOT NULL THEN GREATEST(0, EXTRACT(DAY FROM (NOW() - up.ultima_compra_at))::int) ELSE NULL END,
                    NULLIF(sm.ciclo_compra_json->>'dias_desde_ultima_compra', '')::int
                ) AS dias_sin_compra,
                up.ultima_compra_at,
                up.ultimo_entregado_presup_at,
                ew.ultimo_entregado_wa_at
            FROM public.crm_whatsapp_chats c
            LEFT JOIN public.bunker_clientes bc ON bc.id = c.bunker_cliente_id
            LEFT JOIN deuda_cli dc ON dc.cod = TRIM(COALESCE(bc.codigo_bunker_cliente, c.codigo_bunker_cliente, ''))
            LEFT JOIN ult_presup up ON up.lomas_id = (
                CASE WHEN TRIM(COALESCE(bc.lomas_soft_id, '')) ~ '^0*[0-9]+$'
                     THEN NULLIF(regexp_replace(TRIM(bc.lomas_soft_id), '^0+', ''), '')::integer
                     ELSE NULL END
            )
            LEFT JOIN entregas_wa ew ON ew.chat_id = c.chat_id
            LEFT JOIN ms ON ms.chat_id = c.chat_id
            LEFT JOIN public.crm_cliente_sintesis_memoria sm ON sm.cliente_bunker_id = c.bunker_cliente_id
            WHERE c.categoria_contacto IN ('CLIENTE_BUNKER', 'PROSPECTO', 'PROSPECTO_NODO')
              AND c.modo_privacidad != 'OCULTO'
            ORDER BY
                c.esperando_respuesta DESC,
                COALESCE(ms.real_ultimo_mensaje_at, CASE WHEN c.ultimo_mensaje_texto = 'Cliente Búnker vinculado' THEN NULL ELSE c.ultimo_mensaje_at END) DESC NULLS LAST
            LIMIT 800
        `;

        const [result, contadoresTabs] = await Promise.all([
            pool.query(query),
            calcularContadoresTabsConsolaWa()
        ]);
        const rows = unificarYEnriquecerFilasChats(result.rows);

        // 1. Carril Entrante: Clientes Búnker, Prospectos y Prospectos Nodo esperando respuesta activa
        const entrantes = rows
            .filter(r =>
                r.esperando_respuesta === true &&
                ['CLIENTE_BUNKER', 'PROSPECTO', 'PROSPECTO_NODO'].includes(r.categoria_contacto) &&
                r.modo_privacidad === 'ACTIVO' &&
                !r.esta_silenciado_temporal
            )
            .sort((a, b) => {
                const ta = a.ultimo_mensaje_at ? new Date(a.ultimo_mensaje_at).getTime() : 0;
                const tb = b.ultimo_mensaje_at ? new Date(b.ultimo_mensaje_at).getTime() : 0;
                return tb - ta;
            })
            .slice(0, 15)
            .map(r => ({
                id: r.id,
                chat_id: r.chat_id,
                bunker_cliente_id: r.bunker_cliente_id,
                cliente_nombre: r.cliente_nombre || r.contacto_nombre || r.pushname_wa || r.telefono_normalizado,
                contacto_nombre: r.contacto_nombre || r.pushname_wa || '',
                codigo_bunker_cliente: r.codigo_bunker_cliente || '',
                lomas_soft_id: r.lomas_soft_id || '',
                categoria_contacto: r.categoria_contacto,
                no_leidos: Number(r.no_leidos || 0),
                ultimo_mensaje_texto: r.ultimo_mensaje_texto || '',
                ultimo_mensaje_at: r.ultimo_mensaje_at,
                saldo_pendiente: r.saldo_pendiente
            }));

        // 2. Agrupar por cliente Búnker único (quedándonos con el contacto más activo/habitual para el 1-clic)
        const mapaClientes = new Map();
        for (const r of rows) {
            if (!r.bunker_cliente_id || r.categoria_contacto !== 'CLIENTE_BUNKER') continue;
            const key = Number(r.bunker_cliente_id);
            const tsR = r.ultimo_mensaje_at ? new Date(r.ultimo_mensaje_at).getTime() : 0;
            const prev = mapaClientes.get(key);
            if (!prev) {
                mapaClientes.set(key, {
                    chat_id_pk: r.id,
                    bunker_cliente_id: key,
                    cliente_nombre: r.cliente_nombre || r.contacto_nombre || r.telefono_normalizado,
                    contacto_nombre: r.contacto_nombre || r.pushname_wa || '',
                    codigo_bunker_cliente: r.codigo_bunker_cliente || '',
                    lomas_soft_id: r.lomas_soft_id || '',
                    saldo_pendiente: r.saldo_pendiente,
                    antiguedad_deuda_dias: r.antiguedad_deuda_dias,
                    dias_sin_compra: r.dias_sin_compra,
                    ultimo_entregado_at: r.ultimo_entregado_at,
                    entregado_reciente: r.entregado_reciente,
                    _tsMsg: tsR,
                    _esperando: Boolean(r.esperando_respuesta)
                });
            } else {
                prev.saldo_pendiente = Math.max(prev.saldo_pendiente, r.saldo_pendiente);
                prev.antiguedad_deuda_dias = Math.max(prev.antiguedad_deuda_dias, r.antiguedad_deuda_dias);
                if (prev.dias_sin_compra === null && r.dias_sin_compra !== null) prev.dias_sin_compra = r.dias_sin_compra;
                if (r.entregado_reciente) {
                    prev.entregado_reciente = true;
                    const tsPrevE = prev.ultimo_entregado_at ? new Date(prev.ultimo_entregado_at).getTime() : 0;
                    const tsRE = r.ultimo_entregado_at ? new Date(r.ultimo_entregado_at).getTime() : 0;
                    if (tsRE > tsPrevE) prev.ultimo_entregado_at = r.ultimo_entregado_at;
                }
                if ((r.esperando_respuesta && !prev._esperando) || (Boolean(r.esperando_respuesta) === prev._esperando && tsR > prev._tsMsg)) {
                    prev.chat_id_pk = r.id;
                    prev.contacto_nombre = r.contacto_nombre || r.pushname_wa || prev.contacto_nombre;
                    prev._tsMsg = tsR;
                    prev._esperando = Boolean(r.esperando_respuesta);
                }
            }
        }
        const clientesUnicos = Array.from(mapaClientes.values());

        const conDeudaAll = clientesUnicos
            .filter(c => c.saldo_pendiente > 100)
            .sort((a, b) => (b.antiguedad_deuda_dias - a.antiguedad_deuda_dias) || (b.saldo_pendiente - a.saldo_pendiente));

        const sinCompra30dAll = clientesUnicos
            .filter(c => c.dias_sin_compra !== null && c.dias_sin_compra > 30)
            .sort((a, b) => (b.dias_sin_compra || 0) - (a.dias_sin_compra || 0));

        const entregadosRecientesAll = clientesUnicos
            .filter(c => c.entregado_reciente === true)
            .sort((a, b) => {
                const ta = a.ultimo_entregado_at ? new Date(a.ultimo_entregado_at).getTime() : 0;
                const tb = b.ultimo_entregado_at ? new Date(b.ultimo_entregado_at).getTime() : 0;
                return tb - ta;
            });

        const limpiarItem = (c) => ({
            id: c.chat_id_pk,
            bunker_cliente_id: c.bunker_cliente_id,
            cliente_nombre: c.cliente_nombre,
            contacto_nombre: c.contacto_nombre,
            codigo_bunker_cliente: c.codigo_bunker_cliente,
            lomas_soft_id: c.lomas_soft_id,
            saldo_pendiente: c.saldo_pendiente,
            antiguedad_deuda_dias: c.antiguedad_deuda_dias,
            dias_sin_compra: c.dias_sin_compra,
            ultimo_entregado_at: c.ultimo_entregado_at
        });

        res.json({
            success: true,
            entrantes,
            agenda: {
                con_deuda: {
                    total: conDeudaAll.length,
                    monto_total: conDeudaAll.reduce((acc, c) => acc + c.saldo_pendiente, 0),
                    items: conDeudaAll.slice(0, 5).map(limpiarItem)
                },
                sin_compra_30d: {
                    total: sinCompra30dAll.length,
                    items: sinCompra30dAll.slice(0, 5).map(limpiarItem)
                },
                entregados_recientes: {
                    total: entregadosRecientesAll.length,
                    items: entregadosRecientesAll.slice(0, 5).map(limpiarItem)
                }
            },
            contadores_tabs: {
                por_atender: entrantes.length,
                clientes: Number(contadoresTabs.clientes || clientesUnicos.length),
                nodos: Number(contadoresTabs.nodos || 0),
                otros: Number(contadoresTabs.otros || 0)
            }
        });
    } catch (error) {
        console.error('❌ [CRM-WA-HUB] Error generando Bandeja de Hoy:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/crm/whatsapp/chats
 * Lista de conversaciones para la Columna 1 de la Consola de 3 Columnas
 * Filtros: SIN_RESPONDER | CLIENTES | OTROS (y compatibles: NO_AGENDADOS | PRIVADOS | TODOS)
 * Subfiltros:
 *   - En CLIENTES: TODOS | CON_DEUDA | SIN_COMPRA_30D | ENTREGADO_RECIENTE
 *   - En OTROS:    TODOS | PROSPECTO | PROVEEDOR | PERSONAL_BOTS | PERSONAL | IGNORADO_BOT
 */
router.get('/crm/whatsapp/chats', async (req, res) => {
    try {
        await crmWhatsappDb.asegurarTablasCrmWhatsapp();
        if (!multiContactosSembradosEnHub && typeof crmWhatsappDb.sembrarDirectorioClientesEnChats === 'function') {
            multiContactosSembradosEnHub = true;
            await crmWhatsappDb.sembrarDirectorioClientesEnChats();
        }

        const filtro = String(req.query.filtro || 'CLIENTES').toUpperCase();
        const subfiltro = String(req.query.subfiltro || 'TODOS').toUpperCase();
        const q = String(req.query.q || '').trim().toLowerCase();

        let whereClause = `WHERE 1=1`;
        if (filtro === 'SIN_RESPONDER') {
            whereClause += ` AND c.esperando_respuesta = true AND c.categoria_contacto IN ('CLIENTE_BUNKER', 'PROSPECTO', 'PROSPECTO_NODO') AND c.modo_privacidad = 'ACTIVO' AND (c.silenciado_hasta IS NULL OR c.silenciado_hasta <= NOW())`;
        } else if (filtro === 'CLIENTES') {
            if (q.length > 0) {
                whereClause += ` AND c.categoria_contacto IN ('CLIENTE_BUNKER', 'PROSPECTO', 'PROSPECTO_NODO') AND c.modo_privacidad != 'OCULTO'`;
            } else {
                whereClause += ` AND c.categoria_contacto = 'CLIENTE_BUNKER' AND c.modo_privacidad != 'OCULTO'`;
            }
        } else if (filtro === 'NODOS') {
            whereClause += ` AND (${SQL_CONDICION_FRENTE_NODOS})`;
        } else if (filtro === 'OTROS') {
            if (subfiltro === 'PROSPECTO') {
                whereClause += ` AND c.categoria_contacto = 'PROSPECTO'`;
            } else if (subfiltro === 'PROSPECTO_NODO') {
                whereClause += ` AND c.categoria_contacto = 'PROSPECTO_NODO'`;
            } else if (subfiltro === 'PROVEEDOR') {
                whereClause += ` AND c.categoria_contacto = 'PROVEEDOR'`;
            } else if (subfiltro === 'PERSONAL_BOTS') {
                whereClause += ` AND (c.categoria_contacto IN ('PERSONAL', 'IGNORADO_BOT') OR c.modo_privacidad IN ('SILENCIADO_PIZARRA', 'OCULTO') OR (c.silenciado_hasta IS NOT NULL AND c.silenciado_hasta > NOW()))`;
            } else if (['PERSONAL', 'IGNORADO_BOT', 'SIN_CLASIFICAR'].includes(subfiltro)) {
                whereClause += ` AND c.categoria_contacto = '${subfiltro}'`;
            } else {
                whereClause += ` AND (c.categoria_contacto IN ('PROSPECTO', 'PROSPECTO_NODO', 'PROVEEDOR', 'PERSONAL', 'IGNORADO_BOT', 'SIN_CLASIFICAR') OR c.modo_privacidad IN ('SILENCIADO_PIZARRA', 'OCULTO') OR (c.silenciado_hasta IS NOT NULL AND c.silenciado_hasta > NOW()))`;
            }
        } else if (filtro === 'NO_AGENDADOS') {
            whereClause += ` AND c.categoria_contacto IN ('PROVEEDOR', 'PROSPECTO', 'PROSPECTO_NODO', 'SIN_CLASIFICAR') AND c.es_cliente_bunker = false AND c.modo_privacidad != 'OCULTO'`;
        } else if (filtro === 'PRIVADOS') {
            whereClause += ` AND (c.categoria_contacto IN ('PERSONAL', 'IGNORADO_BOT') OR c.modo_privacidad IN ('SILENCIADO_PIZARRA', 'OCULTO') OR (c.silenciado_hasta IS NOT NULL AND c.silenciado_hasta > NOW()))`;
        } else if (['CLIENTE_BUNKER', 'PROSPECTO', 'PROSPECTO_NODO', 'PROVEEDOR', 'PERSONAL', 'IGNORADO_BOT'].includes(filtro)) {
            whereClause += ` AND c.categoria_contacto = '${filtro}'`;
        } else {
            whereClause += ` AND c.categoria_contacto <> 'IGNORADO_BOT' AND c.modo_privacidad != 'OCULTO'`;
        }

        const query = `
            ${SQL_CTES_TELEMETRIA_CHATS}
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
                ms.real_ultimo_mensaje_at,
                COALESCE(dc.saldo_pendiente, 0)::numeric AS saldo_pendiente,
                COALESCE(
                    NULLIF(sm.comportamiento_pago_json->'composicion'->>'antiguedad_maxima_dias', '')::int,
                    CASE WHEN COALESCE(dc.saldo_pendiente, 0) > 100 AND dc.cc_actualizada_en IS NOT NULL
                         THEN GREATEST(0, EXTRACT(DAY FROM (NOW() - dc.cc_actualizada_en))::int)
                         ELSE 0 END
                )::int AS antiguedad_deuda_dias,
                COALESCE(
                    CASE WHEN up.ultima_compra_at IS NOT NULL THEN GREATEST(0, EXTRACT(DAY FROM (NOW() - up.ultima_compra_at))::int) ELSE NULL END,
                    NULLIF(sm.ciclo_compra_json->>'dias_desde_ultima_compra', '')::int
                ) AS dias_sin_compra,
                up.ultima_compra_at,
                up.ultimo_entregado_presup_at,
                ew.ultimo_entregado_wa_at
            FROM public.crm_whatsapp_chats c
            LEFT JOIN public.bunker_clientes bc ON bc.id = c.bunker_cliente_id
            LEFT JOIN deuda_cli dc ON dc.cod = TRIM(COALESCE(bc.codigo_bunker_cliente, c.codigo_bunker_cliente, ''))
            LEFT JOIN ult_presup up ON up.lomas_id = (
                CASE WHEN TRIM(COALESCE(bc.lomas_soft_id, '')) ~ '^0*[0-9]+$'
                     THEN NULLIF(regexp_replace(TRIM(bc.lomas_soft_id), '^0+', ''), '')::integer
                     ELSE NULL END
            )
            LEFT JOIN entregas_wa ew ON ew.chat_id = c.chat_id
            LEFT JOIN ms ON ms.chat_id = c.chat_id
            LEFT JOIN public.crm_cliente_sintesis_memoria sm ON sm.cliente_bunker_id = c.bunker_cliente_id
            ${whereClause}
            ORDER BY 
                c.esperando_respuesta DESC,
                COALESCE(ms.real_ultimo_mensaje_at, CASE WHEN c.ultimo_mensaje_texto = 'Cliente Búnker vinculado' THEN NULL ELSE c.ultimo_mensaje_at END) DESC NULLS LAST
            LIMIT 800
        `;

        const [result, contadoresTabs] = await Promise.all([
            pool.query(query),
            calcularContadoresTabsConsolaWa()
        ]);
        let rows = unificarYEnriquecerFilasChats(result.rows);

        // Aplicar subfiltro comercial en CLIENTES o en NODOS después de unificar
        if (filtro === 'CLIENTES') {
            if (subfiltro === 'CON_DEUDA') {
                rows = rows
                    .filter(r => Number(r.saldo_pendiente || 0) > 100)
                    .sort((a, b) => (Number(b.antiguedad_deuda_dias || 0) - Number(a.antiguedad_deuda_dias || 0)) || (Number(b.saldo_pendiente || 0) - Number(a.saldo_pendiente || 0)));
            } else if (subfiltro === 'SIN_COMPRA_30D') {
                rows = rows
                    .filter(r => r.dias_sin_compra !== null && Number(r.dias_sin_compra) > 30)
                    .sort((a, b) => Number(b.dias_sin_compra || 0) - Number(a.dias_sin_compra || 0));
            } else if (subfiltro === 'ENTREGADO_RECIENTE') {
                rows = rows
                    .filter(r => Boolean(r.entregado_reciente))
                    .sort((a, b) => {
                        const ta = a.ultimo_entregado_at ? new Date(a.ultimo_entregado_at).getTime() : 0;
                        const tb = b.ultimo_entregado_at ? new Date(b.ultimo_entregado_at).getTime() : 0;
                        return tb - ta;
                    });
            }
        } else if (filtro === 'NODOS') {
            const prioridadEtapa = (r) => {
                const et = String(r.nodo_captacion_json?.etapa || 'INVITACION_INICIAL').toUpperCase();
                return nodosCaptacionCrm.ETAPAS_CAPTACION_NODO[et]?.prioridad || 3;
            };
            if (subfiltro === 'REUNION') {
                rows = rows.filter(r => ['REUNION_A_COORDINAR', 'REUNION_AGENDADA'].includes(String(r.nodo_captacion_json?.etapa || '').toUpperCase()));
            } else if (subfiltro === 'PROPUESTA') {
                rows = rows.filter(r => ['PROPUESTA_ENVIADA', 'EN_EVALUACION'].includes(String(r.nodo_captacion_json?.etapa || '').toUpperCase()));
            } else if (subfiltro === 'INVITACION') {
                rows = rows.filter(r => {
                    const et = String(r.nodo_captacion_json?.etapa || '').toUpperCase();
                    return !et || et === 'INVITACION_INICIAL';
                });
            } else if (subfiltro === 'EXTERNOS') {
                rows = rows.filter(r => !r.bunker_cliente_id);
            }
            rows.sort((a, b) => {
                const wA = a.esperando_respuesta ? 1 : 0;
                const wB = b.esperando_respuesta ? 1 : 0;
                if (wA !== wB) return wB - wA;
                const pA = prioridadEtapa(a);
                const pB = prioridadEtapa(b);
                if (pA !== pB) return pA - pB;
                const tA = a.ultimo_mensaje_at ? new Date(a.ultimo_mensaje_at).getTime() : 0;
                const tB = b.ultimo_mensaje_at ? new Date(b.ultimo_mensaje_at).getTime() : 0;
                return tB - tA;
            });
        }

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
            data: rows,
            contadores_tabs: contadoresTabs
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
                    bc.email_portal, bc.email_portal_nombre, bc.email_portal_cargo,
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
                rayosX.estado_portal_b2b = await resolverEstadoYInvitacionPortalClienteWa(cli, {
                    forzarNuevaInvitacion: false,
                    asegurarTokenSiNoIngreso: true
                }).catch(() => null);
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
                        rayosX.logistica_resumen = await obtenerContextoLogisticoClienteWa(lomasIdNum);
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

                // 2.e Artículos habituales y síntesis rápida en memoria (para Ficha & CC en Columna 3)
                try {
                    const smRes = await pool.query(`
                        SELECT articulos_habituales_json, ciclo_compra_json, comportamiento_pago_json
                        FROM public.crm_cliente_sintesis_memoria
                        WHERE cliente_bunker_id = $1
                        LIMIT 1
                    `, [chat.bunker_cliente_id]);
                    if (smRes.rows.length > 0) {
                        const smRow = smRes.rows[0];
                        rayosX.articulos_habituales = Array.isArray(smRow.articulos_habituales_json)
                            ? smRow.articulos_habituales_json.slice(0, 12)
                            : [];
                        rayosX.ciclo_compra = smRow.ciclo_compra_json || null;
                        rayosX.comportamiento_pago = smRow.comportamiento_pago_json || null;
                    } else {
                        rayosX.articulos_habituales = [];
                    }
                } catch (eSm) {
                    rayosX.articulos_habituales = [];
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

        // Si entre los últimos 10 mensajes hay algún audio (entrante o saliente de Martín) sin transcribir ("🎤 Mensaje de audio"), transcribirlo en caliente
        const ultimos10 = mensajesUnicos.slice(-10);
        const audiosSinTranscribir = ultimos10.filter(m =>
            (m.tipo_mensaje === 'ptt' || m.tipo_mensaje === 'audio') &&
            (!m.cuerpo || String(m.cuerpo).trim() === '🎤 Mensaje de audio')
        );
        if (audiosSinTranscribir.length > 0 && chat.chat_id) {
            try {
                const resTr = await Promise.race([
                    whatsappAudioTranscriber.transcribirAudiosDeChatViaDevTools({
                        chatId: chat.chat_id,
                        msgIds: audiosSinTranscribir.map(m => m.msg_id).filter(Boolean),
                        maxAudios: 4,
                        incluirSalientes: true
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

        // Fase 3.5: Sugerencia determinista de rol por historial (solo si rol_operativo aún es NULL)
        chat.rol_sugerido_historial = (!chat.rol_operativo && (chat.categoria_contacto === 'CLIENTE_BUNKER' || chat.categoria_contacto === 'PROSPECTO'))
            ? sugerirRolOperativoPorHistorial(mensajesUnicos)
            : null;

        // Frente Captación de Nodos: detección determinista del hilo + tiendas reales + caché aislado por chat
        const contextoNodosDetalle = nodosCaptacionCrm.detectarContextoHiloNodosWa({
            mensajesRecientes: mensajesUnicos,
            categoriaContacto: chat.categoria_contacto,
            frenteActivo: chat.frente_activo,
            nodoCaptacionJson: chat.nodo_captacion_json,
            clienteNombre: chat.cliente_nombre || '',
            contactoNombre: chat.contacto_nombre || chat.pushname_wa || '',
            bunkerClienteId: chat.bunker_cliente_id
        });
        const nodosReferencia = await nodosCaptacionCrm.obtenerReferenciasNodosActivos().catch(() => nodosCaptacionCrm.REFERENCIAS_NODOS_FALLBACK);
        const ultimoMsgIdDetalle = mensajesUnicos.length > 0 ? Number(mensajesUnicos[mensajesUnicos.length - 1].id || 0) : 0;
        const nodoJsonChat = (chat.nodo_captacion_json && typeof chat.nodo_captacion_json === 'object') ? chat.nodo_captacion_json : {};
        const razNodosGuardado = (
            contextoNodosDetalle.esFrenteNodos &&
            nodoJsonChat.razonamiento_nodos_json &&
            nodoJsonChat.razonamiento_nodos_json.usando_ia_real &&
            Number(nodoJsonChat.ultimo_msg_id_razonado_nodos || 0) === ultimoMsgIdDetalle &&
            ultimoMsgIdDetalle > 0
        ) ? nodoJsonChat.razonamiento_nodos_json : null;

        // Fase 3.5: Hermanos del mismo cliente Búnker (para Guardrail de Cobranza y salto 1-clic a Pagos/Dueño)
        let otrosContactosCliente = [];
        if (chat.bunker_cliente_id) {
            try {
                const ocRes = await pool.query(`
                    SELECT id, contacto_nombre, contacto_cargo, rol_operativo, apodo_preferido,
                           telefono_normalizado, ultimo_mensaje_at, ultimo_mensaje_texto
                    FROM public.crm_whatsapp_chats
                    WHERE bunker_cliente_id = $1
                      AND id <> $2
                      AND COALESCE(modo_privacidad, 'ACTIVO') <> 'OCULTO'
                    ORDER BY
                        CASE rol_operativo
                            WHEN 'PAGOS_ADMIN' THEN 1
                            WHEN 'DUENO_TITULAR' THEN 2
                            WHEN 'COMPRAS_PEDIDOS' THEN 3
                            WHEN 'RECEPCION_LOCAL' THEN 4
                            WHEN 'COMPARTIDO' THEN 5
                            ELSE 6
                        END ASC,
                        ultimo_mensaje_at DESC NULLS LAST
                `, [chat.bunker_cliente_id, chat.id]);
                otrosContactosCliente = ocRes.rows;
            } catch (_) {}
        }

        res.json({
            success: true,
            chat,
            mensajes: mensajesUnicos,
            rayos_x: rayosX,
            otros_contactos_cliente: otrosContactosCliente,
            contexto_nodos: contextoNodosDetalle,
            nodos_referencia: nodosReferencia,
            razonamiento_nodos_guardado: razNodosGuardado
        });
    } catch (error) {
        console.error('❌ [CRM-WA-HUB] Error en detalle de chat:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/crm/whatsapp/chats/:id/transcribir-audios
 * Desencripta y transcribe bajo demanda audios del chat (entrantes y salientes de Martín).
 * Soporta tanto extracción en caliente vía DevToolsActivePort como audioBase64 directo (imputado a AUDIOS).
 */
router.post('/crm/whatsapp/chats/:id/transcribir-audios', async (req, res) => {
    try {
        const chatPk = parseInt(req.params.id, 10);
        const chatRes = await pool.query('SELECT * FROM public.crm_whatsapp_chats WHERE id = $1 LIMIT 1', [chatPk]);
        if (chatRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Chat no encontrado.' });
        }
        const chat = chatRes.rows[0];
        const msgIds = Array.isArray(req.body?.msgIds) ? req.body.msgIds : [];
        const maxAudios = parseInt(req.body?.maxAudios, 10) || 4;
        const incluirSalientes = req.body?.incluirSalientes !== false;
        const audioBase64Raw = String(req.body?.audioBase64 || '').replace(/^data:audio\/[^;]+;base64,/i, '').trim();

        // Modo directo por base64 (ej. pruebas o reenvío directo de audio)
        if (audioBase64Raw && audioBase64Raw.length >= 32) {
            const targetMsgId = String(req.body?.msgId || msgIds[0] || '').trim();
            const mimeType = String(req.body?.mimeType || 'audio/ogg').trim();
            const esSaliente = Boolean(req.body?.fromMe);
            const resDirecto = await whatsappAudioTranscriber.descargarYTranscribirAudioWhatsApp({
                base64Ogg: audioBase64Raw,
                mimeType,
                detalleOrigen: esSaliente ? 'Audio saliente Martín' : 'Audio entrante cliente'
            });
            let actualizado = false;
            if (resDirecto && resDirecto.ok && resDirecto.cuerpoFormateado && targetMsgId) {
                const rowUpd = await crmWhatsappDb.actualizarTranscripcionAudioMensaje({
                    msgId: targetMsgId,
                    chatId: chat.chat_id,
                    cuerpoFormateado: resDirecto.cuerpoFormateado
                });
                actualizado = Boolean(rowUpd);
            }
            return res.json({
                success: Boolean(resDirecto?.ok),
                encontrados: 1,
                transcritos: resDirecto?.ok ? 1 : 0,
                resultados: resDirecto?.ok ? [{
                    msgId: targetMsgId || 'directo',
                    fromMe: esSaliente,
                    texto: resDirecto.texto,
                    cuerpo: resDirecto.cuerpoFormateado,
                    actualizado
                }] : []
            });
        }

        const resultado = await whatsappAudioTranscriber.transcribirAudiosDeChatViaDevTools({
            chatId: chat.chat_id,
            msgIds,
            maxAudios,
            incluirSalientes
        });
        res.json(resultado);
    } catch (error) {
        console.error('❌ [CRM-WA-HUB] Error en transcribir-audios:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/crm/whatsapp/chats/:id/leer-imagen
 * Fase 3 Multimodal: Lee e interpreta una imagen del chat (comprobante de transferencia, captura bancaria,
 * remito o foto de producto) usando Gemini 2.5 Flash Vision.
 * Persiste un resumen no destructivo sobre filas genéricas ('📷 Imagen') y devuelve el comprobante estructurado.
 */
router.post('/crm/whatsapp/chats/:id/leer-imagen', async (req, res) => {
    try {
        const chatPk = parseInt(req.params.id, 10);
        const chatRes = await pool.query(`
            SELECT c.*, COALESCE(c.cliente_nombre, bc.cliente_nombre) AS nombre_cliente_efectivo
            FROM public.crm_whatsapp_chats c
            LEFT JOIN public.bunker_clientes bc ON bc.id = c.bunker_cliente_id
            WHERE c.id = $1
            LIMIT 1
        `, [chatPk]);
        if (chatRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Chat no encontrado.' });
        }
        const chat = chatRes.rows[0];
        const msgIdReq = req.body?.msgId ? String(req.body.msgId).trim() : null;
        const imageBase64Raw = String(req.body?.imageBase64 || '').replace(/^data:image\/[^;]+;base64,/i, '').trim();

        let imageBuffer = null;
        let mimeType = String(req.body?.mimeType || 'image/jpeg').trim();
        let resolvedMsgId = msgIdReq;
        let origenImagen = 'base64_directo';

        if (imageBase64Raw && imageBase64Raw.length >= 64) {
            imageBuffer = Buffer.from(imageBase64Raw, 'base64');
        } else {
            const extr = await whatsappAudioTranscriber.extraerImagenDeChatViaDevTools({
                chatId: chat.chat_id,
                msgId: msgIdReq
            });
            if (!extr || !extr.success || !extr.imageBuffer) {
                return res.status(422).json({
                    success: false,
                    error: extr?.message || extr?.error || 'No se pudo obtener la imagen desde WhatsApp Web (sesión no disponible o archivo expirado).'
                });
            }
            imageBuffer = extr.imageBuffer;
            mimeType = extr.mimeType || mimeType;
            resolvedMsgId = resolvedMsgId || extr.msgId || null;
            origenImagen = extr.origen || 'devtools';
        }

        const comprobante = await agenteHibridoLlm.leerComprobanteImagenConGemini({
            imageBuffer,
            mimeType,
            contextoCliente: chat.nombre_cliente_efectivo || chat.contacto_nombre || ''
        });

        let resumenMensaje = '';
        if (comprobante.es_comprobante_pago) {
            const partes = [];
            if (comprobante.banco) partes.push(comprobante.banco);
            if (comprobante.importe !== null && comprobante.importe !== undefined) {
                const impFmt = Number(comprobante.importe).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                partes.push(`$${impFmt}`);
            }
            if (comprobante.nro_operacion) partes.push(`Op. ${comprobante.nro_operacion}`);
            if (comprobante.fecha) partes.push(comprobante.fecha);
            if (comprobante.cuit_titular) partes.push(`CUIT ${comprobante.cuit_titular}`);
            resumenMensaje = `📷 Comprobante leído: ${partes.length > 0 ? partes.join(' · ') : (comprobante.resumen_corto || 'Transferencia')}`;
        } else {
            resumenMensaje = `📷 Imagen leída: ${comprobante.resumen_corto || comprobante.tipo_documento || 'Sin texto relevante'}`;
        }

        // Actualización no destructiva solo si existe la fila con texto genérico '📷 Imagen'
        let cuerpoActualizado = false;
        if (resolvedMsgId) {
            const rawShortId = String(resolvedMsgId).split('_').pop();
            const updRes = await pool.query(`
                UPDATE public.crm_whatsapp_mensajes
                SET cuerpo = $2
                WHERE (msg_id = $1 OR msg_id = $3)
                  AND (
                      COALESCE(TRIM(cuerpo), '') = ''
                      OR TRIM(cuerpo) = '📷 Imagen'
                      OR TRIM(cuerpo) LIKE '📷 Comprobante leído:%'
                      OR TRIM(cuerpo) LIKE '📷 Imagen leída:%'
                  )
                RETURNING id, msg_id, cuerpo
            `, [rawShortId, resumenMensaje, String(resolvedMsgId)]).catch(() => ({ rows: [] }));
            cuerpoActualizado = updRes.rows.length > 0;
        }

        res.json({
            success: true,
            msg_id: resolvedMsgId,
            origen: origenImagen,
            comprobante,
            resumen_mensaje: resumenMensaje,
            cuerpo_actualizado: cuerpoActualizado
        });
    } catch (error) {
        console.error('❌ [CRM-WA-HUB] Error en leer-imagen:', error.message);
        res.status(503).json({ success: false, error: error.message });
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
        const { mensajeTexto, borradorOriginalB1 } = req.body;

        if (!mensajeTexto || !String(mensajeTexto).trim()) {
            return res.status(400).json({ success: false, error: 'El mensaje no puede estar vacío.' });
        }

        const chatRes = await pool.query('SELECT * FROM public.crm_whatsapp_chats WHERE id = $1 LIMIT 1', [chatPk]);
        if (chatRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Chat no encontrado.' });
        }

        const chat = chatRes.rows[0];
        const response = await fetch('http://127.0.0.1:3004/facturacion/whatsapp/enviar-mensaje', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                destinatarios: chat.telefono_normalizado,
                mensajeTexto: String(mensajeTexto).trim()
            })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
            let detalleError = (Array.isArray(data.detalles) && data.detalles[0]?.error)
                ? data.detalles[0].error
                : (data.error || data.message || 'No se pudo enviar el mensaje por WhatsApp.');
            if (/No LID for user/i.test(detalleError)) {
                detalleError = `El número +${chat.telefono_normalizado} no tiene una cuenta de WhatsApp activa.`;
            }
            const safeStatus = [502, 503, 504].includes(response.status) ? 500 : (response.status || 500);
            return res.status(safeStatus).json({
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

        // Fase 3.5: Aprendizaje automático determinista de trato/apodo (0 tokens IA extra)
        const aprendizajeDetectado = await procesarAprendizajeTratoAlEnviarWa({
            chat,
            mensajeEnviado: String(mensajeTexto).trim(),
            borradorOriginalB1: String(borradorOriginalB1 || '')
        });

        res.json({
            success: true,
            message: 'Mensaje enviado correctamente.',
            aprendizaje_detectado: aprendizajeDetectado,
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

        const response = await fetch('http://127.0.0.1:3004/facturacion/whatsapp/enviar-mensaje', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                destinatarios: telLimpio,
                mensajeTexto: textoFinal
            })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
            let detalleError = (Array.isArray(data.detalles) && data.detalles[0]?.error)
                ? data.detalles[0].error
                : (data.error || data.message || 'No se pudo enviar el mensaje directo por WhatsApp.');
            if (/No LID for user/i.test(detalleError)) {
                detalleError = `El número +${telLimpio} no tiene una cuenta de WhatsApp activa.`;
            }
            const safeStatus = [502, 503, 504].includes(response.status) ? 500 : (response.status || 500);
            return res.status(safeStatus).json({
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

        const response = await fetch('http://127.0.0.1:3004/facturacion/whatsapp/enviar-documento', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                destinatarios,
                pdfBase64,
                filename: filename || 'Lista_de_Precios_LAMDA.pdf',
                mensajeTexto: mensajeTexto || '📄 Lista de Precios LAMDA'
            })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
            let detalleError = (Array.isArray(data.detalles) && data.detalles[0]?.error)
                ? data.detalles[0].error
                : (data.error || data.message || 'No se pudo enviar el documento PDF por WhatsApp.');
            const safeStatus = [502, 503, 504].includes(response.status) ? 500 : (response.status || 500);
            return res.status(safeStatus).json({
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
        fetch('http://127.0.0.1:3004/facturacion/whatsapp/sincronizar-chats', {
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
            categoria_contacto,
            etiqueta_crm,
            nota_rapida,
            bunker_cliente_id,
            contacto_nombre,
            contacto_cargo,
            desvincular_cliente,
            rol_operativo,
            apodo_preferido,
            nota_trato,
            descartar_apodo,
            frente_activo,
            nodo_captacion_activo,
            nodo_etapa,
            nodo_perfil,
            nodo_nota
        } = req.body;

        const chatRes = await pool.query('SELECT * FROM public.crm_whatsapp_chats WHERE id = $1 LIMIT 1', [chatPk]);
        if (chatRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Chat no encontrado' });
        }

        const actual = chatRes.rows[0];
        let nuevoModo = modo_privacidad !== undefined ? modo_privacidad : actual.modo_privacidad;
        let nuevoSilenciadoHasta = actual.silenciado_hasta;
        let nuevaCategoria = actual.categoria_contacto || 'SIN_CLASIFICAR';
        let nuevaCategoriaManual = Boolean(actual.categoria_manual);
        let nuevoEsperando = Boolean(actual.esperando_respuesta);
        let nuevoNoLeidos = parseInt(actual.no_leidos || 0, 10);

        const categoriasPermitidas = new Set(['CLIENTE_BUNKER', 'PROSPECTO', 'PROSPECTO_NODO', 'PROVEEDOR', 'PERSONAL', 'IGNORADO_BOT']);
        if (categoria_contacto !== undefined && categoriasPermitidas.has(String(categoria_contacto).toUpperCase())) {
            nuevaCategoria = String(categoria_contacto).toUpperCase();
            nuevaCategoriaManual = true;
            if (modo_privacidad === undefined) {
                if (nuevaCategoria === 'CLIENTE_BUNKER' || nuevaCategoria === 'PROSPECTO' || nuevaCategoria === 'PROSPECTO_NODO') {
                    nuevoModo = 'ACTIVO';
                    nuevoSilenciadoHasta = null;
                } else if (nuevaCategoria === 'PROVEEDOR') {
                    nuevoModo = 'SILENCIADO_PIZARRA';
                    nuevoSilenciadoHasta = null;
                } else if (nuevaCategoria === 'PERSONAL' || nuevaCategoria === 'IGNORADO_BOT') {
                    nuevoModo = 'OCULTO';
                    nuevoSilenciadoHasta = null;
                    nuevoEsperando = false;
                    nuevoNoLeidos = 0;
                }
            }
        } else if (modo_privacidad === 'OCULTO') {
            nuevaCategoria = 'PERSONAL';
            nuevaCategoriaManual = true;
            nuevoEsperando = false;
            nuevoNoLeidos = 0;
        }

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
            if (categoria_contacto === undefined && nuevaCategoria === 'CLIENTE_BUNKER') {
                nuevaCategoria = 'PERSONAL';
            }
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
                if (categoria_contacto === undefined) {
                    nuevaCategoria = 'CLIENTE_BUNKER';
                    nuevaCategoriaManual = true;
                    if (modo_privacidad === undefined && nuevoModo === 'OCULTO') {
                        nuevoModo = 'ACTIVO';
                    }
                }
            }
        }

        const nuevaEtiqueta = etiqueta_crm !== undefined ? (etiqueta_crm || null) : actual.etiqueta_crm;
        const nuevaNota = nota_rapida !== undefined ? nota_rapida : actual.nota_rapida;
        const nuevoContactoNombre = contacto_nombre !== undefined ? contacto_nombre : actual.contacto_nombre;
        const nuevoContactoCargo = contacto_cargo !== undefined ? contacto_cargo : actual.contacto_cargo;

        // Fase 3.5: Rol operativo + Apodo / Memoria de Trato
        let nuevoRolOperativo = actual.rol_operativo || null;
        let nuevoRolManual = Boolean(actual.rol_manual);
        let cambioRolOTrato = false;

        if (rol_operativo !== undefined) {
            const rolClean = rol_operativo ? String(rol_operativo).trim().toUpperCase() : null;
            if (rolClean && crmWhatsappDb.ROLES_OPERATIVOS_VALIDOS.has(rolClean)) {
                nuevoRolOperativo = rolClean;
                nuevoRolManual = true;
            } else {
                nuevoRolOperativo = null;
                nuevoRolManual = false;
            }
            cambioRolOTrato = true;
        }

        let nuevoApodoPref = actual.apodo_preferido || null;
        const memTratoActual = (actual.memoria_trato_json && typeof actual.memoria_trato_json === 'object')
            ? { ...actual.memoria_trato_json }
            : {};

        if (descartar_apodo === true) {
            const prevDesc = Array.isArray(memTratoActual.descartados) ? memTratoActual.descartados.slice() : [];
            if (actual.apodo_preferido && !prevDesc.some(d => normalizarTokenNombreWa(d) === normalizarTokenNombreWa(actual.apodo_preferido))) {
                prevDesc.push(String(actual.apodo_preferido).trim());
            }
            nuevoApodoPref = null;
            memTratoActual.apodo = '';
            memTratoActual.apodo_origen = 'descartado';
            memTratoActual.descartados = prevDesc.slice(-12);
            cambioRolOTrato = true;
        } else if (apodo_preferido !== undefined) {
            const cleanAp = String(apodo_preferido || '').trim().slice(0, 60);
            nuevoApodoPref = cleanAp || null;
            memTratoActual.apodo = cleanAp;
            memTratoActual.apodo_origen = cleanAp ? 'manual' : '';
            if (cleanAp && Array.isArray(memTratoActual.descartados)) {
                memTratoActual.descartados = memTratoActual.descartados.filter(
                    d => normalizarTokenNombreWa(d) !== normalizarTokenNombreWa(cleanAp)
                );
            }
            memTratoActual.detectado_en = new Date().toISOString();
            cambioRolOTrato = true;
        }

        if (nota_trato !== undefined) {
            memTratoActual.nota_trato = String(nota_trato || '').trim().slice(0, 240);
            cambioRolOTrato = true;
        }

        // Frente Captación de Nodos: frente_activo + nodo_captacion_json (aislado por chat)
        let nuevoFrenteActivo = String(actual.frente_activo || 'AUTO').trim().toUpperCase();
        if (!nodosCaptacionCrm.FRENTES_ACTIVOS_VALIDOS.has(nuevoFrenteActivo)) nuevoFrenteActivo = 'AUTO';
        const nodoCaptActual = (actual.nodo_captacion_json && typeof actual.nodo_captacion_json === 'object')
            ? { ...actual.nodo_captacion_json }
            : {};
        let cambioConfigNodos = false;

        if (frente_activo !== undefined) {
            const frClean = String(frente_activo || 'AUTO').trim().toUpperCase();
            if (nodosCaptacionCrm.FRENTES_ACTIVOS_VALIDOS.has(frClean)) {
                nuevoFrenteActivo = frClean;
                cambioConfigNodos = true;
            }
        }
        if (nuevaCategoria === 'PROSPECTO_NODO') {
            if (!nodoCaptActual.activo) {
                nodoCaptActual.activo = true;
                nodoCaptActual.etapa = nodoCaptActual.etapa || 'INVITACION_INICIAL';
                nodoCaptActual.origen = 'manual';
                cambioConfigNodos = true;
            }
            if (nuevoFrenteActivo === 'MAYORISTA') {
                nuevoFrenteActivo = 'NODOS';
                cambioConfigNodos = true;
            }
        }
        if (nodo_captacion_activo !== undefined) {
            const actBool = Boolean(nodo_captacion_activo);
            nodoCaptActual.activo = actBool;
            nodoCaptActual.origen = 'manual';
            if (actBool) {
                if (!nodoCaptActual.etapa) nodoCaptActual.etapa = 'INVITACION_INICIAL';
                if (frente_activo === undefined) nuevoFrenteActivo = 'NODOS';
                if (nuevoModo === 'OCULTO') nuevoModo = 'ACTIVO';
                if (!nuevoBunkerId && ['PERSONAL', 'SIN_CLASIFICAR'].includes(nuevaCategoria)) {
                    nuevaCategoria = 'PROSPECTO_NODO';
                    nuevaCategoriaManual = true;
                }
            } else if (frente_activo === undefined) {
                nuevoFrenteActivo = nuevoBunkerId ? 'MAYORISTA' : 'AUTO';
            }
            cambioConfigNodos = true;
        } else if (nuevoFrenteActivo === 'NODOS') {
            nodoCaptActual.activo = true;
            nodoCaptActual.origen = 'manual';
            if (!nodoCaptActual.etapa) nodoCaptActual.etapa = 'INVITACION_INICIAL';
            if (nuevoModo === 'OCULTO') nuevoModo = 'ACTIVO';
        } else if (nuevoFrenteActivo === 'MAYORISTA' && frente_activo !== undefined) {
            nodoCaptActual.activo = false;
        }
        if (nodo_etapa !== undefined) {
            const etClean = String(nodo_etapa || '').trim().toUpperCase();
            if (nodosCaptacionCrm.ETAPAS_CAPTACION_VALIDAS.has(etClean)) {
                nodoCaptActual.etapa = etClean;
                nodoCaptActual.activo = true;
                cambioConfigNodos = true;
            }
        }
        if (nodo_perfil !== undefined) {
            const pfClean = String(nodo_perfil || '').trim().toUpperCase();
            nodoCaptActual.perfil_sugerido = nodosCaptacionCrm.PERFILES_NODO_VALIDOS.has(pfClean) ? pfClean : '';
            cambioConfigNodos = true;
        }
        if (nodo_nota !== undefined) {
            nodoCaptActual.nota_nodos = String(nodo_nota || '').trim().slice(0, 320);
            cambioConfigNodos = true;
        }
        if (cambioConfigNodos || cambioRolOTrato) {
            nodoCaptActual.actualizado_en = new Date().toISOString();
            // Invalidar caché de razonamiento de Nodos para re-razonar con la nueva etapa/nota/frente
            delete nodoCaptActual.razonamiento_nodos_json;
            nodoCaptActual.ultimo_msg_id_razonado_nodos = 0;
        }

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
                categoria_contacto = $13,
                categoria_manual = $14,
                esperando_respuesta = $15,
                no_leidos = $16,
                rol_operativo = $17,
                rol_manual = $18,
                apodo_preferido = $19,
                memoria_trato_json = $20::jsonb,
                frente_activo = $21,
                nodo_captacion_json = $22::jsonb,
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
            nuevoContactoCargo,
            nuevaCategoria,
            nuevaCategoriaManual,
            nuevoEsperando,
            nuevoNoLeidos,
            nuevoRolOperativo,
            nuevoRolManual,
            nuevoApodoPref,
            JSON.stringify(memTratoActual),
            nuevoFrenteActivo,
            JSON.stringify(nodoCaptActual)
        ]);

        // Sincronizar rol_operativo bidireccionalmente con bunker_clientes.whatsapp_facturas
        let rolSincronizadoBunker = false;
        if (rol_operativo !== undefined && nuevoBunkerId && typeof crmWhatsappDb.sincronizarRolOperativoEnBunkerWhatsapp === 'function') {
            const syncRes = await crmWhatsappDb.sincronizarRolOperativoEnBunkerWhatsapp(
                nuevoBunkerId,
                actual.telefono_normalizado,
                nuevoRolOperativo
            );
            rolSincronizadoBunker = Boolean(syncRes?.sincronizado);
        }

        // Invalidar caché de razonamiento IA si cambió rol o trato/apodo
        if (cambioRolOTrato && nuevoBunkerId) {
            await pool.query(`
                UPDATE public.crm_cliente_sintesis_memoria
                SET razonamiento_ia_json = NULL,
                    ultimo_msg_id_razonado = 0,
                    ultima_actualizacion_en = NOW()
                WHERE cliente_bunker_id = $1
            `, [nuevoBunkerId]).catch(() => {});
        }

        // Si se marcó como PERSONAL / OCULTO, propagar aislamiento a todos los teléfonos hermanos de esa misma persona/ficha
        let propagados = 0;
        if (nuevaCategoria === 'PERSONAL' && typeof crmWhatsappDb.propagarCategoriaPersonalEnCliente === 'function') {
            propagados = await crmWhatsappDb.propagarCategoriaPersonalEnCliente({
                bunkerClienteId: nuevoBunkerId,
                clienteNombre: nuevoClienteNombre || '',
                contactoNombre: nuevoContactoNombre || '',
                pushnameWa: actual.pushname_wa || ''
            });
        } else if (typeof crmWhatsappDb.invalidarCacheCategoriasCrm === 'function') {
            crmWhatsappDb.invalidarCacheCategoriasCrm();
        }

        res.json({
            success: true,
            data: updRes.rows[0],
            propagados,
            rol_sincronizado_bunker: rolSincronizadoBunker
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
            const response = await fetch('http://127.0.0.1:3004/facturacion/whatsapp/sincronizar-chats', {
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
                   cuit_cuil, whatsapp_facturas, email_portal, email_portal_nombre, email_portal_cargo,
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

                // Traer las últimas 25 burbujas del chat (incluyendo media_filename para detectar PDFs de Propuesta Nodos)
                const ult25Res = await pool.query(`
                    SELECT id, msg_id, chat_id, from_me, cuerpo, tipo_mensaje, media_filename, ack, origen_envio, fecha_mensaje
                    FROM (
                        SELECT id, msg_id, chat_id, from_me, cuerpo, tipo_mensaje, media_filename, ack, origen_envio, fecha_mensaje
                        FROM public.crm_whatsapp_mensajes
                        WHERE chat_id = ANY($1)
                        ORDER BY fecha_mensaje DESC, id DESC
                        LIMIT 25
                    ) sub
                    ORDER BY fecha_mensaje ASC, id ASC
                `, [chatIdsUnificados]);
                mensajesRecientesChat = ult25Res.rows;

                // Si entre los últimos 10 mensajes hay algún audio (entrante o saliente de Martín) sin transcribir, transcribirlo antes de armar la respuesta
                const ult10Sint = mensajesRecientesChat.slice(-10);
                const audiosSinTrSint = ult10Sint.filter(m =>
                    (m.tipo_mensaje === 'ptt' || m.tipo_mensaje === 'audio') &&
                    (!m.cuerpo || String(m.cuerpo).trim() === '🎤 Mensaje de audio')
                );
                if (audiosSinTrSint.length > 0 && chatRow.chat_id) {
                    try {
                        const resTr = await Promise.race([
                            whatsappAudioTranscriber.transcribirAudiosDeChatViaDevTools({
                                chatId: chatRow.chat_id,
                                msgIds: audiosSinTrSint.map(m => m.msg_id).filter(Boolean),
                                maxAudios: 4,
                                incluirSalientes: true
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

        let chatRowPortal = null;
        if (chatId > 0) {
            try {
                const rChP = await pool.query(`
                    SELECT id, bunker_cliente_id, codigo_bunker_cliente, telefono_normalizado,
                           contacto_nombre, contacto_cargo, rol_operativo, apodo_preferido,
                           categoria_contacto, frente_activo, nodo_captacion_json
                    FROM public.crm_whatsapp_chats
                    WHERE id = $1
                    LIMIT 1
                `, [chatId]);
                if (rChP.rows.length > 0) chatRowPortal = rChP.rows[0];
            } catch (_) {}
        }

        const estadoPortalB2B = await resolverAccesoPortalParaChatWa({
            cli,
            chat: chatRowPortal,
            forzarNuevaInvitacion: false,
            asegurarTokenSiNoIngreso: true
        }).catch(() => null);

        // Evaluar contexto del frente Captación de Nodos para evitar servir caché mayorista viejo (ej. REACTIVACION_PORTAL)
        const detNodosSint = nodosCaptacionCrm.detectarContextoHiloNodosWa({
            mensajesRecientes: mensajesRecientesChat,
            categoriaContacto: chatRowPortal?.categoria_contacto || 'CLIENTE_BUNKER',
            frenteActivo: chatRowPortal?.frente_activo || 'AUTO',
            nodoCaptacionJson: chatRowPortal?.nodo_captacion_json || null,
            clienteNombre: cli.cliente_nombre || '',
            contactoNombre: chatRowPortal?.contacto_nombre || '',
            bunkerClienteId: clienteId
        });

        const ultimoMsgIdActual = mensajesRecientesChat.length > 0
            ? Number(mensajesRecientesChat[mensajesRecientesChat.length - 1].id || 0)
            : 0;
        let razonamientoIaGuardado = null;
        if (detNodosSint.esFrenteNodos) {
            // En frente Nodos usar EXCLUSIVAMENTE el caché aislado por chat (nunca el mayorista de crm_cliente_sintesis_memoria)
            const nodoJsonSint = (chatRowPortal?.nodo_captacion_json && typeof chatRowPortal.nodo_captacion_json === 'object')
                ? chatRowPortal.nodo_captacion_json
                : {};
            const razNodosRaw = nodoJsonSint.razonamiento_nodos_json || null;
            if (
                !forzarCompleta &&
                !huboCambios &&
                razNodosRaw &&
                razNodosRaw.usando_ia_real &&
                agenteHibridoLlm.esAgenteEspecialistaNodos(razNodosRaw.agente_utilizado) &&
                Number(nodoJsonSint.ultimo_msg_id_razonado_nodos || 0) === ultimoMsgIdActual &&
                ultimoMsgIdActual > 0
            ) {
                razonamientoIaGuardado = razNodosRaw;
            }
        } else {
            const razGuardadoRaw = existente?.razonamiento_ia_json || null;
            const coincideChatYPortal = !razGuardadoRaw ? false : (
                (!chatId || !razGuardadoRaw._chat_id_razonado || Number(razGuardadoRaw._chat_id_razonado) === Number(chatId)) &&
                (!estadoPortalB2B?.tipo_acceso_portal || !razGuardadoRaw._tipo_acceso_portal || razGuardadoRaw._tipo_acceso_portal === estadoPortalB2B.tipo_acceso_portal) &&
                !agenteHibridoLlm.esAgenteEspecialistaNodos(razGuardadoRaw.agente_utilizado)
            );
            razonamientoIaGuardado = (
                !forzarCompleta &&
                !huboCambios &&
                existente &&
                razGuardadoRaw &&
                razGuardadoRaw.usando_ia_real &&
                coincideChatYPortal &&
                Number(existente.ultimo_msg_id_razonado || 0) === ultimoMsgIdActual &&
                ultimoMsgIdActual > 0
            ) ? razGuardadoRaw : null;
        }

        const duracionMs = Date.now() - t0;
        res.json({
            success: true,
            modo_lectura: modoLectura,
            duracion_ms: duracionMs,
            version_sintesis: versionSintesis,
            novedades_incorporadas: novedadesIncorporadas,
            cliente_bunker_id: clienteId,
            codigo_bunker_cliente: cli.codigo_bunker_cliente,
            estado_portal_b2b: estadoPortalB2B,
            articulos_habituales: articulosHabitualesArr,
            ciclo_compra: cicloCompra,
            comportamiento_pago: compPago,
            contacto_hilo: chatId ? (contactosHilo[String(chatId)] || null) : null,
            mensajes_recientes: mensajesRecientesChat,
            contexto_nodos: detNodosSint,
            razonamiento_ia_guardado: razonamientoIaGuardado,
            ia_cognitiva: agenteHibridoLlm.obtenerModoCredencialGemini()
        });
    } catch (error) {
        console.error('❌ [CRM-SINTESIS-MEMORIA] Error en sintesis-hibrida:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/crm/whatsapp/clientes/:clienteId/preparar-invitacion-portal
 * Resuelve en vivo el acceso determinista al Portal B2B según el rol_operativo del chat (si se envía chatId):
 *   - TITULAR_ACTIVO / TITULAR_INVITACION_INICIAL para Dueño / Pagos / Compartido
 *   - ENCARGADO_ARMADOR_PEDIDO / ENCARGADO_ARMADOR_PENDIENTE para Compras / Recepción (jamás filtra link titular)
 */
router.post('/crm/whatsapp/clientes/:clienteId/preparar-invitacion-portal', async (req, res) => {
    try {
        const rawParam = String(req.params.clienteId || '').trim();
        if (!rawParam) {
            return res.status(400).json({ success: false, error: 'Identificador de cliente requerido.' });
        }
        const forzarNueva = Boolean(req.body?.forzarNueva);
        const chatIdReq = parseInt(req.body?.chatId || req.query?.chatId, 10) || 0;
        const bcRes = await pool.query(`
            SELECT id, cliente_nombre, razon_social, codigo_bunker_cliente, lomas_soft_id,
                   cuit_cuil, whatsapp_facturas, email_portal, email_portal_nombre, email_portal_cargo
            FROM public.bunker_clientes
            WHERE codigo_bunker_cliente = $1
               OR (CASE WHEN $1 ~ '^[0-9]+$' AND LENGTH($1) < 10 THEN id = $1::integer ELSE false END)
               OR lomas_soft_id = $1
            ORDER BY CASE WHEN codigo_bunker_cliente = $1 THEN 0 ELSE 1 END ASC
            LIMIT 1
        `, [rawParam]);

        if (bcRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Cliente no encontrado en Búnker.' });
        }

        let chatRow = null;
        if (chatIdReq > 0) {
            try {
                const rCh = await pool.query(`
                    SELECT id, bunker_cliente_id, codigo_bunker_cliente, telefono_normalizado,
                           contacto_nombre, contacto_cargo, rol_operativo, apodo_preferido
                    FROM public.crm_whatsapp_chats
                    WHERE id = $1
                    LIMIT 1
                `, [chatIdReq]);
                if (rCh.rows.length > 0) chatRow = rCh.rows[0];
            } catch (_) {}
        }

        const estadoPortal = await resolverAccesoPortalParaChatWa({
            cli: bcRes.rows[0],
            chat: chatRow,
            forzarNuevaInvitacion: forzarNueva,
            asegurarTokenSiNoIngreso: true,
            forzarRefrescoDelegaciones: Boolean(req.body?.forzarRefresco)
        });

        res.json({
            success: true,
            cliente_bunker_id: bcRes.rows[0].id,
            codigo_bunker_cliente: bcRes.rows[0].codigo_bunker_cliente,
            chat_id: chatIdReq || null,
            estado_portal_b2b: estadoPortal
        });
    } catch (error) {
        console.error('❌ [CRM-PORTAL-INV] Error preparando invitación de portal:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/crm/whatsapp/chats/:chatId/habilitar-armador-pedido
 * Habilita (crea o vincula) un enlace especial de Armador de Pre-Pedido (/#/pre-pedido?token=...)
 * para un empleado (COMPRAS_PEDIDOS / RECEPCION_LOCAL) sin login de titular ni acceso a Cuenta Corriente.
 * En Modo Laboratorio simula la operación en memoria local (0 escrituras en Supabase Cloud).
 */
router.post('/crm/whatsapp/chats/:chatId/habilitar-armador-pedido', async (req, res) => {
    try {
        const chatIdNum = parseInt(req.params.chatId, 10);
        if (!chatIdNum) {
            return res.status(400).json({ success: false, error: 'chatId inválido.' });
        }

        const chRes = await pool.query(`
            SELECT c.id, c.bunker_cliente_id, c.codigo_bunker_cliente, c.cliente_nombre,
                   c.telefono_normalizado, c.contacto_nombre, c.contacto_cargo, c.rol_operativo, c.apodo_preferido,
                   bc.razon_social, bc.lomas_soft_id, bc.ver_stock, bc.cuit_cuil, bc.whatsapp_facturas,
                   bc.email_portal, bc.email_portal_nombre, bc.email_portal_cargo
            FROM public.crm_whatsapp_chats c
            JOIN public.bunker_clientes bc ON bc.id = c.bunker_cliente_id
            WHERE c.id = $1
            LIMIT 1
        `, [chatIdNum]);

        if (chRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Chat no encontrado o no vinculado a un cliente Búnker.' });
        }

        const row = chRes.rows[0];
        const codBunker = String(row.codigo_bunker_cliente || '').trim();
        if (!codBunker) {
            return res.status(400).json({ success: false, error: 'El cliente no tiene codigo_bunker_cliente asignado.' });
        }

        const body = req.body || {};
        const modo = String(body.modo || 'CREAR_PERSONAL').trim().toUpperCase();
        const delegacionIdExistente = String(body.delegacion_id || '').trim();
        const nombreColaborador = String(body.nombre_colaborador || row.apodo_preferido || row.contacto_nombre || 'Operador').trim();
        const telColaborador = normalizarDigitosTelPortalWa(body.telefono_colaborador || row.telefono_normalizado);
        const aprobadorNombre = String(body.aprobador_nombre || 'Titular').trim();
        const aprobadorTelefono = normalizarDigitosTelPortalWa(body.aprobador_telefono || '');
        const mostrarPrecios = body.mostrar_precios !== false;
        const mostrarSinIva = Boolean(body.mostrar_sin_iva);
        const tipoEnlace = body.tipo_enlace === 'unico' ? 'unico' : 'permanente';

        if (!telColaborador || telColaborador.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'El contacto no tiene un número de teléfono válido para proteger el enlace de Armador.'
            });
        }

        // Obtener listas asignadas localmente (solo lectura)
        let listIds = [];
        try {
            const rListas = await pool.query(
                `SELECT bunker_lista_precio_id FROM public.bunker_cliente_listas_precios WHERE bunker_cliente_id = $1`,
                [row.bunker_cliente_id]
            );
            listIds = rListas.rows.map(r => parseInt(r.bunker_lista_precio_id, 10)).filter(n => !isNaN(n));
        } catch (_) {}
        if (listIds.length === 0) listIds = [1];

        const cloudBloqueadoPorLab = esModoLaboratorioOSandboxBloqueadoB2B();
        const nombreEmpresa = String(row.cliente_nombre || row.razon_social || codBunker).trim();

        if (cloudBloqueadoPorLab) {
            // MODO LABORATORIO: 100% simulado en memoria local (0 escrituras en Supabase Cloud)
            const store = obtenerStoreDelegacionesLabWa();
            const actuales = store.get(codBunker) ? [...store.get(codBunker)] : [];

            if ((modo === 'VINCULAR_EXISTENTE' || modo === 'REUTILIZAR_EXISTENTE') && delegacionIdExistente) {
                const idx = actuales.findIndex(d => String(d.id) === delegacionIdExistente);
                if (idx === -1) {
                    return res.status(404).json({ success: false, error: 'Delegación previa no encontrada en Laboratorio.' });
                }
                actuales[idx] = {
                    ...actuales[idx],
                    nombre_colaborador: nombreColaborador,
                    telefono_colaborador: telColaborador,
                    aprobador_nombre: aprobadorNombre || actuales[idx].aprobador_nombre || null,
                    aprobador_telefono: aprobadorTelefono || actuales[idx].aprobador_telefono || null,
                    mostrar_precios: mostrarPrecios,
                    mostrar_sin_iva: mostrarSinIva,
                    simulado_laboratorio: true,
                    updated_at: new Date().toISOString()
                };
                store.set(codBunker, actuales);
            } else {
                const tokenSim = crypto.randomBytes(16).toString('hex');
                const nuevaSim = {
                    id: `lab-sim-${tokenSim.slice(0, 12)}`,
                    cliente_id: codBunker,
                    token: tokenSim,
                    nombre_empresa: nombreEmpresa,
                    nombre_colaborador: nombreColaborador,
                    telefono_colaborador: telColaborador,
                    aprobador_nombre: aprobadorNombre || null,
                    aprobador_telefono: aprobadorTelefono || null,
                    mostrar_precios: mostrarPrecios,
                    mostrar_sin_iva: mostrarSinIva,
                    permitir_toggle_iva: true,
                    ver_stock: Boolean(row.ver_stock),
                    tipo_enlace: tipoEnlace,
                    listas_ids: listIds,
                    activo: true,
                    dispositivo_vinculado_hash: null,
                    dispositivo_vinculado_en: null,
                    expires_at: null,
                    created_at: new Date().toISOString(),
                    simulado_laboratorio: true
                };
                store.set(codBunker, [nuevaSim, ...actuales]);
            }

            const estadoNuevo = await resolverAccesoPortalParaChatWa({
                cli: { ...row, id: row.bunker_cliente_id },
                chat: row,
                forzarRefrescoDelegaciones: true
            });

            return res.json({
                success: true,
                simulado_laboratorio: true,
                modo,
                message: '🧪 Modo Laboratorio: link de Armador simulado localmente (0 escrituras en Supabase Cloud).',
                estado_portal_b2b: estadoNuevo
            });
        }

        // PRODUCCIÓN: escribir en Supabase clientes_b2b_delegaciones
        const supaUrl = String(process.env.SUPABASE_B2B_URL || '').trim().replace(/\/+$/, '');
        const supaKey = String(process.env.SUPABASE_B2B_SERVICE_KEY || '').trim();
        if (!supaUrl || !supaKey) {
            return res.status(503).json({ success: false, error: 'Credenciales de Supabase B2B no disponibles.' });
        }

        try {
            const listasNube = await sincronizarListasClienteEnNube(codBunker);
            if (Array.isArray(listasNube) && listasNube.length > 0) listIds = listasNube;
        } catch (_) {}

        if ((modo === 'VINCULAR_EXISTENTE' || modo === 'REUTILIZAR_EXISTENTE') && delegacionIdExistente) {
            const patchPayload = {
                nombre_colaborador: nombreColaborador,
                telefono_colaborador: telColaborador,
                aprobador_nombre: aprobadorNombre || null,
                aprobador_telefono: aprobadorTelefono || null,
                mostrar_precios: mostrarPrecios,
                mostrar_sin_iva: mostrarSinIva,
                listas_ids: listIds,
                updated_at: new Date().toISOString()
            };
            const rPatch = await fetch(
                `${supaUrl}/rest/v1/clientes_b2b_delegaciones?id=eq.${encodeURIComponent(delegacionIdExistente)}&cliente_id=eq.${encodeURIComponent(codBunker)}`,
                {
                    method: 'PATCH',
                    headers: {
                        apikey: supaKey,
                        Authorization: `Bearer ${supaKey}`,
                        'Content-Type': 'application/json',
                        Prefer: 'return=representation'
                    },
                    body: JSON.stringify(patchPayload)
                }
            );
            if (!rPatch.ok) {
                const errTxt = await rPatch.text().catch(() => '');
                throw new Error(`No se pudo vincular la delegación en Supabase (${rPatch.status}): ${errTxt.slice(0, 140)}`);
            }
        } else {
            const token = crypto.randomBytes(16).toString('hex');
            const insertPayload = {
                cliente_id: codBunker,
                token,
                nombre_empresa: nombreEmpresa,
                nombre_colaborador: nombreColaborador,
                telefono_colaborador: telColaborador,
                aprobador_nombre: aprobadorNombre || null,
                aprobador_telefono: aprobadorTelefono || null,
                mostrar_precios: mostrarPrecios,
                mostrar_sin_iva: mostrarSinIva,
                permitir_toggle_iva: true,
                ver_stock: Boolean(row.ver_stock),
                tipo_enlace: tipoEnlace,
                listas_ids: listIds,
                activo: true
            };
            const rPost = await fetch(`${supaUrl}/rest/v1/clientes_b2b_delegaciones`, {
                method: 'POST',
                headers: {
                    apikey: supaKey,
                    Authorization: `Bearer ${supaKey}`,
                    'Content-Type': 'application/json',
                    Prefer: 'return=representation'
                },
                body: JSON.stringify(insertPayload)
            });
            if (!rPost.ok) {
                const errTxt = await rPost.text().catch(() => '');
                throw new Error(`No se pudo crear la delegación en Supabase (${rPost.status}): ${errTxt.slice(0, 140)}`);
            }
        }

        _cacheDelegacionesB2B.delete(codBunker);
        const estadoNuevo = await resolverAccesoPortalParaChatWa({
            cli: { ...row, id: row.bunker_cliente_id },
            chat: row,
            forzarRefrescoDelegaciones: true
        });

        res.json({
            success: true,
            simulado_laboratorio: false,
            modo,
            message: 'Link de Armador de Pedido habilitado correctamente.',
            estado_portal_b2b: estadoNuevo
        });
    } catch (error) {
        console.error('❌ [CRM-ARMADOR] Error habilitando armador de pedido:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/crm/whatsapp/nodos/referencias
 * Retorna las tiendas reales de referencia (dominio oficial https://tienda.lamdaser.com/tienda/<slug>)
 * y el catálogo de etapas válidas de captación para la Consola CRM.
 */
router.get('/crm/whatsapp/nodos/referencias', async (req, res) => {
    try {
        const referencias = await nodosCaptacionCrm.obtenerReferenciasNodosActivos();
        res.json({
            success: true,
            dominio_oficial: nodosCaptacionCrm.DOMINIO_TIENDA_NODOS_OFICIAL,
            referencias,
            etapas: nodosCaptacionCrm.ETAPAS_CAPTACION_NODO
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/crm/whatsapp/asistente-hibrido/razonar
 * Fase 3 + Captación de Nodos: Ejecuta el Motor de 2 Carriles y 10 Agentes Especializados (Gemini 2.5 Flash)
 * enriquecido server-side con la Capa Determinista de LAMDA (CC + tramo_real, Logística real, Portal B2B por Rol,
 * o Base de Conocimiento de Nodos + Tiendas reales https://tienda.lamdaser.com/tienda/<slug>).
 */
router.post('/crm/whatsapp/asistente-hibrido/razonar', async (req, res) => {
    try {
        const body = req.body || {};
        let mensajesArr = Array.isArray(body.mensajesRecientes) ? body.mensajesRecientes.slice() : [];
        const cliIdNum = parseInt(body.clienteId, 10) || 0;
        const chatIdNum = parseInt(body.chatId, 10) || 0;
        const agenteObjNorm = String(body.agenteObjetivo || 'AUTO').trim().toUpperCase();
        const carrilReq = body.carril ? String(body.carril).trim().toUpperCase() : '';
        const instruccionOperador = String(body.instruccionOperador || '').trim();

        // Resolver deterministamente rol_operativo, trato, categoría, frente_activo y nodo_captacion_json desde crm_whatsapp_chats
        let rolOperativo = body.rolOperativo || null;
        let contactoCargo = body.contactoCargo || '';
        let apodoConfirmadoMartin = body.apodoConfirmadoMartin || '';
        let notaTrato = body.notaTrato || '';
        let otrosContactosCliente = Array.isArray(body.otrosContactosCliente) ? body.otrosContactosCliente : [];
        let chatRowDb = null;
        let cliRowDb = null;
        if (chatIdNum > 0) {
            try {
                const chMeta = await pool.query(`
                    SELECT id, chat_id, bunker_cliente_id, codigo_bunker_cliente, telefono_normalizado,
                           cliente_nombre, contacto_nombre, pushname_wa, rol_operativo, contacto_cargo,
                           apodo_preferido, memoria_trato_json, categoria_contacto, frente_activo, nodo_captacion_json
                    FROM public.crm_whatsapp_chats
                    WHERE id = $1
                    LIMIT 1
                `, [chatIdNum]);
                if (chMeta.rows.length > 0) {
                    const rowCh = chMeta.rows[0];
                    chatRowDb = rowCh;
                    if (!rolOperativo && rowCh.rol_operativo) rolOperativo = rowCh.rol_operativo;
                    if (!contactoCargo && rowCh.contacto_cargo) contactoCargo = rowCh.contacto_cargo;
                    if (!apodoConfirmadoMartin && rowCh.apodo_preferido) apodoConfirmadoMartin = rowCh.apodo_preferido;
                    if (!notaTrato && rowCh.memoria_trato_json?.nota_trato) notaTrato = rowCh.memoria_trato_json.nota_trato;
                    if (otrosContactosCliente.length === 0 && rowCh.bunker_cliente_id) {
                        const ocRes = await pool.query(`
                            SELECT id, contacto_nombre, contacto_cargo, rol_operativo, apodo_preferido, telefono_normalizado
                            FROM public.crm_whatsapp_chats
                            WHERE bunker_cliente_id = $1 AND id <> $2 AND COALESCE(modo_privacidad, 'ACTIVO') <> 'OCULTO'
                            LIMIT 8
                        `, [rowCh.bunker_cliente_id, chatIdNum]);
                        otrosContactosCliente = ocRes.rows;
                    }
                    // Si el frontend no envió mensajes o les falta media_filename, completar desde BD
                    if (rowCh.chat_id && (mensajesArr.length === 0 || mensajesArr.some(m => m && m.id && m.media_filename === undefined))) {
                        const mDbRes = await pool.query(`
                            SELECT id, msg_id, from_me, cuerpo, tipo_mensaje, media_filename, fecha_mensaje
                            FROM (
                                SELECT id, msg_id, from_me, cuerpo, tipo_mensaje, media_filename, fecha_mensaje
                                FROM public.crm_whatsapp_mensajes
                                WHERE chat_id = $1
                                ORDER BY fecha_mensaje DESC, id DESC
                                LIMIT 16
                            ) sub
                            ORDER BY fecha_mensaje ASC, id ASC
                        `, [rowCh.chat_id]);
                        if (mensajesArr.length === 0) {
                            mensajesArr = mDbRes.rows;
                        } else if (mDbRes.rows.length > 0) {
                            const mapFn = new Map(mDbRes.rows.map(r => [Number(r.id), r.media_filename]));
                            mensajesArr = mensajesArr.map(m => {
                                if (m && m.id && m.media_filename === undefined && mapFn.has(Number(m.id))) {
                                    return { ...m, media_filename: mapFn.get(Number(m.id)) };
                                }
                                return m;
                            });
                        }
                    }
                }
            } catch (_) {}
        }

        const effectiveCliId = cliIdNum || Number(chatRowDb?.bunker_cliente_id || 0);
        const categoriaEfectiva = String(body.categoriaContacto || chatRowDb?.categoria_contacto || (effectiveCliId > 0 ? 'CLIENTE_BUNKER' : 'PROSPECTO_NODO')).trim().toUpperCase();
        const frenteEfectivo = String(body.frenteActivo || chatRowDb?.frente_activo || 'AUTO').trim().toUpperCase();
        const nodoCaptacionEfectivo = (body.nodoCaptacionJson && typeof body.nodoCaptacionJson === 'object')
            ? body.nodoCaptacionJson
            : (chatRowDb?.nodo_captacion_json && typeof chatRowDb.nodo_captacion_json === 'object' ? chatRowDb.nodo_captacion_json : {});

        const detNodos = nodosCaptacionCrm.detectarContextoHiloNodosWa({
            mensajesRecientes: mensajesArr,
            categoriaContacto: categoriaEfectiva,
            frenteActivo: frenteEfectivo,
            nodoCaptacionJson: nodoCaptacionEfectivo,
            comprobanteLeido: body.comprobanteLeido || null,
            clienteNombre: body.clienteNombre || chatRowDb?.cliente_nombre || '',
            contactoNombre: body.contactoNombre || chatRowDb?.contacto_nombre || chatRowDb?.pushname_wa || '',
            bunkerClienteId: effectiveCliId || null
        });

        const correEspecialistaNodos = agenteHibridoLlm.esAgenteEspecialistaNodos(agenteObjNorm)
            || (agenteObjNorm === 'AUTO' && detNodos.esFrenteNodos);

        let nodosReferencia = null;
        let nodoExistenteContacto = null;
        if (correEspecialistaNodos) {
            nodosReferencia = await nodosCaptacionCrm.obtenerReferenciasNodosActivos().catch(() => nodosCaptacionCrm.REFERENCIAS_NODOS_FALLBACK);
            nodoExistenteContacto = await nodosCaptacionCrm.buscarNodoExistenteDeContacto({
                bunkerClienteId: effectiveCliId || null,
                telefonoNormalizado: chatRowDb?.telefono_normalizado || ''
            }).catch(() => null);
        }

        // Solo cargar ficha Búnker, Portal B2B y CC/Logística cuando NO estamos en especialista de Nodos
        let accesoPortal = null;
        let enriquecido = {
            estadoCuentaDeterminista: body.estadoCuentaDeterminista || {},
            contextoLogistico: body.contextoLogistico || null,
            diasSinCompra: body.diasSinCompra ?? null
        };
        if (!correEspecialistaNodos) {
            if (effectiveCliId > 0) {
                try {
                    const rCli = await pool.query(`
                        SELECT id, cliente_nombre, razon_social, codigo_bunker_cliente, lomas_soft_id,
                               cuit_cuil, whatsapp_facturas, email_portal, email_portal_nombre, email_portal_cargo
                        FROM public.bunker_clientes
                        WHERE id = $1
                        LIMIT 1
                    `, [effectiveCliId]);
                    if (rCli.rows.length > 0) cliRowDb = rCli.rows[0];
                } catch (_) {}
            }

            if (cliRowDb) {
                const chatParaPortal = chatRowDb
                    ? { ...chatRowDb, rol_operativo: rolOperativo || chatRowDb.rol_operativo }
                    : (rolOperativo ? { id: chatIdNum, rol_operativo: rolOperativo } : null);
                accesoPortal = await resolverAccesoPortalParaChatWa({
                    cli: cliRowDb,
                    chat: chatParaPortal,
                    otrosContactos: otrosContactosCliente,
                    forzarNuevaInvitacion: false,
                    asegurarTokenSiNoIngreso: false
                }).catch(() => null);
            }

            enriquecido = await enriquecerContextoDeterministaRazonamientoWa({
                clienteId: effectiveCliId,
                estadoCuentaBase: body.estadoCuentaDeterminista || {},
                contextoLogisticoBase: body.contextoLogistico || null,
                diasSinCompraBase: body.diasSinCompra ?? null
            });
        }

        const tipoAccesoPortal = correEspecialistaNodos
            ? 'NO_APLICA_NODO'
            : (accesoPortal?.tipo_acceso_portal
                || String(body.tipoAccesoPortal || '').trim().toUpperCase()
                || (Boolean(body.yaIngresoPortal) ? 'TITULAR_ACTIVO' : 'TITULAR_INVITACION_INICIAL'));
        const aprobadorNombrePortal = correEspecialistaNodos
            ? ''
            : (accesoPortal?.delegacion_armador?.aprobador_nombre
                || accesoPortal?.aprobador_sugerido?.nombre
                || String(body.aprobadorNombre || '').trim());
        const requiereValidacion4DigitosPortal = !correEspecialistaNodos && Boolean(accesoPortal?.delegacion_armador?.requiere_validacion_4_digitos);
        const linkPortalEfectivo = correEspecialistaNodos
            ? ''
            : (tipoAccesoPortal === 'ENCARGADO_ARMADOR_PEDIDO'
                ? (accesoPortal?.link_armador_pedido || '')
                : (tipoAccesoPortal === 'ENCARGADO_ARMADOR_PENDIENTE'
                    ? ''
                    : (accesoPortal?.link_invitacion_corto || accesoPortal?.link_portal_general || body.linkPortalCliente || '')));
        const yaIngresoPortalEfectivo = !correEspecialistaNodos && tipoAccesoPortal === 'TITULAR_ACTIVO';

        const esTelefonoCompartido = Boolean(body.esTelefonoCompartido || String(rolOperativo || '').toUpperCase() === 'COMPARTIDO');

        const resultado = await agenteHibridoLlm.razonarAsistenciaHibridaClienteWa({
            clienteNombre: body.clienteNombre || chatRowDb?.cliente_nombre || '',
            contactoNombre: body.contactoNombre || chatRowDb?.contacto_nombre || chatRowDb?.pushname_wa || '',
            apodoSugerido: apodoConfirmadoMartin || (esTelefonoCompartido ? '' : (body.apodoSugerido || '')),
            apodoConfirmadoMartin,
            notaTrato,
            rolOperativo,
            contactoCargo,
            esTelefonoCompartido,
            otrosContactosCliente,
            mensajesRecientes: mensajesArr,
            catalogoCompacto: correEspecialistaNodos ? [] : (Array.isArray(body.catalogoCompacto) ? body.catalogoCompacto : []),
            habitualesCliente: correEspecialistaNodos ? [] : (Array.isArray(body.habitualesCliente) ? body.habitualesCliente : []),
            estadoCuentaDeterminista: correEspecialistaNodos ? {} : enriquecido.estadoCuentaDeterminista,
            contextoLogistico: correEspecialistaNodos ? {} : enriquecido.contextoLogistico,
            comprobanteLeido: body.comprobanteLeido || null,
            diasSinCompra: correEspecialistaNodos ? null : enriquecido.diasSinCompra,
            linkPortalCliente: linkPortalEfectivo,
            yaIngresoPortal: yaIngresoPortalEfectivo,
            tipoAccesoPortal,
            aprobadorNombre: aprobadorNombrePortal,
            requiereValidacion4Digitos: requiereValidacion4DigitosPortal,
            carril: carrilReq,
            agenteObjetivo: agenteObjNorm,
            instruccionOperador,
            categoriaContacto: categoriaEfectiva,
            frenteActivo: frenteEfectivo,
            nodoCaptacionJson: nodoCaptacionEfectivo,
            bunkerClienteId: effectiveCliId || null,
            nodosReferencia,
            nodoExistenteContacto,
            contextoNodosPrecalculado: detNodos,
            forzarRecalculo: Boolean(body.forzarRecalculo)
        });

        if (resultado && typeof resultado === 'object') {
            resultado._chat_id_razonado = chatIdNum || null;
            resultado._tipo_acceso_portal = tipoAccesoPortal;
            resultado._frente_razonado = agenteHibridoLlm.esAgenteEspecialistaNodos(resultado.agente_utilizado) ? 'NODOS' : 'MAYORISTA';
        }

        // Persistencia aislada por frente:
        // - Si corrió especialista NODOS: cachea en crm_whatsapp_chats.nodo_captacion_json (clientes y NO-clientes, sin tocar memoria mayorista)
        // - Si corrió especialista MAYORISTA: mantiene comportamiento exacto en crm_cliente_sintesis_memoria
        const ultMsgId = mensajesArr.length > 0 ? Number(mensajesArr[mensajesArr.length - 1].id || 0) : 0;
        const esCorridaDefaultAuto = (agenteObjNorm === 'AUTO' || !agenteObjNorm) && !instruccionOperador && !body.comprobanteLeido;
        if (esCorridaDefaultAuto && resultado && resultado.usando_ia_real) {
            if (agenteHibridoLlm.esAgenteEspecialistaNodos(resultado.agente_utilizado)) {
                if (chatIdNum > 0) {
                    const nodoJsonUpd = {
                        ...nodoCaptacionEfectivo,
                        activo: true,
                        etapa: nodoCaptacionEfectivo.etapa || detNodos.etapaInferida || 'INVITACION_INICIAL',
                        perfil_sugerido: nodoCaptacionEfectivo.perfil_sugerido || detNodos.perfilInferido || '',
                        origen: nodoCaptacionEfectivo.origen || 'auto_hilo',
                        motivo_deteccion: detNodos.motivoDeteccion || nodoCaptacionEfectivo.motivo_deteccion || '',
                        razonamiento_nodos_json: resultado,
                        ultimo_msg_id_razonado_nodos: ultMsgId,
                        actualizado_en: new Date().toISOString()
                    };
                    await pool.query(`
                        UPDATE public.crm_whatsapp_chats
                        SET nodo_captacion_json = $2::jsonb,
                            updated_at = NOW()
                        WHERE id = $1
                    `, [chatIdNum, JSON.stringify(nodoJsonUpd)]).catch(() => {});
                }
            } else if (effectiveCliId > 0) {
                await asegurarTablaSintesisMemoriaCliente().catch(() => {});
                await pool.query(`
                    UPDATE public.crm_cliente_sintesis_memoria
                    SET razonamiento_ia_json = $1::jsonb,
                        ultimo_msg_id_razonado = $2,
                        ultima_actualizacion_en = NOW()
                    WHERE cliente_bunker_id = $3
                `, [JSON.stringify(resultado), ultMsgId, effectiveCliId]).catch(() => {});
            }
        }

        res.json({
            success: true,
            razonamiento: resultado,
            nodos_referencia: nodosReferencia || undefined,
            contexto_nodos: detNodos,
            contexto_determinista: {
                tramo_real: correEspecialistaNodos ? 'NO_APLICA_NODO' : (enriquecido.estadoCuentaDeterminista?.tramo_real || 'EN_TERMINO'),
                saldo_total: correEspecialistaNodos ? 0 : Number(enriquecido.estadoCuentaDeterminista?.saldo_total || 0),
                logistica_estado: correEspecialistaNodos ? 'NO_APLICA_NODO' : (enriquecido.contextoLogistico?.estado_normalizado || 'SIN_PEDIDO_ACTIVO'),
                dias_sin_compra: correEspecialistaNodos ? null : enriquecido.diasSinCompra,
                tipo_acceso_portal: tipoAccesoPortal,
                frente_efectivo: agenteHibridoLlm.esAgenteEspecialistaNodos(resultado?.agente_utilizado) ? 'NODOS' : 'MAYORISTA'
            }
        });
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
 * usando Gemini multimodal (imputado al módulo AUDIOS) para instruir al Asistente Híbrido.
 */
router.post('/crm/whatsapp/asistente-hibrido/transcribir-instruccion-voz', async (req, res) => {
    try {
        const { audioBase64, mimeType } = req.body || {};
        const cleanB64 = String(audioBase64 || '').replace(/^data:audio\/[^;]+;base64,/, '').trim();
        if (!cleanB64 || cleanB64.length < 32) {
            return res.status(400).json({ success: false, error: 'Audio de instrucción vacío o inválido.' });
        }
        const buf = Buffer.from(cleanB64, 'base64');
        const texto = await agenteHibridoLlm.transcribirAudioOggConGemini(buf, mimeType || 'audio/wav', 'Instrucción de voz operador');
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
