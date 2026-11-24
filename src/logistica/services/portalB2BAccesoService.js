/**
 * Servicio compartido para:
 *  1) Normalización y sanitización de contactos reales (WhatsApp y Email) + resolución de Destinatarios de Saldo.
 *  2) Cálculo determinista de Saldo Consolidado (100% alineado con el encabezado del PDF y Modo Sombra/Activo/Excluido).
 *  3) Detección fehaciente de primer ingreso al Portal B2B (sin falsos positivos de emails placeholder) y generación/reutilización
 *     de enlace corto de invitación a 7 días (168h) o acceso directo habitual, respetando blindajes de Modo Laboratorio.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
    parsearContactoWhatsapp,
    sincronizarListasClienteEnNube
} = require('./b2bDirectorySyncService');

const URL_PORTAL_B2B_FALLBACK = 'https://proud-darkness-ac3d.miserrano75.workers.dev';
const PROD_SUPABASE_ID_GUARD = 'zysyxtbcvgswancxtpib';

const EMAIL_PLACEHOLDER_DOMAINS = [
    '@lamdaclientes.com',
    '@b2b.lamdaser.com',
    '@lamda.com.ar'
];

const EMAIL_REGEX_SIMPLE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

let _cacheJsonEstadosPortalHistorico = null;
const _cacheAuthLoginB2B = new Map();
const CACHE_AUTH_TTL_MS = 5 * 60 * 1000;

function resolverUrlPortalB2BOficial() {
    const rawPortalEnv = String(process.env.B2B_PORTAL_URL || '').trim().replace(/\/+$/, '');
    if (!rawPortalEnv || rawPortalEnv.includes('127.0.0.1:59999') || rawPortalEnv.includes('localhost')) {
        return URL_PORTAL_B2B_FALLBACK;
    }
    return rawPortalEnv;
}

function esModoLaboratorioBloqueadoB2B() {
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

function leerMapaHistoricoPortalB2B() {
    if (_cacheJsonEstadosPortalHistorico) return _cacheJsonEstadosPortalHistorico;
    try {
        const jsonPath = path.resolve(__dirname, '../../app-etiquetas/js/b2b-estado-clientes.json');
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

function esEmailPlaceholderInterno(email) {
    const clean = String(email || '').trim().toLowerCase();
    if (!clean || clean === '[]' || clean === '{}') return true;
    if (!EMAIL_REGEX_SIMPLE.test(clean)) return true;
    return EMAIL_PLACEHOLDER_DOMAINS.some(dom => clean.endsWith(dom));
}

function sanitizarEmailReal(raw) {
    const clean = String(raw || '').trim().toLowerCase();
    if (!clean || esEmailPlaceholderInterno(clean)) return '';
    return clean;
}

function stripLocal15AR(digits) {
    if (digits.length === 12 && digits.startsWith('11') && digits.substring(2, 4) === '15') {
        return '11' + digits.substring(4);
    }
    if (digits.length === 12 && digits.substring(3, 5) === '15') {
        return digits.substring(0, 3) + digits.substring(5);
    }
    if (digits.length === 12 && digits.substring(4, 6) === '15') {
        return digits.substring(0, 4) + digits.substring(6);
    }
    return digits;
}

/**
 * Normaliza un número argentino a formato canónico de dígitos con prefijo 549 (ej: 5492216122330).
 */
function normalizarTelefonoCanonicoAR(raw) {
    let digits = String(raw || '').replace(/\D/g, '').trim();
    if (!digits) return '';

    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('540')) {
        digits = '549' + digits.slice(3);
    } else if (digits.startsWith('549')) {
        // Quitar eventual 0 o 15 después de 549
        let rest = digits.slice(3);
        if (rest.startsWith('0')) rest = rest.slice(1);
        rest = stripLocal15AR(rest);
        digits = '549' + rest;
    } else if (digits.startsWith('54') && digits.length >= 12) {
        let rest = digits.slice(2);
        if (rest.startsWith('0')) rest = rest.slice(1);
        rest = stripLocal15AR(rest);
        digits = '549' + rest;
    } else {
        if (digits.startsWith('0') && digits.length > 1) {
            digits = digits.slice(1);
        }
        digits = stripLocal15AR(digits);
        if (digits.length === 10) {
            digits = '549' + digits;
        }
    }

    return digits.length >= 8 ? digits : '';
}

