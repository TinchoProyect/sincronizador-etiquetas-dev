/**
 * ======================================================================================
 * 🤝 COPILOTO HÍBRIDO DE WHATSAPP — CLIENTE DETERMINISTA & TELEMETRÍA (FASE 3)
 * ======================================================================================
 * Arquitectura Unificada Fase 3:
 *   - Toda la redacción inteligente y clasificación semántica corre en el backend
 *     (POST /api/crm/whatsapp/asistente-hibrido/razonar — 2 Carriles x 8 Especialistas Gemini 2.5 Flash).
 *   - Este módulo liviano conserva únicamente:
 *       1. Clavijas deterministas de texto WhatsApp (limpiarSignosAperturaWa, limpiarCierreRedundanteBurbuja1Wa).
 *       2. Formateador determinista de precios en Jerarquía B2B (formatearResumenWhatsAppJerarquiaB2B).
 *       3. Telemetría determinista de Cuenta Corriente / Portal / Logística / Contacto (ejecutarMesaAgentesComercialesWa).
 *       4. Puente directo al motor backend de 2 Carriles (generarConIaGenerativaMesaAgentesWa).
 *       5. Monitor global de Crédito IA Gemini y Acordeón de Conexión en la Pizarra Principal.
 * ======================================================================================
 */

