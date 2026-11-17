/**
 * ============================================================================
 * SERVICIO DE PAQUETERÍA NACIONAL Y FULFILLMENT LAMDA (Strategy / Adapter)
 * ============================================================================
 * Soporta desde el Día 1 operación inmediata (`MANUAL` / `CSV_LOTE`) para
 * Correo Argentino, Andreani y Vía Cargo (validación de guía + autodetección +
 * generación de URL oficial de seguimiento + exportación CSV de preimposición),
 * dejando listos los conectores `API` (`correoArgentinoPaqarAdapter` y
 * `andreaniAdapter`) activables por variables de entorno con caída limpia al
 * tarifario zonal configurado cuando las credenciales aún no están cargadas.
 */

const OPERADORES_META = {
    CORREO_ARGENTINO: {
        codigo: 'CORREO_ARGENTINO',
        nombre: 'Correo Argentino'
    },
    ANDREANI: {
        codigo: 'ANDREANI',
        nombre: 'Andreani'
    },
    VIA_CARGO: {
        codigo: 'VIA_CARGO',
        nombre: 'Vía Cargo'
    },
    OTRO: {
        codigo: 'OTRO',
        nombre: 'Transporte / Correo'
    }
};

function normalizarCodigoOperador(raw = '') {
    const val = String(raw || '').trim().toUpperCase().replace(/\s+/g, '_');
    if (val === 'CORREO' || val === 'CORREO_ARGENTINO' || val === 'PAQAR') return 'CORREO_ARGENTINO';
    if (val === 'ANDREANI') return 'ANDREANI';
    if (val === 'VIA_CARGO' || val === 'VIACARGO') return 'VIA_CARGO';
    if (val === 'OTRO' || val === 'MANUAL') return 'OTRO';
    return 'CORREO_ARGENTINO';
}

function obtenerNombreOperador(raw = '') {
    const cod = normalizarCodigoOperador(raw);
    return OPERADORES_META[cod]?.nombre || 'Correo Argentino';
}

function limpiarGuiaTracking(raw = '') {
    return String(raw || '')
        .trim()
        .toUpperCase()
        .replace(/[\s\t\r\n]+/g, '');
}

/**
 * Autodetecta el operador postal a partir del formato de la guía escaneada con lector USB
 * (p. ej. S10 internacional/nacional `CP987654321AR`, `EP123456789AR`, `SD...AR` -> CORREO_ARGENTINO;
 *  15 dígitos `36000...` -> ANDREANI), respetando el operador elegido cuando el formato es genérico.
 */
function detectarOperadorPorFormatoGuia(guiaRaw = '', operadorPreferido = '') {
    const guia = limpiarGuiaTracking(guiaRaw);
    if (!guia) return normalizarCodigoOperador(operadorPreferido || 'CORREO_ARGENTINO');

    if (/^[A-Z]{2}\d{9}AR$/i.test(guia) || /^000\d{15,21}$/.test(guia)) {
        return 'CORREO_ARGENTINO';
    }
    if (/^36\d{13}$/.test(guia)) {
        return 'ANDREANI';
    }
    if (/^VC[-0-9]{6,18}$/i.test(guia)) {
        return 'VIA_CARGO';
    }
    return normalizarCodigoOperador(operadorPreferido || 'CORREO_ARGENTINO');
}