function parsearListaWhatsappRaw(rawStr) {
    const val = String(rawStr || '').trim();
    if (!val) return [];
    let arr = [];
    if (val.startsWith('[')) {
        try {
            const parsed = JSON.parse(val);
            if (Array.isArray(parsed)) arr = parsed;
        } catch (_) {}
    } else {
        arr = val.split(',').map(n => ({ numero: n.trim(), nombre: '', cargo: '', default_factura: true, default_resumen: true }));
    }

    const seen = new Set();
    const out = [];
    for (const c of arr) {
        if (!c || typeof c !== 'object') continue;
        const numNorm = normalizarTelefonoCanonicoAR(c.numero);
        if (!numNorm || seen.has(numNorm)) continue;
        seen.add(numNorm);
        out.push({
            ...c,
            numero: numNorm,
            nombre: String(c.nombre || '').trim(),
            cargo: String(c.cargo || '').trim()
        });
    }
    return out;
}

function parsearListaEmailRaw(rawStr, clienteObj = null) {
    const val = String(rawStr || '').trim();
    let arr = [];
    if (val) {
        if (val.startsWith('[')) {
            try {
                const parsed = JSON.parse(val);
                if (Array.isArray(parsed)) arr = parsed;
            } catch (_) {}
        } else {
            arr = val.split(',').map(e => ({ email: e.trim(), nombre: '', cargo: '', default_factura: true }));
        }
    }

    const seen = new Set();
    const out = [];
    for (const e of arr) {
        if (!e || typeof e !== 'object') continue;
        const emClean = sanitizarEmailReal(e.email);
        if (!emClean || seen.has(emClean)) continue;
        seen.add(emClean);
        out.push({
            ...e,
            email: emClean,
            nombre: String(e.nombre || '').trim(),
            cargo: String(e.cargo || '').trim()
        });
    }

    // Fallback seguro a email_portal SOLO si es un email real (nunca @lamdaclientes.com ni malformado)
    if (out.length === 0 && clienteObj && clienteObj.email_portal) {
        const portalEmailReal = sanitizarEmailReal(clienteObj.email_portal);
        if (portalEmailReal && !seen.has(portalEmailReal)) {
            out.push({
                email: portalEmailReal,
                nombre: String(clienteObj.email_portal_nombre || clienteObj.cliente_nombre || '').trim(),
                cargo: String(clienteObj.email_portal_cargo || 'Portal B2B').trim(),
                default_factura: false,
                default_resumen: false,
                es_fallback_portal: true
            });
        }
    }

    return out;
}

function normalizarConfigDestinatariosSaldo(rawConfig) {
    if (!rawConfig || typeof rawConfig !== 'object') return null;
    if (rawConfig.configurado !== true) return null;

    const wps = Array.from(new Set(
        (Array.isArray(rawConfig.whatsapp) ? rawConfig.whatsapp : [])
            .map(normalizarTelefonoCanonicoAR)
            .filter(Boolean)
    ));
    const emails = Array.from(new Set(
        (Array.isArray(rawConfig.email) ? rawConfig.email : [])
            .map(sanitizarEmailReal)
            .filter(Boolean)
    ));

    return {
        configurado: true,
        whatsapp: wps,
        email: emails,
        actualizado_en: rawConfig.actualizado_en || null
    };
}

/**
 * Resuelve de forma determinista qué destinatarios corresponden para un Reporte de Saldo:
 *  1) Si existe destinatarios_saldo_config.configurado === true en BD -> usa exactamente esa selección (soporta Solo Email / Solo WA).
 *  2) Si no existe configuración explícita:
 *     - Si hay contactos con default_resumen === true (WA o Email reales) -> usa esos.
 *     - Si no hay marca de resumen y el cliente tiene exactamente 1 contacto real total -> lo sugiere automáticamente.
 *     - Si tiene múltiples contactos reales sin preferencia de resumen -> requiere_definicion = true (evita spammear todos).
 *     - Si no tiene contactos reales -> sin_contactos (requiere_definicion = true).
 */
