/**
 * ======================================================================================
 * 🤝 ASISTENTE COMERCIAL HÍBRIDO DE WHATSAPP — SISTEMA LAMDA
 * ======================================================================================
 * Filosofía Comercial LAMDA (Reglas Conceptuales para Todos los Clientes):
 *   1. Puntuación real de WhatsApp:
 *      - CERO signos de apertura (¿ o ¡). Solo se cierra al final (? o !).
 *   2. Frases cortas, humanas y al pie:
 *      - Entender primero qué nos acaba de decir el cliente antes de proponer nada.
 *      - Respetar cómo lo saluda y cómo cierra el operador en el historial ("Hola Ale, buen día, cómo va?",
 *        "Estoy atento", "Quedamos atentos por cualquier cosa", "Cualquier cosa estamos atentos").
 *   3. Separación estricta entre Texto Libre Corto e Información Dura:
 *      - El texto conversacional va corto y al pie en una burbuja.
 *      - La información dura (Link del Portal, Código, Precios puntuales) va SIEMPRE en burbuja separada.
 *      - El cierre de servicio ("Quedamos atentos por cualquier cosa.") cierra la secuencia.
 *   4. Ofrecer solo lo que el momento amerita:
 *      - Si el cliente dice "por esta semana estamos bien, a la tardecita te escribo":
 *        acusar recibo corto ("Ok Ale, cualquier cosa estamos atentos. Te dejo el link por si querés ver precios en el portal"),
 *        pasar el link separado en la 2da burbuja, y cerrar con "Quedamos atentos por cualquier cosa."
 * ======================================================================================
 */