// ============================================================================
// ADAPTER 1: CORREO ARGENTINO (PAQ.AR API + FALLBACK ZONAL / CSV / MANUAL)
// ============================================================================
const correoArgentinoPaqarAdapter = {
    codigo: 'CORREO_ARGENTINO',
    nombre: 'Correo Argentino',

    estaApiConfigurada() {
        return Boolean(
            String(process.env.PAQAR_API_KEY || '').trim() &&
            String(process.env.PAQAR_AGREEMENT || '').trim()
        );
    },

    validarGuia(numeroTracking = '') {
        const guia = limpiarGuiaTracking(numeroTracking);
        if (!guia || guia.length < 5 || guia.length > 44) {
            return {
                ok: false,
                guia,
                error: 'Ingresá un número de seguimiento válido de Correo Argentino (ej. CP987654321AR o código de barras e-Paq).'
            };
        }
        const esFormatoS10 = /^[A-Z]{2}\d{9}AR$/.test(guia);
        const esEpaqNumerico = /^\d{14,26}$/.test(guia);
        const esAlfanumerico = /^[A-Z0-9-]{5,44}$/.test(guia);
        if (!esFormatoS10 && !esEpaqNumerico && !esAlfanumerico) {
            return {
                ok: false,
                guia,
                error: 'La guía de Correo Argentino contiene caracteres inválidos.'
            };
        }
        return {
            ok: true,
            guia,
            formato_detectado: esFormatoS10 ? 'T&T_AR' : (esEpaqNumerico ? 'EPAQ_BARCODE' : 'ALFANUMERICO')
        };
    },

    construirUrlTracking(numeroTracking = '') {
        const guia = limpiarGuiaTracking(numeroTracking);
        if (!guia) return '';
        return `https://www.correoargentino.com.ar/formularios/e-commerce?id=${encodeURIComponent(guia)}`;
    },

    async cotizar(params = {}, fallbackCotizadorZonal = null) {
        if (!this.estaApiConfigurada()) {
            if (typeof fallbackCotizadorZonal === 'function') {
                return {
                    ok: true,
                    origen_cotizacion: 'TARIFARIO_ZONAL_CONFIGURADO',
                    ...(await fallbackCotizadorZonal(params))
                };
            }
            return { ok: false, modo_fallback: 'TARIFARIO_ZONAL_CONFIGURADO', motivo: 'Credenciales PAQAR no configuradas' };
        }

        const baseUrl = String(process.env.PAQAR_BASE_URL || 'https://api.correoargentino.com.ar/paqar/v1').replace(/\/+$/, '');
        try {
            const resp = await fetch(`${baseUrl}/rates`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Apikey ${process.env.PAQAR_API_KEY}`,
                    agreement: String(process.env.PAQAR_AGREEMENT)
                },
                body: JSON.stringify({
                    postalCodeOrigin: String(params.cp_origen || '1900'),
                    postalCodeDestination: String(params.cp_destino || ''),
                    deliveredType: params.modalidad_postal === 'SUCURSAL' ? 'S' : 'D',
                    dimensions: {
                        weight: Math.max(100, Number(params.peso_gramos || 500)),
                        height: Number(params.alto_cm || 12),
                        width: Number(params.ancho_cm || 20),
                        depth: Number(params.largo_cm || 25)
                    }
                }),
                signal: AbortSignal.timeout(5500)
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            return { ok: true, origen_cotizacion: 'API_PAQAR', respuesta: data };
        } catch (err) {
            if (typeof fallbackCotizadorZonal === 'function') {
                return {
                    ok: true,
                    origen_cotizacion: 'TARIFARIO_ZONAL_FALLBACK',
                    advertencia_api: err.message,
                    ...(await fallbackCotizadorZonal(params))
                };
            }
            return { ok: false, modo_fallback: 'TARIFARIO_ZONAL_FALLBACK', error: err.message };
        }
    },

    async crearPreimposicion(orden = {}) {
        if (!this.estaApiConfigurada()) {
            return {
                ok: false,
                requiere_modo_manual_o_csv: true,
                mensaje: 'Conector Paq.ar listo; cargá PAQAR_API_KEY y PAQAR_AGREEMENT o usá Exportar CSV Preimposición.'
            };
        }
        const baseUrl = String(process.env.PAQAR_BASE_URL || 'https://api.correoargentino.com.ar/paqar/v1').replace(/\/+$/, '');
        const resp = await fetch(`${baseUrl}/orders`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Apikey ${process.env.PAQAR_API_KEY}`,
                agreement: String(process.env.PAQAR_AGREEMENT)
            },
            body: JSON.stringify(orden),
            signal: AbortSignal.timeout(8000)
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            throw new Error(data.message || `Error Paq.ar HTTP ${resp.status}`);
        }
        const guia = limpiarGuiaTracking(data.trackingNumber || data.id || '');
        return {
            ok: true,
            modo_imposicion: 'API',
            numero_tracking: guia,
            url_tracking_carrier: this.construirUrlTracking(guia),
            raw: data
        };
    },

    async obtenerRotulo(numeroTracking = '') {
        if (!this.estaApiConfigurada()) {
            return { ok: false, requiere_modo_manual_o_csv: true };
        }
        const baseUrl = String(process.env.PAQAR_BASE_URL || 'https://api.correoargentino.com.ar/paqar/v1').replace(/\/+$/, '');
        const resp = await fetch(`${baseUrl}/labels?trackingNumber=${encodeURIComponent(limpiarGuiaTracking(numeroTracking))}`, {
            headers: {
                Authorization: `Apikey ${process.env.PAQAR_API_KEY}`,
                agreement: String(process.env.PAQAR_AGREEMENT)
            },
            signal: AbortSignal.timeout(8000)
        });
        if (!resp.ok) throw new Error(`Error obteniendo rótulo Paq.ar HTTP ${resp.status}`);
        const data = await resp.json();
        return { ok: true, rotulo: data };
    },

    async consultarTracking(numeroTracking = '') {
        const guia = limpiarGuiaTracking(numeroTracking);
        if (!this.estaApiConfigurada()) {
            return {
                ok: true,
                modo: 'LINK_EXTERNO',
                numero_tracking: guia,
                url_tracking_carrier: this.construirUrlTracking(guia)
            };
        }
        const baseUrl = String(process.env.PAQAR_BASE_URL || 'https://api.correoargentino.com.ar/paqar/v1').replace(/\/+$/, '');
        const resp = await fetch(`${baseUrl}/tracking?trackingNumber=${encodeURIComponent(guia)}`, {
            headers: {
                Authorization: `Apikey ${process.env.PAQAR_API_KEY}`,
                agreement: String(process.env.PAQAR_AGREEMENT)
            },
            signal: AbortSignal.timeout(6000)
        });
        const data = await resp.json().catch(() => ({}));
        return {
            ok: resp.ok,
            modo: 'API_PAQAR',
            numero_tracking: guia,
            url_tracking_carrier: this.construirUrlTracking(guia),
            eventos: data
        };
    }
};