(function () {
    'use strict';

    const STORAGE_KEY_IA_CONFIG = 'lamda_crm_wa_ia_config_v1';
    const URL_PORTAL_OFICIAL = 'https://proud-darkness-ac3d.miserrano75.workers.dev';

    function resolverUrlModulo3004(ruta) {
        const clean = ruta.startsWith('/') ? ruta : `/${ruta}`;
        const raw = `http://localhost:3004${clean}`;
        return (typeof window.LAMDA_RESOLVE_URL === 'function')
            ? window.LAMDA_RESOLVE_URL(raw)
            : raw;
    }

    function escapar(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function normalizar(str) {
        return String(str || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim();
    }

    /**
     * Regla Innegociable WhatsApp LAMDA:
     * Elimina todos los signos de apertura (¿ y ¡), reemplaza "interés" por "financiación"
     * y sincroniza "buen día" / "buenas tardes" con la hora local real de Argentina.
     */
    function limpiarSignosAperturaWa(texto) {
        let out = String(texto || '')
            .replace(/[¿¡]/g, '')
            .replace(/\bintereses\b/gi, 'financiación')
            .replace(/\binter[eé]s\b/gi, 'financiación')
            .replace(/[ \t]{2,}/g, ' ');
        const h = new Date().getHours();
        if (h < 13) {
            out = out
                .replace(/\bBuenas\s+tardes\b/g, 'Buen día')
                .replace(/\bbuenas\s+tardes\b/g, 'buen día')
                .replace(/\bBuenas\s+noches\b/g, 'Buen día')
                .replace(/\bbuenas\s+noches\b/g, 'buen día');
        } else if (h >= 13 && h < 20) {
            out = out
                .replace(/\bBuen\s+d[ií]a\b/g, 'Buenas tardes')
                .replace(/\bbuen\s+d[ií]a\b/g, 'buenas tardes')
                .replace(/\bBuenos\s+d[ií]as\b/g, 'Buenas tardes')
                .replace(/\bbuenos\s+d[ií]as\b/g, 'buenas tardes');
        }
        return out.trim();
    }

    window.limpiarSignosAperturaWa = limpiarSignosAperturaWa;

    /**
     * Limpia cierres repetitivos al final de Burbuja 1 cuando hay Burbuja 2 o Burbuja 3 activas.
     */
    function limpiarCierreRedundanteBurbuja1Wa(texto) {
        const s = String(texto || '').trim();
        if (!s) return '';
        return s
            .replace(/(?:\r?\n|\s)+(?:Cualquier\s+cos(?:a|ita)\s+(?:estamos\s+atent[oa]s?|escribime(?:\s+por\s+ac[aá])?|avisame)|(?:Estoy|Quedo|Quedamos|Estamos)\s+atent[oa]s?(?:\s+por\s+cualquier\s+cosa)?|Quedamos\s+a\s+disposici[oó]n(?:\s+por\s+cualquier\s+(?:cosa|consulta))?|Avisame\s+cualquier\s+duda(?:\s+que\s+tengas)?)[.!]*$/i, '')
            .trim();
    }

    window.limpiarCierreRedundanteBurbuja1Wa = limpiarCierreRedundanteBurbuja1Wa;

    window.obtenerConfigIaLocalWa = function () {
        try {
            const raw = localStorage.getItem(STORAGE_KEY_IA_CONFIG);
            if (raw) return JSON.parse(raw);
        } catch (_) {}
        return { proveedor: 'gemini', modelo: 'gemini-2.5-flash', habilitada: true };
    };

    function ordenarPorJerarquiaB2BInterno(articulosLista = []) {
        return (Array.isArray(articulosLista) ? articulosLista : []).slice().sort((a, b) => {
            const famA = String(a.familia_b2b || a.familia_nombre || '').trim();
            const famB = String(b.familia_b2b || b.familia_nombre || '').trim();
            const cFam = famA.localeCompare(famB, 'es', { sensitivity: 'base', numeric: true });
            if (cFam !== 0) return cFam;

            const priA = String(a.articulo_principal_display || a.articulo_principal_b2b || a.articulo_principal || '').trim();
            const priB = String(b.articulo_principal_display || b.articulo_principal_b2b || b.articulo_principal || '').trim();
            const cPri = priA.localeCompare(priB, 'es', { sensitivity: 'base', numeric: true });
            if (cPri !== 0) return cPri;

            const subA = String(a.ruta_subcategoria_b2b || '').trim();
            const subB = String(b.ruta_subcategoria_b2b || '').trim();
            const cSub = subA.localeCompare(subB, 'es', { sensitivity: 'base', numeric: true });
            if (cSub !== 0) return cSub;

            const kgA = parseFloat(a.kilos_unidad || 1);
            const kgB = parseFloat(b.kilos_unidad || 1);
            if (Math.abs(kgB - kgA) > 0.01) return kgB - kgA;

            const nomA = String(a.nombre || a.descripcion || '').trim();
            const nomB = String(b.nombre || b.descripcion || '').trim();
            return nomA.localeCompare(nomB, 'es', { sensitivity: 'base', numeric: true });
        });
    }

    function formatearResumenWhatsAppJerarquiaB2B(articulosLista = [], listaId = 1) {
        const lid = Number(listaId) || 1;
        const ordenados = ordenarPorJerarquiaB2BInterno(articulosLista);
        if (ordenados.length === 0) return '';

        const mostrarEncabezadosGrupo = ordenados.length >= 2;
        const lineas = [];
        let grupoActual = '';

        ordenados.forEach(art => {
            const fam = String(art.familia_b2b || art.familia_nombre || '').trim();
            const princ = String(art.articulo_principal_display || art.articulo_principal_b2b || art.articulo_principal || '').trim();
            const etiquetaGrupo = [fam, princ].filter(Boolean).join(' › ');

            if (mostrarEncabezadosGrupo && etiquetaGrupo && etiquetaGrupo !== grupoActual) {
                grupoActual = etiquetaGrupo;
                if (lineas.length > 0) lineas.push('');
                lineas.push(`▪ *${etiquetaGrupo}*`);
            }

            const nom = String(art.nombre_visible || art.descripcion_generada || art.nombre || art.descripcion || art.articulo_numero || art.codigo_unico || 'Artículo').trim();
            const kilos = parseFloat(art.kilos_unidad || 1) || 1;
            const pNuevoBulto = Number(art.precio_nuevo_vigente || art.precio_actual_lista || (art.precios ? (art.precios[lid] || art.precios[String(lid)] || art.precios[1]) : 0) || 0);
            const pNuevoKilo = Number(art.precio_nuevo_kilo || (kilos > 0 ? (pNuevoBulto / kilos) : pNuevoBulto) || 0);

            const txtKilo = `$${Math.round(pNuevoKilo).toLocaleString('es-AR')}/kg`;
            const txtBulto = kilos > 1.05
                ? ` (Bulto x ${kilos}kg: $${Math.round(pNuevoBulto).toLocaleString('es-AR')})`
                : (kilos < 0.99 ? ` ($${Math.round(pNuevoBulto).toLocaleString('es-AR')} c/u)` : '');

            const sinStock = Boolean(art.sin_stock_actual) || (art.stock_real !== undefined && Number(art.stock_real) <= 0 && art.cambio_precio_id);
            const alt = art.alternativa_sugerida || null;

            if (sinStock && alt) {
                const altKg = Math.round(Number(alt.precio_nuevo_kilo || 0)).toLocaleString('es-AR');
                lineas.push(`• *${nom}*: *${txtKilo}*${txtBulto} _(⚠️ Sin stock actual)_`);
                lineas.push(`  ↳ _Alternativa en stock: *${alt.descripcion}* a *$${altKg}/kg*_`);
            } else if (sinStock) {
                lineas.push(`• *${nom}*: *${txtKilo}*${txtBulto} _(⚠️ Sin stock momentáneo)_`);
            } else {
                lineas.push(`• *${nom}*: *${txtKilo}*${txtBulto}`);
            }
        });

        return lineas.join('\n').trim();
    }

    window.formatearResumenWhatsAppJerarquiaB2B = formatearResumenWhatsAppJerarquiaB2B;

    function obtenerSaludoMomentoActual() {
        const h = new Date().getHours();
        if (h < 13) return { lower: 'buen día', cap: 'Buen día' };
        if (h < 20) return { lower: 'buenas tardes', cap: 'Buenas tardes' };
        return { lower: 'buenas noches', cap: 'Buenas noches' };
    }

    function resolverInfoContactoDeterminista(st) {
        const raw = String(st?.contactoNombreChat || st?.nombreCorto || st?.nombreCliente || '').trim();
        const primeraPalabra = raw
            .replace(/\(.*?\)/g, '')
            .split(/[\s,-/]+/)
            .map(s => s.trim())
            .find(s => s.length >= 2 && !/^(contacto|cliente|lomas|admin|srl|sa)$/i.test(s)) || '';
        const nomPila = primeraPalabra
            ? (primeraPalabra.charAt(0).toUpperCase() + primeraPalabra.slice(1).toLowerCase())
            : '';
        const nomHist = String(st?.sintesisMemoria?.contacto_hilo?.nombre_pila_detectado || '').trim();
        const apodo = nomHist || String(st?.nombreCorto || '').trim() || nomPila;
        const momento = obtenerSaludoMomentoActual();
        return {
            nombrePila: nomPila || apodo,
            nombreFormalPila: nomPila || apodo,
            apodoCorto: apodo,
            saludoMomento: momento.lower,
            saludoMomentoCap: momento.cap
        };
    }

    function calcularTelemetriaCuentaDeterminista(st) {
        const cc = st?.rayosX?.cuenta_corriente || {};
        const salv = cc?.salvavidas || null;
        const comp = cc?.composicion || null;

        const saldoActual = Number(cc.saldo_actual || 0);
        const tieneSaldo = saldoActual > 100;
        const tieneSaldoAFavor = saldoActual < -10;
        const montoSaldoAFavor = tieneSaldoAFavor ? Math.abs(saldoActual) : 0;
        const montoFinanciacion = Number(salv?.financiacion_total_con_iva || 0);
        const tieneFinanciacionActiva = tieneSaldo && montoFinanciacion > 1;
        const saldoCapital = tieneSaldo ? saldoActual : 0;
        const saldoTotal = tieneFinanciacionActiva
            ? Number(salv?.saldo_total_proyectado_con_iva || (saldoCapital + montoFinanciacion))
            : saldoCapital;

        const fmtPesos = (n) => `$${Math.round(Number(n || 0)).toLocaleString('es-AR')}`;
        const saldoFmt = fmtPesos(saldoTotal);
        const saldoCapitalFmt = fmtPesos(saldoCapital);
        const financiacionFmt = fmtPesos(montoFinanciacion);
        const saldoAFavorFmt = fmtPesos(montoSaldoAFavor);

        const antiguedadMax = Number(comp?.antiguedad_maxima_dias || 0);
        const capas = Array.isArray(comp?.capas) ? comp.capas : [];
        const comprobantePrincipalTxt = capas.length > 0
            ? String(capas[0].comprobante || capas[0].descripcion || '').trim()
            : '';

        let tramoReal = 'EN_TERMINO';
        const estSalv = String(salv?.estado_general || '').toUpperCase();
        if (!tieneSaldo) {
            tramoReal = 'EN_TERMINO';
        } else if (tieneFinanciacionActiva || /FINANCIAD|SALVAVIDAS|MORA|ATRASO_CRITICO/i.test(estSalv)) {
            tramoReal = 'SALVAVIDAS_FINANCIADO';
        } else if (/COMODIN/i.test(estSalv) || (antiguedadMax >= 11 && antiguedadMax <= 14)) {
            tramoReal = 'COMODIN';
        } else if (/GRACIA|CORTESIA/i.test(estSalv) || (antiguedadMax >= 8 && antiguedadMax <= 10)) {
            tramoReal = 'GRACIA_NATURAL';
        }

        const desgloseParentesisCorto = tieneFinanciacionActiva
            ? `(capital ${saldoCapitalFmt} + financiación ${financiacionFmt})`
            : (antiguedadMax > 0 ? `(de hace ${antiguedadMax} días)` : '');

        const yaIngresoPortal = Boolean(st?.yaIngresoPortal);
        const codigoActivacion = String(st?.codigoActivacion || '').trim();
        const linkActivacionCorto = String(st?.linkActivacionCorto || '').trim();

        const badgeCuenta = tieneSaldo
            ? (tieneFinanciacionActiva
                ? `Total CC: ${saldoFmt} (C: ${saldoCapitalFmt} + F: ${financiacionFmt} · ${antiguedadMax}d)`
                : `Saldo CC: ${saldoFmt}${antiguedadMax > 0 ? ` (${antiguedadMax}d)` : ''}`)
            : (tieneSaldoAFavor ? `Saldo a favor: ${saldoAFavorFmt}` : 'Cuenta al día ($0)');

        const badgePortal = yaIngresoPortal
            ? '🟢 Ya usa el Portal (usuario y clave activos)'
            : `🟠 Nunca entró al Portal → Invitación Inicial${codigoActivacion ? ` (Cód: ${codigoActivacion})` : ''}`;

        return {
            tieneSaldo,
            tieneSaldoAFavor,
            montoSaldoAFavor,
            saldoAFavorFmt,
            cuentaId: cc.cuenta_id || null,
            saldoActual,
            saldoCapital,
            montoFinanciacion,
            tieneFinanciacionActiva,
            saldoTotal,
            saldoFmt,
            saldoCapitalFmt,
            financiacionFmt,
            desgloseParentesisCorto,
            antiguedadMax,
            tramoReal,
            capas,
            cantComprobantesAbiertos: capas.length,
            comprobantePrincipalTxt,
            yaIngresoPortal,
            codigoActivacion,
            linkActivacionCorto,
            badgeCuenta,
            badgePortal
        };
    }

    /**
     * Variantes deterministas breves para inserción puntual de saldo desde botón rápido de CC.
     * Cero "¿"/"¡" y cero palabra "interés".
     */
    function generarTextosMencionSaldoWa(st, infoContacto, ag3, offsetVariante = 0) {
        const saldoFmt = ag3?.saldoFmt || '$0';
        const dias = Number(ag3?.antiguedadMax || 0);
        const tieneSaldo = Boolean(ag3?.tieneSaldo);
        const desgloseParentesis = ag3?.desgloseParentesisCorto
            ? ` ${ag3.desgloseParentesisCorto}`
            : (dias > 0 ? ` (de hace ${dias} días)` : '');
        const compTxt = ag3?.comprobantePrincipalTxt ? ` — ${ag3.comprobantePrincipalTxt}` : '';
        const idx = Math.abs(Number(st?.varianteSaludoIdx || 0) + Number(offsetVariante || 0));

        if (!tieneSaldo) {
            const txt = `Como tenés la cuenta corriente al día ($0), recordá que tenés habilitado el 5% de bonificación en pedidos mayores a $300.000 y acceso a ofertas.`;
            return {
                mencionCortaInline: limpiarSignosAperturaWa(txt),
                mencionCortaBurbuja: limpiarSignosAperturaWa(`${txt} Cualquier cosa estamos atentos.`),
                detalleSaldoYPoliticasBurbuja: limpiarSignosAperturaWa(`${txt} Cualquier consulta estamos atentos.`)
            };
        }

        const variantesCortas = [
            `De paso te encargo cuando puedas lo del saldo pendiente de *${saldoFmt}*${desgloseParentesis}, avisame cómo te queda cómodo manejarlo.`,
            `Te recuerdo cortito el saldo pendiente en cuenta de *${saldoFmt}*${desgloseParentesis}, cuando puedas decime cómo lo organizamos.`,
            `De paso te paso el resumen del saldo pendiente de *${saldoFmt}*${desgloseParentesis}, si querés ir haciendo pagos parciales avisame.`
        ];
        const lineaCorta = variantesCortas[idx % variantesCortas.length];

        let bloqueCondicion = '';
        if (dias > 0 && dias <= 7) {
            bloqueCondicion = `Estás dentro del plazo habitual de 7 días corridos (100% bonificado, sin cargo de financiación).`;
        } else if (dias >= 8 && dias <= 14) {
            bloqueCondicion = `Lleva *${dias} días*, dentro de la ventana de cortesía hasta el día 14 sin cargo de financiación. Desde el día 15 aplica el servicio de financiación (0,1% diario / 3% mensual sobre saldo).`;
        } else if (dias > 14) {
            bloqueCondicion = `El comprobante lleva *${dias} días corridos* (superando la ventana de cortesía de 14 días), por lo que aplica el servicio de financiación de 0,1% diario (3% mensual + IVA) sobre el saldo pendiente.`;
        } else {
            bloqueCondicion = `Los primeros 7 días corridos son 100% bonificados (ventana de cortesía hasta el día 14 sin cargo, y desde el día 15 servicio de financiación de 0,1% diario sobre saldo).`;
        }

        const detallePoliticas = [
            `Te dejo el detalle de tu cuenta corriente: figura un saldo pendiente de *${saldoFmt}*${desgloseParentesis}${compTxt}.`,
            `• *Plazos:* ${bloqueCondicion}`,
            `• *Beneficio:* manteniendo la cuenta en *$0*, se activa el *5% de bonificación* en compras mayores a $300.000 y acceso a ofertas.`,
            `Avisame cómo te queda cómodo organizarlo.`
        ].join('\n');

        return {
            mencionCortaInline: limpiarSignosAperturaWa(lineaCorta),
            mencionCortaBurbuja: limpiarSignosAperturaWa(`${lineaCorta} Cualquier cosa estamos atentos.`),
            detalleSaldoYPoliticasBurbuja: limpiarSignosAperturaWa(detallePoliticas)
        };
    }

    window.generarTextosMencionSaldoWa = generarTextosMencionSaldoWa;

    function construirBloquePortalDeterminista(st) {
        const urlBase = String(st?.urlPortalBase || URL_PORTAL_OFICIAL).replace(/\/+$/, '');
        if (st?.modoLink === 'MAGIC_LINK' && st?.magicLinkDirecto) {
            return st.magicLinkDirecto;
        }
        const esInv = (!st?.yaIngresoPortal || st?.modoLink === 'INVITACION_INICIAL' || st?.modoLink === 'ACTIVACION_CORTA')
            && Boolean(st?.linkActivacionCorto || st?.codigoActivacion);
        if (esInv) {
            const linkInv = st.linkActivacionCorto || `${urlBase}/?t=${st.codigoActivacion}`;
            if (st.codigoActivacion) {
                return `🔑 Invitación inicial al Portal de Clientes:\nCódigo de activación: *${st.codigoActivacion}*\nEntrá acá para crear tu clave por primera vez: ${linkInv}`;
            }
            return linkInv;
        }
        return urlBase;
    }

    /**
     * Motor liviano de telemetría y ensamblado determinista (Fase 3):
     * No duplica redacción heurística por regex; consume directamente `st.razonamientoIa`
     * emitido por los 8 Especialistas de Backend y resuelve la Burbuja 2 determinista (Precios / Link Portal).
     */
    window.ejecutarMesaAgentesComercialesWa = function (st) {
        const msgs = Array.isArray(st?.mensajesCompleta) && st.mensajesCompleta.length > 0
            ? st.mensajesCompleta
            : (Array.isArray(st?.mensajesRecientes) ? st.mensajesRecientes : []);
        const ultimoMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
        const clienteHabloUltimo = Boolean(ultimoMsg && !ultimoMsg.from_me);

        const ultimosRecientes = msgs.slice(-8);
        const ultimaImagen = ultimosRecientes.slice().reverse().find(m =>
            m && (m.tipo_mensaje === 'image' || String(m.cuerpo || '').trim().startsWith('📷'))
        ) || null;
        const tieneAudioSinTranscribir = ultimosRecientes.some(m =>
            m && (m.tipo_mensaje === 'ptt' || m.tipo_mensaje === 'audio')
            && (!m.cuerpo || String(m.cuerpo).trim() === '🎤 Mensaje de audio')
        );

        const infoContacto = resolverInfoContactoDeterminista(st);
        const ag3 = calcularTelemetriaCuentaDeterminista(st);

        const diasDesdeUltimaCompra = st?.sintesisMemoria?.ciclo_compra?.dias_desde_ultima_compra ?? null;
        const logisticaResumen = st?.rayosX?.logistica_resumen || null;
        const pedidoActivoEnCurso = Boolean(
            logisticaResumen && (logisticaResumen.estado_normalizado === 'EN_PREPARACION' || logisticaResumen.estado_normalizado === 'EN_CAMINO')
        );

        const infoDuraLinkPortal = construirBloquePortalDeterminista(st);
        const infoDuraLinkSeguimientoOrden = infoDuraLinkPortal;

        const raz = (st?.razonamientoIa && st.razonamientoIa.usando_ia_real) ? st.razonamientoIa : null;
        let burbuja1 = '';
        let burbuja2 = '';
        let burbuja3 = '';
        let modoResuelto = st?.agenteEspecialistaActivo || st?.modoAccionProactiva || 'AUTO';
        let carrilUtilizado = st?.carrilAsistente || (clienteHabloUltimo ? 'ENTRANTE' : 'SALIENTE');
        let agenteUtilizado = raz?.agente_utilizado || modoResuelto;
        let diagnosticoEjecutivoAgente = '';
        let sugerirAdjuntarPdf = Boolean(st?.sugerirAdjuntarPdfIa);
        let sugerirAdjuntarPdfCc = Boolean(st?.sugerirAdjuntarPdfCcIa);
        let habilitarGestionFactura = Boolean(st?.habilitarGestionFacturaIa);

        if (raz) {
            carrilUtilizado = raz.carril_utilizado || carrilUtilizado;
            agenteUtilizado = raz.agente_utilizado || agenteUtilizado;
            modoResuelto = agenteUtilizado;
            diagnosticoEjecutivoAgente = raz.explicacion_razonamiento || raz.titulo_intencion || '';
            burbuja1 = limpiarSignosAperturaWa(raz.burbuja1_dialogo || '');
            burbuja3 = limpiarSignosAperturaWa(raz.burbuja3_cierre || '');
            sugerirAdjuntarPdf = Boolean(raz.sugerir_adjuntar_pdf);
            sugerirAdjuntarPdfCc = Boolean(raz.sugerir_adjuntar_pdf_cc);
            habilitarGestionFactura = Boolean(raz.habilitar_gestion_factura);

            if (raz.tipo_burbuja2_determinista === 'PRECIOS_SELECCIONADOS') {
                const codsSet = new Set((raz.codigos_articulos_seleccionados || []).map(c => String(c || '').toUpperCase()));
                const artsSel = (st?.catalogoArticulos || []).filter(a =>
                    codsSet.has(String(a.codigo_unico || '').toUpperCase()) || codsSet.has(String(a.id || '').toUpperCase())
                );
                burbuja2 = artsSel.length > 0
                    ? formatearResumenWhatsAppJerarquiaB2B(artsSel.slice(0, 8), st?.listaId || 1)
                    : '';
            } else if (raz.tipo_burbuja2_determinista === 'LINK_SEGUIMIENTO_ORDEN') {
                burbuja2 = infoDuraLinkSeguimientoOrden;
            } else if (raz.tipo_burbuja2_determinista === 'LINK_PORTAL') {
                burbuja2 = infoDuraLinkPortal;
            }
        } else {
            // Fallback mínimo limpio únicamente cuando Gemini no está disponible o aún no respondió
            const apodo = infoContacto.apodoCorto;
            const saludo = st?.charlaEnCurso
                ? (apodo ? `${apodo}, ` : '')
                : (apodo ? `Hola ${apodo}, ${infoContacto.saludoMomento}! ` : `Hola, ${infoContacto.saludoMomento}! `);
            burbuja1 = limpiarSignosAperturaWa(`${saludo}Cómo venís esta semana? Cualquier cosa avisame.`);
            diagnosticoEjecutivoAgente = st?.errorCriticoIa
                ? 'Modo contingencia: Gemini no respondió. Elegí un especialista o reintentá.'
                : 'Listo para ejecutar el especialista seleccionado.';
        }

        const ag1 = {
            clienteHabloUltimo,
            situacionDialogo: raz?.situacion_dialogo || (clienteHabloUltimo ? 'ENTRANTE' : 'SALIENTE'),
            tituloIntencion: raz?.titulo_intencion || (clienteHabloUltimo ? 'Mensaje entrante del cliente' : 'Gestión saliente'),
            ultimoMensajeCliente: clienteHabloUltimo ? String(ultimoMsg.cuerpo || '') : '',
            tieneImagenReciente: Boolean(ultimaImagen),
            ultimaImagenMsgId: ultimaImagen?.msg_id || null,
            tieneAudioSinTranscribir,
            enviamosResumenCuentaReciente: false
        };

        const ag2 = {
            cantPendientesNotificar: Array.isArray(st?.cambiosPreciosPendientes) ? st.cambiosPreciosPendientes.length : 0,
            diasDesdeUltimaCompra,
            pedidoActivoEnCurso,
            logisticaResumen
        };

        const proactivo = {
            burbuja1,
            burbuja2,
            burbuja3,
            mensajePrincipal: burbuja1,
            modoResuelto,
            carrilUtilizado,
            agenteUtilizado,
            diagnosticoEjecutivoAgente,
            infoDuraLinkPortal,
            infoDuraLinkSeguimientoOrden,
            sugerirAdjuntarPdf,
            sugerirAdjuntarPdfCc,
            habilitarGestionFactura
        };

        return {
            infoContacto,
            ag1,
            ag2,
            ag3,
            proactivo,
            ag4: { estrategias: [{ burbuja1, burbuja2, burbuja3 }] }
        };
    };

    window.renderizarPanelMesaAgentesHtmlWa = function (st, resultadoMesa) {
        if (!st || !resultadoMesa) return '';
        const { ag3 = {}, proactivo = {} } = resultadoMesa;
        return `
            <div style="background:#f0f9ff; border:1px solid #bae6fd; border-left:3px solid #0284c7; border-radius:8px; padding:7px 10px; font-size:0.74rem; color:#0f172a;">
                <strong>🧠 ${escapar(proactivo.agenteUtilizado || 'Asistente Híbrido')}</strong>
                <span style="color:#64748b; margin-left:6px;">${escapar(ag3.badgeCuenta || '')}</span>
                ${proactivo.diagnosticoEjecutivoAgente ? `<div style="margin-top:3px; color:#334155;">${escapar(proactivo.diagnosticoEjecutivoAgente)}</div>` : ''}
            </div>
        `;
    };

    /**
     * Puente directo al Motor Backend de 2 Carriles x 8 Especialistas (POST /api/crm/whatsapp/asistente-hibrido/razonar)
     */
    window.generarConIaGenerativaMesaAgentesWa = async function (st, resultadoMesa, instruccionOperador = '', opciones = {}) {
        const instClean = String(instruccionOperador || '').trim();
        const carrilObjetivo = String(opciones.carril || st?.carrilAsistente || '').trim().toUpperCase();
        const agenteObjetivo = String(opciones.agenteObjetivo || st?.agenteEspecialistaActivo || 'AUTO').trim().toUpperCase();
        const comprobanteLeido = opciones.comprobanteLeido !== undefined
            ? opciones.comprobanteLeido
            : (st?.comprobanteLeido || null);

        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 32000);
        try {
            const catalogoCompactoIa = (st?.catalogoArticulos || []).slice(0, 320).map(a => ({
                codigo: a.codigo_unico || a.id,
                nombre: a.nombre,
                kilos_unidad: Number(a.kilos_unidad || a.peso_bulto || 1),
                familia: a.familia_b2b || a.familia_nombre || '',
                stock_disponible: Number(a.stock_real || 0)
            }));

            const r = await fetch('/api/crm/whatsapp/asistente-hibrido/razonar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: ctrl.signal,
                body: JSON.stringify({
                    clienteId: st?.clienteId || 0,
                    chatId: st?.chatId || 0,
                    clienteNombre: st?.nombreCliente || '',
                    contactoNombre: st?.contactoNombreChat || '',
                    apodoSugerido: st?.nombreCorto || '',
                    carril: carrilObjetivo || undefined,
                    agenteObjetivo,
                    comprobanteLeido,
                    diasSinCompra: st?.sintesisMemoria?.ciclo_compra?.dias_desde_ultima_compra ?? null,
                    contextoLogistico: st?.rayosX?.logistica_resumen || null,
                    mensajesRecientes: (st?.mensajesCompleta || st?.mensajesRecientes || []).slice(-14),
                    catalogoCompacto: catalogoCompactoIa,
                    habitualesCliente: (st?.articulosHabituales || []).slice(0, 20).map(h => ({
                        codigo: h.codigo_unico || h.id,
                        nombre: h.nombre,
                        kg: Number(h.kilos_unidad || 1)
                    })),
                    estadoCuentaDeterminista: {
                        saldo_total: st?.rayosX?.cuenta_corriente?.saldo_actual || 0,
                        tiene_saldo_a_favor: Number(st?.rayosX?.cuenta_corriente?.saldo_actual || 0) < -10,
                        pedidos_activos_en_curso: (st?.rayosX?.pedidos_recientes || [])
                            .filter(p => !/entregad|anulad|cancelad|baja/i.test(`${p.estado || ''} ${p.secuencia || ''} ${p.estado_logistico || ''}`))
                            .map(p => ({ id: p.id, estado: p.estado, secuencia: p.secuencia, total: p.total }))
                    },
                    linkPortalCliente: (!st?.yaIngresoPortal && st?.linkActivacionCorto)
                        ? st.linkActivacionCorto
                        : (st?.urlPortalBase || URL_PORTAL_OFICIAL),
                    yaIngresoPortal: Boolean(st?.yaIngresoPortal && st?.modoLink !== 'INVITACION_INICIAL'),
                    instruccionOperador: instClean,
                    forzarRecalculo: Boolean(opciones.forzarRecalculo || instClean || agenteObjetivo !== 'AUTO')
                })
            });

            const data = await r.json().catch(() => null);
            if (!r.ok || !data || !data.success || !data.razonamiento || !data.razonamiento.usando_ia_real) {
                throw new Error(data?.error || `El servicio de IA (Gemini) no respondió (HTTP ${r.status}).`);
            }

            const raz = data.razonamiento;
            st.razonamientoIa = raz;
            st.errorCriticoIa = '';
            st.carrilAsistente = raz.carril_utilizado || carrilObjetivo || st.carrilAsistente;
            st.agenteEspecialistaActivo = raz.agente_utilizado || agenteObjetivo;
            st.sugerirAdjuntarPdfIa = Boolean(raz.sugerir_adjuntar_pdf);
            st.sugerirAdjuntarPdfCcIa = Boolean(raz.sugerir_adjuntar_pdf_cc);
            st.habilitarGestionFacturaIa = Boolean(raz.habilitar_gestion_factura);

            if (Array.isArray(raz.codigos_articulos_pdf_sugeridos) && raz.codigos_articulos_pdf_sugeridos.length > 0) {
                const codsPdfSet = new Set(raz.codigos_articulos_pdf_sugeridos.map(c => String(c || '').toUpperCase()));
                const artsPdf = (st.catalogoArticulos || []).filter(a =>
                    codsPdfSet.has(String(a.codigo_unico || '').toUpperCase()) || codsPdfSet.has(String(a.id || '').toUpperCase())
                );
                if (artsPdf.length > 0) {
                    st.articulosPdfSugeridosIa = artsPdf;
                }
            }

            let b2 = '';
            if (raz.tipo_burbuja2_determinista === 'PRECIOS_SELECCIONADOS') {
                const codsSet = new Set((raz.codigos_articulos_seleccionados || []).map(c => String(c || '').toUpperCase()));
                const artsSel = (st.catalogoArticulos || []).filter(a =>
                    codsSet.has(String(a.codigo_unico || '').toUpperCase()) || codsSet.has(String(a.id || '').toUpperCase())
                );
                if (artsSel.length > 0 && st.idsSeleccionados) {
                    st.idsSeleccionados = new Set(artsSel.map(a => String(a.id)));
                }
                b2 = formatearResumenWhatsAppJerarquiaB2B(artsSel.slice(0, 8), st.listaId || 1);
            } else if (raz.tipo_burbuja2_determinista === 'LINK_SEGUIMIENTO_ORDEN') {
                b2 = resultadoMesa?.proactivo?.infoDuraLinkSeguimientoOrden || construirBloquePortalDeterminista(st);
            } else if (raz.tipo_burbuja2_determinista === 'LINK_PORTAL') {
                b2 = resultadoMesa?.proactivo?.infoDuraLinkPortal || construirBloquePortalDeterminista(st);
            }

            if (typeof window.registrarLlamadaCreditoIaWa === 'function') {
                window.registrarLlamadaCreditoIaWa({
                    cliente: st.nombreCliente || 'Cliente',
                    tipo: `${raz.carril_utilizado || ''} · ${raz.agente_utilizado || 'Especialista'}`,
                    usage: raz._usage || null
                });
            }

            return {
                burbuja1: limpiarSignosAperturaWa(raz.burbuja1_dialogo || ''),
                burbuja2: b2,
                burbuja3: limpiarSignosAperturaWa(raz.burbuja3_cierre || ''),
                sugerirAdjuntarPdf: Boolean(raz.sugerir_adjuntar_pdf),
                sugerirAdjuntarPdfCc: Boolean(raz.sugerir_adjuntar_pdf_cc),
                habilitarGestionFactura: Boolean(raz.habilitar_gestion_factura),
                carrilUtilizado: raz.carril_utilizado,
                agenteUtilizado: raz.agente_utilizado,
                pasoEnEspera: raz.explicacion_razonamiento || 'Mensaje generado con Gemini 2.5 Flash + Clavijas Deterministas.'
            };
        } catch (err) {
            const msg = err?.name === 'AbortError'
                ? 'Tiempo de espera agotado (32s): el servicio de IA (Gemini) no respondió.'
                : (err?.message || 'No se pudo conectar con el servicio de IA (Gemini).');
            st.errorCriticoIa = msg;
            throw new Error(msg);
        } finally {
            clearTimeout(timer);
        }
    };

    // ======================================================================================
    // 📊 MONITOR GLOBAL DE CRÉDITO IA GEMINI Y ACORDEÓN DE CONEXIÓN EN PIZARRA PRINCIPAL
    // ======================================================================================
    const STORAGE_KEY_CREDIT_TRACKER_IA = 'lamda_wa_ia_credit_tracker_v1';
    const _llamadasIaContabilizadasSet = new Set();

    function leerLedgerCreditoIaWa() {
        const hoyKey = new Date().toLocaleDateString('es-AR');
        let base = {
            saldoInicialUsd: 9.99,
            fechaRecarga: '04/11/2026',
            recargaAutomatica: true,
            billingAccountId: '01B986-C7D7EB-F97B7A',
            tokensDesdeRecarga: 0,
            consumidoDesdeRecargaUsd: 0,
            llamadasDesdeRecarga: 0,
            tokensHoy: 0,
            consumidoHoyUsd: 0,
            llamadasHoy: 0,
            estadoCuenta: 'OK',
            ultimoError402: '',
            ultimaVerificacionHora: '',
            fechaHoy: hoyKey,
            historialReciente: []
        };
        try {
            const raw = localStorage.getItem(STORAGE_KEY_CREDIT_TRACKER_IA);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    base = { ...base, ...parsed };
                    if (!base.saldoInicialUsd || Number(base.saldoInicialUsd) === 0) {
                        base.saldoInicialUsd = 9.99;
                        base.fechaRecarga = '04/11/2026';
                    }
                }
            }
        } catch (_) {}
        if (base.fechaHoy !== hoyKey) {
            base.fechaHoy = hoyKey;
            base.tokensHoy = 0;
            base.consumidoHoyUsd = 0;
            base.llamadasHoy = 0;
        }
        if (!base.tokensDesdeRecarga && Array.isArray(base.historialReciente) && base.historialReciente.length > 0) {
            base.tokensDesdeRecarga = base.historialReciente.reduce((acc, it) => acc + Number(it.tokens || 0), 0);
            base.tokensHoy = base.tokensDesdeRecarga;
        }
        return base;
    }

    function guardarLedgerCreditoIaWa(ledger) {
        try {
            localStorage.setItem(STORAGE_KEY_CREDIT_TRACKER_IA, JSON.stringify(ledger));
        } catch (_) {}
        if (typeof window.renderizarWidgetCreditoIaPizarra === 'function') {
            window.renderizarWidgetCreditoIaPizarra();
        }
    }

    let _cacheDiscoLedger = null;
    async function sincronizarLedgerDiscoIa() {
        try {
            const r = await fetch(`/temp/ia_credito_ledger.json?t=${Date.now()}`);
            if (r.ok) {
                const d = await r.json();
                if (d && typeof d === 'object') {
                    _cacheDiscoLedger = d;
                }
            }
        } catch (_) {}
        return _cacheDiscoLedger;
    }

    function obtenerMetricasConsolidadasIa() {
        const local = leerLedgerCreditoIaWa();
        const disco = _cacheDiscoLedger || {};
        const tokensHoy = Math.max(Number(local.tokensHoy || 0), Number(disco.tokensHoy || 0));
        const tokensDesdeRecarga = Math.max(Number(local.tokensDesdeRecarga || 0), Number(disco.tokensDesdeRecarga || 0), tokensHoy);
        const consumidoHoyUsd = Math.max(Number(local.consumidoHoyUsd || 0), Number(disco.consumidoHoyUsd || 0));
        const consumidoDesdeRecargaUsd = Math.max(Number(local.consumidoDesdeRecargaUsd || 0), Number(disco.consumidoDesdeRecargaUsd || 0), consumidoHoyUsd);
        const llamadasHoy = Math.max(Number(local.llamadasHoy || 0), Number(disco.llamadasHoy || 0));
        const llamadasDesdeRecarga = Math.max(Number(local.llamadasDesdeRecarga || 0), Number(disco.llamadasDesdeRecarga || 0), llamadasHoy);
        const saldoInicialUsd = Number(local.saldoInicialUsd || disco.saldoInicialUsd || 0);
        const agotado402 = local.estadoCuenta === 'SIN_SALDO_402' || disco.estadoCuenta === 'SIN_SALDO_402';
        const saldoRestanteUsd = agotado402 ? 0 : Math.max(0, Number((saldoInicialUsd - consumidoDesdeRecargaUsd).toFixed(4)));

        const histLocal = Array.isArray(local.historialReciente) ? local.historialReciente : [];
        const histDisco = Array.isArray(disco.historialReciente) ? disco.historialReciente.map(h => ({
            hora: h.hora || '',
            modulo: h.modulo || 'Sistema LAMDA',
            cliente: h.detalle || h.modulo || 'Sistema',
            tipo: h.modulo || 'IA Gemini',
            tokens: Number(h.tokens || 0),
            costoUsd: Number(h.costoUsd || 0)
        })) : [];
        const vistos = new Set();
        const historialUnificado = [];
        for (const item of [...histLocal, ...histDisco]) {
            const k = `${item.hora}_${item.tokens}_${item.cliente}`;
            if (!vistos.has(k)) {
                vistos.add(k);
                historialUnificado.push(item);
            }
        }

        return {
            agotado402,
            estadoCuenta: agotado402 ? 'SIN_SALDO_402' : (local.estadoCuenta || 'OK'),
            ultimoError402: local.ultimoError402 || disco.ultimoError || '',
            ultimaVerificacionHora: local.ultimaVerificacionHora || '',
            tieneSaldoConfigurado: saldoInicialUsd > 0,
            saldoInicialUsd,
            fechaRecarga: local.fechaRecarga || disco.fechaRecarga || '',
            saldoRestanteUsd,
            tokensHoy,
            tokensDesdeRecarga,
            consumidoHoyUsd,
            consumidoDesdeRecargaUsd,
            llamadasHoy,
            llamadasDesdeRecarga,
            porModulo: disco.porModulo || {},
            historialReciente: historialUnificado.slice(0, 35)
        };
    }

    window.registrarLlamadaCreditoIaWa = function ({ idUnico = '', modulo = 'Asistente Comercial', cliente = 'Cliente', tipo = 'Consulta IA', usage = null } = {}) {
        const keyDedupe = idUnico || `${cliente}_${tipo}_${usage?.timestamp || Math.floor(Date.now() / 4000)}`;
        if (_llamadasIaContabilizadasSet.has(keyDedupe)) return;
        _llamadasIaContabilizadasSet.add(keyDedupe);

        const ledger = leerLedgerCreditoIaWa();
        const pTok = Number(usage?.promptTokens || 1200);
        const cTok = Number(usage?.completionTokens || 220);
        const totalTok = Number(usage?.totalTokens || (pTok + cTok));
        const costoUsd = Number(usage?.costoUsd || ((pTok * 0.0000003) + (cTok * 0.0000025)));

        ledger.estadoCuenta = 'OK';
        ledger.ultimoError402 = '';
        ledger.tokensDesdeRecarga = Number(ledger.tokensDesdeRecarga || 0) + totalTok;
        ledger.consumidoDesdeRecargaUsd = Number((Number(ledger.consumidoDesdeRecargaUsd || 0) + costoUsd).toFixed(5));
        ledger.llamadasDesdeRecarga = Number(ledger.llamadasDesdeRecarga || 0) + 1;
        ledger.tokensHoy = Number(ledger.tokensHoy || 0) + totalTok;
        ledger.consumidoHoyUsd = Number((Number(ledger.consumidoHoyUsd || 0) + costoUsd).toFixed(5));
        ledger.llamadasHoy = Number(ledger.llamadasHoy || 0) + 1;

        const horaStr = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const itemHist = {
            hora: horaStr,
            modulo,
            cliente: String(cliente || 'Sistema').slice(0, 32),
            tipo,
            tokens: totalTok,
            costoUsd: Number(costoUsd.toFixed(5))
        };
        ledger.historialReciente = [itemHist, ...(Array.isArray(ledger.historialReciente) ? ledger.historialReciente : [])].slice(0, 35);
        guardarLedgerCreditoIaWa(ledger);
    };

    window.obtenerEstadoMedidorCreditoIaWa = function (st) {
        if (st && st.razonamientoIa && st.razonamientoIa.usando_ia_real) {
            const idRaz = `${st.clienteId || 0}_${st.chatId || 0}_${st.razonamientoIa.titulo_intencion || ''}`;
            window.registrarLlamadaCreditoIaWa({
                idUnico: idRaz,
                modulo: 'Comercial / CRM',
                cliente: st.nombreCliente || 'Cliente',
                tipo: 'Asistente Comercial',
                usage: st.razonamientoIa._usage || null
            });
        }
        const errStr = String(st?.errorCriticoIa || '').toLowerCase();
        if (errStr.includes('402') || errStr.includes('prepayment credits are depleted')) {
            const ledger = leerLedgerCreditoIaWa();
            ledger.estadoCuenta = 'SIN_SALDO_402';
            ledger.ultimoError402 = st?.errorCriticoIa || 'HTTP 402: Saldo agotado en Google AI Studio';
            guardarLedgerCreditoIaWa(ledger);
        }
        return obtenerMetricasConsolidadasIa();
    };

    window.__pizarraInfoAccordionOpen = false;
    window.__pizarraWaStatus = 'CONECTADO';
    window.__pizarraWaUnread = 0;
    window.__pizarraConnData = {
        nodeMode: 'LOCAL',
        nodeLabel: 'L · Local (PcAlmacen)',
        dbName: 'etiquetas',
        readOnly: 'off',
        lastSyncFormatted: '--',
        servicesActive: 5,
        servicesTotal: 5,
        servicesDetail: 'Etiquetas, Producción, Presupuestos, Facturación, Logística'
    };

    window.toggleAcordeonInfoSistemaPizarra = function (ev) {
        if (ev) ev.stopPropagation();
        window.__pizarraInfoAccordionOpen = !window.__pizarraInfoAccordionOpen;
        window.renderizarWidgetCreditoIaPizarra();
    };

    if (!window.__pizarraAccordionDocListener) {
        window.__pizarraAccordionDocListener = true;
        document.addEventListener('click', function (ev) {
            if (!window.__pizarraInfoAccordionOpen) return;
            const el = document.getElementById('pizarra-ia-global-widget');
            if (el && !el.contains(ev.target)) {
                window.__pizarraInfoAccordionOpen = false;
                window.renderizarWidgetCreditoIaPizarra();
            }
        });
    }

    window.renderizarWidgetCreditoIaPizarra = function () {
        const el = document.getElementById('pizarra-ia-global-widget');
        if (!el) return;
        const oldSeparate = document.getElementById('pizarra-conexion-global-widget');
        if (oldSeparate) oldSeparate.remove();

        el.onclick = null;
        el.style.position = 'relative';
        el.style.cursor = 'default';

        const m = obtenerMetricasConsolidadasIa();
        const agotado = m.agotado402 || (m.tieneSaldoConfigurado && m.saldoRestanteUsd <= 0);
        const d = window.__pizarraConnData || {};
        const isCloud = d.nodeMode === 'NUBE';
        const isLab = d.nodeMode === 'LABORATORIO';
        const connIcon = isLab ? '🧪' : (isCloud ? '☁️' : '🏢');
        const shortNode = isLab ? 'L · Lab' : (isCloud ? 'N · Nube' : 'L · Local');
        const connColor = isLab ? '#52525b' : (isCloud ? '#059669' : '#2563eb');
        const allOk = (d.servicesActive || 5) >= (d.servicesTotal || 5);
        const isOpen = Boolean(window.__pizarraInfoAccordionOpen);
        const arrow = isOpen ? '▴' : '▾';

        const waStatus = String(window.__pizarraWaStatus || 'CONECTADO').toUpperCase();
        const waOk = waStatus === 'CONECTADO';
        const waDot = waOk ? '🟢' : (waStatus === 'ESPERANDO_QR' || waStatus === 'CONECTANDO' ? '🟡' : '🔴');
        const waLabel = waOk ? 'Conectado' : (waStatus === 'ESPERANDO_QR' ? 'Esperando QR' : (waStatus === 'CONECTANDO' ? 'Conectando...' : 'Desconectado'));
        const waConfigHref = resolverUrlModulo3004('/pages/whatsapp-config.html');

        const badgeSaldo = m.tieneSaldoConfigurado
            ? `<span style="background: #dcfce7; color: #166534; border: 1px solid #86efac; padding: 1px 7px; border-radius: 999px; font-size: 0.71rem; font-weight: 800;">Saldo est.: USD $${m.saldoRestanteUsd.toFixed(2)}</span>`
            : `<span style="background: #e0f2fe; color: #0369a1; border: 1px solid #7dd3fc; padding: 1px 7px; border-radius: 999px; font-size: 0.7rem; font-weight: 800;">Configurar saldo</span>`;

        const roLabel = d.readOnly === 'on'
            ? '<span style="color:#d97706;">(Solo lectura)</span>'
            : '<span style="color:#16a34a;">(Escritura)</span>';

        const pillBg = agotado ? '#fef2f2' : '#f8fafc';
        const pillBorder = agotado ? '#ef4444' : '#cbd5e1';

        el.innerHTML = `
            <div onclick="window.toggleAcordeonInfoSistemaPizarra(event)" title="Clic para desplegar información de Conexión, IA Gemini, Mamus e Instalar LAMDA" style="background: ${pillBg}; border: 1px solid ${pillBorder}; border-left: 4px solid ${connColor}; border-radius: 999px; padding: 5px 13px; display: inline-flex; align-items: center; gap: 9px; cursor: pointer; user-select: none; box-shadow: 0 1px 4px rgba(15,23,42,0.06); transition: all 0.15s ease;">
                <span style="font-size: 0.76rem; font-weight: 800; color: #1e293b;">${connIcon} ${shortNode}</span>
                <span style="background: ${allOk ? '#dcfce7' : '#fef3c7'}; color: ${allOk ? '#166534' : '#92400e'}; border: 1px solid ${allOk ? '#86efac' : '#fcd34d'}; padding: 1px 6px; border-radius: 999px; font-size: 0.69rem; font-weight: 800;">${d.servicesActive || 5}/${d.servicesTotal || 5}</span>
                <span style="color: #cbd5e1;">|</span>
                <span style="font-size: 0.75rem; font-weight: 800; color: ${agotado ? '#dc2626' : '#065f46'};">${agotado ? '🚨 IA $0' : '🟢 IA Gemini'}</span>
                <span style="font-size: 0.75rem; color: #64748b; font-weight: 900; margin-left: 2px;">${arrow}</span>
            </div>
            ${isOpen ? `
            <div class="pizarra-ia-dropdown-panel" onclick="event.stopPropagation()" style="position: absolute; right: 0; top: calc(100% + 7px); z-index: 300; width: 430px; max-width: 94vw; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 14px; padding: 12px 14px; box-shadow: 0 12px 32px rgba(15,23,42,0.18); text-align: left;">
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 9px 11px; margin-bottom: 10px;">
                    <div style="font-size: 0.69rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.4px; color: #64748b; margin-bottom: 7px;">
                        Herramientas y Accesos
                    </div>
                    <div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
                        <button type="button" onclick="event.stopPropagation(); window.__pizarraInfoAccordionOpen = false; window.renderizarWidgetCreditoIaPizarra(); if (window.abrirEspacioMamus) window.abrirEspacioMamus();" style="background: #fdf2f8; color: #be185d; border: 1px solid #f472b6; font-size: 0.76rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; padding: 5px 11px; border-radius: 999px;">
                            <span>🌸</span><span>Mamus</span>
                        </button>
                        <button type="button" onclick="event.stopPropagation(); window.__pizarraInfoAccordionOpen = false; window.renderizarWidgetCreditoIaPizarra(); if (window.instalarAccesoDirectoLamdaPrueba) window.instalarAccesoDirectoLamdaPrueba();" style="background: #f5f3ff; color: #5b21b6; border: 1px solid #c4b5fd; font-size: 0.76rem; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; padding: 5px 11px; border-radius: 999px;">
                            <span>📲</span><span>Instalar LAMDA</span>
                        </button>
                        <a href="${waConfigHref}" style="background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; font-size: 0.73rem; font-weight: 700; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; padding: 5px 9px; border-radius: 999px;" title="Abrir Configuración y Estado QR de WhatsApp">
                            <span>${waDot}</span><span>QR / Estado WA (${waLabel})</span>
                        </a>
                    </div>
                </div>
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid ${connColor}; border-radius: 10px; padding: 9px 12px; margin-bottom: 10px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap;">
                        <span style="font-size: 0.78rem; font-weight: 800; color: #0f172a;">${connIcon} Conectado: ${d.nodeLabel || shortNode}</span>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span style="background: ${allOk ? '#dcfce7' : '#fef3c7'}; color: ${allOk ? '#166534' : '#92400e'}; border: 1px solid ${allOk ? '#86efac' : '#fcd34d'}; padding: 1px 7px; border-radius: 999px; font-size: 0.7rem; font-weight: 800;" title="${d.servicesDetail || ''}">Servicios: ${d.servicesActive || 5}/${d.servicesTotal || 5} activos</span>
                            <button type="button" onclick="event.stopPropagation(); window.renderizarWidgetConexionPizarra(true)" style="background: #ffffff; color: #0369a1; border: 1px solid #93c5fd; border-radius: 6px; padding: 2px 7px; font-size: 0.68rem; font-weight: 800; cursor: pointer;" title="Actualizar estado de conexión">🔄</button>
                        </div>
                    </div>
                    <div style="font-size: 0.74rem; color: #334155; font-weight: 700; margin-top: 5px; line-height: 1.45;">
                        Base: <strong style="color:#0f172a;">${d.dbName || 'etiquetas'}</strong> ${roLabel}
                        &nbsp;·&nbsp;
                        WhatsApp: <strong style="color:${waOk ? '#15803d' : '#dc2626'};">${waDot} ${waLabel}</strong>
                        <br>
                        Últ. act./sync: <strong style="color:#0369a1;">${d.lastSyncFormatted || '--'}</strong>
                    </div>
                </div>
                <div style="background: ${agotado ? '#fef2f2' : '#f8fafc'}; border: 1px solid ${agotado ? '#fca5a5' : '#e2e8f0'}; border-left: 4px solid ${agotado ? '#dc2626' : '#059669'}; border-radius: 10px; padding: 9px 12px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap;">
                        <span style="font-size: 0.78rem; font-weight: 800; color: ${agotado ? '#991b1b' : '#065f46'};">${agotado ? '🚨 CRÉDITO IA EN $0' : '🟢 IA Gemini Activa'}</span>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            ${badgeSaldo}
                            <button type="button" onclick="event.stopPropagation(); window.verificarEstadoCuentaIaSilencioso(true)" style="background: #ffffff; color: #0369a1; border: 1px solid #93c5fd; border-radius: 6px; padding: 2px 7px; font-size: 0.68rem; font-weight: 800; cursor: pointer;" title="Consultar en caliente a Google AI Studio">🔄 En caliente</button>
                        </div>
                    </div>
                    <div style="font-size: 0.74rem; color: #334155; font-weight: 700; margin-top: 5px; font-variant-numeric: tabular-nums;">
                        Hoy: <strong style="color:#0f172a;">${Number(m.tokensHoy || 0).toLocaleString('es-AR')} tok</strong> <span style="color:#64748b;">(~$${Number(m.consumidoHoyUsd || 0).toFixed(4)} USD)</span>
                        &nbsp;·&nbsp;
                        Acum.: <strong style="color:#0369a1;">${Number(m.tokensDesdeRecarga || 0).toLocaleString('es-AR')} tok</strong>
                    </div>
                    <div style="margin-top: 7px; text-align: right;">
                        <button type="button" onclick="event.stopPropagation(); window.__pizarraInfoAccordionOpen = false; window.renderizarWidgetCreditoIaPizarra(); if (window.abrirModalControlCreditoIaGlobal) window.abrirModalControlCreditoIaGlobal();" style="background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; border-radius: 6px; padding: 3px 9px; font-size: 0.7rem; font-weight: 800; cursor: pointer;">
                            ⚙️ Abrir Control de Crédito y Consumo IA
                        </button>
                    </div>
                </div>
            </div>
            ` : ''}
        `;

        if (typeof window.renderizarWidgetConexionPizarra === 'function' && !window.__connBoxInitialized) {
            window.__connBoxInitialized = true;
            window.renderizarWidgetConexionPizarra(false);
            setInterval(() => window.renderizarWidgetConexionPizarra(false), 25000);
        }
    };

    window.renderizarWidgetConexionPizarra = async function (forzarToast = false) {
        try {
            const [respConn, respWa] = await Promise.all([
                fetch('api/system/connection-box?_t=' + Date.now()).catch(() => null),
                fetch(resolverUrlModulo3004('/facturacion/whatsapp/status')).catch(() => null)
            ]);
            if (respWa && respWa.ok) {
                const jWa = await respWa.json().catch(() => null);
                if (jWa && jWa.success && jWa.data && jWa.data.status) {
                    window.__pizarraWaStatus = jWa.data.status;
                }
            }
            if (!respConn || !respConn.ok) return;
            const d = await respConn.json();
            window.__pizarraConnData = d;
            window.renderizarWidgetCreditoIaPizarra();
            if (forzarToast && typeof Swal !== 'undefined') {
                const icon = d.nodeMode === 'LABORATORIO' ? '🧪' : (d.nodeMode === 'NUBE' ? '☁️' : '🏢');
                Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: 'info',
                    title: `${icon} ${d.nodeLabel} · BD: ${d.dbName} (${d.servicesActive}/${d.servicesTotal} activos)`,
                    showConfirmButton: false,
                    timer: 2500
                });
            }
        } catch (_) {}
    };

    window.verificarEstadoCuentaIaSilencioso = async function (mostrarToast = false) {
        await sincronizarLedgerDiscoIa();
        try {
            const r = await fetch(resolverUrlModulo3004('/facturacion/cuentas-bancarias/ia-status'), { method: 'GET' });
            const j = await r.json().catch(() => null);
            const ledger = leerLedgerCreditoIaWa();
            ledger.ultimaVerificacionHora = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            if (r.ok && j && j.data && j.data.activa) {
                ledger.estadoCuenta = 'OK';
                ledger.ultimoError402 = '';
                guardarLedgerCreditoIaWa(ledger);
                if (mostrarToast) {
                    window.registrarLlamadaCreditoIaWa({
                        idUnico: `ping_${Date.now()}`,
                        modulo: 'Verificación en Caliente',
                        cliente: 'Google AI Studio',
                        tipo: 'Ping de Estado',
                        usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12, costoUsd: 0.00001 }
                    });
                }
                if (mostrarToast && typeof Swal !== 'undefined') {
                    Swal.fire({
                        toast: true,
                        position: 'top-end',
                        icon: 'success',
                        title: `🟢 Crédito IA Activo en Google (${j.data.modelo || 'Gemini 2.5 Flash'})`,
                        showConfirmButton: false,
                        timer: 2800
                    });
                }
            } else {
                const razon = String(j?.data?.razon || 'Sin respuesta');
                if (razon.includes('402') || razon.toLowerCase().includes('prepayment credits are depleted') || razon.toLowerCase().includes('quota')) {
                    ledger.estadoCuenta = 'SIN_SALDO_402';
                    ledger.ultimoError402 = razon;
                }
                guardarLedgerCreditoIaWa(ledger);
                if (mostrarToast && typeof Swal !== 'undefined') {
                    Swal.fire({
                        toast: true,
                        position: 'top-end',
                        icon: 'error',
                        title: `🔴 Alerta IA: ${razon.slice(0, 90)}`,
                        showConfirmButton: false,
                        timer: 4000
                    });
                }
            }
        } catch (_) {
            window.renderizarWidgetCreditoIaPizarra();
        }
    };

    window.abrirModalControlCreditoIaGlobal = async function () {
        await sincronizarLedgerDiscoIa();
        const m = obtenerMetricasConsolidadasIa();
        const saldoInicial = Number(m.saldoInicialUsd || 0);
        const consumido = Number(m.consumidoDesdeRecargaUsd || 0);
        const restante = m.agotado402 ? 0 : Math.max(0, saldoInicial - consumido);

        const filasHist = (m.historialReciente || []).length === 0
            ? `<tr><td colspan="4" style="padding:10px; text-align:center; color:#64748b;">Todavía no se registraron llamadas en este ciclo.</td></tr>`
            : (m.historialReciente || []).map(h => `
                <tr style="border-bottom:1px solid #f1f5f9; font-size:0.75rem;">
                    <td style="padding:5px 8px; color:#475569; font-weight:700;">${escapar(h.hora)}</td>
                    <td style="padding:5px 8px; color:#0f172a; font-weight:800;">${escapar(h.modulo || h.tipo || 'Sistema')} · <span style="font-weight:600; color:#475569;">${escapar(h.cliente)}</span></td>
                    <td style="padding:5px 8px; color:#0369a1; font-weight:800;">${Number(h.tokens || 0).toLocaleString('es-AR')} tokens</td>
                    <td style="padding:5px 8px; text-align:right; color:#b45309; font-weight:800;">-$${Number(h.costoUsd || 0).toFixed(4)} USD</td>
                </tr>
            `).join('');

        Swal.fire({
            title: '🤖 Control General de Crédito y Consumo IA — Sistema LAMDA',
            width: '720px',
            html: `
                <div style="text-align:left; font-family:inherit; color:#1e293b; font-size:0.82rem;">
                    <div style="background:#f0f9ff; border:1px solid #bae6fd; border-left:4px solid #0284c7; border-radius:8px; padding:9px 12px; margin-bottom:10px; line-height:1.4;">
                        <strong>Módulos del Sistema que utilizan IA (Gemini 2.5 Flash):</strong><br>
                        <span style="font-size:0.76rem; color:#334155;">
                            1️⃣ <strong>Cuentas Bancarias</strong> · 2️⃣ <strong>Recepción Lotes</strong> · 3️⃣ <strong>Audios (entrantes + salientes)</strong> · 4️⃣ <strong>Asistente Comercial & Visión de Comprobantes</strong>
                        </span>
                    </div>
                    <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-bottom:12px;">
                        <div style="background:${m.agotado402 ? '#fef2f2' : '#ecfdf5'}; border:1px solid ${m.agotado402 ? '#f87171' : '#86efac'}; border-radius:8px; padding:8px 10px;">
                            <div style="font-size:0.69rem; font-weight:800; color:${m.agotado402 ? '#991b1b' : '#065f46'}; text-transform:uppercase;">${m.agotado402 ? '🚨 Sin Saldo ($0)' : '🟢 Saldo Disponible Est.'}</div>
                            <div style="font-size:1.22rem; font-weight:900; color:${m.agotado402 ? '#dc2626' : '#047857'}; margin-top:2px;">USD $${restante.toFixed(3)}</div>
                            <div style="font-size:0.68rem; color:#065f46;">Base fijada: USD $${saldoInicial.toFixed(2)} ${m.fechaRecarga ? `(${escapar(m.fechaRecarga)})` : ''}</div>
                        </div>
                        <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:8px 10px;">
                            <div style="font-size:0.69rem; font-weight:800; color:#92400e; text-transform:uppercase;">Tokens Hoy</div>
                            <div style="font-size:1.22rem; font-weight:900; color:#b45309; margin-top:2px;">${Number(m.tokensHoy || 0).toLocaleString('es-AR')} tok</div>
                            <div style="font-size:0.68rem; color:#92400e;">~$${Number(m.consumidoHoyUsd || 0).toFixed(4)} USD (${Number(m.llamadasHoy || 0)} llamadas)</div>
                        </div>
                        <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; padding:8px 10px;">
                            <div style="font-size:0.69rem; font-weight:800; color:#334155; text-transform:uppercase;">Tokens Acumulados</div>
                            <div style="font-size:1.22rem; font-weight:900; color:#0f172a; margin-top:2px;">${Number(m.tokensDesdeRecarga || 0).toLocaleString('es-AR')} tok</div>
                            <div style="font-size:0.68rem; color:#475569;">~$${consumido.toFixed(4)} USD (${Number(m.llamadasDesdeRecarga || 0)} llamadas)</div>
                        </div>
                    </div>
                    <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; padding:10px 12px; margin-bottom:10px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:6px;">
                            <label style="font-weight:800; font-size:0.78rem; color:#0f172a;">💰 Estado en Caliente y Saldo (USD):</label>
                            <div style="display:flex; gap:6px; align-items:center;">
                                <button type="button" id="btn-swal-probe-google-ia" onclick="window.probarEstadoEnCalienteGoogleIaWa()" style="padding:4px 9px; border-radius:6px; border:1px solid #0284c7; background:#e0f2fe; color:#0369a1; font-size:0.72rem; font-weight:800; cursor:pointer;">🔄 Consultar Google en Caliente</button>
                                <a href="https://aistudio.google.com/billing?billing=01B986-C7D7EB-F97B7A" target="_blank" style="font-size:0.73rem; font-weight:800; color:#2563eb; text-decoration:underline;">🔗 Facturación ↗</a>
                            </div>
                        </div>
                        <div id="swal-probe-google-ia-result" style="display:none; margin-bottom:7px; padding:6px 9px; border-radius:6px; font-size:0.74rem; font-weight:700;"></div>
                        <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                            <input type="number" id="swal-input-saldo-ia-usd" step="0.01" min="0" value="${restante > 0 ? restante.toFixed(2) : 10}" style="width:120px; padding:6px 9px; border-radius:6px; border:1px solid #94a3b8; font-size:0.85rem; font-weight:800; color:#0f172a;">
                            <button type="button" onclick="document.getElementById('swal-input-saldo-ia-usd').value='5'" style="padding:5px 9px; border-radius:6px; border:1px solid #cbd5e1; background:#fff; font-size:0.73rem; font-weight:800; cursor:pointer;">USD $5</button>
                            <button type="button" onclick="document.getElementById('swal-input-saldo-ia-usd').value='10'" style="padding:5px 9px; border-radius:6px; border:1px solid #cbd5e1; background:#fff; font-size:0.73rem; font-weight:800; cursor:pointer;">USD $10</button>
                            <button type="button" onclick="document.getElementById('swal-input-saldo-ia-usd').value='20'" style="padding:5px 9px; border-radius:6px; border:1px solid #cbd5e1; background:#fff; font-size:0.73rem; font-weight:800; cursor:pointer;">USD $20</button>
                            <button type="button" onclick="window.reiniciarContadorTokensIa()" style="padding:5px 9px; border-radius:6px; border:1px solid #fca5a5; background:#fef2f2; color:#991b1b; font-size:0.72rem; font-weight:800; cursor:pointer;">🧹 Poner Contador en 0</button>
                        </div>
                    </div>
                    <div style="font-weight:800; font-size:0.75rem; color:#334155; margin-bottom:4px;">📋 Últimas llamadas de IA registradas:</div>
                    <div style="max-height:165px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:7px; background:#fff;">
                        <table style="width:100%; border-collapse:collapse;">
                            <thead style="background:#f1f5f9; font-size:0.69rem; color:#475569; text-transform:uppercase;">
                                <tr>
                                    <th style="padding:5px 8px; text-align:left;">Hora</th>
                                    <th style="padding:5px 8px; text-align:left;">Módulo / Detalle</th>
                                    <th style="padding:5px 8px; text-align:left;">Tokens</th>
                                    <th style="padding:5px 8px; text-align:right;">Costo Est.</th>
                                </tr>
                            </thead>
                            <tbody>${filasHist}</tbody>
                        </table>
                    </div>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: '💾 Guardar Saldo y Actualizar Pizarra',
            confirmButtonColor: '#059669',
            cancelButtonText: 'Cerrar'
        }).then((res) => {
            if (res.isConfirmed) {
                const inp = document.getElementById('swal-input-saldo-ia-usd');
                const valUsd = Math.max(0, parseFloat(inp ? inp.value : 0) || 0);
                const nuevoLedger = leerLedgerCreditoIaWa();
                nuevoLedger.saldoInicialUsd = valUsd;
                nuevoLedger.consumidoDesdeRecargaUsd = 0;
                nuevoLedger.llamadasDesdeRecarga = 0;
                nuevoLedger.tokensDesdeRecarga = 0;
                nuevoLedger.estadoCuenta = valUsd > 0 ? 'OK' : nuevoLedger.estadoCuenta;
                nuevoLedger.fechaRecarga = new Date().toLocaleDateString('es-AR');
                guardarLedgerCreditoIaWa(nuevoLedger);
            }
            window.renderizarWidgetCreditoIaPizarra();
        });
    };

    window.abrirModalControlCreditoIaWa = window.abrirModalControlCreditoIaGlobal;

    window.reiniciarContadorTokensIa = function () {
        const ledger = leerLedgerCreditoIaWa();
        ledger.tokensHoy = 0;
        ledger.tokensDesdeRecarga = 0;
        ledger.consumidoHoyUsd = 0;
        ledger.consumidoDesdeRecargaUsd = 0;
        ledger.llamadasHoy = 0;
        ledger.llamadasDesdeRecarga = 0;
        ledger.historialReciente = [];
        guardarLedgerCreditoIaWa(ledger);
        window.abrirModalControlCreditoIaGlobal();
    };

    window.probarEstadoEnCalienteGoogleIaWa = async function () {
        const box = document.getElementById('swal-probe-google-ia-result');
        const btn = document.getElementById('btn-swal-probe-google-ia');
        if (!box) return;
        box.style.display = 'block';
        box.style.background = '#f1f5f9';
        box.style.border = '1px solid #cbd5e1';
        box.style.color = '#334155';
        box.textContent = '⏳ Consultando en vivo a Google AI Studio (generativelanguage.googleapis.com)...';
        if (btn) btn.disabled = true;

        const t0 = Date.now();
        try {
            let okLive = false;
            let modeloLive = 'gemini-2.5-flash';
            let errLive = '';
            try {
                const r3004 = await fetch(resolverUrlModulo3004('/facturacion/cuentas-bancarias/ia-status'));
                const j3004 = await r3004.json().catch(() => null);
                if (r3004.ok && j3004?.data?.activa) {
                    okLive = true;
                    modeloLive = j3004.data.modelo || modeloLive;
                } else if (j3004?.data?.razon) {
                    errLive = j3004.data.razon;
                }
            } catch (_) {}

            if (!okLive) {
                const r = await fetch('/api/crm/whatsapp/asistente-hibrido/razonar', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        clienteId: 0,
                        clienteNombre: 'Verificación de Saldo',
                        contactoNombre: 'Operador',
                        carril: 'SALIENTE',
                        agenteObjetivo: 'SALUDO_PUNTUAL',
                        mensajesRecientes: [{ id: 1, from_me: false, cuerpo: 'Hola' }],
                        catalogoCompacto: [],
                        habitualesCliente: [],
                        forzarRecalculo: true
                    })
                });
                const j = await r.json().catch(() => null);
                if (r.ok && j && j.success && j.razonamiento?.usando_ia_real) {
                    okLive = true;
                } else {
                    errLive = String(j?.error || errLive || `HTTP ${r.status}`);
                }
            }

            const ms = Date.now() - t0;
            const ledger = leerLedgerCreditoIaWa();
            if (okLive) {
                ledger.estadoCuenta = 'OK';
                ledger.ultimoError402 = '';
                guardarLedgerCreditoIaWa(ledger);
                window.registrarLlamadaCreditoIaWa({
                    idUnico: `probe_${Date.now()}`,
                    modulo: 'Verificación en Caliente',
                    cliente: 'Google AI Studio',
                    tipo: 'Test Conexión',
                    usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12, costoUsd: 0.00001 }
                });
                box.style.background = '#dcfce7';
                box.style.border = '1px solid #86efac';
                box.style.color = '#166534';
                box.innerHTML = `🟢 <strong>CONEXIÓN ACTIVA EN CALIENTE (${ms} ms · ${escapar(modeloLive)}):</strong> Google AI Studio respondió HTTP 200 OK.`;
            } else {
                const es402 = errLive.includes('402') || errLive.toLowerCase().includes('prepayment credits are depleted');
                if (es402) {
                    ledger.estadoCuenta = 'SIN_SALDO_402';
                    ledger.ultimoError402 = errLive;
                    guardarLedgerCreditoIaWa(ledger);
                }
                box.style.background = '#fef2f2';
                box.style.border = '1px solid #f87171';
                box.style.color = '#991b1b';
                box.innerHTML = es402
                    ? `🔴 <strong>SALDO EN GOOGLE AI STUDIO = USD $0.00 (HTTP 402):</strong> Créditos prepagos agotados.`
                    : `⚠️ <strong>Respuesta de Google (${ms} ms):</strong> ${escapar(errLive)}`;
            }
        } catch (err) {
            box.style.background = '#fef2f2';
            box.style.border = '1px solid #f87171';
            box.style.color = '#991b1b';
            box.textContent = `❌ Error de red consultando estado en caliente: ${err.message}`;
        } finally {
            if (btn) btn.disabled = false;
            window.renderizarWidgetCreditoIaPizarra();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.renderizarWidgetCreditoIaPizarra();
            window.verificarEstadoCuentaIaSilencioso(false);
            setInterval(() => {
                sincronizarLedgerDiscoIa().then(() => window.renderizarWidgetCreditoIaPizarra());
            }, 8000);
        });
    } else {
        window.renderizarWidgetCreditoIaPizarra();
        window.verificarEstadoCuentaIaSilencioso(false);
        setInterval(() => {
            sincronizarLedgerDiscoIa().then(() => window.renderizarWidgetCreditoIaPizarra());
        }, 8000);
    }
})();
