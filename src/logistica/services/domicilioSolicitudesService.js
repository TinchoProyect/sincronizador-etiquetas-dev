'use strict';

const crypto = require('crypto');
const QRCode = require('qrcode');
const { pool, ejecutarTransaccion } = require('../config/database');
const DomiciliosModel = require('../models/domiciliosModel');
const { autoAsignarDomicilios } = require('../models/presupuestosModel');

const VIGENCIA_DIAS_DEFAULT = 7;
const MAX_PENDIENTES_POR_CLIENTE = 3;

function esModoLaboratorio() {
    const dbName = String(process.env.DB_NAME || '').trim().toLowerCase();
    const flagLab = String(process.env.LAMDA_MODO_LABORATORIO || process.env.MODO_LABORATORIO || '').trim().toLowerCase();
    return dbName === 'etiquetas_pruebas' || flagLab === 'true' || flagLab === '1';
}

function resolverBaseUrlPublica(req = null) {
    if (esModoLaboratorio() && req) {
        const host = String((req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '').trim();
        const proto = String((req.headers && req.headers['x-forwarded-proto']) || req.protocol || 'http').split(',')[0].trim();
        if (host && /^(localhost|127\.0\.0\.1|192\.168\.|10\.|100\.)/i.test(host)) {
            return `${proto}://${host}`;
        }
    }
    if (esModoLaboratorio()) {
        return `http://localhost:${process.env.LOGISTICA_PORT || process.env.PORT_LOGISTICA || 3005}`;
    }
    return String(process.env.LAMDA_CLOUD_PUBLIC_URL || process.env.PUBLIC_BASE_URL || 'https://logistica.lamdaser.com').replace(/\/+$/, '');
}

function construirUrlPublicaDomicilio(token, req = null) {
    const cleanToken = String(token || '').trim();
    if (!cleanToken) return '';
    return `${resolverBaseUrlPublica(req)}/mi-domicilio/${cleanToken}`;
}

function parsearListaContactosJson(rawValue, tipo = 'whatsapp') {
    if (!rawValue) return [];
    const keyCampo = tipo === 'email' ? 'email' : 'numero';
    const validarValor = (val) => {
        const s = String(val || '').trim();
        if (!s || s === '[]' || s === '{}') return '';
        if (tipo === 'email') return s.includes('@') ? s.toLowerCase() : '';
        return s.replace(/\D/g, '').length >= 6 ? s : '';
    };

    if (Array.isArray(rawValue)) {
        return rawValue
            .map((item) => {
                if (typeof item === 'string') {
                    const v = validarValor(item);
                    return v ? { [keyCampo]: v, nombre: '', cargo: '' } : null;
                }
                if (item && typeof item === 'object') {
                    const v = validarValor(item[keyCampo] || item.telefono || item.celular || item.value);
                    return v ? { ...item, [keyCampo]: v } : null;
                }
                return null;
            })
            .filter(Boolean);
    }

    const rawStr = String(rawValue).trim();
    if (!rawStr || rawStr === '[]' || rawStr === '{}' || rawStr.toLowerCase() === 'null') return [];

    if (rawStr.startsWith('[') || rawStr.startsWith('{')) {
        try {
            const parsed = JSON.parse(rawStr);
            if (Array.isArray(parsed)) return parsearListaContactosJson(parsed, tipo);
            if (parsed && typeof parsed === 'object') return parsearListaContactosJson([parsed], tipo);
        } catch (_) {}
    }

    return rawStr
        .split(/[,;]+/)
        .map((s) => validarValor(s))
        .filter(Boolean)
        .map((v) => ({ [keyCampo]: v, nombre: '', cargo: '' }));
}

function esEmailPlaceholder(email) {
    const e = String(email || '').trim().toLowerCase();
    return !e || e.endsWith('@lamdaclientes.com') || e.endsWith('@b2b.lamdaser.com') || e.endsWith('@lamda.com.ar');
}

function esTokenValidoFormato(token) {
    return /^[a-f0-9-]{16,80}$/i.test(String(token || '').trim());
}

function sanitizarHora(val) {
    const s = String(val || '').trim();
    if (!s) return null;
    const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
    if (!m) return null;
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function componerDireccionDesdePayload(p = {}) {
    const calle = String(p.calle || '').trim();
    const numero = p.sin_numero ? '' : String(p.numero || '').trim();
    const entre = String(p.entre_calles || '').trim();
    const piso = String(p.piso_depto || '').trim();
    const dirRaw = String(p.direccion || '').trim();

    if (calle) {
        let base = calle;
        if (numero) {
            base += ` N° ${numero}`;
        } else if (p.sin_numero && !/\bS\/N\b/i.test(base)) {
            base += ' S/N';
        }
        if (entre) base += ` e/ ${entre}`;
        if (piso) base += ` (${piso})`;
        return base.trim();
    }
    return dirRaw;
}

class DomicilioSolicitudesService {
    static async expirarSolicitudesVencidas(dbClient = null) {
        const db = dbClient || pool;
        await db.query(`
            UPDATE public.clientes_domicilios_solicitudes
            SET estado = 'EXPIRADA', updated_at = NOW()
            WHERE estado = 'PENDIENTE'
              AND expires_at <= NOW()
        `);
    }

    static async resolverClienteBunker(clienteIdentifier, dbClient = null) {
        const db = dbClient || pool;
        const ident = await DomiciliosModel.resolverIdentidadCliente(clienteIdentifier);
        if (!ident.bunkerClienteId) return null;
        const res = await db.query(
            `SELECT id, codigo_bunker_cliente, cliente_nombre, razon_social, lomas_soft_id,
                    whatsapp_facturas, email_facturas, email_portal, email_portal_nombre, email_portal_cargo
             FROM public.bunker_clientes
             WHERE id = $1
             LIMIT 1`,
            [ident.bunkerClienteId]
        );
        return res.rows[0] || null;
    }

    static async obtenerContactosCliente(bunkerClienteId, dbClient = null) {
        const db = dbClient || pool;
        const resCli = await db.query(
            `SELECT id, codigo_bunker_cliente, cliente_nombre, whatsapp_facturas, email_facturas,
                    email_portal, email_portal_nombre, email_portal_cargo
             FROM public.bunker_clientes
             WHERE id = $1
             LIMIT 1`,
            [bunkerClienteId]
        );
        if (resCli.rowCount === 0) return { contactos_whatsapp: [], contactos_email: [] };

        const cli = resCli.rows[0];
        const fuentes = [cli];

        // Contemplar Cuenta Madre Unificada si este cliente es nodo con usar_cuenta_madre_unificada
        try {
            const resMadre = await db.query(
                `SELECT bc_m.id, bc_m.codigo_bunker_cliente, bc_m.cliente_nombre, bc_m.whatsapp_facturas,
                        bc_m.email_facturas, bc_m.email_portal, bc_m.email_portal_nombre, bc_m.email_portal_cargo
                 FROM public.nodos_maestro nm
                 JOIN public.bunker_clientes bc_m ON bc_m.id = nm.cliente_madre_bunker_id
                 WHERE nm.bunker_cliente_id = $1
                   AND COALESCE(nm.usar_cuenta_madre_unificada, false) = true
                 LIMIT 1`,
                [bunkerClienteId]
            );
            if (resMadre.rowCount > 0) fuentes.push(resMadre.rows[0]);
        } catch (_) {}

        const waMap = new Map();
        const emailMap = new Map();

        for (const f of fuentes) {
            for (const w of parsearListaContactosJson(f.whatsapp_facturas, 'whatsapp')) {
                const digits = String(w.numero || '').replace(/\D/g, '');
                if (digits.length >= 6 && !waMap.has(digits)) {
                    waMap.set(digits, { ...w, numero: w.numero });
                }
            }
            for (const em of parsearListaContactosJson(f.email_facturas, 'email')) {
                const mail = String(em.email || '').trim().toLowerCase();
                if (mail && !esEmailPlaceholder(mail) && !emailMap.has(mail)) {
                    emailMap.set(mail, { ...em, email: mail });
                }
            }
            const portalMail = String(f.email_portal || '').trim().toLowerCase();
            if (portalMail && !esEmailPlaceholder(portalMail) && !emailMap.has(portalMail)) {
                emailMap.set(portalMail, {
                    email: portalMail,
                    nombre: f.email_portal_nombre || f.cliente_nombre || '',
                    cargo: f.email_portal_cargo || 'Portal B2B'
                });
            }
        }

        return {
            contactos_whatsapp: Array.from(waMap.values()),
            contactos_email: Array.from(emailMap.values())
        };
    }

    static async crearSolicitud({
        cliente_id,
        modo = 'ALTA_NUEVA',
        domicilio_objetivo_id = null,
        marcar_predeterminado = false,
        nota_operador = null,
        vigencia_dias = VIGENCIA_DIAS_DEFAULT,
        creado_por = 'Operador LAMDA',
        req = null
    }) {
        const cli = await this.resolverClienteBunker(cliente_id);
        if (!cli) {
            const err = new Error('Cliente Búnker no encontrado.');
            err.statusCode = 404;
            throw err;
        }

        const modoNorm = String(modo || 'ALTA_NUEVA').trim().toUpperCase();
        if (!['ALTA_NUEVA', 'ACTUALIZAR_EXISTENTE'].includes(modoNorm)) {
            const err = new Error('Modo de solicitud inválido.');
            err.statusCode = 400;
            throw err;
        }

        await this.expirarSolicitudesVencidas();

        let domObjetivoId = null;
        if (modoNorm === 'ACTUALIZAR_EXISTENTE') {
            domObjetivoId = parseInt(domicilio_objetivo_id, 10);
            if (!Number.isFinite(domObjetivoId)) {
                const err = new Error('Debe indicar el domicilio objetivo a actualizar.');
                err.statusCode = 400;
                throw err;
            }
            const domExistente = await DomiciliosModel.obtenerPorId(domObjetivoId);
            const domsCliente = await DomiciliosModel.obtenerTodos({ id_cliente: cli.id, activo: true });
            if (!domExistente || !domsCliente.some(d => Number(d.id) === domObjetivoId)) {
                const err = new Error('El domicilio seleccionado no pertenece al cliente o está inactivo.');
                err.statusCode = 404;
                throw err;
            }
        }

        const pendientesRes = await pool.query(
            `SELECT id, token_publico, expires_at, created_at
             FROM public.clientes_domicilios_solicitudes
             WHERE bunker_cliente_id = $1 AND estado = 'PENDIENTE'
             ORDER BY created_at DESC`,
            [cli.id]
        );
        if (pendientesRes.rowCount >= MAX_PENDIENTES_POR_CLIENTE) {
            const err = new Error(`Ya existen ${MAX_PENDIENTES_POR_CLIENTE} enlaces pendientes activos para este cliente. Revocá alguno antes de generar uno nuevo.`);
            err.statusCode = 409;
            err.code = 'MAX_PENDIENTES_ALCANZADO';
            throw err;
        }

        const tokenPublico = crypto.randomBytes(24).toString('hex');
        const dias = Math.max(1, Math.min(30, parseInt(vigencia_dias, 10) || VIGENCIA_DIAS_DEFAULT));
        const nombreSnapshot = String(cli.cliente_nombre || cli.razon_social || cli.codigo_bunker_cliente).trim();

        const insertRes = await pool.query(
            `INSERT INTO public.clientes_domicilios_solicitudes (
                token_publico, bunker_cliente_id, codigo_bunker_cliente, cliente_nombre_snapshot,
                modo, domicilio_objetivo_id, marcar_predeterminado, estado, nota_operador,
                creado_por, expires_at, created_at, updated_at
             ) VALUES (
                $1, $2, $3, $4,
                $5, $6, $7, 'PENDIENTE', $8,
                $9, NOW() + ($10::int * INTERVAL '1 day'), NOW(), NOW()
             )
             RETURNING *`,
            [
                tokenPublico,
                cli.id,
                cli.codigo_bunker_cliente,
                nombreSnapshot,
                modoNorm,
                domObjetivoId,
                Boolean(marcar_predeterminado),
                nota_operador ? String(nota_operador).trim() : null,
                creado_por || 'Operador LAMDA',
                dias
            ]
        );

        const solicitud = insertRes.rows[0];
        const urlPublica = construirUrlPublicaDomicilio(solicitud.token_publico, req);
        const qrDataUrl = await QRCode.toDataURL(urlPublica, { width: 320, margin: 2, errorCorrectionLevel: 'M' });
        const contactos = await this.obtenerContactosCliente(cli.id);

        return {
            solicitud: {
                ...solicitud,
                url_publica: urlPublica,
                qr_data_url: qrDataUrl
            },
            url_publica: urlPublica,
            qr_data_url: qrDataUrl,
            cliente: {
                id: cli.id,
                codigo_bunker_cliente: cli.codigo_bunker_cliente,
                cliente_nombre: nombreSnapshot,
                ...contactos
            }
        };
    }

    static async listarSolicitudesPorCliente(clienteIdentifier, req = null) {
        const cli = await this.resolverClienteBunker(clienteIdentifier);
        if (!cli) {
            return { cliente: null, solicitudes: [] };
        }
        await this.expirarSolicitudesVencidas();

        const res = await pool.query(
            `SELECT s.*,
                    cd_obj.alias AS domicilio_objetivo_alias,
                    cd_cre.alias AS domicilio_creado_alias,
                    cd_cre.direccion AS domicilio_creado_direccion
             FROM public.clientes_domicilios_solicitudes s
             LEFT JOIN public.clientes_domicilios cd_obj ON cd_obj.id = s.domicilio_objetivo_id
             LEFT JOIN public.clientes_domicilios cd_cre ON cd_cre.id = s.domicilio_creado_id
             WHERE s.bunker_cliente_id = $1
             ORDER BY (s.estado = 'PENDIENTE') DESC, s.created_at DESC
             LIMIT 12`,
            [cli.id]
        );

        const contactos = await this.obtenerContactosCliente(cli.id);
        const solicitudes = [];
        for (const row of res.rows) {
            const urlPublica = construirUrlPublicaDomicilio(row.token_publico, req);
            let qrDataUrl = null;
            if (row.estado === 'PENDIENTE') {
                try {
                    qrDataUrl = await QRCode.toDataURL(urlPublica, { width: 300, margin: 2, errorCorrectionLevel: 'M' });
                } catch (_) {}
            }
            solicitudes.push({
                ...row,
                url_publica: urlPublica,
                qr_data_url: qrDataUrl
            });
        }

        return {
            cliente: {
                id: cli.id,
                codigo_bunker_cliente: cli.codigo_bunker_cliente,
                cliente_nombre: cli.cliente_nombre || cli.razon_social,
                ...contactos
            },
            solicitudes
        };
    }

    static async revocarSolicitud(solicitudId, operador = 'Operador LAMDA') {
        const idNum = parseInt(solicitudId, 10);
        if (!Number.isFinite(idNum)) {
            const err = new Error('ID de solicitud inválido.');
            err.statusCode = 400;
            throw err;
        }
        const res = await pool.query(
            `UPDATE public.clientes_domicilios_solicitudes
             SET estado = 'REVOCADA',
                 revocada_at = NOW(),
                 revocada_por = $2,
                 updated_at = NOW()
             WHERE id = $1 AND estado = 'PENDIENTE'
             RETURNING *`,
            [idNum, operador]
        );
        if (res.rowCount === 0) {
            const prev = await pool.query('SELECT id, estado FROM public.clientes_domicilios_solicitudes WHERE id = $1', [idNum]);
            if (prev.rowCount === 0) {
                const err = new Error('Solicitud no encontrada.');
                err.statusCode = 404;
                throw err;
            }
            const err = new Error(`La solicitud ya está en estado ${prev.rows[0].estado} y no puede revocarse.`);
            err.statusCode = 409;
            throw err;
        }
        return res.rows[0];
    }

    static async obtenerSolicitudPublicaPorToken(token) {
        const cleanToken = String(token || '').trim();
        if (!esTokenValidoFormato(cleanToken)) {
            return { ok: false, status: 400, code: 'TOKEN_INVALIDO', error: 'El enlace ingresado no es válido.' };
        }

        await this.expirarSolicitudesVencidas();

        const res = await pool.query(
            `SELECT s.*,
                    bc.cliente_nombre AS bc_nombre,
                    bc.razon_social AS bc_razon_social
             FROM public.clientes_domicilios_solicitudes s
             JOIN public.bunker_clientes bc ON bc.id = s.bunker_cliente_id
             WHERE s.token_publico = $1
             LIMIT 1`,
            [cleanToken]
        );

        if (res.rowCount === 0) {
            return { ok: false, status: 404, code: 'NO_ENCONTRADO', error: 'Este enlace no existe o ya no está disponible.' };
        }

        const sol = res.rows[0];
        const clienteNombre = String(sol.cliente_nombre_snapshot || sol.bc_nombre || sol.bc_razon_social || 'Cliente').trim();

        // Solo exponer los alias (sin direcciones sensibles ni saldos ni CUIT)
        const domsActivos = await DomiciliosModel.obtenerTodos({ id_cliente: sol.bunker_cliente_id, activo: true });
        const aliasExistentes = domsActivos
            .map(d => String(d.alias || '').trim())
            .filter(Boolean);

        let domicilioObjetivo = null;
        if (sol.modo === 'ACTUALIZAR_EXISTENTE' && sol.domicilio_objetivo_id) {
            const dObj = await DomiciliosModel.obtenerPorId(sol.domicilio_objetivo_id);
            if (dObj) {
                domicilioObjetivo = {
                    alias: dObj.alias || '',
                    tipo_lugar: dObj.tipo_lugar || '',
                    direccion: dObj.direccion || '',
                    localidad: dObj.localidad || '',
                    provincia: dObj.provincia || 'Buenos Aires',
                    codigo_postal: dObj.codigo_postal || '',
                    latitud: dObj.latitud !== null && dObj.latitud !== undefined ? Number(dObj.latitud) : null,
                    longitud: dObj.longitud !== null && dObj.longitud !== undefined ? Number(dObj.longitud) : null,
                    horario_atencion_desde: dObj.horario_atencion_desde ? String(dObj.horario_atencion_desde).slice(0, 5) : '',
                    horario_atencion_hasta: dObj.horario_atencion_hasta ? String(dObj.horario_atencion_hasta).slice(0, 5) : '',
                    instrucciones_entrega: dObj.instrucciones_entrega || '',
                    telefono_contacto: dObj.telefono_contacto || ''
                };
            }
        }

        let comprobante = null;
        if (sol.estado === 'COMPLETADA') {
            const domIdComprobante = sol.domicilio_creado_id || sol.domicilio_objetivo_id;
            const dCre = domIdComprobante ? await DomiciliosModel.obtenerPorId(domIdComprobante) : null;
            comprobante = dCre ? {
                alias: dCre.alias,
                tipo_lugar: dCre.tipo_lugar,
                direccion: dCre.direccion,
                localidad: dCre.localidad,
                provincia: dCre.provincia,
                horario_atencion_desde: dCre.horario_atencion_desde ? String(dCre.horario_atencion_desde).slice(0, 5) : null,
                horario_atencion_hasta: dCre.horario_atencion_hasta ? String(dCre.horario_atencion_hasta).slice(0, 5) : null,
                instrucciones_entrega: dCre.instrucciones_entrega,
                latitud: dCre.latitud !== null && dCre.latitud !== undefined ? Number(dCre.latitud) : null,
                longitud: dCre.longitud !== null && dCre.longitud !== undefined ? Number(dCre.longitud) : null,
                verificado_at: sol.usado_at || dCre.fecha_verificacion_cliente
            } : { verificado_at: sol.usado_at };
        }

        return {
            ok: true,
            solicitud: {
                id: sol.id,
                estado: sol.estado,
                modo: sol.modo,
                expires_at: sol.expires_at,
                nota_operador: sol.nota_operador || null,
                cliente_nombre: clienteNombre,
                alias_existentes: aliasExistentes,
                domicilio_objetivo: domicilioObjetivo,
                comprobante
            }
        };
    }

    static async confirmarSolicitudPublica(token, payload = {}, metaReq = {}) {
        const cleanToken = String(token || '').trim();
        if (!esTokenValidoFormato(cleanToken)) {
            return { ok: false, status: 400, code: 'TOKEN_INVALIDO', error: 'Enlace inválido.' };
        }

        const alias = String(payload.alias || '').trim();
        const tipoLugar = String(payload.tipo_lugar || '').trim() || null;
        const calle = String(payload.calle || '').trim();
        const numero = payload.sin_numero ? '' : String(payload.numero || '').trim();
        const entreCalles = String(payload.entre_calles || '').trim();
        const pisoDepto = String(payload.piso_depto || '').trim();
        const localidad = String(payload.localidad || '').trim();
        const provincia = String(payload.provincia || 'Buenos Aires').trim() || 'Buenos Aires';
        const codigoPostal = String(payload.codigo_postal || '').trim() || null;
        const telefonoContacto = String(payload.telefono_contacto || '').trim() || null;
        const instruccionesEntrega = String(payload.instrucciones_entrega || '').trim() || null;
        const horarioDesde = sanitizarHora(payload.horario_atencion_desde);
        const horarioHasta = sanitizarHora(payload.horario_atencion_hasta);

        const direccionFinal = componerDireccionDesdePayload({
            calle,
            numero,
            sin_numero: Boolean(payload.sin_numero),
            entre_calles: entreCalles,
            piso_depto: pisoDepto,
            direccion: payload.direccion
        });

        if (!alias) {
            return { ok: false, status: 400, code: 'ALIAS_REQUERIDO', error: 'Ingresá un nombre o alias para identificar el lugar.' };
        }
        if (!direccionFinal || direccionFinal.length < 3) {
            return { ok: false, status: 400, code: 'DIRECCION_REQUERIDA', error: 'Completá la calle y dirección de entrega.' };
        }
        if (!localidad) {
            return { ok: false, status: 400, code: 'LOCALIDAD_REQUERIDA', error: 'Indicá la localidad o barrio de entrega.' };
        }

        const hasLat = payload.latitud !== undefined && payload.latitud !== null && String(payload.latitud).trim() !== '';
        const hasLng = payload.longitud !== undefined && payload.longitud !== null && String(payload.longitud).trim() !== '';
        let latNum = null;
        let lngNum = null;
        if (hasLat || hasLng) {
            latNum = parseFloat(payload.latitud);
            lngNum = parseFloat(payload.longitud);
            if (!DomiciliosModel.validarCoordenadasArgentina(latNum, lngNum)) {
                return {
                    ok: false,
                    status: 400,
                    code: 'COORDENADAS_FUERA_RANGO',
                    error: 'El punto marcado en el mapa está fuera de Argentina. Ajustá el pin sobre tu domicilio.'
                };
            }
            latNum = Number(latNum.toFixed(7));
            lngNum = Number(lngNum.toFixed(7));
        }

        const precisionRaw = parseInt(payload.gps_precision_metros, 10);
        const precisionMetros = Number.isFinite(precisionRaw) && precisionRaw >= 0 && precisionRaw <= 50000 ? precisionRaw : null;

        const resultadoTx = await ejecutarTransaccion(async (client) => {
            const lockRes = await client.query(
                `SELECT *
                 FROM public.clientes_domicilios_solicitudes
                 WHERE token_publico = $1
                 FOR UPDATE`,
                [cleanToken]
            );

            if (lockRes.rowCount === 0) {
                return { ok: false, status: 404, code: 'NO_ENCONTRADO', error: 'El enlace solicitado no existe.' };
            }

            const sol = lockRes.rows[0];

            if (sol.estado === 'COMPLETADA') {
                return {
                    ok: false,
                    status: 409,
                    code: 'YA_COMPLETADA',
                    error: 'Este enlace ya fue utilizado y el domicilio quedó registrado.'
                };
            }
            if (sol.estado === 'REVOCADA') {
                return {
                    ok: false,
                    status: 410,
                    code: 'REVOCADA',
                    error: 'Este enlace fue deshabilitado por el equipo de LAMDA.'
                };
            }
            if (sol.estado === 'EXPIRADA' || new Date(sol.expires_at).getTime() <= Date.now()) {
                await client.query(
                    `UPDATE public.clientes_domicilios_solicitudes SET estado = 'EXPIRADA', updated_at = NOW() WHERE id = $1`,
                    [sol.id]
                );
                return {
                    ok: false,
                    status: 410,
                    code: 'EXPIRADA',
                    error: 'Este enlace venció (7 días). Pedile un nuevo enlace a tu vendedor o por WhatsApp.'
                };
            }

            const ident = await DomiciliosModel.resolverIdentidadCliente(sol.bunker_cliente_id);
            if (!ident.bunkerClienteId) {
                return { ok: false, status: 404, code: 'CLIENTE_NO_ENCONTRADO', error: 'El cliente asociado ya no existe.' };
            }

            let domicilioGuardado;
            if (sol.modo === 'ACTUALIZAR_EXISTENTE' && sol.domicilio_objetivo_id) {
                const existenteRes = await client.query(
                    `SELECT id, es_predeterminado FROM public.clientes_domicilios WHERE id = $1 AND activo = TRUE`,
                    [sol.domicilio_objetivo_id]
                );
                if (existenteRes.rowCount === 0) {
                    return { ok: false, status: 404, code: 'DOMICILIO_OBJETIVO_NO_EXISTE', error: 'El domicilio a actualizar ya no está activo.' };
                }
                domicilioGuardado = await DomiciliosModel.actualizar(sol.domicilio_objetivo_id, {
                    alias,
                    tipo_lugar: tipoLugar,
                    direccion: direccionFinal,
                    localidad,
                    provincia,
                    codigo_postal: codigoPostal,
                    latitud: latNum,
                    longitud: lngNum,
                    coordenadas_validadas: Boolean(latNum !== null && lngNum !== null),
                    es_predeterminado: sol.marcar_predeterminado ? true : existenteRes.rows[0].es_predeterminado,
                    telefono_contacto: telefonoContacto,
                    instrucciones_entrega: instruccionesEntrega,
                    horario_atencion_desde: horarioDesde,
                    horario_atencion_hasta: horarioHasta,
                    origen_carga: 'AUTOGESTION_CLIENTE',
                    verificado_por_cliente: true,
                    fecha_verificacion_cliente: new Date().toISOString(),
                    solicitud_id: sol.id,
                    gps_precision_metros: precisionMetros
                }, client);
            } else {
                const filtro = DomiciliosModel._construirFiltroClienteSql(ident, 1);
                let activos = 0;
                if (filtro.clause !== '1=0') {
                    const cntRes = await client.query(
                        `SELECT COUNT(*)::int AS cnt FROM public.clientes_domicilios cd WHERE ${filtro.clause} AND cd.activo = TRUE`,
                        filtro.params
                    );
                    activos = cntRes.rows[0]?.cnt || 0;
                }
                const esPredeterminado = activos === 0 || Boolean(sol.marcar_predeterminado);

                domicilioGuardado = await DomiciliosModel.crear({
                    id_cliente: ident.legacyClientesPk,
                    bunker_cliente_id: ident.bunkerClienteId,
                    alias,
                    tipo_lugar: tipoLugar,
                    direccion: direccionFinal,
                    localidad,
                    provincia,
                    codigo_postal: codigoPostal,
                    latitud: latNum,
                    longitud: lngNum,
                    coordenadas_validadas: Boolean(latNum !== null && lngNum !== null),
                    es_predeterminado: esPredeterminado,
                    telefono_contacto: telefonoContacto,
                    instrucciones_entrega: instruccionesEntrega,
                    horario_atencion_desde: horarioDesde,
                    horario_atencion_hasta: horarioHasta,
                    origen_carga: 'AUTOGESTION_CLIENTE',
                    verificado_por_cliente: true,
                    fecha_verificacion_cliente: new Date().toISOString(),
                    solicitud_id: sol.id,
                    gps_precision_metros: precisionMetros
                }, client);
            }

            const payloadAuditor = {
                alias,
                tipo_lugar: tipoLugar,
                calle,
                numero,
                sin_numero: Boolean(payload.sin_numero),
                entre_calles: entreCalles,
                piso_depto: pisoDepto,
                direccion: direccionFinal,
                localidad,
                provincia,
                codigo_postal: codigoPostal,
                latitud: latNum,
                longitud: lngNum,
                gps_precision_metros: precisionMetros,
                sin_mapa_fallback: Boolean(payload.sin_mapa_fallback),
                ip: metaReq.ip || null,
                user_agent: metaReq.userAgent ? String(metaReq.userAgent).slice(0, 220) : null
            };

            await client.query(
                `UPDATE public.clientes_domicilios_solicitudes
                 SET estado = 'COMPLETADA',
                     usado_at = NOW(),
                     domicilio_creado_id = $2,
                     payload_recibido = $3::jsonb,
                     updated_at = NOW()
                 WHERE id = $1`,
                [sol.id, domicilioGuardado.id, JSON.stringify(payloadAuditor)]
            );

            return {
                ok: true,
                status: 200,
                domicilio: domicilioGuardado,
                comprobante: {
                    alias: domicilioGuardado.alias,
                    tipo_lugar: domicilioGuardado.tipo_lugar,
                    direccion: domicilioGuardado.direccion,
                    localidad: domicilioGuardado.localidad,
                    provincia: domicilioGuardado.provincia,
                    horario_atencion_desde: domicilioGuardado.horario_atencion_desde ? String(domicilioGuardado.horario_atencion_desde).slice(0, 5) : null,
                    horario_atencion_hasta: domicilioGuardado.horario_atencion_hasta ? String(domicilioGuardado.horario_atencion_hasta).slice(0, 5) : null,
                    instrucciones_entrega: domicilioGuardado.instrucciones_entrega,
                    latitud: domicilioGuardado.latitud !== null ? Number(domicilioGuardado.latitud) : null,
                    longitud: domicilioGuardado.longitud !== null ? Number(domicilioGuardado.longitud) : null,
                    es_predeterminado: Boolean(domicilioGuardado.es_predeterminado),
                    verificado_at: domicilioGuardado.fecha_verificacion_cliente || new Date().toISOString()
                }
            };
        });

        if (resultadoTx.ok) {
            autoAsignarDomicilios(pool).catch(() => {});
        }

        return resultadoTx;
    }

    static async obtenerSolicitudPorId(solicitudId) {
        const idNum = parseInt(solicitudId, 10);
        if (!Number.isFinite(idNum)) return null;
        const res = await pool.query(
            `SELECT * FROM public.clientes_domicilios_solicitudes WHERE id = $1 LIMIT 1`,
            [idNum]
        );
        return res.rows[0] || null;
    }

    static async registrarUltimoEnvio(solicitudId, canalesInfo) {
        await pool.query(
            `UPDATE public.clientes_domicilios_solicitudes
             SET ultimo_envio_at = NOW(),
                 ultimo_envio_canales = $2::jsonb,
                 updated_at = NOW()
             WHERE id = $1`,
            [solicitudId, JSON.stringify(canalesInfo || {})]
        );
    }

    static async guardarWhatsappManualEnFicha(bunkerClienteId, numeroRaw) {
        const digits = String(numeroRaw || '').replace(/\D/g, '');
        if (digits.length < 8) return false;
        let canon = digits;
        if (canon.length === 10) canon = `549${canon}`;
        else if (canon.startsWith('54') && !canon.startsWith('549') && canon.length === 12) canon = `549${canon.slice(2)}`;

        const res = await pool.query(
            `SELECT id, cliente_nombre, whatsapp_facturas FROM public.bunker_clientes WHERE id = $1 LIMIT 1`,
            [bunkerClienteId]
        );
        if (res.rowCount === 0) return false;
        const row = res.rows[0];
        const actuales = parsearListaContactosJson(row.whatsapp_facturas, 'whatsapp');
        const yaExiste = actuales.some(w => String(w.numero || '').replace(/\D/g, '').endsWith(canon.slice(-10)));
        if (yaExiste) return false;

        const nuevaLista = [
            ...actuales,
            {
                id: `cont_${Date.now().toString(36)}`,
                numero: canon,
                nombre: row.cliente_nombre || 'Recepción',
                cargo: 'Entrega',
                enviar_alerta: true,
                default_factura: false,
                default_resumen: false
            }
        ];

        await pool.query(
            `UPDATE public.bunker_clientes SET whatsapp_facturas = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
            [JSON.stringify(nuevaLista), bunkerClienteId]
        );
        return true;
    }
}

module.exports = {
    DomicilioSolicitudesService,
    construirUrlPublicaDomicilio,
    esTokenValidoFormato,
    VIGENCIA_DIAS_DEFAULT,
    MAX_PENDIENTES_POR_CLIENTE
};