// ============================================================================
// ADAPTER 2: ANDREANI (API V2 + FALLBACK ZONAL / CSV / MANUAL)
// ============================================================================
const andreaniAdapter = {
    codigo: 'ANDREANI',
    nombre: 'Andreani',

    estaApiConfigurada() {
        return Boolean(
            String(process.env.ANDREANI_USER || '').trim() &&
            String(process.env.ANDREANI_PASSWORD || '').trim() &&
            String(process.env.ANDREANI_CONTRATO || '').trim()
        );
    },

    validarGuia(numeroTracking = '') {
        const guia = limpiarGuiaTracking(numeroTracking);
        if (!guia || guia.length < 5 || guia.length > 40 || !/^[A-Z0-9-]+$/.test(guia)) {
            return {
                ok: false,
                guia,
                error: 'Ingresá un número de envío válido de Andreani (ej. 360001234567890).'
            };
        }
        return {
            ok: true,
            guia,
            formato_detectado: /^\d{15}$/.test(guia) ? 'ANDREANI_15D' : 'ALFANUMERICO'
        };
    },

    construirUrlTracking(numeroTracking = '') {
        const guia = limpiarGuiaTracking(numeroTracking);
        if (!guia) return '';
        return `https://www.andreani.com/#!/informacionEnvio/${encodeURIComponent(guia)}`;
    },

    async _obtenerTokenAndreani() {
        const baseUrl = String(process.env.ANDREANI_BASE_URL || 'https://apis.andreani.com').replace(/\/+$/, '');
        const creds = Buffer.from(`${process.env.ANDREANI_USER}:${process.env.ANDREANI_PASSWORD}`).toString('base64');
        const resp = await fetch(`${baseUrl}/login`, {
            headers: { Authorization: `Basic ${creds}` },
            signal: AbortSignal.timeout(5500)
        });
        if (!resp.ok) throw new Error(`Login Andreani HTTP ${resp.status}`);
        return resp.headers.get('x-authorization-token') || '';
    },

    async cotizar(params = {}, fallbackCotizadorZonal = null) {
        if (!this.estaApiConfigurada()) {
            if (typeof fallbackCotizadorZonal === 'function') {
                return {
                    ok: true,
                    origen_cotizacion: 'TARIFARIO_ZONAL_CONFIGURADO',
                    ...(await fallbackCotizadorZonal(params))
                };
            }
            return { ok: false, modo_fallback: 'TARIFARIO_ZONAL_CONFIGURADO', motivo: 'Credenciales ANDREANI no configuradas' };
        }
        try {
            const baseUrl = String(process.env.ANDREANI_BASE_URL || 'https://apis.andreani.com').replace(/\/+$/, '');
            const qs = new URLSearchParams({
                cpDestino: String(params.cp_destino || ''),
                contrato: String(process.env.ANDREANI_CONTRATO || ''),
                cliente: String(process.env.ANDREANI_CLIENTE || ''),
                'bultos[0][kilos]': String(Math.max(0.2, Number(params.peso_gramos || 500) / 1000)),
                'bultos[0][valorDeclarado]': String(Math.max(0, Number(params.valor_declarado || 0)))
            });
            const resp = await fetch(`${baseUrl}/v1/tarifas?${qs.toString()}`, {
                signal: AbortSignal.timeout(5500)
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            return { ok: true, origen_cotizacion: 'API_ANDREANI', respuesta: data };
        } catch (err) {
            if (typeof fallbackCotizadorZonal === 'function') {
                return {
                    ok: true,
                    origen_cotizacion: 'TARIFARIO_ZONAL_FALLBACK',
                    advertencia_api: err.message,
                    ...(await fallbackCotizadorZonal(params))
                };
            }
            return { ok: false, modo_fallback: 'TARIFARIO_ZONAL_FALLBACK', error: err.message };
        }
    },

    async crearEnvio(orden = {}) {
        if (!this.estaApiConfigurada()) {
            return {
                ok: false,
                requiere_modo_manual_o_csv: true,
                mensaje: 'Conector Andreani listo; cargá ANDREANI_USER, ANDREANI_PASSWORD y ANDREANI_CONTRATO o usá Exportar CSV Preimposición.'
            };
        }
        const baseUrl = String(process.env.ANDREANI_BASE_URL || 'https://apis.andreani.com').replace(/\/+$/, '');
        const token = await this._obtenerTokenAndreani();
        const resp = await fetch(`${baseUrl}/v2/ordenes-de-envio`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-authorization-token': token
            },
            body: JSON.stringify(orden),
            signal: AbortSignal.timeout(8000)
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.mensaje || `Error Andreani HTTP ${resp.status}`);
        const guia = limpiarGuiaTracking(data?.bultos?.[0]?.numeroDeEnvio || data?.numeroDeEnvio || '');
        return {
            ok: true,
            modo_imposicion: 'API',
            numero_tracking: guia,
            url_tracking_carrier: this.construirUrlTracking(guia),
            raw: data
        };
    },

    async obtenerRotuloZpl(numeroTracking = '') {
        if (!this.estaApiConfigurada()) {
            return { ok: false, requiere_modo_manual_o_csv: true };
        }
        const baseUrl = String(process.env.ANDREANI_BASE_URL || 'https://apis.andreani.com').replace(/\/+$/, '');
        const token = await this._obtenerTokenAndreani();
        const guia = limpiarGuiaTracking(numeroTracking);
        const resp = await fetch(`${baseUrl}/v2/ordenes-de-envio/${encodeURIComponent(guia)}/etiquetas?tipo=zpl`, {
            headers: { 'x-authorization-token': token },
            signal: AbortSignal.timeout(8000)
        });
        if (!resp.ok) throw new Error(`Error rótulo ZPL Andreani HTTP ${resp.status}`);
        const zpl = await resp.text();
        return { ok: true, zpl };
    },

    async consultarTracking(numeroTracking = '') {
        const guia = limpiarGuiaTracking(numeroTracking);
        if (!this.estaApiConfigurada()) {
            return {
                ok: true,
                modo: 'LINK_EXTERNO',
                numero_tracking: guia,
                url_tracking_carrier: this.construirUrlTracking(guia)
            };
        }
        const baseUrl = String(process.env.ANDREANI_BASE_URL || 'https://apis.andreani.com').replace(/\/+$/, '');
        const token = await this._obtenerTokenAndreani();
        const resp = await fetch(`${baseUrl}/v1/envios/${encodeURIComponent(guia)}/trazas`, {
            headers: { 'x-authorization-token': token },
            signal: AbortSignal.timeout(6000)
        });
        const data = await resp.json().catch(() => ({}));
        return {
            ok: resp.ok,
            modo: 'API_ANDREANI',
            numero_tracking: guia,
            url_tracking_carrier: this.construirUrlTracking(guia),
            eventos: data
        };
    }
};

// ============================================================================
// ADAPTERS COMPLEMENTARIOS: VIA CARGO Y TRANSPORTE MANUAL PERSONALIZADO
// ============================================================================
const viaCargoAdapter = {
    codigo: 'VIA_CARGO',
    nombre: 'Vía Cargo',
    estaApiConfigurada() {
        return false;
    },
    validarGuia(numeroTracking = '') {
        const guia = limpiarGuiaTracking(numeroTracking);
        if (!guia || guia.length < 4 || guia.length > 40) {
            return { ok: false, guia, error: 'Ingresá un número de guía válido de Vía Cargo.' };
        }
        return { ok: true, guia, formato_detectado: 'VIA_CARGO' };
    },
    construirUrlTracking(numeroTracking = '') {
        const guia = limpiarGuiaTracking(numeroTracking);
        return guia ? `https://viacargo.com.ar/seguimiento?guia=${encodeURIComponent(guia)}` : '';
    }
};

const otroManualAdapter = {
    codigo: 'OTRO',
    nombre: 'Transporte / Correo',
    estaApiConfigurada() {
        return false;
    },
    validarGuia(numeroTracking = '') {
        const guia = limpiarGuiaTracking(numeroTracking);
        if (!guia || guia.length < 3 || guia.length > 50) {
            return { ok: false, guia, error: 'Ingresá el número de guía o comprobante de despacho.' };
        }
        return { ok: true, guia, formato_detectado: 'MANUAL' };
    },
    construirUrlTracking() {
        return '';
    }
};

const ADAPTERS_POR_OPERADOR = {
    CORREO_ARGENTINO: correoArgentinoPaqarAdapter,
    ANDREANI: andreaniAdapter,
    VIA_CARGO: viaCargoAdapter,
    OTRO: otroManualAdapter
};

function obtenerAdapterOperador(operadorRaw = '') {
    const cod = normalizarCodigoOperador(operadorRaw);
    return ADAPTERS_POR_OPERADOR[cod] || correoArgentinoPaqarAdapter;
}

/**
 * Valida la guía ingresada/escaneada y construye automáticamente la URL oficial
 * del operador postal (respetando una URL personalizada si el operador la especificó).
 */
function resolverGuiaYUrlCarrier({ operador_postal = '', numero_tracking = '', url_tracking_carrier = '' } = {}) {
    const guia = limpiarGuiaTracking(numero_tracking);
    const operadorEfectivo = operador_postal
        ? normalizarCodigoOperador(operador_postal)
        : detectarOperadorPorFormatoGuia(guia, 'CORREO_ARGENTINO');
    const adapter = obtenerAdapterOperador(operadorEfectivo);
    const val = adapter.validarGuia(guia);
    if (!val.ok) {
        throw new Error(val.error || 'Número de guía inválido.');
    }

    const urlManual = String(url_tracking_carrier || '').trim();
    const urlFinal = /^https?:\/\//i.test(urlManual)
        ? urlManual
        : adapter.construirUrlTracking(val.guia);

    return {
        operador_postal: operadorEfectivo,
        operador_postal_label: adapter.nombre,
        numero_tracking: val.guia,
        formato_detectado: val.formato_detectado,
        url_tracking_carrier: urlFinal || null,
        api_configurada: Boolean(adapter.estaApiConfigurada && adapter.estaApiConfigurada())
    };
}

function escaparCeldaCsv(valor) {
    const limpio = String(valor ?? '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/;/g, ',')
        .trim();
    if (limpio.includes('"')) {
        return `"${limpio.replace(/"/g, '""')}"`;
    }
    return limpio;
}

/**
 * Genera el archivo CSV de Preimposición Masiva (UTF-8 con BOM + delimitador `;`)
 * listo para importar por lote en Correo Argentino (MiCorreo / e-Paq) o Andreani
 * sin tipear direcciones manualmente.
 */
function generarCsvPreimposicionMasiva(ordenes = []) {
    const encabezados = [
        'referencia_orden',
        'marca_remitente',
        'operador_postal',
        'modalidad',
        'destinatario_nombre',
        'destinatario_dni',
        'calle',
        'altura',
        'piso_depto',
        'codigo_postal',
        'localidad',
        'provincia',
        'provincia_codigo',
        'telefono',
        'email',
        'peso_gramos',
        'valor_declarado',
        'sucursal_destino',
        'referencias_domicilio'
    ];

    const filas = [encabezados.join(';')];

    for (const ord of (ordenes || [])) {
        const ep = ord.envio_postal || ord || {};
        const codPed = String(ord.codigo_pedido || ep.codigo_pedido || ord.id || '').trim().replace(/^#+/, '');
        const refOrden = codPed.startsWith('PED-') ? `#${codPed}` : `#PED-${codPed}`;
        const modPostal = String(ep.modalidad_postal || (String(ord.modalidad_entrega || '').includes('SUCURSAL') ? 'SUCURSAL' : 'DOMICILIO')).toUpperCase();
        const telLimpio = String(ord.vecino_telefono || ep.telefono || '').replace(/[^\d+]/g, '');
        const dniLimpio = String(ep.destinatario_dni || ord.destinatario_dni || '').replace(/\D+/g, '');
        const pesoGramos = Math.max(100, Math.round(Number(ep.peso_gramos || ord.peso_gramos || 500)));
        const valorDecl = Math.max(0, Math.round(Number(ep.valor_declarado || ord.subtotal_productos_vecino || ord.total_vecino || 0)));

        const celdas = [
            refOrden,
            ord.nombre_marca || ep.nombre_marca || '',
            normalizarCodigoOperador(ep.operador_postal || 'CORREO_ARGENTINO'),
            modPostal === 'SUCURSAL' ? 'SUCURSAL' : 'DOMICILIO',
            ep.destinatario_nombre || ord.vecino_nombre || '',
            dniLimpio,
            modPostal === 'SUCURSAL' ? '' : (ep.calle || ''),
            modPostal === 'SUCURSAL' ? '' : (ep.altura || 'S/N'),
            modPostal === 'SUCURSAL' ? '' : (ep.piso_depto || ''),
            String(ep.cp_destino || '').replace(/\D+/g, ''),
            ep.localidad_nombre || '',
            ep.provincia_nombre || '',
            ep.provincia_codigo || '',
            telLimpio,
            ep.email_contacto || ord.vecino_email || '',
            pesoGramos,
            valorDecl,
            modPostal === 'SUCURSAL' ? (ep.sucursal_nombre || ep.sucursal_codigo || '') : '',
            ep.referencias_domicilio || ord.entrecalles_referencia || ''
        ].map(escaparCeldaCsv);

        filas.push(celdas.join(';'));
    }

    return '\uFEFF' + filas.join('\r\n') + '\r\n';
}

function obtenerEstadoConectoresPaqueteria() {
    return {
        CORREO_ARGENTINO: {
            codigo: 'CORREO_ARGENTINO',
            nombre: correoArgentinoPaqarAdapter.nombre,
            modo_activo: correoArgentinoPaqarAdapter.estaApiConfigurada() ? 'API' : 'MANUAL_CSV',
            api_configurada: correoArgentinoPaqarAdapter.estaApiConfigurada()
        },
        ANDREANI: {
            codigo: 'ANDREANI',
            nombre: andreaniAdapter.nombre,
            modo_activo: andreaniAdapter.estaApiConfigurada() ? 'API' : 'MANUAL_CSV',
            api_configurada: andreaniAdapter.estaApiConfigurada()
        },
        VIA_CARGO: {
            codigo: 'VIA_CARGO',
            nombre: viaCargoAdapter.nombre,
            modo_activo: 'MANUAL_CSV',
            api_configurada: false
        }
    };
}

module.exports = {
    OPERADORES_META,
    correoArgentinoPaqarAdapter,
    andreaniAdapter,
    viaCargoAdapter,
    normalizarCodigoOperador,
    obtenerNombreOperador,
    limpiarGuiaTracking,
    detectarOperadorPorFormatoGuia,
    obtenerAdapterOperador,
    resolverGuiaYUrlCarrier,
    generarCsvPreimposicionMasiva,
    obtenerEstadoConectoresPaqueteria
};