function resolverDestinatariosSaldoCliente(clienteObj) {
    const contactosWp = parsearListaWhatsappRaw(clienteObj?.whatsapp_facturas);
    const contactosEmail = parsearListaEmailRaw(clienteObj?.email_facturas, clienteObj);

    const cfgGuardada = normalizarConfigDestinatariosSaldo(clienteObj?.destinatarios_saldo_config);
    if (cfgGuardada) {
        return {
            configurado_explicitamente: true,
            origen: 'guardado_db',
            whatsapp: cfgGuardada.whatsapp,
            email: cfgGuardada.email,
            requiere_definicion: false,
            solo_pdf: cfgGuardada.whatsapp.length === 0 && cfgGuardada.email.length === 0,
            total_contactos_disponibles: contactosWp.length + contactosEmail.length,
            contactos_wp_disponibles: contactosWp,
            contactos_email_disponibles: contactosEmail,
            actualizado_en: cfgGuardada.actualizado_en
        };
    }

    // Sin configuración explícita en destinatarios_saldo_config: revisar default_resumen === true
    const wpsResumen = contactosWp.filter(c => c.default_resumen === true).map(c => c.numero);
    const emailsResumen = contactosEmail.filter(e => e.default_resumen === true).map(e => e.email);

    if (wpsResumen.length > 0 || emailsResumen.length > 0) {
        return {
            configurado_explicitamente: false,
            origen: 'default_resumen',
            whatsapp: wpsResumen,
            email: emailsResumen,
            requiere_definicion: false,
            solo_pdf: false,
            total_contactos_disponibles: contactosWp.length + contactosEmail.length,
            contactos_wp_disponibles: contactosWp,
            contactos_email_disponibles: contactosEmail,
            actualizado_en: null
        };
    }

    const totalDisponibles = contactosWp.length + contactosEmail.length;
    if (totalDisponibles === 1) {
        return {
            configurado_explicitamente: false,
            origen: 'unico_contacto',
            whatsapp: contactosWp.map(c => c.numero),
            email: contactosEmail.map(e => e.email),
            requiere_definicion: false,
            solo_pdf: false,
            total_contactos_disponibles: 1,
            contactos_wp_disponibles: contactosWp,
            contactos_email_disponibles: contactosEmail,
            actualizado_en: null
        };
    }

    if (totalDisponibles > 1) {
        return {
            configurado_explicitamente: false,
            origen: 'multiple_sin_definir',
            whatsapp: [],
            email: [],
            requiere_definicion: true,
            solo_pdf: false,
            total_contactos_disponibles: totalDisponibles,
            contactos_wp_disponibles: contactosWp,
            contactos_email_disponibles: contactosEmail,
            actualizado_en: null
        };
    }

    return {
        configurado_explicitamente: false,
        origen: 'sin_contactos',
        whatsapp: [],
        email: [],
        requiere_definicion: true,
        solo_pdf: false,
        total_contactos_disponibles: 0,
        contactos_wp_disponibles: [],
        contactos_email_disponibles: [],
        actualizado_en: null
    };
}

/**
 * Formatea un importe en ARS (ej: "$ 1.167.318,34").
 */
function formatMontoAR(val) {
    const num = Math.abs(Number(val) || 0);
    const parts = num.toFixed(2).split('.');
    const formattedInt = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `$ ${formattedInt},${parts[1]}`;
}

/**
 * Calcula el Saldo Consolidado exacto con el mismo criterio del encabezado del PDF (generarPdfBuffer):
 *  - Modo ACTIVO con financiación > 0: saldoCapital + financiacion_total_con_iva (= saldo_total_proyectado_con_iva).
 *  - Modo SOMBRA / EXCLUIDO / ACTIVO sin interés devengado: saldoCapital exigible hoy (sin inflar por sombra).
 */