(function () {
    'use strict';

    const STORAGE_KEY_IA_CONFIG = 'lamda_crm_wa_ia_config_v1';
    const URL_PORTAL_OFICIAL = 'https://portal-clientes-b2b.lamdaser.workers.dev';

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
     * Elimina todos los signos de apertura (¿ y ¡) y sincroniza "buen día" / "buenas tardes"
     * con la hora local real de Argentina para que nunca diga "buenas tardes" a la mañana
     * (incluso si se levanta una memoria guardada en otro horario).
     */
    function limpiarSignosAperturaWa(texto) {
        let out = String(texto || '')
            .replace(/[¿¡]/g, '')
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

    function esMensajeAutomaticoSistema(texto) {
        const t = String(texto || '').trim();
        if (!t) return false;
        return /entrega confirmada|extracto de cuenta corriente|comprobante de pago recibido|te contamos que en el taller|prueba interna|su pedido #\d+ ha sido entregado/i.test(t);
    }

    function nombreProductoConversacional(nombreRaw, incluirFraccion = false) {
        let s = String(nombreRaw || '').trim();
        if (!incluirFraccion) {
            s = s.replace(/\s*[xX]\s*\d+(?:[.,]\d+)?\s*(?:kg|g|gr|grs|lt|l|u|unid|unidades)\b.*$/i, '').trim();
        }
        return s;
    }

    function obtenerMsMensaje(m) {
        if (!m) return 0;
        const raw = m.fecha_mensaje || m.created_at || m.timestamp;
        if (!raw) return 0;
        const ms = new Date(raw).getTime();
        return Number.isFinite(ms) ? ms : 0;
    }

    function formatearTiempoRelativo(ms) {
        if (!ms || ms <= 0) return '';
        const diffMin = Math.max(0, Math.round((Date.now() - ms) / 60000));
        if (diffMin < 2) return 'recién';
        if (diffMin < 60) return `hace ${diffMin} min`;
        const diffHs = Math.round(diffMin / 60);
        if (diffHs < 24) return `hace ${diffHs} h`;
        const diffDias = Math.round(diffHs / 24);
        if (diffDias === 1) return 'ayer';
        return `hace ${diffDias} días`;
    }

    function formatearFechaCortaMensaje(ms) {
        if (!ms || ms <= 0) return '';
        try {
            const d = new Date(ms);
            const hoy = new Date();
            const esHoy = d.toDateString() === hoy.toDateString();
            const hora = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
            if (esHoy) return `Hoy ${hora}`;
            const fecha = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
            return `${fecha} ${hora}`;
        } catch (_) {
            return '';
        }
    }

    /**
     * Quita cualquier frase de cierre ("Estoy atento", "Quedamos atentos...", "Cualquier cosa avisame", etc.)
     * del final de la Burbuja 1 cuando se habilita la Burbuja 2 o la Burbuja 3, evitando repeticiones.
     */
    function limpiarCierreAlFinalDeBurbuja(texto) {
        let s = String(texto || '').trim();
        if (!s) return '';
        const regexCierreAntesDePuente = /(?:\r?\n|\s)+(?:(?:estoy|quedo|quedamos|estamos)\s+atent[oa]s?(?:\s+por\s+(?:cualquier\s+(?:cosa|consulta|duda)|si\s+necesit[aá](?:s|n)\s+algo))?|(?:quedamos|estoy|quedo)\s+a\s+disposici[oó]n(?:\s+por\s+cualquier\s+(?:cosa|consulta))?|cualquier\s+(?:cosa|cosita|duda|consulta)\s+(?:escribime|escribanme|avisame|avisanos|avisen|estamos\s+atentos|quedamos\s+atentos|me\s+dec[ií]s)(?:\s+por\s+ac[aá])?|avisame\s+cualquier\s+(?:cosa|duda|consulta)(?:\s+que\s+tengas)?|te\s+leo\s+cuando\s+puedas)[.!]*(\s+Te\s+(?:dejo|paso|adjunto)\s+ac[aá]\s+abajo\s+el\s+(?:link|acceso)\s+del\s+portal.*)$/i;
        s = s.replace(regexCierreAntesDePuente, '$1').trim();
        const regexCierreFinal = /(?:\r?\n|\s)+(?:(?:estoy|quedo|quedamos|estamos)\s+atent[oa]s?(?:\s+por\s+(?:cualquier\s+(?:cosa|consulta|duda)|si\s+necesit[aá](?:s|n)\s+algo))?|(?:quedamos|estoy|quedo)\s+a\s+disposici[oó]n(?:\s+por\s+cualquier\s+(?:cosa|consulta))?|cualquier\s+(?:cosa|cosita|duda|consulta)\s+(?:escribime|escribanme|avisame|avisanos|avisen|estamos\s+atentos|quedamos\s+atentos|me\s+dec[ií]s)(?:\s+por\s+ac[aá])?|avisame\s+cualquier\s+(?:cosa|duda|consulta)(?:\s+que\s+tengas)?|te\s+leo\s+cuando\s+puedas)[.!]*$/i;
        s = s.replace(regexCierreFinal, '').trim();
        return s;
    }

    window.limpiarCierreRedundanteBurbuja1Wa = limpiarCierreAlFinalDeBurbuja;

    const MAPA_APODOS_CONFIANZA = {
        fernando: 'Fer',
        laura: 'Lau',
        edit: 'Edit',
        alejandro: 'Ale',
        alejandra: 'Ale',
        agustina: 'Agus',
        agustin: 'Agus',
        francisco: 'Fran',
        franco: 'Fran',
        federico: 'Fede',
        guillermo: 'Guille',
        santiago: 'Santi',
        valeria: 'Vale',
        valentina: 'Vale',
        gabriela: 'Gabi',
        gabriel: 'Gabi',
        romina: 'Romi',
        carolina: 'Caro',
        sebastian: 'Seba',
        maximiliano: 'Maxi',
        nicolas: 'Nico',
        daniel: 'Dani',
        daniela: 'Dani',
        cecilia: 'Ceci',
        veronica: 'Vero',
        luciana: 'Lu',
        natalia: 'Nati',
        patricia: 'Pato',
        patricio: 'Pato',
        ezequiel: 'Eze',
        ignacio: 'Nacho',
        eduardo: 'Edu',
        roberto: 'Rober',
        gustavo: 'Gus',
        cristian: 'Cris',
        cristina: 'Cris',
        marcelo: 'Marce',
        marcela: 'Marce',
        claudia: 'Clau',
        claudio: 'Clau',
        silvina: 'Sil',
        silvia: 'Sil',
        viviana: 'Vivi',
        mariana: 'Mari',
        victoria: 'Vicky',
        virginia: 'Vir',
        florencia: 'Flor',
        constanza: 'Coti',
        camila: 'Cami',
        micaela: 'Mica',
        macarena: 'Maca',
        soledad: 'Sole',
        lorena: 'Lore'
    };

    /**
     * ==================================================================================
     * 👤 ANALISTA DE IDENTIDAD, APODO DE CONFIANZA Y ESTILO DEL OPERADOR EN EL HISTORIAL
     * ==================================================================================
     * - Inspecciona cómo lo saludamos nosotros manualmente en este chat ("Hola Lau, cómo andás?",
     *   "Laura! Cómo va?", "Buen día Fer, cómo andás?") ignorando mensajes automáticos.
     * - Detecta tanto el nombre de pila ("Laura", "Fernando") como el apodo corto de WhatsApp
     *   ("Lau", "Fer") para hablarle con naturalidad y cintura real.
     */
    function analizarIdentidadYSaludoContacto(st) {
        const nombreEmpresa = String(st?.nombreCliente || '').trim();
        const contactoRaw = String(st?.contactoNombreChat || '').trim();
        const mensajes = Array.isArray(st?.mensajesCompleta) ? st.mensajesCompleta : [];

        const regexRolGenerico = /^(encargad[oa]|negocio|local|sucursal|administraci[oó]n|compras|ventas|caja|deposito|dep[oó]sito|due[ñn][oa]|cliente|mostrador|whatsapp|celular|fijo|recepci[oó]n|contadur[ií]a|pagos|pedidos|empresa)$/i;
        const regexComercio = /\b(srl|sa|sas|almacen|almac[eé]n|dietetica|diet[eé]tica|mercado|super|autoservicio|distribuidora|mayorista|panaderia|panader[ií]a|confiteria|fiambreria|verduler[ií]a|forrajer[ií]a|tienda|natural|saludable|boutique|casa|don|do[ñn]a|la\s+|el\s+|los\s+|las\s+|san\s+|santa\s+)\b/i;
        const palabrasNoNombre = /^(como|cómo|todo|que|qué|te|les|ya|acá|aca|buen|buenos|buenas|estimado|estimada|gente|equipo|chicos|chicas|dale|hola|che|mirá|mira|bien)$/i;

        let nombreDetectadoEnHistorial = '';
        let ultimoSaludoManualNuestro = '';
        let ultimoMensajeSaludoCompletoNuestro = '';
        const ultimosSaludosNuestros = [];
        let cierreHabitualNuestro = 'Quedamos atentos por cualquier cosa.';

        const salientesManuales = mensajes.filter(m => Boolean(m.from_me) && !esMensajeAutomaticoSistema(m.cuerpo));
        for (let i = salientesManuales.length - 1; i >= 0; i--) {
            const txt = limpiarSignosAperturaWa(salientesManuales[i].cuerpo || '');
            if (!txt) continue;

            // 1) "Hola Fer, cómo andás?", "Buen día Fer", "Che Fer"
            const matchHola = txt.match(/^(?:hola|buen\s+d[ií]a|buenos\s+d[ií]as|buenas\s+tardes|muy\s+buenas\s+tardes|muy\s+buen\s+d[ií]a|buenas|che)[,\s]+([A-ZÁÉÍÓÚÑa-záéíóúñ]{2,15})\b/i);
            // 2) "Laura! Cómo va?", "Fer! Cómo andás?", "Lau, cómo va?"
            const matchDirecto = !matchHola
                ? txt.match(/^([A-ZÁÉÍÓÚÑa-záéíóúñ]{3,14})[!,\s]+(?:como|cómo|todo|buen|buenas|que|qué|est[aá]s)\b/i)
                : null;

            const candRaw = (matchHola && matchHola[1]) ? matchHola[1].trim() : ((matchDirecto && matchDirecto[1]) ? matchDirecto[1].trim() : '');
            if (candRaw && !regexRolGenerico.test(candRaw) && !palabrasNoNombre.test(candRaw)) {
                if (!nombreDetectadoEnHistorial) {
                    nombreDetectadoEnHistorial = candRaw.charAt(0).toUpperCase() + candRaw.slice(1).toLowerCase();
                }
                const primeraLinea = txt.split('\n')[0].slice(0, 90);
                if (!ultimoSaludoManualNuestro) {
                    ultimoSaludoManualNuestro = primeraLinea;
                    ultimoMensajeSaludoCompletoNuestro = txt.slice(0, 180);
                }
                if (ultimosSaludosNuestros.length < 3) {
                    ultimosSaludosNuestros.push(primeraLinea);
                }
            } else if (!ultimoSaludoManualNuestro && /^(?:hola|buen\s+d[ií]a|buenas|muy\s+buen)/i.test(txt)) {
                ultimoSaludoManualNuestro = txt.split('\n')[0].slice(0, 90);
                ultimoMensajeSaludoCompletoNuestro = txt.slice(0, 180);
            }

            const matchCierre = txt.match(/(?:estoy|quedo|quedamos|estamos)\s+atent[oa]s?(?:\s+por\s+cualquier\s+cosa)?/i);
            if (matchCierre && matchCierre[0]) {
                cierreHabitualNuestro = matchCierre[0].charAt(0).toUpperCase() + matchCierre[0].slice(1);
                if (!/[.!]$/.test(cierreHabitualNuestro)) cierreHabitualNuestro += '.';
            }
        }

        // Evaluar el contacto_nombre del teléfono seleccionado (ej: "Fer", "Laura", "Ale", "Encargado")
        let nombrePilaPersona = '';
        let nombreFormalPila = '';
        let etiquetaRol = '';

        if (contactoRaw) {
            const limpioContacto = contactoRaw.replace(/\([^)]*\)/g, '').replace(/#[0-9]+/g, '').trim();
            const primeraPalabra = limpioContacto.split(/[\s\-,/]+/)[0] || '';
            if (regexRolGenerico.test(primeraPalabra) || regexRolGenerico.test(limpioContacto)) {
                etiquetaRol = limpioContacto;
            } else if (normalizar(limpioContacto) === normalizar(nombreEmpresa) && regexComercio.test(limpioContacto)) {
                etiquetaRol = limpioContacto;
            } else if (!regexComercio.test(limpioContacto) && primeraPalabra.length >= 3 && !palabrasNoNombre.test(primeraPalabra)) {
                nombrePilaPersona = primeraPalabra.charAt(0).toUpperCase() + primeraPalabra.slice(1).toLowerCase();
            }
        }

        // Extraer nombre de pila formal si nombreEmpresa es "APELLIDO, NOMBRE" (ej: "DI PIETRO, FERNANDO ADRIAN")
        if (nombreEmpresa && !regexComercio.test(nombreEmpresa)) {
            const limpioEmp = nombreEmpresa.replace(/\([^)]*\)/g, '').replace(/#[0-9]+/g, '').trim();
            if (limpioEmp.includes(',')) {
                const postComa = limpioEmp.split(',')[1]?.trim() || '';
                const primerNom = postComa.split(/\s+/)[0] || '';
                if (primerNom.length >= 3 && !regexRolGenerico.test(primerNom)) {
                    nombreFormalPila = primerNom.charAt(0).toUpperCase() + primerNom.slice(1).toLowerCase();
                }
            } else {
                const partes = limpioEmp.split(/[\s\-,/]+/).filter(Boolean);
                if (partes.length > 0 && partes[0].length >= 3 && !regexRolGenerico.test(partes[0])) {
                    nombreFormalPila = partes[0].charAt(0).toUpperCase() + partes[0].slice(1).toLowerCase();
                }
            }
        }

        // Priorizar el nombre con el que nosotros ya lo llamamos en el chat (ej. "Fer", "Lau", "Laura")
        if (nombreDetectadoEnHistorial) {
            nombrePilaPersona = nombreDetectadoEnHistorial;
        } else if (!nombrePilaPersona && nombreFormalPila) {
            nombrePilaPersona = nombreFormalPila;
        }

        const normPila = normalizar(nombrePilaPersona);
        const normFormal = normalizar(nombreFormalPila);
        const apodoCorto = MAPA_APODOS_CONFIANZA[normPila]
            || MAPA_APODOS_CONFIANZA[normFormal]
            || nombrePilaPersona;

        const nombreCompletoAlternativo = (nombreFormalPila && normalizar(nombreFormalPila) !== normalizar(apodoCorto))
            ? nombreFormalPila
            : nombrePilaPersona;

        const ahora = new Date();
        const horaActual = ahora.getHours();
        const saludoMomentoDia = horaActual < 13 ? 'buen día' : (horaActual < 20 ? 'buenas tardes' : 'buenas noches');
        const saludoMomentoCap = horaActual < 13 ? 'Buen día' : (horaActual < 20 ? 'Buenas tardes' : 'Buenas noches');
        const diasSemana = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
        const diaSemanaHoy = diasSemana[ahora.getDay()] || 'día';

        return {
            esPersonaIdentificada: Boolean(nombrePilaPersona),
            nombrePila: nombrePilaPersona,
            apodoCorto: apodoCorto || nombrePilaPersona,
            nombreFormalPila: nombreCompletoAlternativo || nombrePilaPersona,
            etiquetaContacto: nombrePilaPersona || etiquetaRol || nombreEmpresa || 'Cliente',
            nombreComercio: nombreEmpresa,
            ultimoSaludoNuestro: ultimoSaludoManualNuestro,
            ultimoMensajeSaludoCompletoNuestro,
            ultimosSaludosNuestros,
            cierreHabitualNuestro,
            saludoMomentoDia,
            saludoMomentoCap,
            diaSemanaHoy,
            horaActual
        };
    }

    /**
     * ==================================================================================
     * 🎧 1. INTÉRPRETE CONCEPTUAL, TEMPORAL Y TÁCTICO DE WHATSAPP
     * ==================================================================================
     * Entiende la dinámica real de WhatsApp:
     *   - Detecta si ayer/recién le enviamos el Resumen de Cuenta Corriente / Factura / Presupuesto
     *     y el cliente se quedó en silencio ("SILENCIO_TRAS_RESUMEN_CUENTA").
     *   - Distingue entre:
     *     1) Tantear corto ("Hola Lau, cómo andás?", "Hola Fer, cómo andás?") esperando que conteste;
     *     2) Seguir el Ping-Pong cuando ya tanteamos o cuando nos responde "Hola, cómo estás?";
     *     3) Ir al hueso cuando pregunta algo puntual (ej. Fer consultando por audio cómo es el link para efectivo).
     */
    function ejecutarAgente1Dialogo(mensajes = [], infoContacto = {}) {
        const lista = (Array.isArray(mensajes) ? mensajes : [])
            .filter(m => String(m?.cuerpo || '').trim().length > 0)
            .slice()
            .sort((a, b) => (obtenerMsMensaje(a) - obtenerMsMensaje(b)) || ((a.id || 0) - (b.id || 0)));

        const ahoraMs = Date.now();
        const ahoraDate = new Date(ahoraMs);
        const horaActual = ahoraDate.getHours();
        const ayerDate = new Date(ahoraMs - 24 * 3600 * 1000);
        const diasSemanaNombres = ['el domingo', 'el lunes', 'el martes', 'el miércoles', 'el jueves', 'el viernes', 'el sábado'];

        const formatearCuandoOcurrioMs = (msEvento) => {
            if (!msEvento || msEvento <= 0) return 'ayer';
            const dEv = new Date(msEvento);
            const hEv = dEv.getHours();
            const hsDiff = (ahoraMs - msEvento) / (3600 * 1000);
            if (dEv.toDateString() === ahoraDate.toDateString()) {
                return hsDiff < 1.5 ? 'recién' : 'hoy más temprano';
            }
            if (dEv.toDateString() === ayerDate.toDateString() || (hsDiff >= 10 && hsDiff < 40)) {
                return hEv >= 19 ? 'ayer a la noche' : (hEv >= 13 ? 'ayer a la tarde' : 'ayer');
            }
            const diasDiff = Math.floor(hsDiff / 24);
            if (diasDiff <= 6) return diasSemanaNombres[dEv.getDay()] || 'hace unos días';
            return 'la última vez';
        };

        // ----------------------------------------------------------------------------------
        // A. RASTREO DE RESÚMENES DE CUENTA CORRIENTE, FACTURAS Y PRESUPUESTOS ENVIADOS
        // ----------------------------------------------------------------------------------
        // Detectar si enviamos recientemente (últimas 48h) un Resumen / Extracto de Cuenta Corriente o una Factura/Presupuesto
        const enviosResumenCC = lista.filter(m =>
            Boolean(m.from_me) &&
            /extracto de cuenta corriente|saldo total consolidado/i.test(String(m.cuerpo || '')) &&
            ((ahoraMs - obtenerMsMensaje(m)) <= 2.2 * 24 * 3600 * 1000)
        );
        const enviosFacturasOPresupuestos = lista.filter(m =>
            Boolean(m.from_me) &&
            /su factura .* ha sido emitida|presupuesto aprobado #/i.test(String(m.cuerpo || '')) &&
            ((ahoraMs - obtenerMsMensaje(m)) <= 5 * 24 * 3600 * 1000)
        );

        const ultimoResumenCCObj = enviosResumenCC.length > 0 ? enviosResumenCC[enviosResumenCC.length - 1] : null;
        const ultimaFacturaEnvObj = enviosFacturasOPresupuestos.length > 0 ? enviosFacturasOPresupuestos[enviosFacturasOPresupuestos.length - 1] : null;
        const docCuentaRecienteObj = ultimoResumenCCObj || ultimaFacturaEnvObj || null;
        const msUltimoResumenEnviado = obtenerMsMensaje(docCuentaRecienteObj);
        const enviamosResumenCuentaReciente = Boolean(ultimoResumenCCObj && msUltimoResumenEnviado > 0);
        const enviamosFacturaOPresupuestoReciente = Boolean(ultimaFacturaEnvObj && obtenerMsMensaje(ultimaFacturaEnvObj) > 0);
        const cuandoEnviamosResumenTxt = msUltimoResumenEnviado > 0 ? formatearCuandoOcurrioMs(msUltimoResumenEnviado) : 'ayer';

        let montoResumenEnviadoTxt = '';
        if (ultimoResumenCCObj && ultimoResumenCCObj.cuerpo) {
            const mMonto = String(ultimoResumenCCObj.cuerpo).match(/Saldo Total Consolidado Actualizado:\s*(\$\s*[\d.,]+)/i);
            if (mMonto && mMonto[1]) {
                montoResumenEnviadoTxt = mMonto[1].replace(/\s+/g, '');
            }
        }

        // Mensajes conversacionales (excluyendo plantillas automáticas de sistema)
        const listaConversacional = lista.filter(m => !esMensajeAutomaticoSistema(m.cuerpo));
        const baseAnalisis = listaConversacional.length > 0 ? listaConversacional : lista;

        const entrantes = baseAnalisis.filter(m => !m.from_me);
        const salientes = baseAnalisis.filter(m => Boolean(m.from_me));

        const ultimoMsg = baseAnalisis.length > 0 ? baseAnalisis[baseAnalisis.length - 1] : null;
        const ultimoEntranteObj = entrantes.length > 0 ? entrantes[entrantes.length - 1] : null;
        const ultimoSalienteObj = salientes.length > 0 ? salientes[salientes.length - 1] : null;

        const textoUltimoEntrante = ultimoEntranteObj ? limpiarSignosAperturaWa(ultimoEntranteObj.cuerpo || '') : '';
        const textoUltimoSaliente = ultimoSalienteObj ? limpiarSignosAperturaWa(ultimoSalienteObj.cuerpo || '') : '';
        const textoUltimoGeneral = ultimoMsg ? limpiarSignosAperturaWa(ultimoMsg.cuerpo || '') : '';

        const msUltimoGeneral = obtenerMsMensaje(ultimoMsg);
        const msUltimoEntrante = obtenerMsMensaje(ultimoEntranteObj);
        const msUltimoSaliente = obtenerMsMensaje(ultimoSalienteObj);

        const clienteHabloUltimo = Boolean(ultimoMsg && !ultimoMsg.from_me);
        const nosotrosHablamosUltimo = Boolean(ultimoMsg && ultimoMsg.from_me);

        // Verificar si el cliente quedó en silencio después de que le enviamos el resumen/factura
        const entrantesPostResumen = msUltimoResumenEnviado > 0
            ? entrantes.filter(m => obtenerMsMensaje(m) > msUltimoResumenEnviado)
            : [];
        const salientesManualesPostResumen = msUltimoResumenEnviado > 0
            ? salientes.filter(m => obtenerMsMensaje(m) > msUltimoResumenEnviado)
            : [];
        const clienteEnSilencioTrasResumen = Boolean(
            (enviamosResumenCuentaReciente || enviamosFacturaOPresupuestoReciente) &&
            entrantesPostResumen.length === 0
        );

        const minutosDesdeUltimoMsg = msUltimoGeneral > 0 ? Math.max(1, Math.round((ahoraMs - msUltimoGeneral) / 60000)) : 999999;
        const horasDesdeUltimoMsg = msUltimoGeneral > 0 ? ((ahoraMs - msUltimoGeneral) / (3600 * 1000)) : 9999;
        const diasDesdeUltimoMsg = msUltimoGeneral > 0 ? Math.floor((ahoraMs - msUltimoGeneral) / (24 * 3600 * 1000)) : null;

        const fechaMsgDate = msUltimoGeneral > 0 ? new Date(msUltimoGeneral) : null;
        const horaDelUltimoMsg = fechaMsgDate ? fechaMsgDate.getHours() : null;
        const esMismoDiaCalendario = Boolean(fechaMsgDate && fechaMsgDate.toDateString() === ahoraDate.toDateString());
        const esAyerCalendario = Boolean(fechaMsgDate && fechaMsgDate.toDateString() === ayerDate.toDateString());
        const cuandoCharlamosTxt = msUltimoGeneral > 0 ? formatearCuandoOcurrioMs(msUltimoGeneral) : 'ayer';

        const etiquetaHaceCuanto = msUltimoGeneral <= 0
            ? (msUltimoResumenEnviado > 0 ? `resumen enviado ${cuandoEnviamosResumenTxt}` : 'sin mensajes previos')
            : (minutosDesdeUltimoMsg < 60
                ? `hace ${minutosDesdeUltimoMsg} min`
                : (horasDesdeUltimoMsg < 24
                    ? `hace ${Math.round(horasDesdeUltimoMsg * 10) / 10}h (${formatearFechaCortaMensaje(msUltimoGeneral)})`
                    : `${esAyerCalendario ? 'ayer' : formatearTiempoRelativo(msUltimoGeneral)} (${formatearFechaCortaMensaje(msUltimoGeneral)})`));

        // Charla activa hoy (mismo día o < 10h)
        const charlaEnCursoHoy = msUltimoGeneral > 0 && (esMismoDiaCalendario || horasDesdeUltimoMsg < 10);
        // Respuesta inmediata (< 1.8 horas) vs respuesta diferida (pasaron varias horas)
        const esRespuestaReciente = msUltimoGeneral > 0 && horasDesdeUltimoMsg < 1.8;

        // ==================================================================================
        // 🧠 ANÁLISIS EPISÓDICO PROFUNDO (Levanta el contexto real de lo hablado hoy, ayer o esta semana)
        // ==================================================================================
        const episodioReciente = msUltimoGeneral > 0
            ? baseAnalisis.filter(m => {
                const ms = obtenerMsMensaje(m);
                return ms > 0 && Math.abs(msUltimoGeneral - ms) <= (36 * 3600 * 1000);
            }).slice(-16)
            : [];

        const entrantesEpisodio = episodioReciente.filter(m => !m.from_me);
        const salientesEpisodio = episodioReciente.filter(m => Boolean(m.from_me));
        const textoEntrantesEpisodio = entrantesEpisodio.map(m => limpiarSignosAperturaWa(m.cuerpo || '')).join(' | ');
        const textoSalientesEpisodio = salientesEpisodio.map(m => limpiarSignosAperturaWa(m.cuerpo || '')).join(' | ');
        const textoTodoEpisodio = `${textoEntrantesEpisodio} || ${textoSalientesEpisodio}`;
        const normTodoEpisodio = normalizar(textoTodoEpisodio);
        const normEntrantesEpisodio = normalizar(textoEntrantesEpisodio);

        const esMsgAudio = (m) => Boolean(m && (m.tipo_mensaje === 'ptt' || m.tipo_mensaje === 'audio' || /mensaje de audio|^🎤\s*audio:/i.test(String(m.cuerpo || ''))));
        const huboAudioNuestroEnEpisodio = salientesEpisodio.some(esMsgAudio);
        const huboAudioClienteEnEpisodio = entrantesEpisodio.some(esMsgAudio);
        const huboAudioEnEpisodio = huboAudioNuestroEnEpisodio || huboAudioClienteEnEpisodio;
        // Encontrar la pregunta o frase más sustanciosa del cliente en ese episodio (ignorando "Hola", "Oki", "Dale")
        const fraseSustanciosaClienteObj = entrantesEpisodio
            .slice()
            .reverse()
            .find(m => {
                const t = limpiarSignosAperturaWa(m.cuerpo || '').replace(/^🎤\s*Audio:\s*/i, '').replace(/^["'«»]+|["'«»]+$/g, '').trim();
                return t.length >= 12 && !/^(hola|buen\s+dia|buenas|ok|oki|dale|gracias|muchas\s+gracias|listo|genial|mensaje\s+de\s+audio)\b$/i.test(normalizar(t));
            });
        const fraseSustanciosaCliente = fraseSustanciosaClienteObj
            ? limpiarSignosAperturaWa(fraseSustanciosaClienteObj.cuerpo || '').replace(/^🎤\s*Audio:\s*/i, '').replace(/^["'«»]+|["'«»]+$/g, '').trim()
            : textoUltimoEntrante.replace(/^🎤\s*Audio:\s*/i, '').replace(/^["'«»]+|["'«»]+$/g, '').trim();

        const normUltimoSaliente = normalizar(textoUltimoSaliente);
        const esUltimoEntranteAcuseCorto = Boolean(
            textoUltimoEntrante.length > 0 &&
            textoUltimoEntrante.length <= 35 &&
            /^(ok|oki|okay|dale|genial|joya|barbaro|b[aá]rbaro|perfecto|listo|buenisimo|buenísimo|gracias|muchas\s+gracias|mil\s+gracias|de\s+diez)\b/i.test(normalizar(textoUltimoEntrante))
        );

        // Detectar si nuestro último mensaje saliente fue una "promesa puente" ("En un ratin te paso todo", "Ya te paso", "Ahí me fijo")
        // Sigue vigente incluso si el cliente nos contestó "Ok" / "Dale" a esa promesa puente
        const esPromesaPuenteNuestra = Boolean(
            charlaEnCursoHoy &&
            (nosotrosHablamosUltimo || esUltimoEntranteAcuseCorto) &&
            msUltimoSaliente > 0 &&
            Math.abs(ahoraMs - msUltimoSaliente) <= (6 * 3600 * 1000) &&
            textoUltimoSaliente.length <= 75 &&
            /(en un ratin|en un ratito|en un rato|te paso todo|ya te paso|ahi te paso|ahora te paso|ya te mando|ahi te mando|ahora te mando|aguantame|dame un segundo|dame un ratito|ahi me fijo|ya me fijo|enseguida)/.test(normUltimoSaliente)
        );
        const clienteEsperandoRespuesta = Boolean(clienteHabloUltimo || esPromesaPuenteNuestra);

        // Si prometimos pasar precios recién ("En un ratin te paso todo") y el cliente dijo "Ok", la consulta activa a responder es su frase/audio previo
        const entranteActivoObj = (esPromesaPuenteNuestra && esUltimoEntranteAcuseCorto && fraseSustanciosaClienteObj)
            ? fraseSustanciosaClienteObj
            : ultimoEntranteObj;
        const textoEntranteActivo = entranteActivoObj
            ? limpiarSignosAperturaWa(entranteActivoObj.cuerpo || '')
            : textoUltimoEntrante;

        const ultimoEntranteEsAudio = esMsgAudio(entranteActivoObj);
        const ultimoEntranteAudioSinTranscribir = Boolean(ultimoEntranteEsAudio && /^🎤?\s*mensaje de audio$/i.test(textoEntranteActivo));

        const normUltimoEntranteRaw = normalizar(textoEntranteActivo);
        const normUltimoEntrante = normUltimoEntranteRaw
            .replace(/\b(?:los\s+)?sigos\s+turcos\b/g, 'los higos turcos')
            .replace(/\bigosturcos?\b/g, 'higos turcos')
            .replace(/\bcastanhas?\b/g, 'castanas')
            .replace(/\bcajon\b/g, 'caju');

        const yaSaludamosHoy = Boolean(
            charlaEnCursoHoy &&
            salientesEpisodio.some(m => {
                const ms = obtenerMsMensaje(m);
                return ms > 0 && ((ahoraMs - ms) < (10 * 3600 * 1000));
            })
        );

        // Detectar si nuestro último mensaje saliente fue un "tanteo corto" de WhatsApp ("Laura! Cómo va?", "Buen día Fer, cómo andás?")
        const esTanteoCortoNuestro = Boolean(
            nosotrosHablamosUltimo &&
            !esPromesaPuenteNuestra &&
            textoUltimoSaliente.length > 0 &&
            textoUltimoSaliente.length <= 52 &&
            !/(necesitas|necesitan|mercaderia|precio|valor|portal|link|workers\.dev|factura|saldo)/i.test(normUltimoSaliente) &&
            /(hola|buen\s+dia|buenas|como\s+va|como\s+andas|como\s+estas|todo\s+bien|estas\b)/i.test(normUltimoSaliente)
        );

        const clienteNoPuedeEntrarPortal = Boolean(
            clienteEsperandoRespuesta &&
            /no\s+me\s+puedo\s+meter|no\s+puedo\s+entrar|estoy\s+ocupad[ao]|no\s+puedo\s+abrir\s+la\s+pagina|ando\s+a\s+mil|no\s+ando\s+buscando|precio.*puntual|de\s+eso\s+puntual/i.test(normUltimoEntrante)
        );
        const clienteSalioMandadoOCalle = Boolean(
            clienteEsperandoRespuesta &&
            /sali\s+a\s+(?:hacer|ser)\s+un\s+mandado|estoy\s+en\s+la\s+calle|haciendo\s+un\s+mandado|manejando/i.test(normUltimoEntrante)
        );
        const mencionaProductoPuntualAg1 = /\b(fruta|abrillantad[ao]|brillantad[ao]|escurrid[ao]|glasead[ao]|glaciad[ao]|nuez|nueces|almendras?|castanas?|caju|pistachos?|avellanas?|pasas?|ciruelas?|arandanos?|datil|datiles|higos?|damascos?|kiwis?|jengibres?|naranjas?|mix|granolas?|barritas?|coco|mani|semillas?|girasol|chia|sesamo|lino|zapallo|amapola|lentejas?|lentejon|garbanzos?|porotos?|quinoa|avena|arroz|azucar|mascabo|miel|harinas?|vainilla)\b/.test(normUltimoEntrante);

        // Detectar si el cliente está consultando por pago en efectivo / pasar por el barrio / cómo es el link para efectivo en la app
        const consultaLinkEfectivoOApp = Boolean(
            charlaEnCursoHoy &&
            clienteEsperandoRespuesta &&
            (
                /(como\s+era\s+el\s+link|link\s+para\s+(?:el\s+)?efectivo|como\s+era\s+el\s+tema)/i.test(normUltimoEntrante) ||
                (/(efectivo|achicar|barrio)/i.test(normTodoEpisodio) && /(link|app|como\s+era|tema)/i.test(normUltimoEntrante))
            )
        );
        const ofreceEfectivoOBarrio = Boolean(
            charlaEnCursoHoy &&
            clienteEsperandoRespuesta &&
            !consultaLinkEfectivoOApp &&
            /(entregarte\s+efectivo|entrego\s+efectivo|estas\s+por\s+el\s+barrio|andas\s+por\s+aca|para\s+achicar|pago\s+en\s+efectivo)/i.test(normUltimoEntrante)
        );
        const coordinaRetiroOEnsobrado = Boolean(
            charlaEnCursoHoy &&
            clienteEsperandoRespuesta &&
            (
                /(seguimos\s+abiertos|abiertos\s+de|venite\s+que|pasa\s+por\s+aca|esta\s+mi\s+novia|aviso\s+de\s+ensobrado|codigo\s+de\s+sobre)/i.test(normUltimoEntrante) ||
                (/aviso\s+de\s+ensobrado|codigo\s+de\s+sobre/i.test(normTodoEpisodio) && /(abiertos|venite|horario|tarde|novia|local)/i.test(normUltimoEntrante))
            )
        );

        // Detectar si el cliente nos acaba de responder al tanteo con un saludo humano ("Hola Martincho / Como estas ?", audio de Edit "Buenas, cómo andas, Martín? Todo bien?...")
        const esSaludoOPingPongCliente = Boolean(
            charlaEnCursoHoy &&
            clienteEsperandoRespuesta &&
            !mencionaProductoPuntualAg1 &&
            !consultaLinkEfectivoOApp &&
            !ofreceEfectivoOBarrio &&
            /(hola|buen\s+dia|buenas|como\s+andas|como\s+estas|todo\s+bien|martincho|martin\b)/i.test(normUltimoEntrante) &&
            !/(pasame|mandame|necesito|precio|lista|cuanto\s+esta)/i.test(normUltimoEntrante)
        );

        const yaEnviamosLinkHoy = Boolean(
            charlaEnCursoHoy &&
            /workers\.dev|lamdaser\.com/i.test(salientes.slice(-3).map(m => String(m.cuerpo || '')).join(' '))
        );

        // Detectar temas sensibles o comerciales abiertos en la charla reciente (<= 7 días)
        const charlaReciente7d = msUltimoGeneral > 0 && (diasDesdeUltimoMsg !== null && diasDesdeUltimoMsg <= 7);
        const habloDePagosParcialesOCuenta = Boolean(
            charlaReciente7d &&
            /pagos?\s+parcial|pagar\s+de\s+a\s+partes|ir\s+pagando|entregas?\s+parcial|asistencia\s+financiera|te\s+voy\s+transfiriendo|aguantame|perdon\s+por\s+la\s+molestia|entregarte\s+efectivo|para\s+achicar/i.test(normTodoEpisodio)
        );
        const habloDeReclamoOFactura = Boolean(
            charlaReciente7d &&
            /nota\s+de\s+credito|revisando\s+la\s+factura|detectamos\s+un\s+error|diferencia\s+en\s+la\s+factura|reclamo/i.test(normTodoEpisodio)
        );
        const clienteDijoArmandoPedido = Boolean(
            charlaReciente7d &&
            /armar\s+un\s+pedido|armando\s+pedido|empezando\s+a\s+ver|viendo\s+que\s+necesitamos|cuando\s+tengas\s+avisanos/i.test(normEntrantesEpisodio)
        );
        const clientePidioListaEnEpisodio = Boolean(
            charlaReciente7d &&
            /pasas\s+lista|pasar\s+lista|lista\s+de\s+precios|mandame\s+lista|tenes\s+lista/i.test(normEntrantesEpisodio)
        );

        // Detectar momento temporal prometido por el cliente ("a la tardecita", "más tarde", "mañana", etc.)
        let momentoPrometidoCliente = '';
        let yaLlegoMomentoPrometido = false;
        if (clienteHabloUltimo && textoUltimoEntrante) {
            const mMom = textoUltimoEntrante.match(/\b(a la tardecita|a la tarde|m[aá]s tarde|ma[ñn]ana|en un rato|despu[eé]s|a la noche|en la semana|el lunes|el martes|el mi[eé]rcoles|el jueves|el viernes)\b/i);
            if (mMom && mMom[1]) {
                momentoPrometidoCliente = mMom[1].toLowerCase();
            }
            if (/tardecita|a la tarde|m[aá]s tarde|despu[eé]s|en un rato/i.test(momentoPrometidoCliente)) {
                if (horasDesdeUltimoMsg >= 2 || (horaDelUltimoMsg !== null && horaDelUltimoMsg < 15 && horaActual >= 17)) {
                    yaLlegoMomentoPrometido = true;
                }
            } else if (/ma[ñn]ana/i.test(momentoPrometidoCliente) && !esMismoDiaCalendario) {
                yaLlegoMomentoPrometido = true;
            } else if (horasDesdeUltimoMsg >= 3) {
                yaLlegoMomentoPrometido = true;
            }
        }

        const apodo = infoContacto.apodoCorto || infoContacto.nombrePila || 'el cliente';
        const descDocCuenta = enviamosResumenCuentaReciente
            ? `el resumen de cuenta corriente${montoResumenEnviadoTxt ? ` (${montoResumenEnviadoTxt})` : ''}`
            : `la factura y resumen`;

        // ==================================================================================
        // 🎯 CLASIFICACIÓN TÁCTICA DE LA SITUACIÓN CONVERSACIONAL DE WHATSAPP
        // ==================================================================================
        let situacionDialogo = 'INICIAR_SALUDO_SEMANAL';
        let tituloIntencion = '👋 Tantear corto / Iniciar charla';
        let explicacionSituacion = '';

        if (charlaEnCursoHoy && clienteEsperandoRespuesta) {
            const citaLimpia = textoEntranteActivo.replace(/^🎤\s*Audio:\s*/i, '').replace(/^["'«»]+|["'«»]+$/g, '').trim();

            if (coordinaRetiroOEnsobrado) {
                situacionDialogo = 'CLIENTE_COORDINO_RETIRO_O_ENSOBRADO';
                tituloIntencion = `💵 Ensobrado / Horario de retiro confirmado (${etiquetaHaceCuanto})`;
                explicacionSituacion = `${apodo} ya cargó el Aviso de Ensobrado y te confirmó el horario para pasar a retirarlo ("${citaLimpia}"). En WhatsApp corresponde cerrar cortito en 1 sola línea confirmando que más tarde pasás por ahí, sin volver a saludar.`;
            } else if (consultaLinkEfectivoOApp) {
                // Caso real Fer: envió audio "¿Cómo era el link para efectivo? A ver cómo era el tema."
                situacionDialogo = 'CLIENTE_CONSULTA_LINK_EFECTIVO_APP';
                tituloIntencion = ultimoEntranteEsAudio
                    ? `💵 Audio: Consulta cómo es el link para efectivo (${etiquetaHaceCuanto})`
                    : `💵 Consulta por link de efectivo / App (${etiquetaHaceCuanto})`;
                explicacionSituacion = `${apodo} consultó ${ultimoEntranteEsAudio ? 'por audio ' : ''}${etiquetaHaceCuanto}: "${citaLimpia}" (venían hablando de entregar efectivo para achicar el saldo). Corresponde explicarle cortito cómo se carga desde su cuenta y pasarle su link directo en la 2da burbuja.`;
            } else if (ofreceEfectivoOBarrio) {
                situacionDialogo = 'CLIENTE_OFRECE_EFECTIVO_BARRIO';
                tituloIntencion = `💵 Quiere entregar efectivo para achicar (${etiquetaHaceCuanto})`;
                explicacionSituacion = `${apodo} escribió ${etiquetaHaceCuanto}: "${citaLimpia}". Quiere entregarte efectivo para achicar su saldo. Corresponde responder corto al pie para coordinar o pasarle el link de la app.`;
            } else if ((mencionaProductoPuntualAg1 && /(cuanto|precio|valor|decis|pasas|pasame|tenes|hay|stock|cotiza|kilos?|kg)/.test(normUltimoEntrante)) || (clienteNoPuedeEntrarPortal && /(precio|valor|cuanto)/.test(normUltimoEntrante))) {
                situacionDialogo = 'CLIENTE_CONSULTA_PUNTUAL';
                tituloIntencion = ultimoEntranteEsAudio
                    ? `🎙️ Consulta de precios por Audio (${etiquetaHaceCuanto})`
                    : `💲 Consulta puntual del cliente (${etiquetaHaceCuanto})`;
                explicacionSituacion = `El cliente consultó ${ultimoEntranteEsAudio ? 'por audio ' : ''}${etiquetaHaceCuanto}: "${citaLimpia}". ${clienteNoPuedeEntrarPortal ? 'Como avisó que está ocupado/a y no puede entrar a la página ahora, corresponde pasarle directamente los precios de los artículos consultados en la 2da burbuja.' : 'Corresponde responder corto al pie, separar los precios de los artículos consultados en la 2da burbuja y el cierre en la 3ra burbuja.'}`;
            } else if (/estamos bien|por ahora bien|por esta semana|todo bien por ahora|no necesito|no necesitamos|te escribo|te aviso|m[aá]s tarde|tardecita|a la tarde|me fijo|reviso y te|cualquier cosa te/i.test(textoUltimoEntrante)) {
                if (yaLlegoMomentoPrometido || horasDesdeUltimoMsg >= 2) {
                    situacionDialogo = 'CLIENTE_POSTERGO_Y_LLEGO_MOMENTO';
                    const horasRedondeadas = Math.max(2, Math.round(horasDesdeUltimoMsg));
                    tituloIntencion = momentoPrometidoCliente
                        ? `🌇 Dijo "${momentoPrometidoCliente}" hace ${horasRedondeadas}h (ya llegó el momento)`
                        : `⏰ Respondió hace ${horasRedondeadas}h (${formatearFechaCortaMensaje(msUltimoGeneral)})`;
                    explicacionSituacion = `Escribió ${etiquetaHaceCuanto}: "${textoUltimoEntrante}". Como ya pasaron ~${horasRedondeadas}h, corresponde retomar corto o dejarle el link del portal por si al final quiere mirar algo.`;
                } else if (clienteDijoArmandoPedido) {
                    situacionDialogo = 'SEGUIMIENTO_ARMANDO_PEDIDO_O_STOCK';
                    tituloIntencion = `📝 Avisó que está viendo/armando pedido (${etiquetaHaceCuanto})`;
                    explicacionSituacion = `El cliente comentó: "${textoUltimoEntrante}". Corresponde acompañarlo dejándole el link del portal por si le sirve para armar el pedido.`;
                } else {
                    situacionDialogo = 'CLIENTE_POSTERGA_O_ESTA_BIEN';
                    tituloIntencion = momentoPrometidoCliente
                        ? `👍 Respondió ${etiquetaHaceCuanto} (${momentoPrometidoCliente} escribe)`
                        : `👍 Respondió ${etiquetaHaceCuanto} que por ahora está bien`;
                    explicacionSituacion = `El cliente respondió ${etiquetaHaceCuanto}: "${textoUltimoEntrante}". Corresponde acusar recibo corto ("Dale, perfecto!"), ofrecer el link del portal en burbuja aparte por si más tarde quiere mirar precios, y cerrar en la 3ra burbuja.`;
                }
            } else if (esSaludoOPingPongCliente) {
                situacionDialogo = 'CLIENTE_RESPONDE_TANTEO_O_SALUDO';
                tituloIntencion = ultimoEntranteEsAudio
                    ? `🎙️ Audio de saludo / Ping-pong (${etiquetaHaceCuanto})`
                    : `🤝 Contestó el saludo — En Ping-Pong (${etiquetaHaceCuanto})`;
                explicacionSituacion = `${apodo} contestó ${ultimoEntranteEsAudio ? 'por audio ' : ''}${etiquetaHaceCuanto}: "${citaLimpia}". En WhatsApp ahora toca el 2° paso del ping-pong: responderle con cercanía ("Bien, acá andamos, todo tranquilo!") y entrar cortito en tema${(enviamosResumenCuentaReciente || enviamosFacturaOPresupuestoReciente) ? ` preguntándole si pudo ver ${descDocCuenta} que le pasaste ${cuandoEnviamosResumenTxt}` : ''}.`;
            } else if (habloDePagosParcialesOCuenta) {
                situacionDialogo = 'SEGUIMIENTO_CHARLA_PAGOS_PARCIALES';
                tituloIntencion = `🤝 Conversando sobre pagos / saldo (${etiquetaHaceCuanto})`;
                explicacionSituacion = `El cliente comentó sobre pagos/cuenta ("${citaLimpia}"). Corresponde responder corto, con cintura y empatía.`;
            } else if (/^(gracias|muchas gracias|mil gracias|genial|joya|barbaro|b[aá]rbaro|perfecto|dale|ok|okay|listo|buen[ií]simo|recibido|de diez)\b/i.test(normUltimoEntrante) && textoUltimoEntrante.length < 45) {
                situacionDialogo = 'CLIENTE_AGRADECE_O_CONFIRMA';
                tituloIntencion = `🙌 Cliente agradeció / confirmó (${etiquetaHaceCuanto})`;
                explicacionSituacion = `El cliente cerró o confirmó ${etiquetaHaceCuanto} ("${textoUltimoEntrante}"). Corresponde un cierre corto de cortesía.`;
            } else if (/(lista|catalogo|pasas lista|pasar lista|tenes lista|mandame lista)/.test(normUltimoEntrante)) {
                situacionDialogo = 'CLIENTE_PIDE_LISTA';
                tituloIntencion = `📋 Cliente pidió lista de precios (${etiquetaHaceCuanto})`;
                explicacionSituacion = `El cliente pidió precios/lista ${etiquetaHaceCuanto}. Corresponde texto corto + Link del Portal en burbuja separada + cierre en 3ra burbuja.`;
            } else if (/(cuanto|precio|valor|tenes|hay|stock|cotiza)/.test(normUltimoEntrante) || mencionaProductoPuntualAg1 || /\?$/.test(textoUltimoEntrante)) {
                situacionDialogo = 'CLIENTE_CONSULTA_PUNTUAL';
                tituloIntencion = ultimoEntranteEsAudio
                    ? `🎙️ Consulta puntual por Audio (${etiquetaHaceCuanto})`
                    : `💲 Consulta puntual del cliente (${etiquetaHaceCuanto})`;
                explicacionSituacion = `El cliente consultó ${ultimoEntranteEsAudio ? 'por audio ' : ''}${etiquetaHaceCuanto}: "${citaLimpia}". Corresponde responder corto al pie, separar los precios/info dura en la 2da burbuja y el cierre en la 3ra burbuja.`;
            } else if (/(mandame|necesito|agregame|pedir|pedido|pasame\s+\d|quiero\s+\d|kilos|bolsa|caja)/.test(normUltimoEntrante)) {
                situacionDialogo = 'CLIENTE_ENVIA_PEDIDO';
                tituloIntencion = `📦 Cliente envió pedido (${etiquetaHaceCuanto})`;
                explicacionSituacion = `El cliente pasó pedido ${etiquetaHaceCuanto}: "${textoUltimoEntrante}". Corresponde confirmar recepción corta.`;
            } else if (ultimoEntranteAudioSinTranscribir) {
                situacionDialogo = 'CLIENTE_CONSULTA_PUNTUAL';
                tituloIntencion = `🎧 Audio recibido (${etiquetaHaceCuanto})`;
                explicacionSituacion = `El cliente envió un mensaje de audio ${etiquetaHaceCuanto}. Tocá "🎧 Transcribir audio" arriba para leer exactamente lo que consultó o seleccioná los artículos a cotizar.`;
            } else {
                situacionDialogo = 'CLIENTE_SALUDA_O_COMENTA';
                tituloIntencion = `💬 Cliente escribió (${etiquetaHaceCuanto})`;
                explicacionSituacion = `Último mensaje del cliente (${etiquetaHaceCuanto}): "${citaLimpia}". Responder corto y al pie.`;
            }
        } else if (charlaEnCursoHoy && nosotrosHablamosUltimo && esTanteoCortoNuestro) {
            // Caso real Laura hoy: ayer a la noche le mandamos el resumen de cuenta, se quedó en silencio, y hoy a las 12:05 le mandamos "Laura! Cómo va?"
            situacionDialogo = 'NOSOTROS_YA_TANTEAMOS_HOY';
            tituloIntencion = clienteEnSilencioTrasResumen
                ? `⏳ Ya tanteaste (${etiquetaHaceCuanto}) · Resumen enviado ${cuandoEnviamosResumenTxt}`
                : `⏳ Ya le tiraste el toque corto (${etiquetaHaceCuanto})`;
            explicacionSituacion = clienteEnSilencioTrasResumen
                ? `Le enviaste ${descDocCuenta} ${cuandoEnviamosResumenTxt}, se quedó en silencio y ${etiquetaHaceCuanto} ya le tiraste el toque corto ("${textoUltimoSaliente}") esperando que aparezca. En WhatsApp lo ideal es esperar que te conteste; o tenés listo abajo el 2° mensaje de ping-pong ("Bien, acá andamos... Che, pudiste ver lo que te pasé ayer?") para cuando responda.`
                : `Ya le enviaste el saludo corto de tanteo ${etiquetaHaceCuanto} ("${textoUltimoSaliente}"). Esperá a que te conteste o usá el 2° paso de ping-pong para ir al tema sin volver a decirle "Hola".`;
        } else if (clienteEnSilencioTrasResumen && salientesManualesPostResumen.length === 0) {
            // Le mandamos ayer/recién el resumen de cuenta o factura, el cliente se quedó mudo y todavía no le escribimos hoy
            situacionDialogo = 'SILENCIO_TRAS_RESUMEN_CUENTA';
            tituloIntencion = `🤫 En silencio tras resumen (${cuandoEnviamosResumenTxt})`;
            explicacionSituacion = `Le mandaste ${descDocCuenta} ${cuandoEnviamosResumenTxt} y se quedó en silencio (no dijo ni sí ni no). Para tener cintura en WhatsApp, NO le tires un discurso largo de entrada: tirale primero un tanteo bien cortito ("Hola ${apodo}, cómo andás?") para ver si está y esperar que te conteste.`;
        } else if (charlaEnCursoHoy && nosotrosHablamosUltimo) {
            if (/como va|como venis|como vienen|necesitas algo|necesitan algo|alguna consulta|estoy atento/i.test(normUltimoSaliente)) {
                situacionDialogo = 'NOSOTROS_YA_SALUDAMOS_HOY';
                tituloIntencion = `⏳ Ya le escribimos (${etiquetaHaceCuanto})`;
                explicacionSituacion = `Ya le escribiste ${etiquetaHaceCuanto} ("${textoUltimoSaliente.slice(0, 60)}"). No repitas el saludo.`;
            } else {
                situacionDialogo = 'CONTINUAR_NUESTRO_MENSAJE_HOY';
                tituloIntencion = `⚡ Conversación activa (${etiquetaHaceCuanto})`;
                explicacionSituacion = `Último mensaje tuyo ${etiquetaHaceCuanto} ("${textoUltimoSaliente.slice(0, 60)}"). Podés continuar el hilo sin volver a saludar.`;
            }
        } else if (habloDePagosParcialesOCuenta && (!charlaEnCursoHoy || horasDesdeUltimoMsg >= 2)) {
            situacionDialogo = 'SEGUIMIENTO_CHARLA_PAGOS_PARCIALES';
            tituloIntencion = `🤝 Charla de ${cuandoCharlamosTxt}: Pagos / Cuenta${huboAudioNuestroEnEpisodio ? ' + 🎤 Audio' : ''}`;
            explicacionSituacion = `En la charla de ${cuandoCharlamosTxt}, ${apodo} habló del tema de pagos/saldo (${fraseSustanciosaCliente ? `"${fraseSustanciosaCliente}"` : 'cuenta corriente'})${enviamosResumenCuentaReciente ? ` y ${cuandoEnviamosResumenTxt} le enviaste el resumen actualizado` : ''}. Podés tantearlo primero con un "Hola ${apodo}, cómo andás?" esperando que conteste, o retomar directo el tema.`;
        } else if (habloDeReclamoOFactura && (!charlaEnCursoHoy || horasDesdeUltimoMsg >= 2)) {
            situacionDialogo = 'SEGUIMIENTO_RECLAMO_O_FACTURA';
            tituloIntencion = `🧾 Seguimiento gestión de factura (${cuandoCharlamosTxt})`;
            explicacionSituacion = `Venían conversando ${cuandoCharlamosTxt} por una diferencia/nota de crédito en factura. Corresponde tantear corto o retomar ese tema con tacto antes de ofrecer mercadería.`;
        } else if (clienteDijoArmandoPedido && (!charlaEnCursoHoy || horasDesdeUltimoMsg >= 2)) {
            situacionDialogo = 'SEGUIMIENTO_ARMANDO_PEDIDO_O_STOCK';
            tituloIntencion = `📝 Dijo ${cuandoCharlamosTxt} que estaba viendo/armando pedido`;
            explicacionSituacion = `En la charla de ${cuandoCharlamosTxt} comentó: "${fraseSustanciosaCliente}". Corresponde retomar conectado con eso para ver si pudo armar el pedido o necesita consultar algún precio.`;
        } else if (clientePidioListaEnEpisodio && !charlaEnCursoHoy) {
            situacionDialogo = 'SEGUIMIENTO_LISTA_ENVIADA_RECIENTE';
            tituloIntencion = `📋 Pidió lista de precios ${cuandoCharlamosTxt}`;
            explicacionSituacion = `${cuandoCharlamosTxt.charAt(0).toUpperCase() + cuandoCharlamosTxt.slice(1)} nos pidió la lista de precios ("${fraseSustanciosaCliente}") y le enviamos el acceso al portal. Corresponde preguntarle si pudo ver bien los precios o si necesita algún artículo puntual.`;
        } else if (charlaReciente7d && huboAudioEnEpisodio) {
            situacionDialogo = 'SEGUIMIENTO_AUDIO_RECIENTE';
            tituloIntencion = `🎤 Charla con audio ${cuandoCharlamosTxt} (${etiquetaHaceCuanto})`;
            explicacionSituacion = `En la conversación de ${cuandoCharlamosTxt} intercambiaron mensajes/audio${fraseSustanciosaCliente ? ` ("${fraseSustanciosaCliente}")` : ''}. Podés tantear corto primero ("Hola ${apodo}, cómo andás?") o seguir sobre lo hablado ${cuandoCharlamosTxt}.`;
        } else {
            situacionDialogo = 'INICIAR_SALUDO_SEMANAL';
            tituloIntencion = diasDesdeUltimoMsg !== null
                ? `👋 Iniciar charla (última vez ${etiquetaHaceCuanto})`
                : '👋 Iniciar charla en WhatsApp';
            explicacionSituacion = `Podés elegir entre: 1) Tantear corto en 1 línea ("Hola ${apodo}, cómo andás?") y esperar que te conteste para charlar, o 2) Comunicarle directo dejándole la consulta semanal / link del portal.`;
        }

        let temaUltimoHilo = 'Sin charla previa registrada';
        if (clienteEnSilencioTrasResumen) {
            temaUltimoHilo = `Resumen de cuenta enviado ${cuandoEnviamosResumenTxt}${montoResumenEnviadoTxt ? ` (${montoResumenEnviadoTxt})` : ''} — Cliente en silencio`;
        } else if (fraseSustanciosaCliente) {
            temaUltimoHilo = `"${fraseSustanciosaCliente.replace(/\s+/g, ' ').slice(0, 72)}${fraseSustanciosaCliente.length > 72 ? '…' : ''}"`;
        } else if (textoUltimoGeneral) {
            temaUltimoHilo = `"${textoUltimoGeneral.replace(/\s+/g, ' ').slice(0, 72)}${textoUltimoGeneral.length > 72 ? '…' : ''}"`;
        }

        return {
            intencion: situacionDialogo,
            situacionDialogo,
            tituloIntencion,
            explicacionSituacion,
            charlaEnCurso: charlaEnCursoHoy && esRespuestaReciente,
            charlaEnCursoHoy,
            esRespuestaReciente,
            yaLlegoMomentoPrometido,
            cuandoCharlamosTxt,
            enviamosResumenCuentaReciente,
            enviamosFacturaOPresupuestoReciente,
            cuandoEnviamosResumenTxt,
            montoResumenEnviadoTxt,
            clienteEnSilencioTrasResumen,
            esTanteoCortoNuestro,
            esPromesaPuenteNuestra,
            yaSaludamosHoy,
            consultaLinkEfectivoOApp,
            ofreceEfectivoOBarrio,
            esSaludoOPingPongCliente,
            clienteSalioMandadoOCalle,
            huboAudioNuestroEnEpisodio,
            huboAudioClienteEnEpisodio,
            huboAudioEnEpisodio,
            ultimoEntranteEsAudio,
            ultimoEntranteAudioSinTranscribir,
            clienteNoPuedeEntrarPortal,
            habloDePagosParcialesOCuenta,
            fraseSustanciosaCliente,
            etiquetaHaceCuanto,
            horaDelUltimoMsg,
            horaActual,
            clienteHabloUltimo,
            nosotrosHablamosUltimo,
            momentoPrometidoCliente,
            yaEnviamosLinkRecien: yaEnviamosLinkHoy,
            minutosDesdeUltimoMsg,
            horasDesdeUltimoMsg,
            diasDesdeUltimoMsg,
            msUltimoGeneral,
            fechaUltimoGeneralTxt: formatearFechaCortaMensaje(msUltimoGeneral),
            tiempoUltimoGeneralTxt: formatearTiempoRelativo(msUltimoGeneral),
            textoUltimoEntrante,
            textoUltimoSaliente,
            textoUltimoGeneral,
            temaUltimoHilo
        };
    }

    /**
     * ==================================================================================
     * 🌳 FORMATEADOR DE RESUMEN DE PRECIOS RESPETANDO LA JERARQUÍA B2B (5 NIVELES)
     * ==================================================================================
     * Agrupa y ordena cualquier lista de artículos (actualizaciones pendientes, habituales
     * o seleccionados) siguiendo exactamente el árbol de "Configurar Jerarquía B2B":
     *   Familia -> Artículo Principal -> Subcategorías B2B -> Presentación (mayor a menor kg).
     */
    function ordenarPorJerarquiaB2BInterno(lista = []) {
        return (Array.isArray(lista) ? lista.slice() : []).sort((a, b) => {
            const famA = String(a.familia_b2b || a.familia_nombre || 'ZZZ').trim();
            const famB = String(b.familia_b2b || b.familia_nombre || 'ZZZ').trim();
            const cFam = famA.localeCompare(famB, 'es', { sensitivity: 'base' });
            if (cFam !== 0) return cFam;

            const prA = String(a.articulo_principal_display || a.articulo_principal_b2b || a.articulo_principal || 'ZZZ').trim();
            const prB = String(b.articulo_principal_display || b.articulo_principal_b2b || b.articulo_principal || 'ZZZ').trim();
            const cPr = prA.localeCompare(prB, 'es', { sensitivity: 'base' });
            if (cPr !== 0) return cPr;

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

    /**
     * ==================================================================================
     * 🛒 2. ANALISTA DE COMPRAS, CICLO Y CAMBIOS DE PRECIO EN SUS HABITUALES
     * ==================================================================================
     * - Calcula qué compra y cada cuántos días.
     * - Integra en tiempo real las actualizaciones pendientes de "Gestión de Cambios y Notificaciones"
     *   (/api/produccion/precios/clientes-afectados-resumen) y ordena todo según la Jerarquía B2B.
     */
    function ejecutarAgente2Productos({
        articulosHabituales = [],
        articulosMencionadosChat = [],
        tokensNegadosCliente = [],
        articulosSimilares = [],
        cambiosPreciosPendientes = [],
        cambiosPreciosTodos = [],
        ultimasFacturas = [],
        pedidosRecientes = [],
        listaId = 1
    }) {
        const lid = Number(listaId) || 1;
        const negados = Array.isArray(tokensNegadosCliente) ? tokensNegadosCliente.filter(Boolean) : [];
        const noEstaNegado = (art) => {
            if (negados.length === 0 || !art) return true;
            const textoArt = normalizar(`${art.nombre || ''} ${art.descripcion || ''} ${art._bolsaBusqueda || ''} ${art.articulo_principal || ''}`);
            return !negados.some(tok => textoArt.includes(tok));
        };
        const mapaCambiosPorSku = new Map();
        (Array.isArray(cambiosPreciosTodos) ? cambiosPreciosTodos : []).forEach(cp => {
            const sku = String(cp.articulo_numero || '').trim().toUpperCase();
            if (sku) mapaCambiosPorSku.set(sku, cp);
            if (cp.codigo_barras) mapaCambiosPorSku.set(String(cp.codigo_barras).trim().toUpperCase(), cp);
        });

        // Analizar cada artículo habitual e inyectar datos de Gestión de Cambios y Jerarquía B2B
        const habitualesEnriquecidos = ordenarPorJerarquiaB2BInterno((articulosHabituales || []).filter(noEstaNegado).map(art => {
            const codUp = String(art.codigo_unico || art.id || '').trim().toUpperCase();
            const cpMatch = mapaCambiosPorSku.get(codUp) || null;

            const pActual = cpMatch && Number(cpMatch.precio_nuevo_vigente) > 0
                ? Math.round(Number(cpMatch.precio_nuevo_vigente))
                : (art && art.precios
                    ? Math.round(Number(art.precios[lid] || art.precios[String(lid)] || art.precios[1] || 0))
                    : 0);
            const pAnterior = cpMatch && Number(cpMatch.precio_pagado_anterior) > 0
                ? Math.round(Number(cpMatch.precio_pagado_anterior))
                : Math.round(Number(art.ultimo_precio_unitario || 0));

            let variacionPct = cpMatch && cpMatch.diferencia_porcentaje !== undefined
                ? Math.round(Number(cpMatch.diferencia_porcentaje) * 10) / 10
                : 0;
            let cambioPrecio = false;

            if (cpMatch && Math.abs(variacionPct) >= 0.5) {
                cambioPrecio = true;
            } else if (pActual > 0 && pAnterior > 0) {
                variacionPct = Math.round(((pActual - pAnterior) / pAnterior) * 100);
                if (Math.abs(variacionPct) >= 2 && Math.abs(variacionPct) <= 180) {
                    cambioPrecio = true;
                }
            }

            const pendienteNotificar = Boolean(cpMatch && cpMatch.estado_notificacion === 'PENDIENTE');

            return {
                ...art,
                familia_b2b: cpMatch?.familia_b2b || art.familia_b2b || art.familia_nombre || '',
                articulo_principal_display: cpMatch?.articulo_principal_display || art.articulo_principal_display || art.articulo_principal || '',
                ruta_subcategoria_b2b: cpMatch?.ruta_subcategoria_b2b || art.ruta_subcategoria_b2b || '',
                ruta_jerarquia_b2b: cpMatch?.ruta_jerarquia_b2b || art.ruta_jerarquia_b2b || '',
                precio_actual_lista: pActual,
                precio_nuevo_kilo: cpMatch?.precio_nuevo_kilo || (Number(art.kilos_unidad || 1) > 0 ? Math.round(pActual / Number(art.kilos_unidad || 1)) : pActual),
                ultimo_precio_pagado: pAnterior,
                variacion_pct: variacionPct,
                cambio_precio: cambioPrecio,
                pendiente_notificar: pendienteNotificar,
                estado_notificacion: cpMatch?.estado_notificacion || null,
                sin_stock_actual: Boolean(cpMatch?.sin_stock_actual),
                alternativa_sugerida: cpMatch?.alternativa_sugerida || null
            };
        }));

        const pendientesOrdenadosB2B = ordenarPorJerarquiaB2BInterno((cambiosPreciosPendientes || []).filter(noEstaNegado));
        const todosAfectadosOrdenadosB2B = ordenarPorJerarquiaB2BInterno((cambiosPreciosTodos || []).filter(noEstaNegado));
        const cantPendientesNotificar = pendientesOrdenadosB2B.length;
        const cantConSubaOBajaPendiente = pendientesOrdenadosB2B.filter(a => Math.abs(Number(a.diferencia_porcentaje || 0)) >= 0.5).length;

        const topHabituales = habitualesEnriquecidos.slice(0, 8);
        const habitualesConCambioPrecio = habitualesEnriquecidos.filter(a => a.cambio_precio || a.pendiente_notificar).slice(0, 8);
        const mencionados = ordenarPorJerarquiaB2BInterno(articulosMencionadosChat || []).slice(0, 8);
        const similares = ordenarPorJerarquiaB2BInterno(articulosSimilares || []).slice(0, 4);

        const fechasCompraMs = [];
        (ultimasFacturas || []).forEach(f => {
            if ([3, 8, 13].includes(Number(f.tipo_cbte))) return;
            const rawF = f.fecha_emision || f.emitida_en;
            if (rawF) {
                const ms = new Date(rawF).getTime();
                if (Number.isFinite(ms) && ms > 0) fechasCompraMs.push(ms);
            }
        });
        (pedidosRecientes || []).forEach(p => {
            if (p.fecha) {
                const ms = new Date(p.fecha).getTime();
                if (Number.isFinite(ms) && ms > 0) fechasCompraMs.push(ms);
            }
        });

        fechasCompraMs.sort((a, b) => b - a);
        const fechasUnicasMs = [];
        fechasCompraMs.forEach(ms => {
            if (fechasUnicasMs.length === 0 || Math.abs(fechasUnicasMs[fechasUnicasMs.length - 1] - ms) > (18 * 3600 * 1000)) {
                fechasUnicasMs.push(ms);
            }
        });

        let diasDesdeUltimaCompra = null;
        let fechaUltimaCompraTxt = '';
        let frecuenciaMediaDias = null;

        if (fechasUnicasMs.length > 0) {
            diasDesdeUltimaCompra = Math.max(0, Math.round((Date.now() - fechasUnicasMs[0]) / (1000 * 3600 * 24)));
            try {
                fechaUltimaCompraTxt = new Date(fechasUnicasMs[0]).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
            } catch (_) {}
        }

        if (fechasUnicasMs.length >= 2) {
            const diffs = [];
            for (let i = 0; i < fechasUnicasMs.length - 1; i++) {
                const d = Math.round((fechasUnicasMs[i] - fechasUnicasMs[i + 1]) / (1000 * 3600 * 24));
                if (d >= 2 && d <= 120) diffs.push(d);
            }
            if (diffs.length > 0) {
                frecuenciaMediaDias = Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
            }
        }

        const enFechaReposicion = Boolean(
            frecuenciaMediaDias &&
            diasDesdeUltimaCompra !== null &&
            diasDesdeUltimaCompra >= Math.max(7, frecuenciaMediaDias - 4)
        );

        let badgeCiclo = 'Sin compras registradas';
        if (diasDesdeUltimaCompra !== null && frecuenciaMediaDias) {
            badgeCiclo = `Compra cada ~${frecuenciaMediaDias}d · Última hace ${diasDesdeUltimaCompra}d`;
        } else if (diasDesdeUltimaCompra !== null) {
            badgeCiclo = `Última compra hace ${diasDesdeUltimaCompra}d (${fechaUltimaCompraTxt})`;
        } else if (topHabituales.length > 0) {
            badgeCiclo = `${articulosHabituales.length} artículos habituales`;
        }

        let resumenCambioPrecios = '';
        if (cantPendientesNotificar > 0) {
            resumenCambioPrecios = `🔔 ${cantPendientesNotificar} actualización(es) pendiente(s) de enviar en Gestión de Precios${cantConSubaOBajaPendiente > 0 ? ` (${cantConSubaOBajaPendiente} con nuevo valor)` : ''}`;
        } else if (habitualesConCambioPrecio.length > 0) {
            resumenCambioPrecios = `📊 ${habitualesConCambioPrecio.length} de sus habituales actualizaron precio vs. su última compra`;
        } else if (topHabituales.length > 0) {
            resumenCambioPrecios = `🟰 Sus habituales mantienen el mismo precio de su última compra`;
        }

        return {
            topHabituales,
            habitualesConCambioPrecio,
            pendientesOrdenadosB2B,
            todosAfectadosOrdenadosB2B,
            cantPendientesNotificar,
            cantConSubaOBajaPendiente,
            resumenCambioPrecios,
            mencionados,
            similares,
            diasDesdeUltimaCompra,
            fechaUltimaCompraTxt,
            frecuenciaMediaDias,
            enFechaReposicion,
            badgeCiclo
        };
    }

    /**
     * ==================================================================================
     * 💳 3. ANALISTA DE CUENTA CORRIENTE, MEDIO DE PAGO Y PORTAL B2B
     * ==================================================================================
     */
    function ejecutarAgente3CuentaYPagos({
        rayosX = null,
        sintesisMemoria = null,
        yaIngresoPortal = false,
        fechaUltimoIngresoTxt = '',
        codigoActivacion = '',
        linkActivacionCorto = '',
        listaId = 1
    }) {
        const cc = rayosX?.cuenta_corriente || null;
        const compSint = sintesisMemoria?.comportamiento_pago?.composicion || null;
        const compObj = cc?.composicion || compSint || null;
        const salvObj = cc?.salvavidas || sintesisMemoria?.comportamiento_pago?.salvavidas || null;
        const cuentaId = cc?.cuenta_id || null;
        const saldoCapital = Number(cc?.saldo_actual ?? sintesisMemoria?.comportamiento_pago?.saldo_actual ?? 0);
        const tieneSaldo = saldoCapital > 100;
        const capas = Array.isArray(compObj?.capas) ? compObj.capas : [];
        const cancelados = Array.isArray(compObj?.comprobantes_cancelados) ? compObj.comprobantes_cancelados : [];
        let antiguedadMax = Number(compObj?.antiguedad_maxima_dias || 0);

        const movs = Array.isArray(cc?.ultimos_movimientos) ? cc.ultimos_movimientos : [];
        if (tieneSaldo && antiguedadMax <= 0 && movs.length > 0) {
            const debMov = movs.find(m => {
                const str = `${m.tipo_movimiento || ''} ${m.tipo_comprobante || ''} ${m.descripcion || ''}`;
                return /debe|cargo|factura|remito|presupuesto|venta/i.test(str) && !/recibo|pago|haber|credito|cr[eé]dito/i.test(str);
            }) || movs[0];
            if (debMov?.fecha_movimiento) {
                const diffMs = Date.now() - new Date(debMov.fecha_movimiento).getTime();
                if (Number.isFinite(diffMs) && diffMs > 0) {
                    antiguedadMax = Math.max(1, Math.floor(diffMs / 86400000));
                }
            }
        }

        // Calcular Financiación activa (Total = Capital + Financiación c/IVA)
        let montoFinanciacion = Number(salvObj?.financiacion_total_con_iva ?? 0);
        if (tieneSaldo && montoFinanciacion <= 0 && !salvObj && antiguedadMax > 14) {
            if (capas.length > 0) {
                montoFinanciacion = capas.reduce((acc, c) => {
                    const diasC = Number(c.antiguedad_dias || 0);
                    const capC = Number(c.monto_pendiente || c.capital_pendiente || 0);
                    if (diasC > 14 && capC > 0) {
                        return acc + (capC * 0.001 * diasC * 1.21);
                    }
                    return acc;
                }, 0);
            } else {
                montoFinanciacion = saldoCapital * 0.001 * antiguedadMax * 1.21;
            }
        }

        const tieneFinanciacionActiva = tieneSaldo && montoFinanciacion > 0.5;
        const saldoTotal = tieneFinanciacionActiva ? (saldoCapital + montoFinanciacion) : saldoCapital;
        const saldoActual = saldoTotal;
        const saldoCapitalFmt = `$${Math.round(saldoCapital).toLocaleString('es-AR')}`;
        const financiacionFmt = `$${Math.round(montoFinanciacion).toLocaleString('es-AR')}`;
        // El monto principal (saldoFmt) siempre es la TOTALIDAD (Capital + Financiación cuando aplica)
        const saldoFmt = `$${Math.round(saldoTotal).toLocaleString('es-AR')}`;
        const desgloseParentesisCorto = tieneFinanciacionActiva
            ? (antiguedadMax > 0
                ? `(C: ${saldoCapitalFmt} + F: ${financiacionFmt}, de hace ${antiguedadMax} días)`
                : `(C: ${saldoCapitalFmt} + F: ${financiacionFmt})`)
            : (antiguedadMax > 0 ? `(de hace ${antiguedadMax} días)` : '');

        // 1. Analizar conducta histórica de pagos (comprobantes_cancelados de composicionSaldoService + fallback sobre ultimos_movimientos)
        const cantFacturasHistoricasPagadas = cancelados.length;
        const diasCancelacionValidos = cancelados
            .map(c => Number(c.dias_hasta_cancelacion ?? 0))
            .filter(n => Number.isFinite(n) && n >= 0);
        const promedioDiasCancelacion = diasCancelacionValidos.length > 0
            ? Math.round((diasCancelacionValidos.reduce((a, b) => a + b, 0) / diasCancelacionValidos.length) * 10) / 10
            : null;
        const cantEnPlazoHabitual = cancelados.filter(
            c => c.tramo_cancelacion === 'PLAZO_HABITUAL' || Number(c.dias_hasta_cancelacion ?? 0) <= 7
        ).length;
        const pctEnPlazoHabitual = cantFacturasHistoricasPagadas > 0
            ? (cantEnPlazoHabitual / cantFacturasHistoricasPagadas)
            : 0;

        // Fallback sobre ultimos_movimientos si el servidor aún no recargó comprobantes_cancelados:
        // detectar si sus pagos recientes dejan sistemáticamente saldo_resultante en $0.00
        const pagosRealesMovs = movs.filter(m => {
            const str = `${m.tipo_movimiento || ''} ${m.tipo_comprobante || ''} ${m.descripcion || ''}`;
            return /credito|cr[eé]dito|haber|pago|cobro|recibo/i.test(str) && !/redondeo|ajuste/i.test(str);
        });
        const pagosQueCancelanACero = pagosRealesMovs.filter(m => Math.abs(Number(m.saldo_resultante ?? 999999)) <= 50);
        const cumplePorMovimientosACero = Boolean(
            cantFacturasHistoricasPagadas === 0 &&
            pagosRealesMovs.length >= 1 &&
            pagosQueCancelanACero.length === pagosRealesMovs.length
        );

        const esPagadorCumplidorContraEntrega = Boolean(
            (cantFacturasHistoricasPagadas >= 2 &&
             promedioDiasCancelacion !== null &&
             promedioDiasCancelacion <= 6 &&
             pctEnPlazoHabitual >= 0.75) ||
            cumplePorMovimientosACero
        );

        let resumenConductaHistorica = '';
        if (esPagadorCumplidorContraEntrega) {
            if (cantFacturasHistoricasPagadas > 0 && promedioDiasCancelacion !== null) {
                const promRedondeado = Math.max(1, Math.round(promedioDiasCancelacion));
                resumenConductaHistorica = `⭐ Paga siempre contra entrega (${cantFacturasHistoricasPagadas} fact. históricas · prom. ${promRedondeado}d, nunca deja facturas atrás)`;
            } else {
                resumenConductaHistorica = `⭐ Paga siempre factura por factura dejando saldo en $0 (nunca deja una factura atrás)`;
            }
        } else if (cantFacturasHistoricasPagadas > 0 && promedioDiasCancelacion !== null) {
            resumenConductaHistorica = `📊 Historial: ${cantFacturasHistoricasPagadas} fact. canceladas (promedio ${Math.round(promedioDiasCancelacion)} días)`;
        }

        // 2. Analizar las capas abiertas (facturas pendientes ordenadas de más antigua a más nueva)
        const capasOrdenadas = [...capas].sort((a, b) => Number(b.antiguedad_dias || 0) - Number(a.antiguedad_dias || 0));
        const cantComprobantesAbiertos = capasOrdenadas.length;
        const capaMasAntigua = cantComprobantesAbiertos > 0 ? capasOrdenadas[0] : null;
        const capaUltimaEntrega = cantComprobantesAbiertos > 0 ? capasOrdenadas[cantComprobantesAbiertos - 1] : null;

        const diasMasAntigua = Number(capaMasAntigua?.antiguedad_dias ?? antiguedadMax ?? 0);
        const diasUltimaEntrega = Number(capaUltimaEntrega?.antiguedad_dias ?? 0);
        const montoMasAntiguaFmt = capaMasAntigua
            ? `$${Math.round(Number(capaMasAntigua.monto_pendiente || capaMasAntigua.monto_original || 0)).toLocaleString('es-AR')}`
            : saldoFmt;
        const montoUltimaEntregaFmt = capaUltimaEntrega
            ? `$${Math.round(Number(capaUltimaEntrega.monto_pendiente || capaUltimaEntrega.monto_original || 0)).toLocaleString('es-AR')}`
            : saldoFmt;

        const rawFechaAntigua = capaMasAntigua?.punto_cero || capaMasAntigua?.fecha_movimiento;
        const fechaMasAntiguaCorta = rawFechaAntigua
            ? new Date(rawFechaAntigua).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
            : '';
        const rawFechaUltima = capaUltimaEntrega?.punto_cero || capaUltimaEntrega?.fecha_movimiento;
        const fechaUltimaEntregaCorta = rawFechaUltima
            ? new Date(rawFechaUltima).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
            : '';

        const cuandoUltimaEntregaTxt = diasUltimaEntrega === 0
            ? 'hoy'
            : (diasUltimaEntrega === 1
                ? 'ayer'
                : (diasUltimaEntrega <= 3 ? 'hace un par de días' : `hace ${diasUltimaEntrega} días`));

        let patronCuentaAbierta = 'CUENTA_AL_DIA';
        if (tieneSaldo) {
            if (cantComprobantesAbiertos === 2 && diasUltimaEntrega <= 6 && diasMasAntigua > diasUltimaEntrega && (esPagadorCumplidorContraEntrega || cantFacturasHistoricasPagadas === 0)) {
                // Caso real Cecilia (577 The Green Corner): paga siempre al día, última entrega hace 2 días + 1 factura anterior que quedó atrás
                patronCuentaAbierta = 'DOS_PENDIENTES_ULTIMA_Y_ANTERIOR_ATRAS';
            } else if (cantComprobantesAbiertos === 1 && esPagadorCumplidorContraEntrega && diasMasAntigua >= 6) {
                patronCuentaAbierta = 'UNA_FACTURA_ATRASADA_PAGADOR_CUMPLIDOR';
            } else if (diasMasAntigua <= 7) {
                patronCuentaAbierta = 'EN_PLAZO_HABITUAL';
            } else {
                patronCuentaAbierta = 'SALDO_PENDIENTE_GENERAL';
            }
        }

        const pagosDetectados = movs.filter(m => {
            const str = `${m.tipo_movimiento || ''} ${m.tipo_comprobante || ''} ${m.origen_tipo || ''} ${m.descripcion || ''}`;
            const esNc = /nota[_\s]*de?[_\s]*cr[eé]dito|\bnc\b/i.test(str);
            return !esNc && /recibo|pago|haber|acredit|cobro|cr[eé]dito|transferencia/i.test(str);
        });

        let medioPagoHabitual = 'Sin pagos registrados aún';
        let detalleComportamientoPago = '';

        if (pagosDetectados.length > 0) {
            const textosPagos = pagosDetectados.map(p => `${p.descripcion || ''} ${p.tipo_comprobante || ''}`).join(' ');
            const bancos = [];
            if (/galicia/i.test(textosPagos)) bancos.push('Galicia');
            if (/provincia|bapro/i.test(textosPagos)) bancos.push('Provincia');
            if (/mercado\s*pago|mp\b/i.test(textosPagos)) bancos.push('Mercado Pago');
            if (/santander/i.test(textosPagos)) bancos.push('Santander');
            if (/bbva|frances|francés/i.test(textosPagos)) bancos.push('BBVA');

            if (/transferencia|cobro_bancario/i.test(textosPagos)) {
                medioPagoHabitual = `Transferencia Bancaria${bancos.length > 0 ? ` (${bancos.join('/')})` : ''}`;
            } else if (/efectivo|caja/i.test(textosPagos)) {
                medioPagoHabitual = 'Efectivo';
            } else if (/cheque|echeq/i.test(textosPagos)) {
                medioPagoHabitual = 'Cheque / E-Cheq';
            } else {
                medioPagoHabitual = 'Pago en Cuenta Corriente';
            }

            const ultPago = pagosDetectados[0];
            const fechaUltPago = ultPago?.fecha_movimiento
                ? new Date(ultPago.fecha_movimiento).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
                : '';
            detalleComportamientoPago = `${pagosDetectados.length} ${pagosDetectados.length === 1 ? 'pago reciente' : 'pagos recientes'}${fechaUltPago ? ` (último: ${fechaUltPago})` : ''}`;
        }

        // Resumen corto de comprobantes pendientes (capas FIFO)
        let resumenComprobantesCorto = '';
        let comprobantePrincipalTxt = '';
        if (tieneSaldo && capasOrdenadas.length > 0) {
            if (patronCuentaAbierta === 'DOS_PENDIENTES_ULTIMA_Y_ANTERIOR_ATRAS') {
                resumenComprobantesCorto = `${cantComprobantesAbiertos} pendientes: Anterior${fechaMasAntiguaCorta ? ` (${fechaMasAntiguaCorta})` : ''} ${montoMasAntiguaFmt} (${diasMasAntigua}d) + Últ. entrega${fechaUltimaEntregaCorta ? ` (${fechaUltimaEntregaCorta})` : ''} ${montoUltimaEntregaFmt} (${diasUltimaEntrega}d)`;
            } else {
                const itemsCapas = capasOrdenadas.slice(0, 2).map(c => {
                    const desc = String(c.descripcion || c.tipo_comprobante || 'Comprobante').replace(/\s*\(CAE:[^)]*\)/i, '').trim();
                    const rawF = c.punto_cero || c.fecha_movimiento;
                    const fechaC = rawF
                        ? new Date(rawF).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
                        : '';
                    const montoC = `$${Math.round(Number(c.monto_pendiente || c.monto_original || 0)).toLocaleString('es-AR')}`;
                    const diasC = Number(c.antiguedad_dias || antiguedadMax || 0);
                    return `${desc}${fechaC ? ` (${fechaC})` : ''}: ${montoC}${diasC > 0 ? ` · ${diasC}d` : ''}`;
                });
                resumenComprobantesCorto = itemsCapas.join(' | ') + (capasOrdenadas.length > 2 ? ` (+${capasOrdenadas.length - 2} más)` : '');
            }
            comprobantePrincipalTxt = String(capaMasAntigua?.descripcion || capaMasAntigua?.tipo_comprobante || '').replace(/\s*\(CAE:[^)]*\)/i, '').trim();
        }

        // Diagnóstico determinista de en qué condiciones está el saldo pendiente y qué aplica según su Lista
        let condicionSaldoCodigo = 'AL_DIA_OPTIMO';
        let etiquetaCondicionSaldo = '🟢 Cuenta al día ($0)';
        let colorCondicionBg = '#dcfce7';
        let colorCondicionText = '#166534';
        let colorCondicionBorder = '#86efac';
        let explicacionCondicionSaldo = `Cuenta al día ($0): tiene activo el 5% de descuento por volumen (> $300.000) y acceso a ofertas en su Lista #${listaId}.`;

        if (tieneSaldo) {
            if (patronCuentaAbierta === 'DOS_PENDIENTES_ULTIMA_Y_ANTERIOR_ATRAS') {
                condicionSaldoCodigo = 'DOS_PENDIENTES_ULTIMA_Y_ANTERIOR_ATRAS';
                etiquetaCondicionSaldo = `🔔 2 facturas pendientes (últ. entrega ${cuandoUltimaEntregaTxt} + 1 anterior de hace ${diasMasAntigua}d)`;
                colorCondicionBg = '#fef3c7';
                colorCondicionText = '#92400e';
                colorCondicionBorder = '#f59e0b';
                const txtHistCorto = cantFacturasHistoricasPagadas > 0
                    ? `${cantFacturasHistoricasPagadas} fact. históricas en ~${Math.max(1, Math.round(promedioDiasCancelacion || 2))}d, nunca deja una atrás`
                    : `cancela siempre factura por factura a $0, nunca deja una atrás`;
                explicacionCondicionSaldo = esPagadorCumplidorContraEntrega
                    ? `Paga siempre al día (${txtHistCorto}). Quedó pendiente la factura anterior${fechaMasAntiguaCorta ? ` (${fechaMasAntiguaCorta})` : ''} y la última entrega (${cuandoUltimaEntregaTxt}). Conviene enviarle un aviso cortito sin PDF ofreciéndole el resumen de cuenta.`
                    : `Tiene 2 facturas abiertas: el último pedido entregado ${cuandoUltimaEntregaTxt} y una factura anterior${fechaMasAntiguaCorta ? ` (${fechaMasAntiguaCorta})` : ''} que quedó atrás. Conviene avisarle cortito y ofrecerle el resumen de cuenta.`;
            } else if (patronCuentaAbierta === 'UNA_FACTURA_ATRASADA_PAGADOR_CUMPLIDOR') {
                condicionSaldoCodigo = 'UNA_FACTURA_ATRASADA_PAGADOR_CUMPLIDOR';
                etiquetaCondicionSaldo = `🔔 1 factura pendiente (${diasMasAntigua}d) en cliente cumplidor`;
                colorCondicionBg = '#fef3c7';
                colorCondicionText = '#92400e';
                colorCondicionBorder = '#f59e0b';
                const txtHistUna = cantFacturasHistoricasPagadas > 0
                    ? `${cantFacturasHistoricasPagadas} fact. en ~${Math.max(1, Math.round(promedioDiasCancelacion || 2))}d`
                    : `cancela siempre a $0`;
                explicacionCondicionSaldo = `Históricamente paga siempre contra entrega (${txtHistUna}). Quedó 1 factura pendiente${fechaMasAntiguaCorta ? ` del ${fechaMasAntiguaCorta}` : ` de hace ${diasMasAntigua}d`}; conviene recordársela con un aviso corto.`;
            } else if (antiguedadMax <= 7) {
                condicionSaldoCodigo = 'VENTANA_ESTANDAR';
                etiquetaCondicionSaldo = `🟢 En plazo habitual (${antiguedadMax > 0 ? `${antiguedadMax}d de 7d` : 'reciente'} · 0% financiación)`;
                colorCondicionBg = '#dcfce7';
                colorCondicionText = '#166534';
                colorCondicionBorder = '#86efac';
                explicacionCondicionSaldo = `Dentro de los primeros 7 días corridos bonificados. Al cancelar el saldo a $0 mantiene activo el 5% por volumen (> $300.000) y ofertas de su Lista #${listaId}.`;
            } else if (antiguedadMax <= 14) {
                condicionSaldoCodigo = 'VENTANA_CORTESIA';
                etiquetaCondicionSaldo = `🎟️ Ventana de cortesía (${antiguedadMax} días · hasta día 14 sin cargo)`;
                colorCondicionBg = '#fef3c7';
                colorCondicionText = '#92400e';
                colorCondicionBorder = '#fcd34d';
                explicacionCondicionSaldo = `Superó los 7 días habituales (lleva ${antiguedadMax}d). Con comodín de cortesía llega al día 14 sin cargo de financiación; desde el día 15 aplica servicio de financiación (0,1%/día). Al cancelar a $0 activa el 5% (> $300k) y ofertas de Lista #${listaId}.`;
            } else {
                condicionSaldoCodigo = 'FINANCIACION_ACTIVA';
                etiquetaCondicionSaldo = tieneFinanciacionActiva
                    ? `🟡 Total: ${saldoFmt} (C: ${saldoCapitalFmt} + F: ${financiacionFmt} · hace ${antiguedadMax} días)`
                    : `🟡 Financiación activa (${antiguedadMax} días · 0,1% diario / 3% mes)`;
                colorCondicionBg = '#ffedd5';
                colorCondicionText = '#9a3412';
                colorCondicionBorder = '#fdba74';
                explicacionCondicionSaldo = tieneFinanciacionActiva
                    ? `Total c/financiación: ${saldoFmt} (Capital ${saldoCapitalFmt} + Financiación ${financiacionFmt}, de hace ${antiguedadMax} días). Puede hacer pagos parciales para achicar capital y, al dejar saldo en $0, reactiva el 5% (> $300k) y ofertas de Lista #${listaId}.`
                    : `Lleva ${antiguedadMax} días corridos (> 14d): corre servicio de financiación (0,1% diario sobre saldo). Puede hacer pagos parciales para achicar capital y, al dejar saldo en $0, reactiva el 5% (> $300k) y ofertas de Lista #${listaId}.`;
            }
        }

        const badgeCuenta = tieneSaldo
            ? (tieneFinanciacionActiva
                ? `Total CC: ${saldoFmt} (C: ${saldoCapitalFmt} + F: ${financiacionFmt} · ${antiguedadMax}d)`
                : `Saldo CC: ${saldoFmt}${antiguedadMax > 0 ? ` (${antiguedadMax}d)` : ''}`)
            : 'Cuenta al día ($0)';

        const badgePortal = yaIngresoPortal
            ? `🟢 Ya usa el Portal${fechaUltimoIngresoTxt ? ` (últ. vez: ${fechaUltimoIngresoTxt})` : ''}`
            : `🟠 Aún no entró al Portal${codigoActivacion ? ` (Cód: ${codigoActivacion})` : ''}`;

        return {
            tieneSaldo,
            cuentaId,
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
            capas: capasOrdenadas,
            cantComprobantesAbiertos,
            cantFacturasHistoricasPagadas,
            promedioDiasCancelacion,
            esPagadorCumplidorContraEntrega,
            resumenConductaHistorica,
            patronCuentaAbierta,
            diasMasAntigua,
            diasUltimaEntrega,
            cuandoUltimaEntregaTxt,
            fechaMasAntiguaCorta,
            fechaUltimaEntregaCorta,
            montoMasAntiguaFmt,
            montoUltimaEntregaFmt,
            resumenComprobantesCorto,
            comprobantePrincipalTxt,
            condicionSaldoCodigo,
            etiquetaCondicionSaldo,
            colorCondicionBg,
            colorCondicionText,
            colorCondicionBorder,
            explicacionCondicionSaldo,
            medioPagoHabitual,
            detalleComportamientoPago,
            yaIngresoPortal,
            codigoActivacion,
            linkActivacionCorto,
            badgeCuenta,
            badgePortal
        };
    }

    /**
     * Construye las variantes de mención de saldo pendiente (corto conversacional o explicación
     * detallada con días y políticas de su Lista de Precios) sin usar jamás "¿" ni "¡" y sin
     * exponer nombres internos de listas al cliente.
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
            const variantesAlDia = [
                `De paso te recuerdo que al tener tu cuenta al día en $0 tenés activo de forma automática el 5% de bonificación en compras superiores a $300.000 y todas las ofertas de tu lista.`,
                `Como tenés la cuenta corriente al día ($0), recordá que en tu lista tenés habilitado el 5% de descuento adicional para pedidos mayores a $300.000 y acceso a ofertas.`
            ];
            return {
                mencionCortaInline: limpiarSignosAperturaWa(variantesAlDia[idx % variantesAlDia.length]),
                mencionCortaBurbuja: limpiarSignosAperturaWa(`${variantesAlDia[idx % variantesAlDia.length]} Cualquier cosa estamos atentos.`),
                detalleSaldoYPoliticasBurbuja: limpiarSignosAperturaWa(`${variantesAlDia[idx % variantesAlDia.length]} Cualquier consulta estamos atentos.`)
            };
        }

        // 1. Mención corta para incrustar dentro del Mensaje 1 o en burbuja corta aparte
        let variantesCortasInline = [];
        if (ag3?.patronCuentaAbierta === 'DOS_PENDIENTES_ULTIMA_Y_ANTERIOR_ATRAS') {
            variantesCortasInline = [
                `Solamente quería recordarte que hay dos facturas pendientes (una anterior y la última que te entregué) por un total de *${saldoFmt}*${desgloseParentesis}. Como nunca dejás una factura pendiente, te quería enviar este recordatorio y te adjunto ahora el resumen. Cualquier duda avisame!`,
                `Solamente quería avisarte que hay dos facturas pendientes (la última y la anterior) por un total de *${saldoFmt}*${desgloseParentesis}. Como nunca dejás una factura pendiente, te quería enviar este recordatorio y ahora te adjunto el resumen. Cualquier cosa decime!`,
                `Solamente te escribía para recordarte que hay una factura pendiente anterior y la última que te entregué por un total de *${saldoFmt}*${desgloseParentesis}. Como nunca dejás una factura pendiente, te mando este recordatorio y te adjunto ahora el resumen!`
            ];
        } else if (ag3?.patronCuentaAbierta === 'UNA_FACTURA_ATRASADA_PAGADOR_CUMPLIDOR') {
            variantesCortasInline = [
                `Solamente quería recordarte que quedó una factura pendiente anterior por un total de *${saldoFmt}*${desgloseParentesis}. Como nunca dejás una factura pendiente, te quería enviar este recordatorio y te adjunto ahora el resumen. Cualquier duda avisame!`,
                `Solamente quería avisarte que quedó pendiente una factura anterior por un total de *${saldoFmt}*${desgloseParentesis}. Como nunca dejás una factura pendiente, te quería enviar este recordatorio y ahora te adjunto el resumen. Cualquier cosa decime!`
            ];
        } else {
            variantesCortasInline = [
                `De paso te encargo cuando puedas lo del saldo total pendiente de *${saldoFmt}*${desgloseParentesis}, avisame cómo te queda cómodo manejarlo.`,
                `Te recuerdo también cortito el saldo total pendiente en cuenta de *${saldoFmt}*${desgloseParentesis}, cuando puedas decime cómo lo organizamos.`,
                `De paso te comento que tenés pendiente el saldo total de *${saldoFmt}*${desgloseParentesis}, si querés cancelarlo antes del pedido o ir haciendo pagos parciales avisame.`,
                `Te encargo de paso cuando puedas ver el saldo total pendiente de *${saldoFmt}*${desgloseParentesis} así mantenés activa la bonificación del 5% y las ofertas de tu lista.`
            ];
        }

        const cierresCortos = [
            'Cualquier cosa estamos atentos.',
            'Quedamos atentos por cualquier cosa.',
            'Estoy atento por cualquier cosa.'
        ];

        const lineaCortaElegida = variantesCortasInline[idx % variantesCortasInline.length];
        const cierreElegido = cierresCortos[idx % cierresCortos.length];

        // 2. Explicación en burbuja aparte: Saldo + Días + Condición actual + Políticas de su Lista de Precios
        let bloqueCondicionDias = '';
        if (dias > 0 && dias <= 7) {
            bloqueCondicionDias = `Estás dentro del plazo habitual de 7 días corridos (100% bonificado, sin cargo de financiación). Recordá también que contás con un comodín de cortesía hasta el día 14 sin cargo si en algún momento lo necesitás.`;
        } else if (dias >= 8 && dias <= 14) {
            bloqueCondicionDias = `Ya pasaron los primeros 7 días habituales (lleva *${dias} días*), por lo que estás dentro de la ventana de cortesía hasta el día 14 sin cargo de financiación. A partir del día 15 comienza a correr el servicio de financiación (0,1% diario / 3% mensual sobre saldo). Si te resulta más cómodo, podés ir haciendo pagos parciales a tu ritmo.`;
        } else if (dias > 14) {
            bloqueCondicionDias = `El comprobante lleva *${dias} días corridos* (superando los 7 días habituales y la ventana de cortesía de 14 días), por lo que aplica el servicio de financiación de 0,1% diario (3% mensual + IVA) sobre el saldo pendiente. Podés ir haciendo entregas parciales a tu ritmo para bajar capital en el acto y mantener tu cuenta habilitada.`;
        } else {
            bloqueCondicionDias = `Recordá que los primeros 7 días corridos son 100% bonificados (con ventana de cortesía hasta el día 14 sin cargo, y desde el día 15 servicio de financiación de 0,1% diario sobre saldo). Podés manejar pagos parciales cuando te quede cómodo.`;
        }

        const variantesDetallePoliticas = [
            [
                `Por otro lado, te paso el detalle de tu cuenta corriente: figura un saldo total pendiente de *${saldoFmt}*${desgloseParentesis}${compTxt}.`,
                `• *Plazos y facilidades:* ${bloqueCondicionDias}`,
                `• *Política de tu Lista de Precios:* al mantener la cuenta al día (*saldo $0*), tenés activo de forma automática el *5% de bonificación por volumen* en compras superiores a $300.000 y el acceso a todas las *ofertas promocionales*.`,
                `Avisame cómo te queda cómodo organizarlo o cualquier duda escribime por acá.`
            ].join('\n'),
            [
                `Te dejo aparte el resumen de tu cuenta corriente: tenés un saldo total pendiente de *${saldoFmt}*${desgloseParentesis}${compTxt}.`,
                `${bloqueCondicionDias}`,
                `Además, te recuerdo que por las condiciones de tu Lista de Precios mayorista, teniendo la cuenta en *$0* se activa automáticamente el *5% de descuento adicional* en pedidos mayores a $300.000 y los precios de *oferta*.`,
                `Cualquier cosa decime cómo lo vamos manejando, estoy atento.`
            ].join('\n')
        ];

        return {
            mencionCortaInline: limpiarSignosAperturaWa(lineaCortaElegida),
            mencionCortaBurbuja: limpiarSignosAperturaWa(`${lineaCortaElegida} ${cierreElegido}`),
            detalleSaldoYPoliticasBurbuja: limpiarSignosAperturaWa(variantesDetallePoliticas[idx % variantesDetallePoliticas.length])
        };
    }

    window.generarTextosMencionSaldoWa = generarTextosMencionSaldoWa;

    /**
     * ==================================================================================
     * ⚡ 4. GENERADOR DE RESPUESTAS Y ACCIONES PROACTIVAS LAMDA (INTEGRALIDAD ENTRE BURBUJAS)
     * ==================================================================================
     * Reglas de integralidad:
     *   1. Nunca repetir el mismo saludo que le enviamos la última vez a ese cliente (ni repetir
     *      la misma plantilla entre clientes consecutivos).
     *   2. Coherencia total entre Mensaje 1, Mensaje 2 y Mensaje 3: si hay Mensaje 3 (o Mensaje 2 + 3),
     *      el Mensaje 1 JAMÁS lleva cierre ("Estoy atento", "Quedamos atentos", etc.) para no repetir.
     *   3. Conciencia temporal: distingue si el cliente acaba de responder hace pocos minutos
     *      o si respondió hace varias horas (ej. dijo "a la tardecita te escribo" a las 12:09 y ya son las 18:30).
     */
    function construirMensajesProactivosWa(st, infoContacto, ag1, ag2, ag3) {
        const enCurso = Boolean(st.charlaEnCurso);
        const varIdx = Number(st.varianteSaludoIdx || 0);
        const semillaCliente = Number(st.chatId || st.clienteId || 0);
        const idxCombinado = Math.abs(varIdx + semillaCliente);
        const modoAccion = st.modoAccionProactiva || 'AUTO';

        const usaLinkActivacion = st.modoLink === 'ACTIVACION_CORTA' && st.linkActivacionCorto;
        const usaMagicLink = st.modoLink === 'MAGIC_LINK' && st.magicLinkDirecto;
        const linkElegido = usaMagicLink
            ? st.magicLinkDirecto
            : (usaLinkActivacion ? st.linkActivacionCorto : (st.urlPortalBase || URL_PORTAL_OFICIAL));

        const infoDuraLinkPortal = (!st.yaIngresoPortal && st.codigoActivacion && !usaLinkActivacion && !usaMagicLink)
            ? `${linkElegido}\nCódigo de acceso: *${st.codigoActivacion}*`
            : `${linkElegido}`;

        const seleccionados = (st.catalogoArticulos || []).filter(a => st.idsSeleccionados.has(String(a.id)));
        const lid = Number(st.listaId) || 1;

        const formatearLineaPrecio = (art) => {
            const pLista = art && art.precios ? Number(art.precios[lid] || art.precios[String(lid)] || art.precios[1] || 0) : 0;
            const kilos = Number(art?.kilos_unidad || 1);
            const pKg = kilos > 0 ? Math.round(pLista / kilos) : Math.round(pLista);
            const pBulto = Math.round(pLista);
            return `• *${art.nombre}*: *$${pBulto.toLocaleString('es-AR')}*${kilos > 1.05 ? ` ($${pKg.toLocaleString('es-AR')}/kg)` : ''}`;
        };

        const nombrePila = infoContacto.nombrePila;
        const apodo = infoContacto.apodoCorto || nombrePila;
        const nombreFormal = infoContacto.nombreFormalPila || nombrePila;
        const buenDia = infoContacto.saludoMomentoDia; // "buen día" / "buenas tardes" / "buenas noches"
        const buenDiaCap = infoContacto.saludoMomentoCap;
        const diaSemana = infoContacto.diaSemanaHoy || 'día';

        // Repertorio variado de cierres cortos con la muletilla real de Martín
        const cierresVariados = [
            'Cualquier cosa estamos atentos.',
            'Quedamos atentos por cualquier cosa.',
            'Estoy atento por cualquier cosa.',
            'Avisame cualquier duda que tengas.',
            'Quedamos a disposición por cualquier consulta.',
            'Cualquier cosita avisame.'
        ];

        const elegirCierreCoherente = (textoBurbuja1 = '', offset = 0) => {
            const normB1 = normalizar(textoBurbuja1);
            const candidatos = cierresVariados.filter(c => {
                const normC = normalizar(c);
                if (normB1.includes('atento') && normC.includes('atento')) return false;
                if (normB1.includes('escribime') && normC.includes('escribime')) return false;
                if (normB1.includes('avisame') && normC.includes('avisame')) return false;
                if (normB1.includes('disposicion') && normC.includes('disposicion')) return false;
                if (normB1.includes('necesita') && normC.includes('necesita')) return false;
                return true;
            });
            const lista = candidatos.length > 0 ? candidatos : cierresVariados;
            return lista[(idxCombinado + offset) % lista.length];
        };

        const momTxt = ag1.momentoPrometidoCliente ? ` ${ag1.momentoPrometidoCliente}` : '';
        const cuando = ag1.cuandoCharlamosTxt || 'ayer';
        const cuandoRes = ag1.cuandoEnviamosResumenTxt || cuando || 'ayer';
        const mencAudio = ag1.huboAudioNuestroEnEpisodio ? ', pudiste escuchar el audio?' : '?';
        const mencAudio2 = ag1.huboAudioNuestroEnEpisodio ? ' y el audio que te mandé' : '';

        // ----------------------------------------------------------------------------------
        // 0. ETAPA 1 DE WHATSAPP: TANTEO CORTO (3 a 6 palabras, 1 sola burbuja, esperar que conteste)
        // ----------------------------------------------------------------------------------
        const candidatosTanteoRaw = apodo
            ? [
                `Hola ${apodo}, cómo andás?`,
                `${buenDiaCap} ${apodo}, cómo andás?`,
                `${nombreFormal || apodo}! Cómo va?`,
                `Hola ${apodo}, todo bien?`,
                `Hola ${apodo}, cómo va?`,
                `Buenas ${apodo}, cómo andás?`,
                `${apodo}! Todo bien?`
            ]
            : [
                `Hola! Cómo andan?`,
                `${buenDiaCap}, cómo andan?`,
                `Hola, cómo va todo?`,
                `Buenas! Todo bien?`
            ];

        const normUltSaludoTanteo = normalizar(infoContacto.ultimoSaludoNuestro || '');
        const tanteosFiltrados = candidatosTanteoRaw.filter(t => {
            if (!normUltSaludoTanteo) return true;
            return normalizar(t) !== normUltSaludoTanteo;
        });
        const listaTanteos = tanteosFiltrados.length > 0 ? tanteosFiltrados : candidatosTanteoRaw;
        const textoTanteoElegido = listaTanteos[(varIdx + semillaCliente) % listaTanteos.length];

        const paqueteTanteoCorto = {
            burbuja1: textoTanteoElegido,
            burbuja2: '',
            burbuja3: '',
            pasoEnEspera: `Tanteo corto de WhatsApp (1 sola línea): abrís cancha y esperás que ${apodo || 'el cliente'} te conteste antes de entrar en tema.`
        };

        // ----------------------------------------------------------------------------------
        // 0.B ETAPA 2 DE WHATSAPP: PING-PONG HUMANO / ENTRAR EN TEMA ("Bien, acá andamos... Che, pudiste ver lo de ayer?")
        // ----------------------------------------------------------------------------------
        let variantesPingPong = [];
        if (ag1.clienteSalioMandadoOCalle) {
            // Caso real Edit: "Buenas, cómo andas, Martín? Todo bien? Bueno, yo acá, justo salí a hacer un mandado..."
            variantesPingPong = [
                `Acá andamos ${apodo || ''}, todo tranquilo por suerte! Hacelo tranquila el mandado y cuando vuelvas chiflá y vemos lo que necesites.`.replace(/\s+/g, ' '),
                `Bien ${apodo || ''}, acá andamos con cosas varias! Todo bien por suerte. Cuando te desocupes del mandado avisame qué estabas necesitando.`.replace(/\s+/g, ' '),
                `Todo bien por acá ${apodo || ''}, metiéndole! Andá tranquila a hacer el mandado y después cuando estés me escribís.`.replace(/\s+/g, ' ')
            ];
        } else if (ag1.enviamosResumenCuentaReciente || ag1.enviamosFacturaOPresupuestoReciente) {
            // Caso real Laura / Fer: ayer a la noche le mandamos el resumen/saldo y ahora estamos en el 2° paso del ping-pong
            if (ag1.situacionDialogo === 'NOSOTROS_YA_TANTEAMOS_HOY') {
                variantesPingPong = [
                    `Bien, acá andamos, todo tranquilo! Che, pudiste ver lo que te pasé ${cuandoRes}? Qué opinás, cómo lo ves?`,
                    `Acá andamos, con cosas varias... Contame, pudiste mirar el resumen que te pasé ${cuandoRes}? Cómo querés que lo manejemos?`,
                    `Te escribía cortito para ver si pudiste chusmear el resumen que te pasé ${cuandoRes}, contame cómo lo ves o cómo venís con eso.`
                ];
            } else {
                variantesPingPong = [
                    `Bien, acá andamos, todo tranquilo! Che, pudiste ver lo que te pasé ${cuandoRes}? Qué opinás, cómo lo ves?`,
                    `Acá andamos, con cosas varias... Contame, pudiste ver el resumen que te pasé ${cuandoRes}? Cómo venís con eso?`,
                    `Todo bien por acá, metiéndole! Che, pudiste mirar lo que te mandé ${cuandoRes} de la cuenta? Decime cómo querés hacer.`
                ];
            }
        } else if (ag1.habloDePagosParcialesOCuenta) {
            variantesPingPong = [
                `Acá andamos, con cosas varias... Contame, qué querés hacer con lo que vimos ${cuando}?`,
                `Bien, acá andamos, todo tranquilo! Che, cómo venís con lo que hablamos ${cuando}? Pudiste verlo?`,
                `Todo bien por acá! Contame cómo te queda cómodo manejar lo que charlamos ${cuando}.`
            ];
        } else {
            variantesPingPong = [
                `Bien, acá andamos, con cosas varias! Vos todo bien? Contame, cómo venís para esta semana, necesitás algo?`,
                `Acá andamos, todo tranquilo por suerte! Contame, qué andás necesitando o qué querés que veamos?`,
                `Todo bien por acá, metiéndole! Cómo vienen ustedes para estos días, necesitan reponer algo?`
            ];
        }

        const paquetePingPongTema = {
            burbuja1: variantesPingPong[varIdx % variantesPingPong.length],
            burbuja2: '',
            burbuja3: '',
            pasoEnEspera: `2° paso del Ping-Pong de WhatsApp: respuesta humana corta + ir al tema en 1 sola burbuja.`
        };

        // ----------------------------------------------------------------------------------
        // A. RESPUESTA AL CLIENTE SEGÚN LO QUE DIJO, EL CONTEXTO RECIENTE Y CUÁNTO TIEMPO PASÓ
        // ----------------------------------------------------------------------------------
        let paqueteResponderContexto = null;

        if (ag1.situacionDialogo === 'CLIENTE_COORDINO_RETIRO_O_ENSOBRADO') {
            const nomFer = apodo || nombrePila || '';
            const variantesRetiroCoordinado = [
                `Dale${nomFer ? ' ' + nomFer : ''}, genial! Más tarde paso por ahí entonces, mil gracias!`,
                `Bárbaro${nomFer ? ' ' + nomFer : ''}! Tipo 17 / 18 me doy una vuelta por el local. Gracias!`,
                `Joya${nomFer ? ' ' + nomFer : ''}, agendado! Más tarde paso por allá, muchas gracias!`
            ];
            paqueteResponderContexto = {
                burbuja1: variantesRetiroCoordinado[varIdx % variantesRetiroCoordinado.length],
                burbuja2: '',
                burbuja3: '',
                pasoEnEspera: `Confirmación corta de retiro en el local en 1 sola burbuja (sin volver a saludar).`
            };
        } else if (ag1.situacionDialogo === 'CLIENTE_CONSULTA_LINK_EFECTIVO_APP') {
            // Caso real Fer hoy 12:12: Audio "¿Cómo era el link para efectivo? A ver cómo era el tema."
            const nomFer = apodo || nombrePila || '';
            const variantesLinkEfectivo = [
                `Mirá${nomFer ? ' ' + nomFer : ''}, es re sencillo: te dejo acá abajo el link directo a tu cuenta en la app. Cuando entrás vas a Cuenta Corriente / Informar Pago y ahí ponés que entregás efectivo por el monto que quieras achicar, o si preferís decime cuánto es y lo dejo cargado yo desde acá.`,
                `Te paso acá abajo tu link directo${nomFer ? ', ' + nomFer : ''}! Entrando ahí vas a la parte de Cuenta Corriente, tocás en Informar Pago y elegís Efectivo con el importe para achicar, así ya nos queda registrado para pasar a retirarlo.`,
                `Ahí va el link acá abajo${nomFer ? ' ' + nomFer : ''}! Desde ahí entrás directo a tu cuenta y podés dejar avisado el pago en efectivo para achicar, o decime qué monto querés entregar y coordinamos para pasar por el barrio.`
            ];
            const b1Ef = variantesLinkEfectivo[varIdx % variantesLinkEfectivo.length];
            paqueteResponderContexto = {
                burbuja1: b1Ef,
                burbuja2: infoDuraLinkPortal,
                burbuja3: 'Fijate si te deja entrar bien y cualquier duda avisame!',
                pasoEnEspera: `Explica cortito cómo gestionar el pago en efectivo en la app + Link directo en 2da burbuja.`
            };
        } else if (ag1.situacionDialogo === 'CLIENTE_OFRECE_EFECTIVO_BARRIO') {
            // Caso real Fer hoy 12:07: "Te entrego efectivo si andas por aca para achicar"
            const nomFer = apodo || nombrePila || '';
            const variantesOfreceEfectivo = [
                `Dale${nomFer ? ' ' + nomFer : ''}, genial! Te paso el link para el efectivo o vos lo gestionás por la app?`,
                `Bárbaro${nomFer ? ' ' + nomFer : ''}! Querés que te pase acá el link directo de la app para dejarlo asentado o decime cuánto querés entregar y paso por el barrio?`,
                `Genial${nomFer ? ' ' + nomFer : ''}! Contame qué monto querés entregar para achicar o avisame si querés que te pase el link de la app.`
            ];
            paqueteResponderContexto = {
                burbuja1: variantesOfreceEfectivo[varIdx % variantesOfreceEfectivo.length],
                burbuja2: '',
                burbuja3: '',
                pasoEnEspera: `Respuesta corta de WhatsApp para coordinar el efectivo o pasarle el link de la app.`
            };
        } else if (ag1.situacionDialogo === 'CLIENTE_RESPONDE_TANTEO_O_SALUDO') {
            paqueteResponderContexto = paquetePingPongTema;
        } else if (ag1.situacionDialogo === 'SILENCIO_TRAS_RESUMEN_CUENTA' || ag1.situacionDialogo === 'NOSOTROS_YA_TANTEAMOS_HOY') {
            // Si elige ir directo al tema del resumen de cuenta enviado ayer (sin esperar o tras el tanteo)
            const nomDest = apodo || nombrePila || '';
            const prefijo = ag1.situacionDialogo === 'NOSOTROS_YA_TANTEAMOS_HOY'
                ? ''
                : `Hola${nomDest ? ' ' + nomDest : ''}, cómo andás? `;
            const variantesDirectoResumen = [
                `${prefijo}Te escribía cortito para ver si pudiste mirar el resumen que te pasé ${cuandoRes}, contame cómo lo ves o cómo querés que lo manejemos.`,
                `${prefijo}Quería saber si pudiste ver lo que te pasé ${cuandoRes} de la cuenta corriente y cómo venís con eso.`,
                `${prefijo}Che, pudiste chusmear el resumen de cuenta que te mandé ${cuandoRes}? Avisame cómo te queda cómodo organizarlo.`
            ];
            paqueteResponderContexto = {
                burbuja1: variantesDirectoResumen[varIdx % variantesDirectoResumen.length],
                burbuja2: '',
                burbuja3: '',
                pasoEnEspera: `Consulta directa y con tacto sobre el resumen de cuenta enviado ${cuandoRes} (1 sola burbuja).`
            };
        } else if (ag1.situacionDialogo === 'CONTINUAR_NUESTRO_MENSAJE_HOY' || ag1.situacionDialogo === 'NOSOTROS_YA_SALUDAMOS_HOY') {
            // Ya estamos hablando hoy y el último mensaje fue nuestro: no volver a decir "Hola, buen día!"
            const nomDest = apodo || nombrePila || '';
            const habloRepartoODeposito = /reparto|deposito|dep[oó]sito|venir\s+para\s+ac[aá]|andas\s+por\s+ac[aá]/i.test(ag1.fraseSustanciosaCliente || '');
            const variantesContinuarHoy = habloRepartoODeposito
                ? [
                    `Che${nomDest ? ' ' + nomDest : ''}, por cierto, si necesitás que te prepare o alcance algo de mercadería avisame y lo armamos!`,
                    `De paso te digo${nomDest ? ' ' + nomDest : ''}: si estás necesitando reponer algo del depósito decime qué te hace falta y coordinamos.`,
                    `Avisame${nomDest ? ' ' + nomDest : ''} si de paso necesitás algo de mercadería para estos días así ya lo tengo en cuenta!`
                ]
                : [
                    `Por cierto${nomDest ? ' ' + nomDest : ''}, si necesitás ver algún precio o armar pedido para estos días avisame por acá!`,
                    `Cualquier cosita que necesites de mercadería para esta semana chiflame${nomDest ? ' ' + nomDest : ''}!`,
                    `Te dejo acá abajo el link del portal por si en algún momento querés mirar precios actualizados.`
                ];
            const b1Cont = variantesContinuarHoy[varIdx % variantesContinuarHoy.length];
            const llevaLink = /ac[aá]\s+abajo/i.test(b1Cont);
            paqueteResponderContexto = {
                burbuja1: b1Cont,
                burbuja2: llevaLink ? infoDuraLinkPortal : '',
                burbuja3: '',
                pasoEnEspera: `Continuación natural de la charla de hoy sin repetir el saludo inicial.`
            };
        } else if (ag1.situacionDialogo === 'SEGUIMIENTO_CHARLA_PAGOS_PARCIALES') {
            // Caso real Fernando Di Pietro: ayer consultó por pagos parciales, le explicamos y enviamos audio
            const nomDest = apodo || nombrePila;
            const variantesPagosConLink = nomDest
                ? [
                    `Hola ${nomDest}, ${buenDia}, cómo estás? Te escribo por lo que charlamos ${cuando}${mencAudio} Quedate tranquilo para ir manejando los pagos parciales a tu ritmo. Te dejo acá abajo el link del portal por si además están necesitando algo de mercadería para esta semana.`,
                    `${buenDiaCap} ${nomDest}, cómo andás? Seguimos en tema con lo que hablamos ${cuando}${mencAudio2}, manejá los pagos parciales con total tranquilidad como te quede cómodo. Te dejo acá abajo el acceso al portal por si necesitás mirar precios o armar pedido.`,
                    `Hola ${nomDest}, cómo va? Por lo que vimos ${cuando} de ir haciendo pagos de a partes, manejalo tranquilo sin problema que tu cuenta sigue habilitada. Si para estos días necesitan algo de mercadería, acá abajo te dejo el link del portal.`
                ]
                : [
                    `Hola, ${buenDia}, cómo están? Les escribo por lo que charlamos ${cuando}${mencAudio} Quédense tranquilos para ir manejando los pagos parciales a su ritmo. Les dejo acá abajo el link del portal por si además están necesitando algo de mercadería para esta semana.`,
                    `${buenDiaCap}, cómo andan? Seguimos en tema con lo que hablamos ${cuando}, manejen los pagos parciales con total tranquilidad. Les dejo acá abajo el acceso al portal por si necesitan mirar precios o armar pedido.`,
                    `Hola, cómo va? Por lo que vimos ${cuando} de ir haciendo pagos de a partes, manéjenlo tranquilos sin problema. Si para estos días necesitan algo de mercadería, acá abajo les dejo el link del portal.`
                ];
            const b1Pagos = variantesPagosConLink[varIdx % variantesPagosConLink.length];
            paqueteResponderContexto = {
                burbuja1: b1Pagos,
                burbuja2: infoDuraLinkPortal,
                burbuja3: elegirCierreCoherente(b1Pagos, 1),
                pasoEnEspera: `Seguimiento empático sobre lo charlado ${cuando} (pagos parciales/audio) + Link en 2da burbuja + Cierre en 3ra burbuja.`
            };
        } else if (ag1.situacionDialogo === 'SEGUIMIENTO_ARMANDO_PEDIDO_O_STOCK') {
            const variantesArmandoConLink = nombrePila
                ? [
                    `Hola ${nombrePila}, ${buenDia}, cómo va? Como ${cuando} me comentaste que estaban empezando a ver qué necesitaban para armar pedido, te dejo acá abajo el link del portal con los precios al día.`,
                    `${buenDiaCap} ${nombrePila}, cómo andás? Siguiendo lo que hablamos ${cuando}, pudieron ir viendo algo del pedido que estaban armando? Te dejo acá abajo el acceso al portal por si querés consultar algún valor.`,
                    `Hola ${nombrePila}, cómo estás? Te escribo por lo que me comentaste ${cuando} del pedido, te dejo a mano el link del portal por si necesitan revisar precios o sumar algún artículo.`
                ]
                : [
                    `Hola, ${buenDia}, cómo va? Como ${cuando} nos comentaron que estaban empezando a armar pedido, les dejo acá abajo el link del portal con los precios al día.`,
                    `${buenDiaCap}, cómo andan? Siguiendo lo que hablamos ${cuando}, pudieron ir viendo algo del pedido? Les dejo acá abajo el acceso al portal por si quieren consultar algún valor.`
                ];
            const b1Arm = variantesArmandoConLink[varIdx % variantesArmandoConLink.length];
            paqueteResponderContexto = {
                burbuja1: b1Arm,
                burbuja2: infoDuraLinkPortal,
                burbuja3: elegirCierreCoherente(b1Arm, 1),
                pasoEnEspera: `Conectado con el pedido que estaban armando (${cuando}) + Link separado + Cierre.`
            };
        } else if (ag1.situacionDialogo === 'SEGUIMIENTO_LISTA_ENVIADA_RECIENTE') {
            const variantesListaReciente = nombrePila
                ? [
                    `Hola ${nombrePila}, ${buenDia}, cómo estás? Pudiste entrar bien ${cuando} al link del portal para ver la lista de precios o necesitás que te pase algún valor puntual por acá?`,
                    `${buenDiaCap} ${nombrePila}, cómo va? Te consulto cortito si ${cuando} pudiste ver bien los precios en el portal y si están necesitando algo de mercadería para esta semana.`
                ]
                : [
                    `Hola, ${buenDia}, cómo están? Pudieron entrar bien ${cuando} al link del portal para ver la lista de precios o necesitan que les pase algún valor puntual por acá?`,
                    `${buenDiaCap}, cómo va? Les consulto cortito si ${cuando} pudieron ver bien los precios en el portal y si están necesitando algo para esta semana.`
                ];
            const b1Lis = variantesListaReciente[varIdx % variantesListaReciente.length];
            paqueteResponderContexto = {
                burbuja1: `${b1Lis}\n${elegirCierreCoherente(b1Lis, 1)}`,
                burbuja2: '',
                burbuja3: '',
                pasoEnEspera: `Seguimiento sobre la lista de precios enviada ${cuando}.`
            };
        } else if (ag1.situacionDialogo === 'SEGUIMIENTO_RECLAMO_O_FACTURA') {
            const b1Rec = nombrePila
                ? `Hola ${nombrePila}, ${buenDia}, cómo estás? Te escribo siguiendo lo que vimos ${cuando} de la factura para dejarlo resuelto, y de paso consultarte si están necesitando algo de mercadería para esta semana.`
                : `Hola, ${buenDia}, cómo están? Les escribo siguiendo lo que vimos ${cuando} de la factura para dejarlo resuelto, y de paso consultarles si están necesitando algo para esta semana.`;
            paqueteResponderContexto = {
                burbuja1: `${b1Rec}\n${elegirCierreCoherente(b1Rec, 1)}`,
                burbuja2: '',
                burbuja3: '',
                pasoEnEspera: `Seguimiento conectado con la gestión de factura de ${cuando}.`
            };
        } else if (ag1.situacionDialogo === 'SEGUIMIENTO_AUDIO_RECIENTE') {
            const variantesAudio = nombrePila
                ? [
                    `Hola ${nombrePila}, ${buenDia}, cómo estás? Te escribo por lo que hablamos ${cuando}${mencAudio} Avisame cómo vienen para esta semana o si están necesitando algo de mercadería. Te dejo acá abajo el link del portal por si querés mirar precios.`,
                    `${buenDiaCap} ${nombrePila}, cómo va? Siguiendo lo que charlamos ${cuando}${mencAudio2}, cómo vienen para estos días, necesitan reponer algo? Te dejo acá abajo el acceso al portal.`
                ]
                : [
                    `Hola, ${buenDia}, cómo están? Les escribo por lo que hablamos ${cuando}${mencAudio} Avísenme cómo vienen para esta semana o si están necesitando algo de mercadería. Les dejo acá abajo el link del portal.`
                ];
            const b1Aud = variantesAudio[varIdx % variantesAudio.length];
            paqueteResponderContexto = {
                burbuja1: b1Aud,
                burbuja2: infoDuraLinkPortal,
                burbuja3: elegirCierreCoherente(b1Aud, 1),
                pasoEnEspera: `Seguimiento conectado con el audio/charla de ${cuando} + Link en 2da burbuja + Cierre.`
            };
        } else if (ag1.situacionDialogo === 'CLIENTE_POSTERGO_Y_LLEGO_MOMENTO') {
            // Caso real Ale: a las 12:09 dijo "cualquier cosa te escribo a la tardecita" y ahora son las 18:35 (pasaron 6h)
            const variantesRetomarTardeConLink = nombrePila
                ? [
                    `Hola ${nombrePila}, ${buenDia}! Como hoy me comentaste que por ahí${momTxt || ' más tarde'} veías si necesitaban algo, te dejo acá abajo el link del portal por si querés mirar precios.`,
                    `${buenDiaCap} ${nombrePila}, cómo va? Te dejo a mano el link del portal por si ahora${momTxt || ' a la tarde'} querés revisar algún precio o armar pedido.`,
                    `Hola ${nombrePila}, cómo andás? Por si al final necesitás consultar algún valor ahora${momTxt || ' a la tarde'}, te paso acá abajo el acceso directo al portal.`
                ]
                : [
                    `Hola, ${buenDia}! Como hoy nos comentaron que por ahí${momTxt || ' más tarde'} veían si necesitaban algo, les dejo acá abajo el link del portal por si quieren mirar precios.`,
                    `${buenDiaCap}, cómo va? Les dejo a mano el link del portal por si ahora${momTxt || ' a la tarde'} quieren revisar algún precio.`,
                    `Hola, cómo andan? Por si al final necesitan consultar algún valor ahora${momTxt || ' a la tarde'}, les paso acá abajo el acceso al portal.`
                ];
            const b1Retomar = variantesRetomarTardeConLink[varIdx % variantesRetomarTardeConLink.length];
            paqueteResponderContexto = {
                burbuja1: b1Retomar,
                burbuja2: infoDuraLinkPortal,
                burbuja3: elegirCierreCoherente(b1Retomar, 1),
                pasoEnEspera: `Seguimiento acorde a la hora actual (${ag1.etiquetaHaceCuanto} desde que escribió) + Link en 2da burbuja + Cierre sin repetir.`
            };
        } else if (ag1.situacionDialogo === 'CLIENTE_POSTERGA_O_ESTA_BIEN') {
            // El cliente acaba de responder hace poco (< 2h) que por ahora está bien / más tarde avisa
            const variantesB1ConLink = nombrePila
                ? [
                    `Dale ${nombrePila}, perfecto! Te dejo acá abajo el link del portal por si${momTxt || ' más tarde'} querés mirar algún precio.`,
                    `Ok ${nombrePila}, genial! Te adjunto el acceso al portal por si${momTxt || ' después'} querés ver valores actualizados.`,
                    `Buenísimo ${nombrePila}, gracias por avisar! Te dejo el link del portal por si más adelante querés chusmear precios.`
                ]
                : [
                    `Dale, perfecto! Les dejo acá abajo el link del portal por si${momTxt || ' más tarde'} quieren mirar algún precio.`,
                    `Ok, genial! Les adjunto el acceso al portal por si${momTxt || ' después'} quieren ver valores actualizados.`,
                    `Buenísimo, gracias por avisar! Les dejo el link del portal por si más adelante quieren mirar precios.`
                ];
            const b1Post = variantesB1ConLink[varIdx % variantesB1ConLink.length];
            paqueteResponderContexto = {
                burbuja1: b1Post,
                burbuja2: infoDuraLinkPortal,
                burbuja3: elegirCierreCoherente(b1Post, 2),
                pasoEnEspera: `Acuse inmediato + Link del Portal separado + Cierre en 3ra burbuja.`
            };
        } else if (ag1.situacionDialogo === 'CLIENTE_AGRADECE_O_CONFIRMA') {
            const variantesGracias = nombrePila
                ? [
                    `Gracias a vos ${nombrePila}! Cualquier cosa escribime por acá.`,
                    `Bárbaro ${nombrePila}, quedamos a disposición!`,
                    `Un gusto ${nombrePila}, cualquier cosita avisame!`
                ]
                : [
                    `Gracias a ustedes! Cualquier cosa escríbanme por acá.`,
                    `Bárbaro, quedamos a disposición!`,
                    `Muchas gracias, cualquier cosita avisen!`
                ];
            paqueteResponderContexto = {
                burbuja1: variantesGracias[varIdx % variantesGracias.length],
                burbuja2: '',
                burbuja3: '',
                pasoEnEspera: `Cierre corto de cortesía (1 sola burbuja).`
            };
        } else if (ag1.situacionDialogo === 'CLIENTE_ENVIA_PEDIDO') {
            const b1Ped = nombrePila
                ? `Perfecto ${nombrePila}, ya tomamos nota y te lo vamos preparando.`
                : `Perfecto, ya tomamos nota y lo vamos preparando.`;
            paqueteResponderContexto = {
                burbuja1: b1Ped,
                burbuja2: '',
                burbuja3: elegirCierreCoherente(b1Ped, 1),
                pasoEnEspera: `Confirmación corta de pedido recibido.`
            };
        } else if (ag1.situacionDialogo === 'CLIENTE_PIDE_LISTA') {
            const prefHora = ag1.horasDesdeUltimoMsg >= 2.5 ? `${buenDiaCap}${nombrePila ? ' ' + nombrePila : ''}! ` : (nombrePila ? `Hola ${nombrePila}, ` : `Hola, `);
            const b1Lista = `${prefHora}te paso acá abajo el link del portal con los precios actualizados:`;
            paqueteResponderContexto = {
                burbuja1: b1Lista,
                burbuja2: infoDuraLinkPortal,
                burbuja3: elegirCierreCoherente(b1Lista, 2),
                pasoEnEspera: `Texto corto + Link separado + Cierre sin repetir.`
            };
        } else {
            const prefHora = ag1.horasDesdeUltimoMsg >= 2.5
                ? (nombrePila ? `Hola ${nombrePila}, ${buenDia}! ` : `Hola, ${buenDia}! `)
                : (nombrePila ? `Dale ${nombrePila}, ` : `Dale, `);
            const variantesAcuseSimple = [
                `${prefHora}cualquier cosa escribime por acá.`,
                `${prefHora}perfecto! Quedamos a disposición por cualquier consulta.`,
                `${prefHora}buenísimo, quedamos atentos por cualquier cosa.`
            ];
            paqueteResponderContexto = {
                burbuja1: variantesAcuseSimple[varIdx % variantesAcuseSimple.length],
                burbuja2: '',
                burbuja3: '',
                pasoEnEspera: `Respuesta corta y al pie (1 burbuja).`
            };
        }

        // ----------------------------------------------------------------------------------
        // B. ACUSE O SEGUIMIENTO CORTO EN 1 SOLA BURBUJA (Modo 'SOLO_ATENTOS', sin link)
        // ----------------------------------------------------------------------------------
        let variantesSoloTexto = [];
        if (ag1.situacionDialogo === 'SEGUIMIENTO_CHARLA_PAGOS_PARCIALES') {
            variantesSoloTexto = nombrePila
                ? [
                    `Hola ${nombrePila}, ${buenDia}, cómo estás? Te escribo cortito por lo que charlamos ${cuando}${mencAudio} Quedate tranquilo para ir manejando los pagos parciales a tu ritmo, y avisame si para esta semana estás necesitando algo de mercadería.\nEstoy atento.`,
                    `${buenDiaCap} ${nombrePila}, cómo andás? Pudiste ver lo que te pasé ${cuando}${mencAudio2}? Por el tema de los pagos parciales manejalo tranquilo como te quede cómodo, y decime si necesitan reponer algo de mercadería para estos días.\nCualquier cosa escribime por acá.`,
                    `Hola ${nombrePila}, cómo va? Seguimos en tema con lo que hablamos ${cuando}, manejalo con total tranquilidad que tu cuenta sigue habilitada. Avisame si además están necesitando algo de mercadería para esta semana.\nQuedamos a disposición.`
                ]
                : [
                    `Hola, ${buenDia}, cómo están? Les escribo cortito por lo que charlamos ${cuando}${mencAudio} Quédense tranquilos para ir manejando los pagos parciales a su ritmo, y avísenme si para esta semana están necesitando algo de mercadería.\nEstoy atento.`,
                    `${buenDiaCap}, cómo andan? Pudieron ver lo que les pasé ${cuando}? Por los pagos parciales manéjenlo tranquilos como les quede cómodo, y díganme si necesitan reponer algo de mercadería.\nCualquier cosa escríbanme por acá.`
                ];
        } else if (ag1.situacionDialogo === 'SEGUIMIENTO_ARMANDO_PEDIDO_O_STOCK') {
            variantesSoloTexto = nombrePila
                ? [
                    `Hola ${nombrePila}, ${buenDia}, cómo va? Pudieron ir viendo algo del pedido que estaban armando ${cuando} o necesitan que les consulte algún precio?\nEstoy atento.`,
                    `${buenDiaCap} ${nombrePila}, cómo andás? Te escribo por lo que me comentaste ${cuando}, avisame cuando tengas listo el pedido o si necesitás ver algún valor.\nCualquier cosa escribime por acá.`
                ]
                : [
                    `Hola, ${buenDia}, cómo va? Pudieron ir viendo algo del pedido que estaban armando ${cuando} o necesitan que les consulte algún precio?\nQuedamos atentos.`
                ];
        } else if (ag1.situacionDialogo === 'SEGUIMIENTO_LISTA_ENVIADA_RECIENTE' || ag1.situacionDialogo === 'SEGUIMIENTO_AUDIO_RECIENTE' || ag1.situacionDialogo === 'SEGUIMIENTO_RECLAMO_O_FACTURA') {
            variantesSoloTexto = nombrePila
                ? [
                    `Hola ${nombrePila}, ${buenDia}, cómo estás? Pudiste ver lo que hablamos ${cuando}${mencAudio} Avisame si para esta semana estás necesitando algo de mercadería o alguna consulta.\nEstoy atento.`,
                    `${buenDiaCap} ${nombrePila}, cómo va? Seguimos en tema con lo de ${cuando}, decime cualquier duda que tengas y si necesitan reponer algo para estos días.\nCualquier cosa escribime por acá.`
                ]
                : [
                    `Hola, ${buenDia}, cómo están? Pudieron ver lo que hablamos ${cuando}? Avísenme si para esta semana están necesitando algo de mercadería.\nQuedamos atentos.`
                ];
        } else if (ag1.situacionDialogo === 'CLIENTE_POSTERGO_Y_LLEGO_MOMENTO') {
            variantesSoloTexto = nombrePila
                ? [
                    `Hola ${nombrePila}, ${buenDia}! Pudiste ver si necesitaban algo para esta semana o están bien así?`,
                    `${buenDiaCap} ${nombrePila}, cómo va? Te consulto cortito si al final necesitaron algo hoy${momTxt} o están cubiertos.`,
                    `Hola ${nombrePila}, cómo andás? Avisame si al final necesitan algo para estos días o si por esta semana están bien.`
                ]
                : [
                    `Hola, ${buenDia}! Pudieron ver si necesitaban algo para esta semana o están bien así?`,
                    `${buenDiaCap}, cómo va? Les consulto cortito si al final necesitaron algo hoy${momTxt} o están cubiertos.`,
                    `Hola, cómo andan? Avísenme si al final necesitan algo para estos días o si por esta semana están bien.`
                ];
        } else {
            variantesSoloTexto = nombrePila
                ? [
                    `Dale ${nombrePila}, perfecto! Cualquier cosa${momTxt} escribime por acá.`,
                    `Ok ${nombrePila}, genial. Quedamos a disposición por cualquier cosa.`,
                    `Buenísimo ${nombrePila}, gracias por avisar! Cualquier cosita avisame.`
                ]
                : [
                    `Dale, perfecto! Cualquier cosa${momTxt} escríbanme por acá.`,
                    `Ok, genial. Quedamos a disposición por cualquier cosa.`,
                    `Buenísimo, gracias por avisar! Cualquier cosita avisen.`
                ];
        }
        const paqueteSoloAtentos = {
            burbuja1: variantesSoloTexto[varIdx % variantesSoloTexto.length],
            burbuja2: '',
            burbuja3: '',
            pasoEnEspera: `1 solo mensaje corto empático y conectado con la charla previa.`
        };

        // ----------------------------------------------------------------------------------
        // C. SALUDO CORTO DE SEMANA CON VARIACIÓN INTELIGENTE (Anti-repetición contra el historial)
        // ----------------------------------------------------------------------------------
        const repertorioSaludosCuerpo = nombrePila
            ? [
                `Hola ${nombrePila}, ${buenDia}! Espero que estés teniendo un buen ${diaSemana}. Cómo venís esta semana, necesitás algo o ver algún precio?`,
                `${buenDiaCap} ${nombrePila}, cómo andás? Cómo vienen para esta semana, necesitan reponer algo o ver algún precio?`,
                `Hola ${nombrePila}, cómo va todo? Cómo vienen de mercadería para estos días, necesitás consultar algún precio?`,
                `Muy ${buenDia} ${nombrePila}! Cómo arrancaron la semana, necesitan algo o alguna consulta de precios?`,
                `Hola ${nombrePila}, ${buenDia}, cómo estás? Para esta semana, estás necesitando algo o querés ver algún valor?`,
                `${buenDiaCap} ${nombrePila}, todo bien? Espero que venga muy bien el ${diaSemana}. Necesitás algo para estos días?`,
                `Hola ${nombrePila}, cómo va la semana? Necesitan algo de mercadería para estos días o ver algún precio?`,
                `Hola ${nombrePila}, ${buenDia}, cómo va? Cómo venís esta semana, necesitás algo o consulta?`
            ]
            : [
                `Hola, ${buenDia}! Espero que estén teniendo un buen ${diaSemana}. Cómo vienen esta semana, necesitan algo o ver algún precio?`,
                `${buenDiaCap}, cómo andan? Cómo vienen para esta semana, necesitan reponer algo o ver algún precio?`,
                `Hola, cómo va todo? Cómo vienen de mercadería para estos días, necesitan consultar algún precio?`,
                `Muy ${buenDia}! Cómo arrancaron la semana, necesitan algo o alguna consulta de precios?`,
                `Hola, ${buenDia}, cómo están? Para esta semana, están necesitando algo o quieren ver algún valor?`,
                `${buenDiaCap}, todo bien? Espero que venga muy bien el ${diaSemana}. Necesitan algo para estos días?`,
                `Hola, cómo va la semana? Necesitan algo de mercadería para estos días o ver algún precio?`,
                `Hola, ${buenDia}, cómo va? Cómo vienen esta semana, necesitan algo o consulta?`
            ];

        // Filtrar cualquier saludo cuya apertura o estructura repita el último saludo que le mandamos a este cliente
        const normUltSaludo = normalizar(infoContacto.ultimoSaludoNuestro || '');
        const normUltCompleto = normalizar(infoContacto.ultimoMensajeSaludoCompletoNuestro || '');
        const saludosNoRepetidos = repertorioSaludosCuerpo.filter(cand => {
            if (!normUltSaludo && !normUltCompleto) return true;
            const normCand = normalizar(cand);
            // Si el último saludo tenía "como venis esta semana, necesitas algo o consulta", evitar esa misma fórmula
            if (normUltCompleto.includes('necesitas algo o consulta') && normCand.includes('necesitas algo o consulta')) return false;
            if (normUltCompleto.includes('espero que estes teniendo') && normCand.includes('espero que estes teniendo')) return false;
            if (normUltCompleto.includes('como andas') && normCand.includes('como andas')) return false;
            if (normUltCompleto.includes('como va todo') && normCand.includes('como va todo')) return false;
            const prefijoCand = normCand.slice(0, 28);
            const prefijoUlt = normUltSaludo.slice(0, 28);
            return prefijoCand !== prefijoUlt;
        });

        const poolSaludosFinal = saludosNoRepetidos.length > 0 ? saludosNoRepetidos : repertorioSaludosCuerpo;
        const cuerpoSaludoElegido = poolSaludosFinal[idxCombinado % poolSaludosFinal.length];
        const cierreParaSaludo1Burbuja = elegirCierreCoherente(cuerpoSaludoElegido, 0);

        const paqueteSaludoSemanal = {
            burbuja1: `${cuerpoSaludoElegido}\n${cierreParaSaludo1Burbuja}`,
            burbuja2: '',
            burbuja3: '',
            pasoEnEspera: `Saludo corto variado (distinto al último enviado) esperando respuesta del cliente.`
        };

        // ----------------------------------------------------------------------------------
        // D. PASAR LINK DEL PORTAL (Texto libre corto SIN cierre en B1 + Link en B2 + Cierre en B3)
        // ----------------------------------------------------------------------------------
        const AperturasCortasPortal = enCurso
            ? ['', '', '']
            : (nombrePila
                ? [
                    `Hola ${nombrePila}, ${buenDia}, cómo va? `,
                    `${buenDiaCap} ${nombrePila}, cómo andás? `,
                    `Hola ${nombrePila}, espero que estés teniendo un buen ${diaSemana}! `
                ]
                : [
                    `Hola, ${buenDia}, cómo va? `,
                    `${buenDiaCap}, cómo andan? `,
                    `Hola, espero que estén teniendo un buen ${diaSemana}! `
                ]);
        const saludoPrefijoCorto = AperturasCortasPortal[idxCombinado % AperturasCortasPortal.length];

        const variantesTextoPortal = [
            `${saludoPrefijoCorto}Te dejo acá abajo el link del portal por si querés ver precios actualizados o armar pedido.`,
            `${saludoPrefijoCorto}Te paso el acceso a nuestro portal donde podés consultar todos los precios al día.`,
            `${saludoPrefijoCorto}Te adjunto acá abajo el link del portal por si necesitás mirar algún precio esta semana.`
        ];
        const b1Portal = limpiarCierreAlFinalDeBurbuja(variantesTextoPortal[idxCombinado % variantesTextoPortal.length]);

        const paquetePortalSeparado = {
            burbuja1: b1Portal,
            burbuja2: infoDuraLinkPortal,
            burbuja3: elegirCierreCoherente(b1Portal, 1),
            pasoEnEspera: `Texto corto sin cierre repetido + Link del Portal en 2da burbuja + Cierre en 3ra burbuja.`
        };

        // ----------------------------------------------------------------------------------
        // E. PASAR PRECIOS / ACTUALIZACIONES PENDIENTES EN JERARQUÍA B2B (B1 sin cierre + Precios en B2 + Cierre en B3)
        // ----------------------------------------------------------------------------------
        const pendientesB2B = ag2.pendientesOrdenadosB2B || [];
        const listaCotizar = seleccionados.length > 0
            ? ordenarPorJerarquiaB2BInterno(seleccionados)
            : ((ag1.situacionDialogo === 'CLIENTE_CONSULTA_PUNTUAL' && ag2.mencionados.length > 0)
                ? ag2.mencionados.slice(0, 8)
                : (pendientesB2B.length > 0
                    ? pendientesB2B.slice(0, 8)
                    : (ag2.habitualesConCambioPrecio.length > 0
                        ? ag2.habitualesConCambioPrecio.slice(0, 6)
                        : (ag2.mencionados.length > 0 ? ag2.mencionados : ag2.topHabituales.slice(0, 4)))));

        const lineasPreciosDuros = listaCotizar.length > 0
            ? formatearResumenWhatsAppJerarquiaB2B(listaCotizar.slice(0, 8), lid)
            : '';

        let textoIntroPrecios = '';
        if (ag1.situacionDialogo === 'CLIENTE_CONSULTA_PUNTUAL') {
            if (ag1.esPromesaPuenteNuestra || ag1.yaSaludamosHoy) {
                // Ya nos saludamos hoy (o ya le dijimos "En un ratin te paso todo"): continuar directo al pie sin repetir "Hola X, buen día!"
                const nomC = apodo || nombrePila || '';
                const variantesYaSaludamos = ag1.ultimoEntranteEsAudio
                    ? [
                        `${nomC ? nomC + ', a' : 'A'}cá abajo te paso los precios y las presentaciones de lo que me consultaste en el audio:`,
                        `Ahí escuché bien tu audio${nomC ? ', ' + nomC : ''}! Te dejo acá abajo los valores puntuales y las presentaciones:`,
                        `Te paso directo por acá${nomC ? ' ' + nomC : ''} los precios y presentaciones que me pediste en el audio:`
                    ]
                    : [
                        `${nomC ? nomC + ', a' : 'A'}cá abajo te paso los precios y presentaciones de lo que me consultaste:`,
                        `Te dejo acá abajo${nomC ? ' ' + nomC : ''} los valores actualizados que me pediste:`
                    ];
                textoIntroPrecios = variantesYaSaludamos[varIdx % variantesYaSaludamos.length];
            } else if (ag1.clienteNoPuedeEntrarPortal) {
                const variantesNoPuedeEntrar = nombrePila
                    ? [
                        `Hola ${nombrePila}, ${buenDia}! Sí, claro, quedate tranquila que te paso los valores directo por acá:`,
                        `${buenDiaCap} ${nombrePila}! No hay problema, te paso acá abajo los precios que me pediste:`,
                        `Hola ${nombrePila}, cómo estás? Dale, no te preocupes por entrar a la página, acá te dejo los precios actualizados:`
                    ]
                    : [
                        `Hola, ${buenDia}! Sí, claro, no hay problema, te paso los valores directo por acá:`,
                        `${buenDiaCap}! Te paso acá abajo los precios que nos consultaste:`
                    ];
                textoIntroPrecios = variantesNoPuedeEntrar[varIdx % variantesNoPuedeEntrar.length];
            } else if (ag1.ultimoEntranteEsAudio) {
                const variantesAudioPrecios = nombrePila
                    ? [
                        `Hola ${nombrePila}, ${buenDia}! Ahí escuché tu audio, te paso acá abajo los precios actualizados:`,
                        `${buenDiaCap} ${nombrePila}, cómo estás? Dale, te paso por acá los valores que me consultaste en el audio:`,
                        `Hola ${nombrePila}! Sí, claro, acá abajo te dejo los precios que me pediste:`
                    ]
                    : [
                        `Hola, ${buenDia}! Ahí escuchamos el audio, te paso acá abajo los precios actualizados:`
                    ];
                textoIntroPrecios = variantesAudioPrecios[varIdx % variantesAudioPrecios.length];
            } else {
                const prefConsulta = nombrePila ? `Hola ${nombrePila}, ${buenDia}! ` : `Hola, ${buenDia}! `;
                textoIntroPrecios = `${enCurso ? saludoPrefijoCorto : prefConsulta}Te paso acá abajo los precios actualizados:`;
            }
        } else if (seleccionados.length === 0 && (pendientesB2B.length > 0 || ag2.habitualesConCambioPrecio.length > 0)) {
            textoIntroPrecios = `${saludoPrefijoCorto}Te paso acá abajo cómo quedaron actualizados los valores de los artículos que solés llevar:`;
        } else {
            textoIntroPrecios = `${saludoPrefijoCorto}Te paso acá abajo los precios actualizados:`;
        }

        const paqueteCotizarSeparado = lineasPreciosDuros
            ? {
                burbuja1: limpiarCierreAlFinalDeBurbuja(textoIntroPrecios),
                burbuja2: lineasPreciosDuros,
                burbuja3: elegirCierreCoherente(textoIntroPrecios, 2),
                pasoEnEspera: `Texto corto + Precios ordenados por Jerarquía B2B en 2da burbuja + Cierre en 3ra burbuja.`
            }
            : {
                burbuja1: `${saludoPrefijoCorto}Decime qué artículo querés consultar y te paso el precio enseguida.`,
                burbuja2: '',
                burbuja3: elegirCierreCoherente(saludoPrefijoCorto, 2),
                pasoEnEspera: `Esperando que indique qué artículo cotizar.`
            };

        if (ag1.situacionDialogo === 'CLIENTE_CONSULTA_PUNTUAL') {
            paqueteResponderContexto = paqueteCotizarSeparado;
        }

        // Paquete específico para avisar las Actualizaciones Pendientes de "Gestión de Cambios y Notificaciones"
        const fuenteActualizaciones = pendientesB2B.length > 0
            ? pendientesB2B
            : (ag2.habitualesConCambioPrecio.length > 0 ? ag2.habitualesConCambioPrecio : ag2.topHabituales);
        const resumenActualizacionesB2B = formatearResumenWhatsAppJerarquiaB2B(fuenteActualizaciones.slice(0, 10), lid);

        let introActualizaciones = '';
        if (ag1.situacionDialogo === 'SEGUIMIENTO_CHARLA_PAGOS_PARCIALES') {
            introActualizaciones = nombrePila
                ? `Hola ${nombrePila}, ${buenDia}, cómo estás? Seguimos en tema con lo que hablamos ${cuando}${mencAudio2}, manejá los pagos parciales con total tranquilidad. De paso te dejo acá abajo cómo quedaron actualizados los valores de los artículos que solés llevar:`
                : `Hola, ${buenDia}, cómo están? Seguimos en tema con lo que hablamos ${cuando}, manejen los pagos parciales con total tranquilidad. De paso les dejo acá abajo cómo quedaron actualizados los valores de los artículos habituales:`;
        } else if (enCurso) {
            introActualizaciones = `Te paso acá abajo cómo quedaron actualizados los valores de los artículos que solés llevar:`;
        } else {
            const variantesIntroAct = nombrePila
                ? [
                    `Hola ${nombrePila}, ${buenDia}, cómo va? Te paso acá abajo cómo quedaron actualizados los valores de los artículos que solés llevar:`,
                    `${buenDiaCap} ${nombrePila}, cómo estás? Te dejo acá abajo la actualización de precios de los productos que comprás habitualmente:`,
                    `Hola ${nombrePila}, cómo andás? Te comparto cómo quedaron los valores actualizados de tus artículos habituales:`
                ]
                : [
                    `Hola, ${buenDia}, cómo va? Les paso acá abajo cómo quedaron actualizados los valores de los artículos que suelen llevar:`,
                    `${buenDiaCap}, cómo están? Les dejo acá abajo la actualización de precios de los productos habituales:`
                ];
            introActualizaciones = variantesIntroAct[varIdx % variantesIntroAct.length];
        }

        const paqueteActualizacionesPendientes = resumenActualizacionesB2B
            ? {
                burbuja1: limpiarCierreAlFinalDeBurbuja(introActualizaciones),
                burbuja2: resumenActualizacionesB2B,
                burbuja3: elegirCierreCoherente(introActualizaciones, 2),
                pasoEnEspera: `Aviso de actualizaciones pendientes ordenado por Jerarquía B2B (al enviar se marcan como NOTIFICADO).`
            }
            : paqueteCotizarSeparado;

        // ----------------------------------------------------------------------------------
        // F. CONSULTAR POR SUS HABITUALES (Corto y al pie)
        // ----------------------------------------------------------------------------------
        let paqueteHabituales = paqueteSaludoSemanal;
        if (ag2.topHabituales.length > 0) {
            const prod1 = nombreProductoConversacional(ag2.topHabituales[0].nombre, false);
            const prod2 = ag2.topHabituales[1] ? nombreProductoConversacional(ag2.topHabituales[1].nombre, false) : '';
            const mencionProds = prod2 && normalizar(prod1) !== normalizar(prod2)
                ? `${prod1} o ${prod2}`
                : `${prod1}`;
            const b1Hab = `${saludoPrefijoCorto}Cómo vienen esta semana, necesitan reponer ${mencionProds} o ver algún precio?`;
            paqueteHabituales = {
                burbuja1: `${b1Hab}\n${elegirCierreCoherente(b1Hab, 1)}`,
                burbuja2: '',
                burbuja3: '',
                pasoEnEspera: `Consulta corta mencionando lo que suele comprar.`
            };
        }

        // ----------------------------------------------------------------------------------
        // G. LISTA EN PDF
        // ----------------------------------------------------------------------------------
        const b1Pdf = `${saludoPrefijoCorto}Te adjunto la lista de precios actualizada en PDF.`;
        const paquetePdf = {
            burbuja1: b1Pdf,
            burbuja2: elegirCierreCoherente(b1Pdf, 1),
            burbuja3: '',
            pasoEnEspera: `PDF adjunto + cierre atento.`
        };

        // ----------------------------------------------------------------------------------
        // H. AVISO CORTO DE CUENTA CORRIENTE (SIN PDF, 1 SOLA BURBUJA) Y POLÍTICAS DE LISTA
        // ----------------------------------------------------------------------------------
        const textosSaldo = generarTextosMencionSaldoWa(st, infoContacto, ag3, 0);
        const b1ConPuentePortal = /portal|link|acceso/i.test(cuerpoSaludoElegido)
            ? limpiarCierreAlFinalDeBurbuja(cuerpoSaludoElegido)
            : `${limpiarCierreAlFinalDeBurbuja(cuerpoSaludoElegido)} Te dejo acá abajo el link del portal por si querés mirar precios.`;

        const yaSaludamosHoy = Boolean(
            enCurso ||
            ag1.situacionDialogo === 'NOSOTROS_YA_TANTEAMOS_HOY' ||
            ag1.situacionDialogo === 'NOSOTROS_YA_SALUDAMOS_HOY' ||
            ag1.situacionDialogo === 'CONTINUAR_NUESTRO_MENSAJE_HOY'
        );
        const prefSaludoAvisoCuenta = yaSaludamosHoy
            ? ''
            : (apodo ? `Hola ${apodo}, cómo va? ` : `Hola, ${buenDia}, cómo va? `);

        let variantesAvisoCortoCuenta = [];
        const txtParenGlobal = ag3.desgloseParentesisCorto
            ? ` ${ag3.desgloseParentesisCorto}`
            : (ag3.antiguedadMax > 0 ? ` (de hace ${ag3.antiguedadMax} días)` : '');
        if (ag3.patronCuentaAbierta === 'DOS_PENDIENTES_ULTIMA_Y_ANTERIOR_ATRAS') {
            variantesAvisoCortoCuenta = [
                `${prefSaludoAvisoCuenta}Solamente quería recordarte que hay dos facturas pendientes (una anterior y la última que te entregué) por un total de *${ag3.saldoFmt}*${txtParenGlobal}. Como nunca dejás una factura pendiente, te quería enviar este recordatorio y te adjunto ahora el resumen. Cualquier duda avisame!`,
                `${prefSaludoAvisoCuenta}Solamente quería avisarte que hay dos facturas pendientes (la última y la anterior) por un total de *${ag3.saldoFmt}*${txtParenGlobal}. Como nunca dejás una factura pendiente, te quería enviar este recordatorio y ahora te adjunto el resumen. Cualquier cosa decime!`,
                `${prefSaludoAvisoCuenta}Solamente te escribía para recordarte que hay una factura pendiente anterior y la última que te entregué por un total de *${ag3.saldoFmt}*${txtParenGlobal}. Como nunca dejás una factura pendiente, te mando este recordatorio y te adjunto ahora el resumen!`
            ];
        } else if (ag3.patronCuentaAbierta === 'UNA_FACTURA_ATRASADA_PAGADOR_CUMPLIDOR') {
            variantesAvisoCortoCuenta = [
                `${prefSaludoAvisoCuenta}Solamente quería recordarte que quedó una factura pendiente anterior por un total de *${ag3.saldoFmt}*${txtParenGlobal}. Como nunca dejás una factura pendiente, te quería enviar este recordatorio y te adjunto ahora el resumen. Cualquier duda avisame!`,
                `${prefSaludoAvisoCuenta}Solamente quería avisarte que quedó pendiente una factura anterior por un total de *${ag3.saldoFmt}*${txtParenGlobal}. Como nunca dejás una factura pendiente, te quería enviar este recordatorio y ahora te adjunto el resumen. Cualquier cosa decime!`
            ];
        } else if (ag3.tieneSaldo) {
            variantesAvisoCortoCuenta = [
                `${prefSaludoAvisoCuenta}Solamente quería recordarte por el saldo total pendiente en cuenta de *${ag3.saldoFmt}*${txtParenGlobal} y te adjunto ahora el resumen. Cualquier duda avisame!`,
                `${prefSaludoAvisoCuenta}Solamente te escribía para avisarte del saldo total pendiente en cuenta por *${ag3.saldoFmt}*${txtParenGlobal}. Ahora te adjunto el resumen, cualquier cosa decime!`
            ];
        } else {
            variantesAvisoCortoCuenta = [
                `${prefSaludoAvisoCuenta}${textosSaldo.mencionCortaInline}`
            ];
        }

        const paqueteAvisoCortoCuenta = {
            burbuja1: variantesAvisoCortoCuenta[varIdx % variantesAvisoCortoCuenta.length],
            burbuja2: '',
            burbuja3: '',
            pasoEnEspera: `Recordatorio corto y directo en 1 sola burbuja avisando que ahora se adjunta el resumen en PDF.`
        };

        const paqueteSaldoCorto = {
            burbuja1: b1ConPuentePortal,
            burbuja2: infoDuraLinkPortal,
            burbuja3: textosSaldo.mencionCortaBurbuja,
            pasoEnEspera: `Saludo semanal + Link del Portal + Recordatorio corto del saldo pendiente (${ag3.saldoFmt}).`
        };

        const paqueteSaldoYPoliticas = {
            burbuja1: b1ConPuentePortal,
            burbuja2: infoDuraLinkPortal,
            burbuja3: textosSaldo.detalleSaldoYPoliticasBurbuja,
            pasoEnEspera: `Saludo semanal + Link del Portal + Detalle de saldo (${ag3.saldoFmt}) y políticas de su Lista de Precios.`
        };

        // ----------------------------------------------------------------------------------
        // SELECCIÓN INTELIGENTE DEL PAQUETE ACTIVO (CON CINTURA TÁCTICA DE WHATSAPP)
        // ----------------------------------------------------------------------------------
        let modoResuelto = modoAccion;
        let paqueteElegido = paqueteSaludoSemanal;
        const tienePatronFacturasAtrasCumplidor = (
            ag3.patronCuentaAbierta === 'DOS_PENDIENTES_ULTIMA_Y_ANTERIOR_ATRAS' ||
            ag3.patronCuentaAbierta === 'UNA_FACTURA_ATRASADA_PAGADOR_CUMPLIDOR'
        ) && !ag1.enviamosResumenCuentaReciente;

        if (seleccionados.length > 0 && (modoAccion === 'AUTO' || modoAccion === 'COTIZAR')) {
            modoResuelto = 'COTIZAR';
            paqueteElegido = paqueteCotizarSeparado;
        } else if (modoAccion === 'AVISO_CORTO_CUENTA') {
            modoResuelto = 'AVISO_CORTO_CUENTA';
            paqueteElegido = paqueteAvisoCortoCuenta;
        } else if (modoAccion === 'TANTEO_CORTO') {
            modoResuelto = 'TANTEO_CORTO';
            paqueteElegido = paqueteTanteoCorto;
        } else if (modoAccion === 'PING_PONG_TEMA') {
            modoResuelto = 'PING_PONG_TEMA';
            paqueteElegido = paquetePingPongTema;
        } else if (modoAccion === 'ACTUALIZACIONES_PENDIENTES') {
            modoResuelto = 'ACTUALIZACIONES_PENDIENTES';
            paqueteElegido = paqueteActualizacionesPendientes;
        } else if (modoAccion === 'SALDO_CORTO') {
            modoResuelto = 'SALDO_CORTO';
            paqueteElegido = paqueteSaldoCorto;
        } else if (modoAccion === 'SALDO_Y_POLITICAS') {
            modoResuelto = 'SALDO_Y_POLITICAS';
            paqueteElegido = paqueteSaldoYPoliticas;
        } else if (modoAccion === 'RESPONDER_CONTEXTO') {
            modoResuelto = 'RESPONDER_CONTEXTO';
            paqueteElegido = paqueteResponderContexto;
        } else if (modoAccion === 'SOLO_ATENTOS') {
            modoResuelto = 'SOLO_ATENTOS';
            paqueteElegido = paqueteSoloAtentos;
        } else if (modoAccion === 'SALUDO_SEMANAL') {
            modoResuelto = 'SALUDO_SEMANAL';
            paqueteElegido = paqueteSaludoSemanal;
        } else if (modoAccion === 'HABITUALES') {
            modoResuelto = 'HABITUALES';
            paqueteElegido = paqueteHabituales;
        } else if (modoAccion === 'COTIZAR') {
            modoResuelto = 'COTIZAR';
            paqueteElegido = paqueteCotizarSeparado;
        } else if (modoAccion === 'PORTAL') {
            modoResuelto = 'PORTAL';
            paqueteElegido = paquetePortalSeparado;
        } else if (modoAccion === 'PDF') {
            modoResuelto = 'PDF';
            paqueteElegido = paquetePdf;
        } else {
            // MODO AUTO: El Agente interpreta el historial de pagos, las facturas abiertas y el hilo de WhatsApp
            if (
                ag1.situacionDialogo === 'CLIENTE_COORDINO_RETIRO_O_ENSOBRADO' ||
                ag1.situacionDialogo === 'CLIENTE_CONSULTA_LINK_EFECTIVO_APP' ||
                ag1.situacionDialogo === 'CLIENTE_OFRECE_EFECTIVO_BARRIO'
            ) {
                modoResuelto = 'RESPONDER_CONTEXTO';
                paqueteElegido = paqueteResponderContexto;
            } else if (ag1.situacionDialogo === 'CLIENTE_CONSULTA_PUNTUAL') {
                modoResuelto = 'COTIZAR';
                paqueteElegido = paqueteCotizarSeparado;
            } else if (ag1.situacionDialogo === 'CLIENTE_PIDE_LISTA') {
                modoResuelto = 'PORTAL';
                paqueteElegido = paqueteResponderContexto;
            } else if (ag1.situacionDialogo === 'CLIENTE_ENVIA_PEDIDO') {
                modoResuelto = 'RESPONDER_CONTEXTO';
                paqueteElegido = paqueteResponderContexto;
            } else if (tienePatronFacturasAtrasCumplidor) {
                // Caso real Cecilia (577 The Green Corner): paga siempre al día, entregamos hace 2 días y quedó esa + 1 factura anterior atrás
                modoResuelto = 'AVISO_CORTO_CUENTA';
                paqueteElegido = paqueteAvisoCortoCuenta;
            } else if (ag1.situacionDialogo === 'SILENCIO_TRAS_RESUMEN_CUENTA') {
                // Le mandamos el resumen/saldo ayer y se quedó en silencio -> Primero tanteo corto esperando respuesta
                modoResuelto = 'TANTEO_CORTO';
                paqueteElegido = paqueteTanteoCorto;
            } else if (ag1.situacionDialogo === 'NOSOTROS_YA_TANTEAMOS_HOY') {
                // Ya le tiramos "Laura! Cómo va?" / "Buen día Fer, cómo andás?" -> Dejar listo el 2° paso del ping-pong
                modoResuelto = 'PING_PONG_TEMA';
                paqueteElegido = paquetePingPongTema;
            } else if (ag1.situacionDialogo === 'CLIENTE_RESPONDE_TANTEO_O_SALUDO') {
                // El cliente nos contestó "Hola, cómo estás?" -> Responder con ping-pong humano e ir al tema
                modoResuelto = 'PING_PONG_TEMA';
                paqueteElegido = paquetePingPongTema;
            } else if (ag1.situacionDialogo === 'CONTINUAR_NUESTRO_MENSAJE_HOY' || ag1.situacionDialogo === 'NOSOTROS_YA_SALUDAMOS_HOY') {
                modoResuelto = 'RESPONDER_CONTEXTO';
                paqueteElegido = paqueteResponderContexto;
            } else if (ag1.situacionDialogo === 'CLIENTE_POSTERGO_Y_LLEGO_MOMENTO' || ag1.situacionDialogo === 'CLIENTE_POSTERGA_O_ESTA_BIEN') {
                modoResuelto = 'RESPONDER_CONTEXTO';
                paqueteElegido = paqueteResponderContexto;
            } else if (
                ag1.situacionDialogo === 'SEGUIMIENTO_CHARLA_PAGOS_PARCIALES' ||
                ag1.situacionDialogo === 'SEGUIMIENTO_ARMANDO_PEDIDO_O_STOCK' ||
                ag1.situacionDialogo === 'SEGUIMIENTO_LISTA_ENVIADA_RECIENTE' ||
                ag1.situacionDialogo === 'SEGUIMIENTO_RECLAMO_O_FACTURA' ||
                ag1.situacionDialogo === 'SEGUIMIENTO_AUDIO_RECIENTE'
            ) {
                modoResuelto = 'RESPONDER_CONTEXTO';
                paqueteElegido = paqueteResponderContexto;
            } else if (ag1.situacionDialogo === 'CLIENTE_AGRADECE_O_CONFIRMA') {
                modoResuelto = 'SOLO_ATENTOS';
                paqueteElegido = paqueteResponderContexto;
            } else if (ag1.situacionDialogo === 'CLIENTE_SALUDA_O_COMENTA') {
                modoResuelto = 'RESPONDER_CONTEXTO';
                paqueteElegido = paqueteResponderContexto;
            } else {
                // Inicio de conversación desde cero: si tiene saldo pendiente o resumen reciente, abrir con tanteo corto
                if (ag3.tieneSaldo || ag1.enviamosResumenCuentaReciente) {
                    modoResuelto = 'TANTEO_CORTO';
                    paqueteElegido = paqueteTanteoCorto;
                } else {
                    modoResuelto = 'SALUDO_SEMANAL';
                    paqueteElegido = paqueteSaludoSemanal;
                }
            }
        }

        // Construir explicación ejecutiva del Agente para que el operador vea por qué sugiere este mensaje sin llenar la pantalla de botones
        let diagnosticoEjecutivoAgente = '';
        if (ag3.patronCuentaAbierta === 'DOS_PENDIENTES_ULTIMA_Y_ANTERIOR_ATRAS') {
            const detalleHist = ag3.cantFacturasHistoricasPagadas > 0
                ? `${ag3.cantFacturasHistoricasPagadas} facturas históricas pagadas en ~${Math.max(1, Math.round(ag3.promedioDiasCancelacion || 2))} días, nunca deja una atrás`
                : `cancela siempre factura por factura dejando saldo $0, nunca deja una atrás`;
            const txtConducta = ag3.esPagadorCumplidorContraEntrega
                ? `paga siempre contra entrega (${detalleHist})`
                : `registra ${ag3.cantComprobantesAbiertos} comprobantes abiertos`;
            const txtYaSaludamos = yaSaludamosHoy
                ? `Como ya abriste charla hoy (${infoContacto.ultimoSaludoNuestro ? `"${infoContacto.ultimoSaludoNuestro}"` : 'saludo enviado'}), te dejo listo el recordatorio corto sin repetir el saludo`
                : `Te dejo listo un recordatorio cortito en 1 sola burbuja`;
            diagnosticoEjecutivoAgente = `${apodo || 'Este cliente'} ${txtConducta}. Hoy tiene 2 facturas pendientes: la última entrega (${ag3.cuandoUltimaEntregaTxt}${ag3.fechaUltimaEntregaCorta ? `, ${ag3.fechaUltimaEntregaCorta}` : ''}) y 1 factura anterior${ag3.fechaMasAntiguaCorta ? ` del ${ag3.fechaMasAntiguaCorta}` : ''} que quedó atrás. ${txtYaSaludamos}, explicándole por qué le avisás (nunca deja una pendiente) y que ahora le adjuntás el resumen.`;
        } else if (ag3.patronCuentaAbierta === 'UNA_FACTURA_ATRASADA_PAGADOR_CUMPLIDOR') {
            const detalleHistUna = ag3.cantFacturasHistoricasPagadas > 0
                ? `${ag3.cantFacturasHistoricasPagadas} facturas en ~${Math.max(1, Math.round(ag3.promedioDiasCancelacion || 2))}d`
                : `cancela siempre factura por factura a $0`;
            diagnosticoEjecutivoAgente = `${apodo || 'Este cliente'} siempre paga al día (${detalleHistUna}), pero quedó 1 factura pendiente de hace ${ag3.diasMasAntigua} días. Te propongo un recordatorio corto en 1 sola burbuja avisándole que ahora le adjuntás el resumen.`;
        } else if (ag1.situacionDialogo === 'SILENCIO_TRAS_RESUMEN_CUENTA') {
            diagnosticoEjecutivoAgente = `Le enviaste el resumen de cuenta ${cuandoRes} y aún no contestó. En WhatsApp conviene mandar primero un tanteo corto ("${paqueteTanteoCorto.burbuja1}") y esperar que responda antes de ir al tema.`;
        } else if (ag1.situacionDialogo === 'NOSOTROS_YA_TANTEAMOS_HOY') {
            diagnosticoEjecutivoAgente = `Ya enviaste el saludo inicial hoy. Te dejo listo el 2° paso natural de la charla sin volver a saludar.`;
        } else {
            diagnosticoEjecutivoAgente = ag1.explicacionSituacion || paqueteElegido.pasoEnEspera || '';
        }

        // Regla de oro de integralidad: si hay Burbuja 2 o Burbuja 3, la Burbuja 1 NUNCA lleva cierre al final
        let b1Final = limpiarSignosAperturaWa(paqueteElegido.burbuja1);
        const b2Final = limpiarSignosAperturaWa(paqueteElegido.burbuja2);
        let b3Final = limpiarSignosAperturaWa(paqueteElegido.burbuja3);

        if (b2Final || b3Final) {
            b1Final = limpiarCierreAlFinalDeBurbuja(b1Final);
            if (b3Final && modoResuelto !== 'SALDO_CORTO' && modoResuelto !== 'SALDO_Y_POLITICAS') {
                // Asegurar que la Burbuja 3 jamás repita una frase que ya esté en la Burbuja 1
                const norm1 = normalizar(b1Final);
                const norm3 = normalizar(b3Final);
                if ((norm1.includes('atento') && norm3.includes('atento')) ||
                    (norm1.includes('escribime') && norm3.includes('escribime')) ||
                    (norm1.includes('avisame') && norm3.includes('avisame'))) {
                    b3Final = elegirCierreCoherente(b1Final, 3);
                }
            }
        }

        return {
            modoResuelto,
            mensajePrincipal: b1Final,
            burbuja1: b1Final,
            burbuja2: b2Final,
            burbuja3: b3Final,
            paqueteTanteoCorto,
            paquetePingPongTema,
            paqueteAvisoCortoCuenta,
            diagnosticoEjecutivoAgente,
            cuerpoSaludoSinCierre: limpiarCierreAlFinalDeBurbuja(cuerpoSaludoElegido),
            cierreSugerido3raBurbuja: elegirCierreCoherente(b1Final, 1),
            infoDuraLinkPortal,
            linkElegido,
            textosSaldo,
            pasoEnEspera: paqueteElegido.pasoEnEspera
        };
    }

    /**
     * Ejecuta el análisis integral híbrido (Identidad + Diálogo + Compras/Precios + Pagos/Cuenta + Propuesta Corta)
     */
    window.ejecutarMesaAgentesComercialesWa = function (st) {
        if (!st) return null;
        const rayosX = st.rayosX || null;
        const sint = st.sintesisMemoria || null;
        const infoContacto = analizarIdentidadYSaludoContacto(st);

        if (sint && sint.contacto_hilo) {
            if (!infoContacto.ultimoSaludoNuestro && sint.contacto_hilo.ultimo_saludo_nuestro) {
                infoContacto.ultimoSaludoNuestro = limpiarSignosAperturaWa(sint.contacto_hilo.ultimo_saludo_nuestro);
            }
            if (!infoContacto.nombrePila && sint.contacto_hilo.nombre_pila_detectado) {
                infoContacto.nombrePila = sint.contacto_hilo.nombre_pila_detectado;
                infoContacto.apodoCorto = MAPA_APODOS_CONFIANZA[normalizar(infoContacto.nombrePila)] || infoContacto.nombrePila;
                infoContacto.esPersonaIdentificada = true;
            }
            if (sint.contacto_hilo.cierre_habitual) {
                infoContacto.cierreHabitualNuestro = sint.contacto_hilo.cierre_habitual;
            }
        }

        const ag1 = ejecutarAgente1Dialogo(st.mensajesCompleta || st.mensajesRecientes || [], infoContacto);
        const razIa = (st.razonamientoIa && st.razonamientoIa.usando_ia_real) ? st.razonamientoIa : null;
        if (razIa) {
            if (razIa.situacion_dialogo) ag1.situacionDialogo = razIa.situacion_dialogo;
            if (razIa.titulo_intencion) ag1.tituloIntencion = `🧠 ${razIa.titulo_intencion}`;
            if (razIa.explicacion_razonamiento) ag1.explicacionSituacion = razIa.explicacion_razonamiento;
        }

        if (st._charlaEnCursoForzadaUsuario === undefined) {
            st.charlaEnCurso = ag1.charlaEnCurso;
        }

        const ag2 = ejecutarAgente2Productos({
            articulosHabituales: st.articulosHabituales || [],
            articulosMencionadosChat: st.articulosMencionadosChat || [],
            tokensNegadosCliente: st.tokensNegadosCliente || [],
            articulosSimilares: st.articulosSimilares || [],
            cambiosPreciosPendientes: st.cambiosPreciosPendientes || [],
            cambiosPreciosTodos: st.cambiosPreciosTodos || [],
            ultimasFacturas: rayosX?.ultimas_facturas || [],
            pedidosRecientes: rayosX?.pedidos_recientes || [],
            listaId: st.listaId || 1
        });

        if (sint && sint.ciclo_compra) {
            if (sint.ciclo_compra.dias_desde_ultima_compra !== null && sint.ciclo_compra.dias_desde_ultima_compra !== undefined) {
                ag2.diasDesdeUltimaCompra = sint.ciclo_compra.dias_desde_ultima_compra;
                ag2.fechaUltimaCompraTxt = sint.ciclo_compra.fecha_ultima_compra_txt || ag2.fechaUltimaCompraTxt;
            }
            if (sint.ciclo_compra.frecuencia_media_dias) {
                ag2.frecuenciaMediaDias = sint.ciclo_compra.frecuencia_media_dias;
            }
            ag2.enFechaReposicion = Boolean(
                ag2.frecuenciaMediaDias &&
                ag2.diasDesdeUltimaCompra !== null &&
                ag2.diasDesdeUltimaCompra >= Math.max(7, ag2.frecuenciaMediaDias - 5)
            );
            if (ag2.diasDesdeUltimaCompra !== null && ag2.frecuenciaMediaDias) {
                ag2.badgeCiclo = `Cada ~${ag2.frecuenciaMediaDias}d · Última hace ${ag2.diasDesdeUltimaCompra}d`;
            } else if (ag2.diasDesdeUltimaCompra !== null) {
                ag2.badgeCiclo = `Última compra hace ${ag2.diasDesdeUltimaCompra}d (${ag2.fechaUltimaCompraTxt})`;
            }
        }

        const ag3 = ejecutarAgente3CuentaYPagos({
            rayosX,
            sintesisMemoria: sint,
            yaIngresoPortal: st.yaIngresoPortal,
            fechaUltimoIngresoTxt: st.fechaUltimoIngresoTxt,
            codigoActivacion: st.codigoActivacion,
            linkActivacionCorto: st.linkActivacionCorto,
            listaId: st.listaId || 1
        });

        if (sint && sint.comportamiento_pago) {
            if (sint.comportamiento_pago.medio_pago_habitual && sint.comportamiento_pago.medio_pago_habitual !== 'Sin pagos registrados aún') {
                ag3.medioPagoHabitual = sint.comportamiento_pago.medio_pago_habitual;
                ag3.detalleComportamientoPago = sint.comportamiento_pago.detalle_comportamiento_pago || ag3.detalleComportamientoPago;
            }
        }

        const proactivo = construirMensajesProactivosWa(st, infoContacto, ag1, ag2, ag3);

        // Si el Comité Cognitivo IA (Gemini) está activo y el operador está en modo AUTO,
        // combinamos el diálogo razonado (B1 y B3) con la Burbuja 2 100% determinista (Precios de BD o Link oficial)
        if (razIa && (!st.modoAccionProactiva || st.modoAccionProactiva === 'AUTO')) {
            if (razIa.burbuja1_dialogo) {
                proactivo.burbuja1 = limpiarSignosAperturaWa(razIa.burbuja1_dialogo);
                proactivo.mensajePrincipal = proactivo.burbuja1;
            }
            if (razIa.tipo_burbuja2_determinista === 'PRECIOS_SELECCIONADOS') {
                const selActual = (st.catalogoArticulos || []).filter(a => st.idsSeleccionados && st.idsSeleccionados.has(String(a.id)));
                const listaParaB2 = selActual.length > 0 ? selActual : (ag2.mencionados || []);
                proactivo.burbuja2 = formatearResumenWhatsAppJerarquiaB2B(listaParaB2.slice(0, 8), st.listaId || 1);
                proactivo.modoResuelto = 'COTIZAR';
            } else if (razIa.tipo_burbuja2_determinista === 'LINK_PORTAL') {
                proactivo.burbuja2 = proactivo.infoDuraLinkPortal || '';
                proactivo.modoResuelto = 'PASAR_PORTAL';
            } else if (razIa.tipo_burbuja2_determinista === 'VACIA') {
                // Si es apertura de semana (!charlaEnCurso) y el cliente aún no ingresó al Portal B2B, dejar listo el Link del Portal en Burbuja 2
                if (!ag1.charlaEnCurso && !st.yaIngresoPortal && !ag1.yaEnviamosLinkHoy && proactivo.infoDuraLinkPortal) {
                    proactivo.burbuja2 = proactivo.infoDuraLinkPortal;
                } else {
                    proactivo.burbuja2 = '';
                }
            }
            if (razIa.burbuja3_cierre !== undefined) {
                const cierreIaLimpio = limpiarSignosAperturaWa(razIa.burbuja3_cierre || '');
                if (cierreIaLimpio) {
                    proactivo.cierreSugerido3raBurbuja = cierreIaLimpio;
                }
                proactivo.burbuja3 = proactivo.burbuja2 ? (cierreIaLimpio || proactivo.cierreSugerido3raBurbuja || 'Cualquier cosa estamos atentos.') : '';
            }
            if (razIa.explicacion_razonamiento) {
                proactivo.diagnosticoEjecutivoAgente = razIa.explicacion_razonamiento;
            }
        }

        return {
            infoContacto,
            ag1,
            ag2,
            ag3,
            proactivo,
            ag4: {
                estrategias: [
                    {
                        id: proactivo.modoResuelto,
                        burbuja1: proactivo.burbuja1,
                        burbuja2: proactivo.burbuja2,
                        burbuja3: proactivo.burbuja3,
                        pasoEnEspera: proactivo.pasoEnEspera
                    }
                ]
            }
        };
    };

    /**
     * Renderiza la Estructura Híbrida del Cliente (3 Tarjetas Limpias + Diagnóstico del Agente + Barra Mínima de Píldoras)
     */
    window.renderizarPanelMesaAgentesHtmlWa = function (st, resultadoMesa) {
        if (!st || !resultadoMesa) return '';
        const { infoContacto, ag1, ag2, ag3, proactivo } = resultadoMesa;
        const modoActivo = proactivo.modoResuelto || 'TANTEO_CORTO';
        const esModoAuto = !st.modoAccionProactiva || st.modoAccionProactiva === 'AUTO';
        const sint = st.sintesisMemoria || null;
        const apodoUi = infoContacto.apodoCorto || infoContacto.nombrePila || 'el cliente';

        const mostrarCards = Boolean(st.mostrarRadiografia3Tarjetas);
        const nombreListaFiscalizada = st.listaNombre || `Lista #${st.listaId || 1}`;
        if (typeof window.obtenerEstadoMedidorCreditoIaWa === 'function') {
            window.obtenerEstadoMedidorCreditoIaWa(st);
        }
        let barraMemoriaHtml = '';
        if (st.errorCriticoIa || st.errorCriticoSintesis) {
            const detalleErr = [st.errorCriticoIa, st.errorCriticoSintesis].filter(Boolean).join(' · ');
            barraMemoriaHtml += `
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; background: #fef2f2; border: 2px solid #ef4444; border-left: 6px solid #dc2626; border-radius: 8px; padding: 8px 12px; margin-bottom: 8px; font-size: 0.75rem; color: #991b1b; box-shadow: 0 2px 6px rgba(220,38,38,0.12);">
                    <div style="flex: 1; min-width: 240px; line-height: 1.35;">
                        🚨 <strong>ALERTA CRÍTICA DE SERVICIO (IA GEMINI SIN CONEXIÓN):</strong> ${escapar(detalleErr)}<br>
                        <span style="font-size: 0.7rem; color: #7f1d1d;">⚠️ <strong>Atención Operador:</strong> El motor de IA no respondió. La sugerencia inferior fue armada únicamente con reglas fijas de emergencia (sin razonamiento semántico). Revisá antes de enviar o reintentá la conexión.</span>
                    </div>
                    <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                        <button type="button" onclick="window.toggleRadiografia3TarjetasWa()" style="background: #ffffff; border: 1px solid #fca5a5; color: #991b1b; padding: 5px 9px; border-radius: 6px; font-size: 0.7rem; font-weight: 800; cursor: pointer;">
                            📊 ${mostrarCards ? 'Ocultar Radiografía' : 'Ver Radiografía (3 tarjetas)'}
                        </button>
                        <button type="button" onclick="window.forzarRelecturaProfundaClienteWa()" style="background: #dc2626; border: 1px solid #b91c1c; color: #ffffff; padding: 5px 10px; border-radius: 6px; font-size: 0.71rem; font-weight: 800; cursor: pointer; white-space: nowrap;">
                            🔄 Reintentar Conexión IA
                        </button>
                    </div>
                </div>
            `;
        } else {
            const iaActiva = Boolean(st.razonamientoIa && st.razonamientoIa.usando_ia_real);
            const txtCompra = ag2.diasDesdeUltimaCompra !== null ? `🛒 Últ. compra: ${ag2.diasDesdeUltimaCompra}d` : '🛒 Cliente activo';
            barraMemoriaHtml += `
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; background: ${iaActiva ? '#ecfdf5' : '#f8fafc'}; border: 1px solid ${iaActiva ? '#6ee7b7' : '#cbd5e1'}; border-left: 4px solid ${iaActiva ? '#059669' : '#0284c7'}; border-radius: 8px; padding: 5px 10px; margin-bottom: 8px; font-size: 0.71rem; color: #0f172a;">
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <span style="font-weight: 800; color: ${iaActiva ? '#065f46' : '#334155'};">
                            ${iaActiva ? '🟢 IA Gemini Activa' : '⏳ Analizando con IA...'}
                        </span>
                        <span style="background: #dcfce7; color: #166534; border: 1px solid #86efac; padding: 1px 7px; border-radius: 999px; font-weight: 800; font-size: 0.68rem;" title="Agente Fiscalizador Determinista: verifica que el 100% de los precios del mensaje y del PDF pertenezcan estrictamente a la lista asignada de este cliente">
                            🔒 Fiscalizador Precios: Lista #${escapar(st.listaId || 1)} (${escapar(nombreListaFiscalizada)}) ✓
                        </span>
                        <span style="color: #475569; font-weight: 700;">${escapar(txtCompra)}</span>
                        <span style="color: ${ag3.tieneSaldo ? '#b45309' : '#047857'}; font-weight: 800;">💳 ${escapar(ag3.badgeCuenta)}</span>
                    </div>
                    <div style="display: flex; gap: 5px; align-items: center; flex-wrap: wrap;">
                        <button type="button" onclick="window.toggleRadiografia3TarjetasWa()" style="background: #ffffff; border: 1px solid #cbd5e1; color: #1e293b; padding: 2px 8px; border-radius: 6px; font-size: 0.68rem; font-weight: 800; cursor: pointer; white-space: nowrap;">
                            📊 ${mostrarCards ? 'Ocultar Radiografía' : 'Ver Radiografía (3 tarjetas)'}
                        </button>
                        <button type="button" onclick="window.forzarRelecturaProfundaClienteWa()" style="background: #ffffff; border: 1px solid #6ee7b7; color: #065f46; padding: 2px 8px; border-radius: 6px; font-size: 0.68rem; font-weight: 800; cursor: pointer; white-space: nowrap;">
                            🔄 Re-analizar
                        </button>
                    </div>
                </div>
            `;
        }

        const chipsHabitualesHtml = ag2.topHabituales.length > 0
            ? ag2.topHabituales.slice(0, 8).map(art => {
                const sel = st.idsSeleccionados && st.idsSeleccionados.has(String(art.id));
                const pKg = art.precio_nuevo_kilo ? `$${Math.round(art.precio_nuevo_kilo).toLocaleString('es-AR')}/kg` : (art.precio_actual_lista ? `$${art.precio_actual_lista.toLocaleString('es-AR')}` : '');
                const badgeCambio = art.cambio_precio
                    ? ` · ${art.variacion_pct > 0 ? `📈 +${art.variacion_pct}%` : `📉 ${art.variacion_pct}%`}`
                    : '';
                const badgePend = art.pendiente_notificar ? '🔔 ' : '';
                const rutaJer = art.ruta_jerarquia_b2b ? `[${art.ruta_jerarquia_b2b}] ` : '';
                return `
                    <button type="button" onclick="window.toggleArticuloAsistenteComercialWa('${escapar(String(art.id))}')" title="${escapar(rutaJer)}${art.cambio_precio ? `Antes pagó $${art.ultimo_precio_pagado.toLocaleString('es-AR')} -> Hoy $${art.precio_actual_lista.toLocaleString('es-AR')}` : 'Clic para incluir su precio en burbuja separada'}" style="padding: 2px 7px; border-radius: 999px; font-size: 0.68rem; font-weight: 700; cursor: pointer; border: 1px solid ${sel ? '#059669' : (art.pendiente_notificar ? '#d97706' : (art.cambio_precio ? '#f59e0b' : '#cbd5e1'))}; background: ${sel ? '#dcfce7' : (art.pendiente_notificar ? '#fef3c7' : (art.cambio_precio ? '#fffbeb' : '#ffffff'))}; color: ${sel ? '#065f46' : '#1e293b'};">
                        ${sel ? '✅ ' : '➕ '}${badgePend}${escapar(art.nombre)}${pKg ? ` (${escapar(pKg)}${escapar(badgeCambio)})` : ''}
                    </button>
                `;
            }).join('')
            : `<span style="font-size:0.71rem; color:#64748b;">Sin artículos frecuentes detectados aún.</span>`;

        const hayPendientesGestionPrecios = ag2.cantPendientesNotificar > 0;
        const cuandoHablamosLabel = ag1.cuandoCharlamosTxt || 'ayer';
        const cuandoResumenLabel = ag1.cuandoEnviamosResumenTxt || cuandoHablamosLabel;

        // Tarjeta 3 limpia (sin repetir botonera): muestra conducta histórica de pago + detalle de facturas abiertas
        const bloqueEstadoCuentaCard3Html = ag3.tieneSaldo
            ? `
                <div style="margin-top: 5px; padding: 6px 8px; background: ${ag3.colorCondicionBg || '#fef3c7'}; border: 1px solid ${ag3.colorCondicionBorder || '#fcd34d'}; border-radius: 7px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 4px; flex-wrap: wrap;">
                        <span style="font-size: 0.7rem; font-weight: 800; color: ${ag3.colorCondicionText || '#92400e'};">
                            ${escapar(ag3.etiquetaCondicionSaldo)}
                        </span>
                        ${st.chatId ? `
                            <button type="button" onclick="window.abrirAsistentePoliticasFinanciacionWa({ chatId: ${Number(st.chatId || 0)}, escenario: 'PAGOS_PARCIALES' })" style="background: #ffffff; color: #334155; border: 1px solid #cbd5e1; padding: 1px 6px; border-radius: 5px; font-size: 0.64rem; font-weight: 800; cursor: pointer;" title="Ver detalle de Cuenta Corriente / Extracto PDF">
                                📄 Ver CC ↗
                            </button>
                        ` : ''}
                    </div>
                    ${ag3.resumenComprobantesCorto ? `<div style="font-size: 0.68rem; color: #1e293b; font-weight: 800; margin-top: 2px;">🧾 ${escapar(ag3.resumenComprobantesCorto)}</div>` : ''}
                    <div style="font-size: 0.66rem; color: #334155; margin-top: 2px; line-height: 1.25;">
                        💡 ${escapar(ag3.explicacionCondicionSaldo)}
                    </div>
                </div>
            `
            : `
                <div style="margin-top: 5px; padding: 5px 8px; background: #ecfdf5; border: 1px solid #86efac; border-radius: 7px; font-size: 0.68rem; color: #065f46; font-weight: 700;">
                    🟢 <strong>Cuenta en $0:</strong> Tiene activo el 5% (> $300.000) y ofertas en su Lista #${escapar(st.listaId)}.
                </div>
            `;

        const textoApodoBadge = infoContacto.esPersonaIdentificada
            ? (infoContacto.apodoCorto && infoContacto.apodoCorto !== infoContacto.nombrePila
                ? `(Lo llamás: "${escapar(infoContacto.apodoCorto)}" / "${escapar(infoContacto.nombrePila)}")`
                : `(Lo llamás: "${escapar(infoContacto.nombrePila)}")`)
            : '';

        // Barra compacta de píldoras inteligentes (reemplaza los 18 botones anteriores)
        const pildorasRapidas = [
            {
                id: 'AUTO',
                activo: esModoAuto,
                label: '🧠 Sugerencia del Agente',
                title: 'El agente elige el mensaje más apropiado combinando historial de pagos, facturas abiertas y charla de WhatsApp',
                onclick: `window.elegirAccionProactivaAsistenteWa('AUTO')`
            },
            {
                id: 'TANTEO_CORTO',
                activo: !esModoAuto && modoActivo === 'TANTEO_CORTO',
                label: `👋 Saludo 1 línea ("Hola ${apodoUi}...")`,
                title: 'Un único saludo corto de 3 a 5 palabras para abrir charla y esperar que conteste',
                onclick: `window.elegirAccionProactivaAsistenteWa('TANTEO_CORTO')`
            }
        ];

        if (ag3.tieneSaldo) {
            pildorasRapidas.push({
                id: 'AVISO_CORTO_CUENTA',
                activo: !esModoAuto && modoActivo === 'AVISO_CORTO_CUENTA',
                label: ag3.patronCuentaAbierta === 'DOS_PENDIENTES_ULTIMA_Y_ANTERIOR_ATRAS'
                    ? '💬 Recordatorio corto: 2 facturas pendientes'
                    : `💬 Recordatorio corto de cuenta (${ag3.saldoFmt})`,
                title: 'Recordatorio corto y directo en 1 sola burbuja avisando de las facturas pendientes y que ahora se adjunta el resumen',
                onclick: `window.elegirAccionProactivaAsistenteWa('AVISO_CORTO_CUENTA')`
            });
            pildorasRapidas.push({
                id: 'SALDO_Y_POLITICAS',
                activo: !esModoAuto && modoActivo === 'SALDO_Y_POLITICAS',
                label: '📋 Saldo y Políticas (7d / 14d / 5%)',
                title: 'Explica los plazos de cuenta corriente y beneficios de su Lista de Precios en burbuja separada',
                onclick: `window.elegirAccionProactivaAsistenteWa('SALDO_Y_POLITICAS')`
            });
        }

        if (ag1.enviamosResumenCuentaReciente || ag1.situacionDialogo === 'NOSOTROS_YA_TANTEAMOS_HOY') {
            pildorasRapidas.push({
                id: 'PING_PONG_TEMA',
                activo: !esModoAuto && modoActivo === 'PING_PONG_TEMA',
                label: '💬 2° Paso Ping-Pong',
                title: 'Continuar la charla después del saludo inicial',
                onclick: `window.elegirAccionProactivaAsistenteWa('PING_PONG_TEMA')`
            });
        }

        pildorasRapidas.push({
            id: 'PORTAL',
            activo: !esModoAuto && modoActivo === 'PORTAL',
            label: '🔗 + Link Portal',
            title: 'Incluir el link del Portal B2B en una 2da burbuja separada',
            onclick: `window.sumarLinkPortalAlMensajeAsistenteWa()`
        });

        if (hayPendientesGestionPrecios) {
            pildorasRapidas.push({
                id: 'ACTUALIZACIONES_PENDIENTES',
                activo: !esModoAuto && modoActivo === 'ACTUALIZACIONES_PENDIENTES',
                label: `🔔 Cambios de Precio (${ag2.cantPendientesNotificar})`,
                title: 'Incluir las actualizaciones de precios pendientes ordenadas por Jerarquía B2B en el Mensaje 2',
                onclick: `window.elegirAccionProactivaAsistenteWa('ACTUALIZACIONES_PENDIENTES')`
            });
        }

        return `
            ${barraMemoriaHtml}
            <!-- ESTRUCTURA HÍBRIDA DEL CLIENTE EN 3 TARJETAS CLARAS (PLEGABLE PARA NO RECARGAR LA PANTALLA) -->
            <div id="wa-asist-com-radiografia-3cards" style="display: ${mostrarCards ? 'grid' : 'none'}; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; margin-bottom: 8px;">
                <!-- 1. QUÉ DIJO EL CLIENTE, HACE CUÁNTO Y CÓMO SALUDARLO -->
                <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-left: 4px solid #0284c7; border-radius: 9px; padding: 8px 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 4px; margin-bottom: 4px;">
                        <span style="font-weight: 800; font-size: 0.75rem; color: #0f172a;">💬 1. Estado del Hilo y Tiempo</span>
                        <span style="font-size: 0.67rem; font-weight: 800; padding: 1px 6px; border-radius: 999px; background: ${ag1.clienteHabloUltimo ? '#fef3c7' : (ag1.charlaEnCurso ? '#dcfce7' : '#e0f2fe')}; color: ${ag1.clienteHabloUltimo ? '#92400e' : (ag1.charlaEnCurso ? '#166534' : '#0369a1')};">
                            ${escapar(ag1.tituloIntencion)}
                        </span>
                    </div>
                    <div style="font-size: 0.72rem; color: #334155; line-height: 1.35;">
                        <div><strong>Contacto:</strong> ${escapar(infoContacto.etiquetaContacto)} ${textoApodoBadge ? `<span style="color:#059669; font-weight:700;">${textoApodoBadge}</span>` : ''} · <span style="color:#b45309; font-weight:800;">⏱️ Últ. msg: ${escapar(ag1.etiquetaHaceCuanto || 'sin registro')}</span></div>
                        ${(ag1.enviamosResumenCuentaReciente || ag1.enviamosFacturaOPresupuestoReciente) ? `<div style="margin-top: 2px; color: #6d28d9; font-weight: 800;">📄 <strong>Últ. comprobante/resumen en chat:</strong> ${escapar(cuandoResumenLabel)}${ag1.montoResumenEnviadoTxt ? ` (${escapar(ag1.montoResumenEnviadoTxt)})` : ''}</div>` : ''}
                        ${ag1.fraseSustanciosaCliente ? `<div style="margin-top: 2px; color: #7c2d12; font-weight: 700;"><strong>Planteo del cliente (${escapar(cuandoHablamosLabel)}):</strong> <em>"${escapar(ag1.fraseSustanciosaCliente.slice(0, 95))}"</em>${ag1.huboAudioNuestroEnEpisodio ? ' · 🎤 (con audio nuestro)' : (ag1.huboAudioClienteEnEpisodio ? ' · 🎤 (con audio del cliente)' : '')}</div>` : ''}
                        ${infoContacto.ultimoSaludoNuestro ? `<div style="margin-top: 2px; color: #0369a1;"><strong>Último saludo enviado:</strong> <em>"${escapar(infoContacto.ultimoSaludoNuestro)}"</em></div>` : ''}
                    </div>
                </div>

                <!-- 2. QUÉ COMPRA, CADA CUÁNTO Y SI CAMBIÓ ALGÚN PRECIO -->
                <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-left: 4px solid #10b981; border-radius: 9px; padding: 8px 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 4px; margin-bottom: 4px;">
                        <span style="font-weight: 800; font-size: 0.75rem; color: #065f46;">🛒 2. Qué Compra y Cambios de Precio</span>
                        <span style="font-size: 0.67rem; font-weight: 800; padding: 1px 6px; border-radius: 999px; background: ${ag2.enFechaReposicion ? '#fef3c7' : '#dcfce7'}; color: ${ag2.enFechaReposicion ? '#92400e' : '#166534'};">
                            ${escapar(ag2.enFechaReposicion ? `🔥 En fecha de reposición (${ag2.diasDesdeUltimaCompra}d)` : ag2.badgeCiclo)}
                        </span>
                    </div>
                    <div style="font-size: 0.71rem; color: #14532d; margin-bottom: 4px;">
                        ${ag2.diasDesdeUltimaCompra !== null
                            ? `Última compra hace <strong>${ag2.diasDesdeUltimaCompra}d</strong> (${escapar(ag2.fechaUltimaCompraTxt)})${ag2.frecuenciaMediaDias ? ` · Ciclo: <strong>cada ~${ag2.frecuenciaMediaDias}d</strong>` : ''}`
                            : `Artículos habituales del cliente (tocá uno para cotizar):`}
                        ${ag2.resumenCambioPrecios ? `<div style="font-weight: 800; color: ${(ag2.cantPendientesNotificar > 0 || ag2.habitualesConCambioPrecio.length > 0) ? '#b45309' : '#15803d'}; margin-top: 1px;">${escapar(ag2.resumenCambioPrecios)}</div>` : ''}
                    </div>
                    <div style="display: flex; flex-wrap: wrap; gap: 4px; max-height: 54px; overflow-y: auto;">
                        ${chipsHabitualesHtml}
                    </div>
                </div>

                <!-- 3. CÓMO NOS PAGA, CONDUCTA HISTÓRICA Y FACTURAS ABIERTAS -->
                <div style="background: #faf5ff; border: 1px solid #e9d5ff; border-left: 4px solid #8b5cf6; border-radius: 9px; padding: 8px 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 4px; margin-bottom: 4px;">
                        <span style="font-weight: 800; font-size: 0.75rem; color: #4c1d95;">💳 3. Conducta de Pago y Cuenta</span>
                        <span style="font-size: 0.67rem; font-weight: 800; padding: 1px 6px; border-radius: 999px; background: ${ag3.tieneSaldo ? '#fef3c7' : '#ede9fe'}; color: ${ag3.tieneSaldo ? '#92400e' : '#5b21b6'}; border: 1px solid ${ag3.tieneSaldo ? '#fcd34d' : 'transparent'};">
                            ${escapar(ag3.badgeCuenta)}
                        </span>
                    </div>
                    <div style="font-size: 0.72rem; color: #3b0764; line-height: 1.35;">
                        <div style="display: flex; justify-content: space-between; gap: 6px; flex-wrap: wrap;">
                            <span><strong>Cómo paga:</strong> ${escapar(ag3.medioPagoHabitual)}</span>
                            ${ag3.detalleComportamientoPago ? `<span style="color:#6b21a8; font-size:0.68rem;">${escapar(ag3.detalleComportamientoPago)}</span>` : ''}
                        </div>
                        ${ag3.resumenConductaHistorica ? `<div style="margin-top: 2px; font-weight: 800; color: ${ag3.esPagadorCumplidorContraEntrega ? '#047857' : '#5b21b6'}; font-size: 0.69rem;">${escapar(ag3.resumenConductaHistorica)}</div>` : ''}
                        <div style="margin-top: 2px; font-weight: 700; color: ${st.yaIngresoPortal ? '#166534' : '#92400e'}; font-size: 0.69rem;">
                            ${escapar(ag3.badgePortal)}
                        </div>
                        ${bloqueEstadoCuentaCard3Html}
                    </div>
                </div>
            </div>

            <!-- DIAGNÓSTICO INTELIGENTE DEL AGENTE + BARRA COMPACTA DE PÍLDORAS (SIN EXCESO DE BOTONES) -->
            <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-left: 4px solid #0284c7; border-radius: 10px; padding: 8px 11px; margin-bottom: 10px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; flex-wrap: wrap;">
                    <div style="flex: 1; min-width: 260px; font-size: 0.75rem; color: #0f172a; line-height: 1.35;">
                        <strong style="color: #0369a1;">🧠 Lectura del Agente:</strong> ${escapar(proactivo.diagnosticoEjecutivoAgente)}
                    </div>
                    <div style="display: flex; gap: 5px; align-items: center; flex-shrink: 0;">
                        <button type="button" onclick="window.rotarVarianteSaludoAsistenteWa()" style="background: #ffffff; color: #1d4ed8; border: 1px solid #93c5fd; padding: 3px 9px; border-radius: 6px; font-size: 0.71rem; font-weight: 800; cursor: pointer;" title="Rota otra variante de redacción manteniendo este mismo criterio">
                            🎲 Otra variante
                        </button>
                        <button type="button" onclick="window.abrirModalListaPreciosBunkerDesdeCrmWa('${hayPendientesGestionPrecios ? 'ACTUALIZACIONES' : 'HABITUALES'}')" style="background: #ffffff; color: #6d28d9; border: 1px solid #c4b5fd; padding: 3px 9px; border-radius: 6px; font-size: 0.71rem; font-weight: 800; cursor: pointer;" title="Abre el diseñador de Lista de Precios / Actualizaciones en PDF">
                            📄 PDF Precios ↗
                        </button>
                    </div>
                </div>

                <div style="display: flex; gap: 5px; flex-wrap: wrap; align-items: center; margin-top: 7px; padding-top: 6px; border-top: 1px dashed #bae6fd;">
                    <span style="font-size: 0.69rem; font-weight: 800; color: #475569; margin-right: 2px;">Enfoque rápido:</span>
                    ${pildorasRapidas.map(p => `
                        <button type="button" onclick="${p.onclick}" title="${escapar(p.title)}" style="padding: 3px 9px; border-radius: 999px; font-size: 0.71rem; font-weight: 800; cursor: pointer; border: ${p.activo ? '2px solid #0284c7' : '1px solid #cbd5e1'}; background: ${p.activo ? '#0284c7' : '#ffffff'}; color: ${p.activo ? '#ffffff' : '#334155'}; transition: all 0.12s;">
                            ${escapar(p.label)}
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
    };

    function obtenerConfigIaLocalWa() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY_IA_CONFIG);
            if (!raw) return { provider: 'gemini', apiKey: '', model: 'gemini-2.5-flash' };
            const parsed = JSON.parse(raw);
            return {
                provider: parsed.provider || 'gemini',
                apiKey: String(parsed.apiKey || '').trim(),
                model: parsed.model || (parsed.provider === 'openai' ? 'gpt-4o-mini' : 'gemini-2.5-flash')
            };
        } catch (_) {
            return { provider: 'gemini', apiKey: '', model: 'gemini-2.5-flash' };
        }
    }

    window.obtenerConfigIaLocalWa = obtenerConfigIaLocalWa;

    /**
     * Redactor Agéntico Local con Criterio LAMDA (separa siempre el texto corto de la info dura y cierra quedando atento)
     */
    function redactarConAgentesLocalesEInstruccion(st, resultadoMesa, instruccionOperador = '') {
        const res = resultadoMesa || window.ejecutarMesaAgentesComercialesWa(st);
        const { infoContacto, ag2, ag3, proactivo } = res;
        const enCurso = Boolean(st.charlaEnCurso);
        const lid = Number(st.listaId) || 1;

        const saludoBreve = enCurso
            ? ''
            : (infoContacto.nombrePila
                ? `Hola ${infoContacto.nombrePila}, ${infoContacto.saludoMomentoDia}, cómo va? `
                : `Hola, ${infoContacto.saludoMomentoDia}, cómo va? `);

        const formatearLineaArticulo = (art) => {
            const pLista = art && art.precios ? Number(art.precios[lid] || art.precios[String(lid)] || art.precios[1] || 0) : 0;
            const kilos = Number(art?.kilos_unidad || 1);
            const pKg = kilos > 0 ? Math.round(pLista / kilos) : Math.round(pLista);
            const pBulto = Math.round(pLista);
            return `• *${art.nombre}*: *$${pBulto.toLocaleString('es-AR')}*${kilos > 1.05 ? ` ($${pKg.toLocaleString('es-AR')}/kg)` : ''}`;
        };

        const rawInst = String(instruccionOperador || '').trim();
        const instNorm = normalizar(rawInst);

        if (!rawInst) {
            st.varianteSaludoIdx = ((st.varianteSaludoIdx || 0) + 1) % 6;
            const nuevoRes = window.ejecutarMesaAgentesComercialesWa(st);
            return {
                burbuja1: nuevoRes.proactivo.burbuja1,
                burbuja2: nuevoRes.proactivo.burbuja2,
                burbuja3: nuevoRes.proactivo.burbuja3,
                pasoEnEspera: nuevoRes.proactivo.pasoEnEspera
            };
        }

        const stopwords = new Set([
            'decile', 'avisale', 'comentale', 'contale', 'pasale', 'mandale', 'ofrecele', 'recordale',
            'preguntale', 'consultale', 'pregunta', 'decir', 'avisar', 'que', 'hoy', 'ayer', 'manana',
            'entro', 'entraron', 'llego', 'llegaron', 'ingreso', 'ingresaron', 'tenemos', 'hay', 'quedo',
            'nueva', 'nuevo', 'nuevas', 'nuevos', 'fresca', 'fresco', 'partida', 'lote', 'stock',
            'si', 'quiere', 'necesita', 'busca', 'le', 'interesa', 'sirve', 'lleva', 'llevar', 'separo',
            'precio', 'precios', 'valor', 'valores', 'lista', 'portal', 'link', 'pagina', 'web', 'pdf',
            'por', 'favor', 'con', 'tacto', 'hola', 'como', 'estas', 'para', 'del', 'las', 'los',
            'una', 'uno', 'unos', 'unas', 'algo', 'mas', 'tambien', 'ademas', 'sobre', 'cuenta',
            'saldo', 'deuda', 'pago', 'factura', 'facturas', 'vencimiento', 'reparto', 'entrega', 'zona'
        ]);

        const tokensInst = instNorm
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(t => t.length >= 2 && !stopwords.has(t));

        const idsHab = new Set((st.articulosHabituales || []).map(a => String(a.id)));
        let articulosDetectadosEnPrompt = [];

        if (tokensInst.length > 0 && Array.isArray(st.catalogoArticulos)) {
            const puntuados = [];
            for (const art of st.catalogoArticulos) {
                const bolsa = normalizar(`${art.nombre || ''} ${art.codigo_unico || ''} ${art.familia_nombre || ''} ${art.categoria || ''}`);
                let hits = 0;
                for (const tk of tokensInst) {
                    if (bolsa.includes(tk)) {
                        hits += /^\d+\s*kg$|^\d+kg$/.test(tk) ? 2.5 : 1.5;
                    }
                }
                if (hits > 0) {
                    if (idsHab.has(String(art.id))) hits += 0.6;
                    if (Number(art.stock_real || 0) > 0) hits += 0.3;
                    puntuados.push({ art, hits });
                }
            }
            puntuados.sort((a, b) => b.hits - a.hits);
            articulosDetectadosEnPrompt = puntuados.slice(0, 3).map(x => x.art);
        }

        const seleccionadosManual = (st.catalogoArticulos || []).filter(a => st.idsSeleccionados.has(String(a.id)));
        const articulosParaCotizar = seleccionadosManual.length > 0 ? seleccionadosManual : articulosDetectadosEnPrompt;

        const convertirTerceraASegundaPersona = (txt) => {
            let s = limpiarSignosAperturaWa(txt);
            s = s.replace(/^(?:por favor\s+)?(?:decile|avisale|comentale|contale|recordale|explicale|transmitile)\s+que\s+/i, '');
            s = s.replace(/^(?:por favor\s+)?(?:pasale|mandale|enviale|compartile)\s+/i, 'te paso ');
            s = s.replace(/^(?:por favor\s+)?(?:ofrecele)\s+/i, 'te ofrezco ');
            s = s.replace(/\bsi\s+quiere\b/gi, 'si querés');
            s = s.replace(/\bquiere\b/gi, 'querés');
            s = s.replace(/\bnecesita\b/gi, 'necesitás');
            s = s.replace(/\bbusca\b/gi, 'buscás');
            s = s.replace(/\bpuede\b/gi, 'podés');
            s = s.replace(/\btiene\b/gi, 'tenés');
            s = s.replace(/\bsuele\s+llevar\b/gi, 'solés llevar');
            s = s.replace(/\blleva\b/gi, 'llevás');
            s = s.replace(/\ble\s+sirve\b/gi, 'te sirve');
            s = s.replace(/\ble\s+interesa\b/gi, 'te interesa');
            s = s.replace(/\ble\s+separo\b/gi, 'te separo');
            s = s.replace(/\ble\s+mando\b/gi, 'te mando');
            s = s.replace(/\ble\s+paso\b/gi, 'te paso');
            s = s.replace(/\bsu\s+zona\b/gi, 'tu zona');
            s = s.replace(/\bsu\s+cuenta\b/gi, 'tu cuenta');
            s = s.replace(/\bsu\s+portal\b/gi, 'tu portal');
            s = s.replace(/\bsu\s+pedido\b/gi, 'tu pedido');
            return s.trim();
        };

        const capitalizar = (s) => {
            const limpio = String(s || '').trim();
            if (!limpio) return '';
            return limpio.charAt(0).toUpperCase() + limpio.slice(1);
        };

        const textoAdaptado = capitalizar(convertirTerceraASegundaPersona(rawInst));
        const burbuja1 = limpiarSignosAperturaWa(`${saludoBreve}${textoAdaptado}${/[.!?]$/.test(textoAdaptado) ? '' : '.'}`);

        const bloquesInfoDura = [];
        if (articulosParaCotizar.length > 0) {
            bloquesInfoDura.push(articulosParaCotizar.slice(0, 4).map(formatearLineaArticulo).join('\n'));
        }
        if (/\b(link|portal|pagina|web)\b/.test(instNorm)) {
            bloquesInfoDura.push(proactivo.infoDuraLinkPortal);
        }
        if (/\b(saldo|cuenta|deuda)\b/.test(instNorm) && ag3.saldoActual > 0) {
            bloquesInfoDura.push(`Saldo actual en cuenta corriente: *${ag3.saldoFmt}*`);
        }

        const burbuja2 = bloquesInfoDura.join('\n\n');
        const burbuja3 = burbuja2 ? 'Quedamos atentos por cualquier cosa.' : '';

        return {
            burbuja1: burbuja2 ? burbuja1 : `${burbuja1}\nQuedamos atentos por cualquier cosa.`,
            burbuja2,
            burbuja3,
            pasoEnEspera: 'Texto corto separado de la información dura + cierre atento.'
        };
    }

    window.generarConIaGenerativaMesaAgentesWa = async function (st, resultadoMesa, instruccionOperador = '') {
        const instClean = String(instruccionOperador || '').trim();
        if (!instClean) {
            return redactarConAgentesLocalesEInstruccion(st, resultadoMesa, '');
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 30000);
        try {
            const catalogoCompactoIa = (st.catalogoArticulos || []).slice(0, 320).map(a => ({
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
                    clienteId: st.clienteId || 0,
                    clienteNombre: st.nombreCliente || '',
                    contactoNombre: st.contactoNombreChat || '',
                    apodoSugerido: st.nombreCorto || '',
                    mensajesRecientes: (st.mensajesCompleta || st.mensajesRecientes || []).slice(-14),
                    catalogoCompacto: catalogoCompactoIa,
                    habitualesCliente: (st.articulosHabituales || []).slice(0, 20).map(h => ({
                        codigo: h.codigo_unico || h.id,
                        nombre: h.nombre,
                        kg: Number(h.kilos_unidad || 1)
                    })),
                    estadoCuentaDeterminista: {
                        saldo_total: st.rayosX?.cuenta_corriente?.saldo_actual || 0
                    },
                    linkPortalCliente: st.linkActivacionCorto || st.urlPortalBase || '',
                    instruccionOperador: instClean,
                    forzarRecalculo: true
                })
            });
            const data = await r.json().catch(() => null);
            if (!r.ok || !data || !data.success || !data.razonamiento || !data.razonamiento.usando_ia_real) {
                throw new Error(data?.error || `El servicio de IA (Gemini) no respondió (HTTP ${r.status}).`);
            }
            const raz = data.razonamiento;
            st.razonamientoIa = raz;
            st.errorCriticoIa = '';

            if (Array.isArray(raz.codigos_articulos_pdf_sugeridos) && raz.codigos_articulos_pdf_sugeridos.length > 0) {
                const codsPdfSet = new Set(raz.codigos_articulos_pdf_sugeridos.map(c => String(c || '').toUpperCase()));
                const artsPdf = (st.catalogoArticulos || []).filter(a =>
                    codsPdfSet.has(String(a.codigo_unico || '').toUpperCase()) || codsPdfSet.has(String(a.id || '').toUpperCase())
                );
                if (artsPdf.length > 0) {
                    st.articulosPdfSugeridosIa = artsPdf;
                }
            }
            if (raz.sugerir_adjuntar_pdf) {
                st.sugerirAdjuntarPdfIa = true;
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
            } else if (raz.tipo_burbuja2_determinista === 'LINK_PORTAL') {
                b2 = resultadoMesa?.proactivo?.infoDuraLinkPortal || st.linkActivacionCorto || st.urlPortalBase || '';
            }
            if (typeof window.registrarLlamadaCreditoIaWa === 'function') {
                window.registrarLlamadaCreditoIaWa({
                    cliente: st.nombreCliente || 'Cliente',
                    tipo: 'Adaptación en vivo',
                    usage: raz._usage || null
                });
            }
            return {
                burbuja1: limpiarSignosAperturaWa(raz.burbuja1_dialogo || ''),
                burbuja2: b2,
                burbuja3: limpiarSignosAperturaWa(raz.burbuja3_cierre || ''),
                pasoEnEspera: raz.explicacion_razonamiento || 'Mensaje adaptado con IA Gemini + Clavijas Deterministas.'
            };
        } catch (err) {
            const msg = err?.name === 'AbortError'
                ? 'Tiempo de espera agotado (30s): el servicio de IA (Gemini) no respondió.'
                : (err?.message || 'No se pudo conectar con el servicio de IA (Gemini).');
            st.errorCriticoIa = msg;
            throw new Error(msg);
        } finally {
            clearTimeout(timer);
        }
    };

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
        // Si ya había historial sin tokensHoy sumados, reconstruir piso mínimo
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

        // Unificar historial reciente (local + disco)
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
        const pTok = Number(usage?.promptTokens || 1650);
        const cTok = Number(usage?.completionTokens || 240);
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

    /**
     * Renderiza en la Pizarra Principal (a la derecha de la Hora y el Día) el contador de tokens acumulados
     * y la alerta visual si el saldo en Google llega a $0.
     */
    window.renderizarWidgetCreditoIaPizarra = function () {
        const el = document.getElementById('pizarra-ia-global-widget');
        if (!el) return;

        const m = obtenerMetricasConsolidadasIa();
        const agotado = m.agotado402 || (m.tieneSaldoConfigurado && m.saldoRestanteUsd <= 0);

        if (agotado) {
            el.innerHTML = `
                <div style="background: #fef2f2; border: 2px solid #ef4444; border-left: 6px solid #dc2626; border-radius: 12px; padding: 8px 14px; text-align: right; box-shadow: 0 4px 12px rgba(220,38,38,0.14);">
                    <div style="display: flex; align-items: center; justify-content: flex-end; gap: 8px;">
                        <span style="font-size: 0.82rem; font-weight: 900; color: #991b1b;">🚨 CRÉDITO IA EN $0 (SIN SALDO EN GOOGLE)</span>
                        <button type="button" onclick="event.stopPropagation(); window.verificarEstadoCuentaIaSilencioso(true)" style="background: #dc2626; color: #fff; border: none; border-radius: 6px; padding: 2px 8px; font-size: 0.7rem; font-weight: 800; cursor: pointer;" title="Consultar estado en caliente a Google AI Studio">
                            🔄 Verificar ahora
                        </button>
                    </div>
                    <div style="font-size: 0.74rem; color: #7f1d1d; font-weight: 700; margin-top: 2px;">
                        Tokens acum.: <strong>${Number(m.tokensDesdeRecarga || 0).toLocaleString('es-AR')} tok</strong> · Tocá acá para abrir Control de Crédito IA
                    </div>
                </div>
            `;
            return;
        }

        const badgeSaldo = m.tieneSaldoConfigurado
            ? `<span style="background: #dcfce7; color: #166534; border: 1px solid #86efac; padding: 1px 7px; border-radius: 999px; font-size: 0.72rem; font-weight: 800;">Saldo est.: USD $${m.saldoRestanteUsd.toFixed(2)}</span>`
            : `<span style="background: #e0f2fe; color: #0369a1; border: 1px solid #7dd3fc; padding: 1px 7px; border-radius: 999px; font-size: 0.7rem; font-weight: 800;">Configurar saldo</span>`;

        el.innerHTML = `
            <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-left: 4px solid #059669; border-radius: 12px; padding: 7px 13px; text-align: right; transition: all 0.15s ease;">
                <div style="display: flex; align-items: center; justify-content: flex-end; gap: 7px; flex-wrap: wrap;">
                    <span style="font-size: 0.78rem; font-weight: 800; color: #065f46;">🟢 IA Gemini Activa</span>
                    ${badgeSaldo}
                    <button type="button" onclick="event.stopPropagation(); window.verificarEstadoCuentaIaSilencioso(true)" style="background: #ffffff; color: #0369a1; border: 1px solid #93c5fd; border-radius: 6px; padding: 2px 7px; font-size: 0.69rem; font-weight: 800; cursor: pointer;" title="Consultar en caliente a Google AI Studio si el crédito está activo">
                        🔄 En caliente
                    </button>
                </div>
                <div style="font-size: 0.75rem; color: #334155; font-weight: 700; margin-top: 3px; font-variant-numeric: tabular-nums;">
                    Hoy: <strong style="color:#0f172a;">${Number(m.tokensHoy || 0).toLocaleString('es-AR')} tok</strong> <span style="color:#64748b;">(~$${Number(m.consumidoHoyUsd || 0).toFixed(4)} USD)</span>
                    &nbsp;·&nbsp;
                    Acumulado: <strong style="color:#0369a1;">${Number(m.tokensDesdeRecarga || 0).toLocaleString('es-AR')} tok</strong> <span style="color:#64748b;">(~$${Number(m.consumidoDesdeRecargaUsd || 0).toFixed(4)} USD)</span>
                </div>
            </div>
        `;
    };

    /**
     * Consulta en caliente el servidor de Facturación (3004) / Google AI Studio para saber si la cuenta tiene crédito activo
     */
    window.verificarEstadoCuentaIaSilencioso = async function (mostrarToast = false) {
        await sincronizarLedgerDiscoIa();
        try {
            const r = await fetch('http://localhost:3004/facturacion/cuentas-bancarias/ia-status', { method: 'GET' });
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
                        title: `🟢 Crédito IA Activo en Google (${j.data.modelo || 'Gemini'})`,
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
                        <strong>Módulos del Sistema que utilizan IA (Gemini):</strong><br>
                        <span style="font-size:0.76rem; color:#334155;">
                            1️⃣ <strong>Cuentas Bancarias y Conciliación</strong> (Clasificación Home Banking) ·
                            2️⃣ <strong>Recepción de Lotes / Compras</strong> (Re-Ranker de ofertas) ·
                            3️⃣ <strong>Transcripción de Audios</strong> (Solo clientes Búnker) ·
                            4️⃣ <strong>Asistente Comercial CRM</strong>
                        </span>
                    </div>

                    <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-bottom:12px;">
                        <div style="background:${m.agotado402 ? '#fef2f2' : '#ecfdf5'}; border:1px solid ${m.agotado402 ? '#f87171' : '#86efac'}; border-radius:8px; padding:8px 10px;">
                            <div style="font-size:0.69rem; font-weight:800; color:${m.agotado402 ? '#991b1b' : '#065f46'}; text-transform:uppercase;">
                                ${m.agotado402 ? '🚨 Estado: Sin Saldo ($0)' : '🟢 Saldo Disponible Est.'}
                            </div>
                            <div style="font-size:1.22rem; font-weight:900; color:${m.agotado402 ? '#dc2626' : '#047857'}; margin-top:2px;">
                                USD $${restante.toFixed(3)}
                            </div>
                            <div style="font-size:0.68rem; color:#065f46;">Base fijada: USD $${saldoInicial.toFixed(2)} ${m.fechaRecarga ? `(${escapar(m.fechaRecarga)})` : ''}</div>
                        </div>
                        <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:8px 10px;">
                            <div style="font-size:0.69rem; font-weight:800; color:#92400e; text-transform:uppercase;">Tokens Consumidos Hoy</div>
                            <div style="font-size:1.22rem; font-weight:900; color:#b45309; margin-top:2px;">${Number(m.tokensHoy || 0).toLocaleString('es-AR')} tok</div>
                            <div style="font-size:0.68rem; color:#92400e;">~$${Number(m.consumidoHoyUsd || 0).toFixed(4)} USD (${Number(m.llamadasHoy || 0)} llamadas hoy)</div>
                        </div>
                        <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; padding:8px 10px;">
                            <div style="font-size:0.69rem; font-weight:800; color:#334155; text-transform:uppercase;">Tokens Acumulados</div>
                            <div style="font-size:1.22rem; font-weight:900; color:#0f172a; margin-top:2px;">${Number(m.tokensDesdeRecarga || 0).toLocaleString('es-AR')} tok</div>
                            <div style="font-size:0.68rem; color:#475569;">~$${consumido.toFixed(4)} USD (${Number(m.llamadasDesdeRecarga || 0)} llamadas totales)</div>
                        </div>
                    </div>

                    <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; padding:10px 12px; margin-bottom:10px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:6px;">
                            <label style="font-weight:800; font-size:0.78rem; color:#0f172a;">💰 Estado en Caliente y Sincronización de Saldo (USD):</label>
                            <div style="display:flex; gap:6px; align-items:center;">
                                <button type="button" id="btn-swal-probe-google-ia" onclick="window.probarEstadoEnCalienteGoogleIaWa()" style="padding:4px 9px; border-radius:6px; border:1px solid #0284c7; background:#e0f2fe; color:#0369a1; font-size:0.72rem; font-weight:800; cursor:pointer;">
                                    🔄 Consultar Estado en Caliente a Google
                                </button>
                                <a href="https://aistudio.google.com/billing?billing=01B986-C7D7EB-F97B7A" target="_blank" style="font-size:0.73rem; font-weight:800; color:#2563eb; text-decoration:underline;">🔗 Abrir Mi Facturación (01B986-C7D7EB-F97B7A) ↗</a>
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
                        <div style="font-size:0.69rem; color:#64748b; margin-top:4px;">
                            💡 Si usás la misma cuenta en otras apps externas, podés pisar acá el saldo actual de AI Studio y el sistema descontará a partir de ese valor.
                        </div>
                    </div>

                    <div style="font-weight:800; font-size:0.75rem; color:#334155; margin-bottom:4px;">📋 Últimas llamadas de IA registradas en el Sistema:</div>
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
            // 1. Intentar por el endpoint liviano de salud IA de Facturación (3004)
            let okLive = false;
            let modeloLive = 'gemini-2.5-flash';
            let errLive = '';
            try {
                const r3004 = await fetch('http://localhost:3004/facturacion/cuentas-bancarias/ia-status');
                const j3004 = await r3004.json().catch(() => null);
                if (r3004.ok && j3004?.data?.activa) {
                    okLive = true;
                    modeloLive = j3004.data.modelo || modeloLive;
                } else if (j3004?.data?.razon) {
                    errLive = j3004.data.razon;
                }
            } catch (_) {}

            // 2. Si 3004 no respondió okLive, verificar también contra el motor de 3000
            if (!okLive) {
                const r = await fetch('/api/crm/whatsapp/asistente-hibrido/razonar', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        clienteId: 0,
                        clienteNombre: 'Verificación de Saldo',
                        contactoNombre: 'Operador',
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
                box.innerHTML = `🟢 <strong>CONEXIÓN ACTIVA EN CALIENTE (${ms} ms · ${escapar(modeloLive)}):</strong> Google AI Studio respondió HTTP 200 OK con crédito disponible en todos los módulos del sistema.`;
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
                if (es402) {
                    const inp = document.getElementById('swal-input-saldo-ia-usd');
                    if (inp) inp.value = '0';
                    box.innerHTML = `🔴 <strong>SALDO EN GOOGLE AI STUDIO = USD $0.00 (HTTP 402):</strong> Google informa en vivo que los créditos prepagos están agotados (<i>"Your prepayment credits are depleted"</i>).`;
                } else {
                    box.innerHTML = `⚠️ <strong>Respuesta de Google (${ms} ms):</strong> ${escapar(errLive)}`;
                }
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

    // Inicializar el widget de la Pizarra Principal y el chequeo periódico
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