function calcularResumenSaldoConsolidado(cuentaObj, salvavidasInfo = null, detallarBalance = true) {
    const saldoCapital = parseFloat(Number(cuentaObj?.saldo || 0).toFixed(2));
    const modoSwitch = salvavidasInfo?.reglas_aplicadas?.modo_switch
        || (salvavidasInfo?.reglas_aplicadas?.habilitado === false ? 'EXCLUIDO' : 'ACTIVO');
    const esModoSombra = modoSwitch === 'SOMBRA';
    const tieneSalvavidasHabilitado = Boolean(
        detallarBalance &&
        salvavidasInfo &&
        salvavidasInfo.reglas_aplicadas &&
        salvavidasInfo.reglas_aplicadas.habilitado &&
        modoSwitch !== 'EXCLUIDO'
    );

    const finCalcConIva = parseFloat(Number(
        salvavidasInfo?.financiacion_calculada_con_iva ?? salvavidasInfo?.financiacion_total_con_iva ?? 0
    ).toFixed(2));
    const finActivaConIvaRaw = Number(salvavidasInfo?.financiacion_total_con_iva || 0);
    const tieneFinanciacionActiva = Boolean(tieneSalvavidasHabilitado && !esModoSombra && finActivaConIvaRaw > 0.005);
    const tieneFinanciacionSombra = Boolean(tieneSalvavidasHabilitado && esModoSombra && finCalcConIva > 0.005);

    const financiacionActivaConIva = tieneFinanciacionActiva
        ? parseFloat(finActivaConIvaRaw.toFixed(2))
        : 0;
    const saldoConsolidado = tieneFinanciacionActiva
        ? parseFloat(Number(salvavidasInfo?.saldo_total_proyectado_con_iva ?? (saldoCapital + financiacionActivaConIva)).toFixed(2))
        : saldoCapital;

    let estado = 'AL_DIA';
    if (saldoConsolidado > 0.005) estado = 'DEUDOR';
    else if (saldoConsolidado < -0.005) estado = 'A_FAVOR';

    return {
        saldoCapital,
        saldoConsolidado,
        financiacionActivaConIva,
        financiacionSombraConIva: tieneFinanciacionSombra ? finCalcConIva : 0,
        tieneFinanciacionActiva,
        tieneFinanciacionSombra,
        modoSwitch,
        esModoSombra,
        estado,
        saldoCapitalFmt: formatMontoAR(saldoCapital),
        saldoConsolidadoFmt: formatMontoAR(saldoConsolidado),
        financiacionActivaFmt: formatMontoAR(financiacionActivaConIva)
    };
}

/**
 * Determina sin falsos positivos si el cliente YA ingresó al Portal B2B o si NUNCA ingresó,
 * y devuelve el link oficial (directo o invitación corta válida 7 días / 168h).
 *
 * IMPORTANTE:
 *  - Jamás borra ni blanquea usuarios existentes en Supabase Auth.
 *  - En Modo Laboratorio (LAMDA_MODO_LABORATORIO=true / etiquetas_pruebas) jamás contacta a Supabase Cloud.
 */
async function resolverAccesoPortalCliente(
    cliRow,
    { asegurarInvitacion = false, horasVigencia = 168, horasMinReutilizar = 48 } = {},
    dbPool
) {
    const portalUrl = resolverUrlPortalB2BOficial();
    const codBunker = String(cliRow?.codigo_bunker_cliente || '').trim();

    if (!codBunker) {
        return {
            ya_ingreso: true,
            modo: 'ACCESO_DIRECTO',
            url_portal: portalUrl,
            url_final: portalUrl,
            codigo_activacion: '',
            token: '',
            expires_at: null,
            vigencia_horas: null,
            reutilizada: false,
            se_generara_al_enviar: false
        };
    }

    const mapaHist = leerMapaHistoricoPortalB2B();
    const histCli = mapaHist[codBunker] || null;
    const cloudBloqueadoPorLab = esModoLaboratorioBloqueadoB2B();

    let invLocalUsada = false;
    let operoEnPortalLocal = false;
    let ultimoIngresoIso = histCli?.ultimo_ingreso || null;
    let emailRegistrado = sanitizarEmailReal(histCli?.email_registrado) || '';

    // 1. Señal local: invitación ya marcada usada en portal_invitaciones
    if (dbPool) {
        try {
            const invUsadaRes = await dbPool.query(
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

        // 2. Señal local: pedidos / presupuestos operados desde Portal B2B
        const lomasIdStr = String(cliRow?.lomas_soft_id || '').trim();
        if (lomasIdStr && /^\d+$/.test(lomasIdStr)) {
            try {
                const presPortalRes = await dbPool.query(`
                    SELECT MAX(fecha) AS ult_fecha
                    FROM public.presupuestos
                    WHERE NULLIF(regexp_replace(id_cliente::text, '^0+', ''), '')::integer = $1
                      AND (agente = 'Portal B2B' OR modificado_portal = true)
                `, [parseInt(lomasIdStr, 10)]);
                if (presPortalRes.rows[0]?.ult_fecha) {
                    operoEnPortalLocal = true;
                    if (!ultimoIngresoIso) {
                        ultimoIngresoIso = new Date(presPortalRes.rows[0].ult_fecha).toISOString();
                    }
                }
            } catch (_) {}
        }
    }

    // 3. Señal cloud en Producción (nunca en Modo Laboratorio): Auth last_sign_in_at + perfiles reales + telemetría
    let tienePerfilSupabaseActivo = false;
    const supaUrl = String(process.env.SUPABASE_B2B_URL || '').trim().replace(/\/+$/, '');
    const supaKey = String(process.env.SUPABASE_B2B_SERVICE_KEY || '').trim();

    if (!cloudBloqueadoPorLab && supaUrl && supaKey) {
        const cachedAuth = _cacheAuthLoginB2B.get(codBunker);
        if (cachedAuth && (Date.now() - cachedAuth.ts < CACHE_AUTH_TTL_MS)) {
            tienePerfilSupabaseActivo = cachedAuth.activo;
            if (cachedAuth.emailReal) emailRegistrado = cachedAuth.emailReal;
            if (cachedAuth.ultimoIngreso) ultimoIngresoIso = cachedAuth.ultimoIngreso;
        } else {
            const ctrlSupa = new AbortController();
            const timerSupa = setTimeout(() => ctrlSupa.abort(), 3000);
            try {
                const [respProf, respTelem] = await Promise.allSettled([
                    fetch(`${supaUrl}/rest/v1/clientes_b2b_perfiles?cliente_id=eq.${encodeURIComponent(codBunker)}&select=id,email,updated_at&limit=1`, {
                        headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` },
                        signal: ctrlSupa.signal
                    }),
                    fetch(`${supaUrl}/rest/v1/telemetria_accesos?cliente_nombre=eq.${encodeURIComponent(codBunker)}&select=id,created_at&order=id.desc&limit=1`, {
                        headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` },
                        signal: ctrlSupa.signal
                    })
                ]);

                let emailRealDetectado = '';
                let lastSignInReal = null;

                if (respTelem.status === 'fulfilled' && respTelem.value.ok) {
                    const telemRows = await respTelem.value.json().catch(() => []);
                    if (Array.isArray(telemRows) && telemRows.length > 0) {
                        tienePerfilSupabaseActivo = true;
                        if (!ultimoIngresoIso && telemRows[0].created_at) {
                            ultimoIngresoIso = telemRows[0].created_at;
                        }
                    }
                }

                if (respProf.status === 'fulfilled' && respProf.value.ok) {
                    const profRows = await respProf.value.json().catch(() => []);
                    if (Array.isArray(profRows) && profRows.length > 0) {
                        const prof = profRows[0];
                        const esPlaceholder = esEmailPlaceholderInterno(prof.email);
                        if (!esPlaceholder) {
                            emailRealDetectado = sanitizarEmailReal(prof.email);
                        }

                        if (prof.id) {
                            try {
                                const respAuth = await fetch(`${supaUrl}/auth/v1/admin/users/${encodeURIComponent(prof.id)}`, {
                                    headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` },
                                    signal: ctrlSupa.signal
                                });
                                if (respAuth.ok) {
                                    const authData = await respAuth.json().catch(() => null);
                                    const authUser = authData?.user || authData;
                                    if (authUser?.last_sign_in_at) {
                                        lastSignInReal = authUser.last_sign_in_at;
                                    }
                                    const authMailReal = sanitizarEmailReal(authUser?.email);
                                    if (authMailReal) emailRealDetectado = authMailReal;
                                }
                            } catch (_) {}
                        }

                        if (lastSignInReal) {
                            tienePerfilSupabaseActivo = true;
                            ultimoIngresoIso = lastSignInReal;
                        } else if (!esPlaceholder && emailRealDetectado) {
                            tienePerfilSupabaseActivo = true;
                            if (!ultimoIngresoIso && prof.updated_at) {
                                ultimoIngresoIso = prof.updated_at;
                            }
                        }
                    }
                }

                if (emailRealDetectado) emailRegistrado = emailRealDetectado;

                _cacheAuthLoginB2B.set(codBunker, {
                    ts: Date.now(),
                    activo: tienePerfilSupabaseActivo,
                    emailReal: emailRealDetectado,
                    ultimoIngreso: ultimoIngresoIso
                });
            } catch (_) {
                // Continuar con señales locales si falla red
            } finally {
                clearTimeout(timerSupa);
            }
        }
    }

    const histIngresoValido = Boolean(
        histCli?.ya_ingreso === true && (
            histCli?.ultimo_ingreso ||
            Boolean(sanitizarEmailReal(histCli?.email_registrado))
        )
    );

    const yaIngreso = Boolean(
        tienePerfilSupabaseActivo ||
        invLocalUsada ||
        operoEnPortalLocal ||
        (cloudBloqueadoPorLab && histIngresoValido)
    );

    if (yaIngreso) {
        return {
            ya_ingreso: true,
            modo: 'ACCESO_DIRECTO',
            url_portal: portalUrl,
            url_final: portalUrl,
            codigo_activacion: '',
            token: '',
            expires_at: null,
            vigencia_horas: null,
            ultimo_ingreso: ultimoIngresoIso,
            email_registrado: emailRegistrado,
            reutilizada: false,
            se_generara_al_enviar: false
        };
    }

    // Cliente NUNCA ingresó -> buscar invitación vigente con al menos `horasMinReutilizar` (48h) restantes
    let tokenActivo = '';
    let expiresAt = null;
    let reutilizada = false;

    if (dbPool) {
        try {
            const vigRes = await dbPool.query(`
                SELECT token, expires_at
                FROM public.portal_invitaciones
                WHERE cliente_id = $1
                  AND usado = false
                  AND LENGTH(token) = 64
                  AND token ~ '^[0-9a-fA-F]+$'
                  AND expires_at > (NOW() + ($2::integer * INTERVAL '1 hour'))
                ORDER BY expires_at DESC, id DESC
                LIMIT 1
            `, [codBunker, Math.max(1, Number(horasMinReutilizar) || 48)]);

            if (vigRes.rows.length > 0) {
                tokenActivo = String(vigRes.rows[0].token).trim();
                expiresAt = new Date(vigRes.rows[0].expires_at);
                reutilizada = true;
            }
        } catch (_) {}
    }

    let seGeneraraAlEnviar = false;
    if (!tokenActivo) {
        if (asegurarInvitacion) {
            tokenActivo = crypto.randomBytes(32).toString('hex');
            expiresAt = new Date(Date.now() + (Number(horasVigencia) || 168) * 3600 * 1000);
            if (dbPool) {
                try {
                    await dbPool.query(
                        `INSERT INTO public.portal_invitaciones (token, cliente_id, expires_at, usado)
                         VALUES ($1, $2, $3, false)`,
                        [tokenActivo, codBunker, expiresAt]
                    );
                } catch (errIns) {
                    console.warn('⚠️ [PORTAL-B2B-ACCESO] Error insertando portal_invitaciones local:', errIns.message);
                }
            }
        } else {
            seGeneraraAlEnviar = true;
        }
    }

    // Sincronizar invitación activa en Supabase Cloud SOLO en Producción (cero tráfico cloud en Laboratorio)
    if (asegurarInvitacion && tokenActivo && !cloudBloqueadoPorLab && supaUrl && supaKey) {
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
            const cleanPortalMail = sanitizarEmailReal(cliRow?.email_portal);

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
                    expires_at: (expiresAt || new Date(Date.now() + 168 * 3600 * 1000)).toISOString(),
                    usado: false,
                    razon_social: cliRow?.razon_social || cliRow?.cliente_nombre || codBunker,
                    email_portal: cleanPortalMail,
                    email_portal_nombre: nombreContactoInferido,
                    email_portal_cargo: metadataCargoJson
                })
            }).catch(() => {});
        } catch (_) {}
    }

    const codigoActivacion = tokenActivo ? tokenActivo.slice(0, 6) : '';
    const urlFinal = codigoActivacion ? `${portalUrl}/?t=${codigoActivacion}` : portalUrl;

    return {
        ya_ingreso: false,
        modo: 'INVITACION_INICIAL',
        url_portal: portalUrl,
        url_final: urlFinal,
        codigo_activacion: codigoActivacion,
        token: tokenActivo,
        expires_at: expiresAt ? expiresAt.toISOString() : null,
        vigencia_horas: Number(horasVigencia) || 168,
        ultimo_ingreso: null,
        email_registrado: emailRegistrado,
        reutilizada,
        se_generara_al_enviar: seGeneraraAlEnviar
    };
}

/**
 * Construye el cuerpo estándar de WhatsApp para Reporte de Saldo (masivo e individual):
 *  - Saldo Consolidado explícito y coherente al centavo con el PDF.
 *  - Bloque inteligente de Portal B2B (Invitación 7 días si nunca ingresó vs. Link directo si ya ingresó).
 */
function construirMensajeWhatsappSaldo({ saldoInfo, portalInfo, esChequeReciente = false }) {
    const intro = esChequeReciente
        ? 'Te adjunto en PDF el comprobante de validación de cheque y el resumen de tu cuenta corriente.'
        : 'Te adjunto el resumen actualizado de tu cuenta corriente en PDF.';

    let lineaSaldo = '';
    if (saldoInfo) {
        if (saldoInfo.estado === 'DEUDOR') {
            if (saldoInfo.tieneFinanciacionActiva) {
                lineaSaldo = `💰 *Saldo consolidado actual:* *${saldoInfo.saldoConsolidadoFmt}* _(Capital: ${saldoInfo.saldoCapitalFmt} + Financiación c/IVA: ${saldoInfo.financiacionActivaFmt})_`;
            } else {
                lineaSaldo = `💰 *Saldo consolidado actual:* *${saldoInfo.saldoConsolidadoFmt}*`;
            }
        } else if (saldoInfo.estado === 'A_FAVOR') {
            lineaSaldo = `💰 *Saldo consolidado actual:* *${saldoInfo.saldoConsolidadoFmt} a favor*`;
        } else {
            lineaSaldo = `💰 *Saldo consolidado actual:* *$ 0,00 (Al día)*`;
        }
    }

    const portalUrlFinal = portalInfo?.url_final || resolverUrlPortalB2BOficial();
    let bloquePortal = '';
    if (portalInfo && portalInfo.modo === 'INVITACION_INICIAL' && portalInfo.codigo_activacion) {
        bloquePortal = [
            `✨ *Te invitamos a activar tu acceso al Portal de Pedidos y Precios* (consultá precios al día y armá tus pedidos desde el celular):`,
            `🔑 Código de activación: *${portalInfo.codigo_activacion}*`,
            `👉 Activá tu primer ingreso acá (válido 7 días): ${portalUrlFinal}`
        ].join('\n');
    } else {
        bloquePortal = `🌐 *Portal de pedidos y precios:* ${portalUrlFinal}`;
    }

    return [intro, lineaSaldo, bloquePortal, 'Cualquier duda avisame!']
        .filter(Boolean)
        .join('\n\n');
}

/**
 * Construye el bloque HTML institucional de Portal B2B para insertar en el cuerpo del Email.
 */
function construirBloquePortalEmailHtml(portalInfo) {
    const urlFinal = portalInfo?.url_final || resolverUrlPortalB2BOficial();
    if (portalInfo && portalInfo.modo === 'INVITACION_INICIAL' && portalInfo.codigo_activacion) {
        return `
        <div style="margin: 22px 0; padding: 18px 20px; border: 1px solid #c4b5fd; border-left: 4px solid #7c3aed; border-radius: 10px; background: linear-gradient(135deg, #faf5ff 0%, #f5f3ff 100%);">
            <div style="font-size: 13px; font-weight: 700; color: #5b21b6; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 6px;">
                ✨ ¡Te invitamos al Portal de Pedidos y Precios LAMDA!
            </div>
            <p style="margin: 0 0 12px 0; font-size: 13.5px; color: #334155; line-height: 1.5;">
                Activá tu acceso por primera vez sin complicaciones para consultar precios actualizados en vivo y armar tus pedidos online en segundos.
            </p>
            <div style="margin-bottom: 14px; font-size: 13px; color: #1e293b;">
                🔑 Código de activación personal: <strong style="background: #ede9fe; color: #5b21b6; padding: 3px 8px; border-radius: 5px; font-family: monospace; font-size: 14px;">${portalInfo.codigo_activacion}</strong>
                <span style="font-size: 11.5px; color: #64748b; margin-left: 6px;">(válido por 7 días)</span>
            </div>
            <div style="margin-bottom: 10px;">
                <a href="${urlFinal}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #7c3aed; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 13.5px; padding: 10px 20px; border-radius: 7px;">
                    🚀 Activar mi acceso al Portal B2B
                </a>
            </div>
            <div style="font-size: 11.5px; color: #64748b; word-break: break-all;">
                Si el botón no abre, copiá este enlace en tu navegador: <a href="${urlFinal}" style="color: #7c3aed;">${urlFinal}</a>
            </div>
        </div>
        `;
    }

    return `
    <div style="margin: 22px 0; padding: 16px 20px; border: 1px solid #cbd5e1; border-left: 4px solid #4f46e5; border-radius: 10px; background-color: #f8fafc;">
        <div style="font-size: 13px; font-weight: 700; color: #312e81; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 6px;">
            🌐 Portal de Pedidos y Precios LAMDA
        </div>
        <p style="margin: 0 0 12px 0; font-size: 13.5px; color: #475569; line-height: 1.5;">
            Consultá tu lista de precios actualizada y cargá tus próximos pedidos directamente desde tu cuenta del Portal:
        </p>
        <div style="margin-bottom: 8px;">
            <a href="${urlFinal}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #4f46e5; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 13.5px; padding: 9px 18px; border-radius: 7px;">
                Ingresar al Portal de Pedidos y Precios
            </a>
        </div>
        <div style="font-size: 11.5px; color: #64748b; word-break: break-all;">
            Enlace directo: <a href="${urlFinal}" style="color: #4f46e5;">${urlFinal}</a>
        </div>
    </div>
    `;
}

module.exports = {
    URL_PORTAL_B2B_FALLBACK,
    resolverUrlPortalB2BOficial,
    esModoLaboratorioBloqueadoB2B,
    esEmailPlaceholderInterno,
    sanitizarEmailReal,
    normalizarTelefonoCanonicoAR,
    parsearListaWhatsappRaw,
    parsearListaEmailRaw,
    normalizarConfigDestinatariosSaldo,
    resolverDestinatariosSaldoCliente,
    formatMontoAR,
    calcularResumenSaldoConsolidado,
    resolverAccesoPortalCliente,
    construirMensajeWhatsappSaldo,
    construirBloquePortalEmailHtml
};
