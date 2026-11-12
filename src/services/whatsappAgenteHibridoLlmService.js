/**
 * Motor Híbrido Multi-Agente (IA Generativa Gemini + Clavijas Deterministas LAMDA)
 * Sistema LAMDA — Consola Comercial & CRM WhatsApp
 *
 * Filosofía Arquitectónica (Híbrido Real):
 * 1. CAPA COGNITIVA (IA Gemini 2.5 Flash):
 *    - Escucha nativamente los audios Ogg Opus de WhatsApp en español rioplatense (~1.5s).
 *    - Razona la frase entera del cliente (intención, apuro, negaciones como "el mix ese no te lo pido por ahora",
 *      presentaciones pedidas, promesas puente previas como "En un ratin te paso todo" -> "Ok").
 *    - Selecciona los códigos exactos del catálogo Búnker a cotizar y redacta el diálogo humano corto (Burbuja 1 y 3).
 *
 * 2. CAPA DETERMINISTA (Clavijas Duras Intocables en Código + PostgreSQL):
 *    - Los PRECIOS por kilo y por bulto jamás los escribe la IA: se calculan e inyectan 100% desde la base de datos
 *      según la lista asignada al cliente y los códigos seleccionados.
 *    - El SALDO de cuenta corriente (Capital + Financiación, antigüedad y facturas abiertas) proviene 100% de
 *      composicionSaldoService.
 *    - El LINK del Portal B2B (?t=XXXXXX) proviene del registro oficial del cliente.
 *    - Guardrails de salida: prohibición estricta de signos "¿" / "¡" y de la palabra "interés" / "intereses".
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const iaMonitor = require('./iaCreditoMonitorService');

let _vertexAuthClient = null;
let _ultimoUsageGemini = null;
const _cacheRazonamientoHibrido = new Map();

function obtenerContextoHorarioArgentina() {
    const ahora = new Date();
    let horaAr = ahora.getHours();
    let fechaHoraTxt = ahora.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
    try {
        const parts = new Intl.DateTimeFormat('es-AR', {
            timeZone: 'America/Argentina/Buenos_Aires',
            hour: 'numeric',
            hour12: false
        }).formatToParts(ahora);
        const hPart = parts.find(p => p.type === 'hour');
        if (hPart) horaAr = parseInt(hPart.value, 10);
    } catch (_) {}
    const franja = horaAr < 13 ? 'MAÑANA' : (horaAr < 20 ? 'TARDE' : 'NOCHE');
    const saludoObligatorio = horaAr < 13 ? 'buen día' : (horaAr < 20 ? 'buenas tardes' : 'buenas noches');
    return { horaAr, franja, saludoObligatorio, fechaHoraTxt };
}

/**
 * Limpia signos de apertura "¿" y "¡", reemplaza cualquier mención prohibida de "interés" por "financiación"
 * y corrige determinísticamente el saludo horario ("buen día" / "buenas tardes" / "buenas noches") según la hora real de Argentina.
 */
function aplicarClavijasTextoDeterministaWa(texto) {
    if (!texto) return '';
    const { horaAr } = obtenerContextoHorarioArgentina();
    let out = String(texto)
        .replace(/[¿¡]/g, '')
        .replace(/\bintereses\b/gi, 'financiación')
        .replace(/\binter[eé]s\b/gi, 'financiación');

    if (horaAr < 13) {
        out = out
            .replace(/\bBuenas\s+tardes\b/g, 'Buen día')
            .replace(/\bbuenas\s+tardes\b/g, 'buen día')
            .replace(/\bBuenas\s+noches\b/g, 'Buen día')
            .replace(/\bbuenas\s+noches\b/g, 'buen día');
    } else if (horaAr >= 13 && horaAr < 20) {
        out = out
            .replace(/\bBuen\s+d[ií]a\b/g, 'Buenas tardes')
            .replace(/\bbuen\s+d[ií]a\b/g, 'buenas tardes')
            .replace(/\bBuenos\s+d[ií]as\b/g, 'Buenas tardes')
            .replace(/\bbuenos\s+d[ií]as\b/g, 'buenas tardes');
    }
    return out.trim();
}

/**
 * Busca GEMINI_API_KEY en memoria o leyendo en caliente .env y src/facturacion/.env
 * (permite activarla sin siquiera reiniciar el servidor Node.js)
 */
function leerApiKeyGeminiEnCaliente() {
    const candidatosEnv = [
        path.resolve(__dirname, '../../.env'),
        path.resolve(__dirname, '../facturacion/.env')
    ];
    for (const envPath of candidatosEnv) {
        try {
            if (!fs.existsSync(envPath)) continue;
            const contenido = fs.readFileSync(envPath, 'utf8');
            const match = contenido.match(/^\s*GEMINI_API_KEY\s*=\s*([^\r\n#]+)/m);
            if (match && match[1]) {
                const val = match[1].trim().replace(/^["']|["']$/g, '');
                if (val.length > 15 && !val.includes('YOUR_GEMINI_API_KEY')) {
                    process.env.GEMINI_API_KEY = val;
                    const matchBackup = contenido.match(/^\s*GEMINI_API_KEY_BACKUP\s*=\s*([^\r\n#]+)/m);
                    if (matchBackup && matchBackup[1]) {
                        process.env.GEMINI_API_KEY_BACKUP = matchBackup[1].trim().replace(/^["']|["']$/g, '');
                    }
                    return val;
                }
            }
        } catch (_) {}
    }
    const enMemoria = String(process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || '').trim();
    if (enMemoria && enMemoria.length > 15 && !enMemoria.includes('YOUR_GEMINI_API_KEY')) {
        return enMemoria;
    }
    return '';
}

/**
 * Verifica si hay credenciales de IA activas (GEMINI_API_KEY directa o Vertex AI en GOOGLE_SA_KEY_FILE)
 */
function obtenerModoCredencialGemini() {
    const apiKey = leerApiKeyGeminiEnCaliente();
    const apiKeyBackup = String(process.env.GEMINI_API_KEY_BACKUP || '').trim();
    if (apiKey && apiKey.length > 15) {
        const apiKeys = [apiKey];
        if (apiKeyBackup && apiKeyBackup.length > 15 && apiKeyBackup !== apiKey) {
            apiKeys.push(apiKeyBackup);
        }
        return { disponible: true, modo: 'API_KEY', apiKey, apiKeys };
    }
    const saFile = String(process.env.GOOGLE_SA_KEY_FILE || '').trim();
    const vertexHabilitado = String(process.env.VERTEX_AI_ENABLED || '').trim().toLowerCase() === 'true';
    if (saFile && fs.existsSync(saFile) && vertexHabilitado) {
        return { disponible: true, modo: 'VERTEX_SA', saFile };
    }
    return { disponible: false, modo: 'SIN_CREDENCIAL' };
}

/**
 * Ejecuta una llamada multimodal / estructurada a Gemini Flash (vía API Key o Vertex AI Service Account)
 */
async function invocarGemini25Flash({ systemInstruction, parts, responseSchema = null, temperature = 0.15, timeoutMs = 28000 }) {
    const cred = obtenerModoCredencialGemini();
    if (!cred.disponible) {
        throw new Error('GEMINI_NO_CONFIGURADO: Falta configurar GEMINI_API_KEY en .env (o habilitar Vertex AI).');
    }

    const modeloPrimario = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
    const modelosCandidatos = [modeloPrimario, 'gemini-flash-latest'];
    const keysCandidatas = cred.modo === 'API_KEY' ? (cred.apiKeys || [cred.apiKey]) : ['VERTEX'];
    let ultimoError = null;

    for (const activeKey of keysCandidatas) {
        for (const modelName of modelosCandidatos) {
            const generationConfig = {
                temperature
            };
            if (responseSchema) {
                generationConfig.responseMimeType = 'application/json';
                generationConfig.responseSchema = responseSchema;
            }
            if (modelName.includes('2.5') || modelName.includes('3.')) {
                generationConfig.thinkingConfig = { thinkingBudget: 0 };
            }

            const bodyPayload = {
                contents: [
                    {
                        role: 'user',
                        parts
                    }
                ],
                generationConfig
            };

            if (systemInstruction) {
                bodyPayload.systemInstruction = {
                    parts: [{ text: systemInstruction }]
                };
            }

            let url = '';
            const headers = { 'Content-Type': 'application/json' };

            if (cred.modo === 'API_KEY') {
                url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(activeKey)}`;
            } else {
                if (!_vertexAuthClient) {
                    const auth = new google.auth.GoogleAuth({
                        keyFile: cred.saFile,
                        scopes: ['https://www.googleapis.com/auth/cloud-platform']
                    });
                    _vertexAuthClient = await auth.getClient();
                }
                const tokenRes = await _vertexAuthClient.getAccessToken();
                const saJson = JSON.parse(fs.readFileSync(cred.saFile, 'utf8'));
                const projectId = saJson.project_id;
                const location = process.env.VERTEX_AI_LOCATION || 'us-central1';
                url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelName}:generateContent`;
                headers.Authorization = `Bearer ${tokenRes.token}`;
            }

            const controller = new AbortController();
            const perAttemptTimeout = Math.min(Number(timeoutMs) || 14000, 13000);
            const timer = setTimeout(() => controller.abort(), perAttemptTimeout);
            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(bodyPayload),
                    signal: controller.signal
                });
                if (!res.ok) {
                    const errTxt = await res.text().catch(() => '');
                    ultimoError = new Error(`Gemini (${modelName}) HTTP ${res.status}: ${errTxt.slice(0, 240)}`);
                    iaMonitor.registrarEventoIaSistema({
                        modulo: 'COMERCIAL_CRM',
                        detalle: `Error HTTP ${res.status}`,
                        modelo: modelName,
                        errorMsg: ultimoError.message
                    });
                    if (res.status === 404) continue;
                    break; // Probar siguiente API key si hay 429/403/5xx
                }
                const data = await res.json();
                const um = data?.usageMetadata || {};
                const pTok = Number(um.promptTokenCount || 1500);
                const cTok = Number(um.candidatesTokenCount || 220);
                const tTok = Number(um.totalTokenCount || (pTok + cTok));
                // Tarifa oficial Gemini Flash (~$0.30 / 1M input, ~$2.50 / 1M output)
                const costoUsd = Number(((pTok * 0.0000003) + (cTok * 0.0000025)).toFixed(6));
                _ultimoUsageGemini = {
                    modelName,
                    promptTokens: pTok,
                    completionTokens: cTok,
                    totalTokens: tTok,
                    costoUsd,
                    timestamp: Date.now()
                };
                iaMonitor.registrarEventoIaSistema({
                    modulo: 'COMERCIAL_CRM',
                    detalle: 'Asistencia Comercial / Audio',
                    usageDirecto: {
                        promptTokens: pTok,
                        outputTokens: cTok,
                        totalTokens: tTok,
                        costoUsd
                    },
                    modelo: modelName
                });
                const partsResp = data?.candidates?.[0]?.content?.parts || [];
                const partTexto = partsResp.find(p => typeof p.text === 'string' && !p.thought) || partsResp[0];
                return String(partTexto?.text || '').trim();
            } catch (err) {
                ultimoError = err;
            } finally {
                clearTimeout(timer);
            }
        }
    }
    throw ultimoError || new Error('Error invocando Gemini.');
}

/**
 * 🎙️ AGENTE OÍDO MULTIMODAL:
 * Escucha directamente el buffer de audio (.ogg de WhatsApp o .webm del micrófono del operador) con Gemini Flash en ~1.5 segundos,
 * entendiendo el español rioplatense y todos los artículos e instrucciones comerciales del rubro LAMDA.
 */
async function transcribirAudioOggConGemini(audioBuffer, mimeType = 'audio/ogg') {
    if (!audioBuffer || audioBuffer.length < 32) {
        throw new Error('Buffer de audio vacío.');
    }
    const rawMime = String(mimeType || 'audio/ogg').split(';')[0].trim().toLowerCase() || 'audio/ogg';
    // Nota técnica: La API REST de Gemini rechaza "audio/webm" con HTTP 400 INVALID_ARGUMENT,
    // pero procesa contenedores WebM/Opus perfectamente cuando se declaran como "audio/ogg" o "video/webm".
    const candidatosMime = (rawMime === 'audio/webm' || rawMime === 'application/octet-stream')
        ? ['audio/ogg', 'video/webm']
        : [rawMime, 'audio/ogg', 'video/webm'];

    const audioBase64 = Buffer.from(audioBuffer).toString('base64');
    const systemPrompt = [
        'Sos el transcriptor experto en español argentino (rioplatense) de LAMDA, distribuidora mayorista de frutos secos, frutas disecadas, frutas glaseadas/escurridas (abrillantadas), cereales, semillas, legumbres, mixes, granolas y barritas.',
        'Escuchá el audio y devolvé ÚNICAMENTE la transcripción exacta en texto plano de lo que dice la persona, sin agregar comentarios ni introducciones.',
        'Prestá especial atención a términos del rubro e instrucciones operativas: higos turcos, higos negros, damasco turco, damascos, castañas de cajú, castañas tostadas sin sal, castañas tostadas y saladas, castañas de Pará, avellanas, almendras Non Pareil / Guara, nueces mariposa / Chandler, fruta escurrida / abrillantada, fruta glaseada, pasas de uva Flame / Sultanina / Jumbo, arándanos, dátiles, ciruelas Presidente, lentejón, garbanzos, porotos, azúcar mascabo, mix de frutos secos, granolas, fracciones chicas, por un kilo, por dos kilos, por 5 kilos, por 10 kilos, PDF adjunto, lista de precios.'
    ].join(' ');

    let ultimoErr = null;
    for (const mimeIntento of candidatosMime) {
        try {
            const texto = await invocarGemini25Flash({
                systemInstruction: systemPrompt,
                parts: [
                    {
                        inlineData: {
                            mimeType: mimeIntento,
                            data: audioBase64
                        }
                    },
                    {
                        text: 'Transcribí exactamente este mensaje de voz en español argentino.'
                    }
                ],
                temperature: 0.05,
                timeoutMs: 22000
            });
            const limpio = String(texto || '').replace(/^["'«»]+|["'«»]+$/g, '').trim();
            if (limpio) return limpio;
        } catch (err) {
            ultimoErr = err;
        }
    }
    if (ultimoErr) throw ultimoErr;
    return '';
}

/**
 * 🧠 COMITÉ MULTI-AGENTE HÍBRIDO (Razonamiento IA + Clavijas Deterministas):
 * Analiza la conversación completa, el catálogo real de LAMDA y la radiografía determinista del cliente,
 * devolviendo los códigos exactos a cotizar (respetando exclusiones), los artículos sugeridos para PDF adjunto
 * y las burbujas con cintura táctica.
 */
async function razonarAsistenciaHibridaClienteWa({
    clienteNombre,
    contactoNombre,
    apodoSugerido,
    mensajesRecientes = [],
    catalogoCompacto = [],
    habitualesCliente = [],
    estadoCuentaDeterminista = {},
    linkPortalCliente = '',
    instruccionOperador = '',
    forzarRecalculo = false
}) {
    const cred = obtenerModoCredencialGemini();
    if (!cred.disponible) {
        throw new Error('GEMINI_NO_CONFIGURADO: No se encontró GEMINI_API_KEY activa en el servidor.');
    }

    const ultMsg = mensajesRecientes.length > 0 ? mensajesRecientes[mensajesRecientes.length - 1] : null;
    const instClean = String(instruccionOperador || '').trim();
    const cacheKey = `${clienteNombre}_${contactoNombre}_${ultMsg?.id || ultMsg?.msg_id || mensajesRecientes.length}_${ultMsg?.cuerpo || ''}_${instClean}`;
    if (!forzarRecalculo && !instClean && _cacheRazonamientoHibrido.has(cacheKey)) {
        const cached = _cacheRazonamientoHibrido.get(cacheKey);
        if (Date.now() - cached.ts < 90000) {
            return cached.data;
        }
    }

    const systemInstruction = `
Sos el Director del Comité de Agentes Comerciales Híbridos de LAMDA (distribuidora mayorista B2B de frutos secos, frutas disecadas, semillas, cereales, legumbres, mixes y granolas), asistiendo a Martín en su WhatsApp.

REGLAS INNEGOCIABLES DEL SISTEMA HÍBRIDO (CLAVIJAS DURAS):
1. JAMÁS inventes precios ni escribas importes de artículos en burbuja1 ni burbuja3. El Agente Fiscalizador Determinista de LAMDA estampará los precios reales de la Lista Asignada del cliente tanto en la Burbuja 2 como en el PDF adjunto.
2. RAZONAMIENTO DE EXCLUSIONES Y NEGACIONES: Leé la oración completa del cliente. Si el cliente menciona un producto para decir que NO lo quiere (ejemplo: "El mix ese no te lo pido por ahora", "poroto no me mandes"), JAMÁS lo incluyas en "codigos_articulos_seleccionados" y agregalo en "conceptos_excluidos".
3. PRESENTACIONES CHICAS vs CAJAS GRANDES (10kg+) Y DIVISIÓN CUERPO vs PDF ADJUNTO:
   - En "codigos_articulos_seleccionados" poné lo que va en el CUERPO DEL MENSAJE (Burbuja 2): lo que el cliente pidió explícitamente (máx 6-8 artículos).
   - Si el cliente pidió presentaciones chicas ("por 1 kg, por 2 kg", "fracciones chicas") y para ese producto ya existe presentación de 1kg o 2kg en el catálogo (ej: Avellanas Peladas x 2kg "APx2"), NO incluyas cajas grandes de 10kg (ej: "AP15+X10") en "codigos_articulos_seleccionados". Solo incluí un bulto de 5kg si no existe de 1kg (ej: Higo Turco x 2kg y x 5kg).
   - En "codigos_articulos_pdf_sugeridos" seleccioná artículos RELACIONADOS / COMPLEMENTARIOS en presentaciones acordes para enviar en un PDF adjunto prolijo sin recargar el texto del chat: por ejemplo, si pidió castañas de cajú, sugerí en el PDF las Castañas de Cajú Tostadas sin sal y Tostadas y Saladas en 1kg/2kg; si pidió higos turcos, sugerí Damasco Turco en 1kg/5kg y Ciruelas/Dátiles/Habituales en fracciones chicas.
   - Si hay artículos complementarios útiles o si el operador pide agregar ofertas/relacionados o adjuntar PDF, poné "sugerir_adjuntar_pdf": true.
   - Nunca selecciones códigos internos de producción ("PROD AP Externo", "PROD UP Externo", "Caja MICRO").
4. OBEDIENCIA PRIORITARIA AL OPERADOR ("instruccion_operador_prioritaria"):
   - Si Martín (el operador) da una instrucción hablada o escrita en "instruccion_operador_prioritaria" (por ejemplo: "agregale las ofertas de castañas tostadas y saladas y damasco turco en fracciones chicas, sacá la caja de 10kg, mandale PDF adjunto"), esa instrucción tiene PRIORIDAD ABSOLUTA: actualizá "codigos_articulos_seleccionados" y/o "codigos_articulos_pdf_sugeridos", activá "sugerir_adjuntar_pdf": true si pide PDF o si el cuerpo quedaría muy largo, y adaptá "burbuja1_dialogo" y "burbuja3_cierre" comentándole al cliente que en el mensaje tiene lo que consultó y en el PDF adjunto las variantes relacionadas (ej: castañas tostadas/saladas, damasco turco, etc.).
5. CINTURA TÁCTICA DE WHATSAPP Y REDACCIÓN CONTEXTUAL NO CLÓNICA:
   - Nunca uses signos de apertura "¿" ni "¡" (en WhatsApp real solo se usa "?" y "!" al cerrar).
   - Nunca uses la palabra "interés" ni "intereses": siempre se dice "financiación".
   - Si hoy ya saludamos al cliente o si nosotros ya le mandamos un mensaje puente como "En un ratin te paso todo" (incluso si el cliente después contestó "Ok" o "Dale"), NO vuelvas a saludar con "Hola X, buen día, cómo estás?". Continuá directo al pie.
   - PROHIBIDO SALUDAR A TODOS LOS CLIENTES IGUAL CON FRASES DE MOLDE: Cuando abras semana o retomes contacto (ej. última charla hace varios días), mirá de qué hablaron realmente en la última interacción del historial (si pidió algo puntual, si coordinaron entrega, si quedó en revisar stock, o cuáles son sus "articulos_habituales_cliente") y redactá "burbuja1_dialogo" conectado con esa conversación real, no como un robot que les dice lo mismo a todos.
   - AUDIOS VIEJOS SIN TRANSCRIBIR: Si un mensaje del historial dice literalmente "🎤 Mensaje de audio" (sin texto transcrito al lado) y es de días anteriores (ej. de la semana pasada), NO digas "ahí escuché tu audio" como si fuera de recién; abrí la semana con naturalidad consultando cómo vienen de stock/reposición para esta semana (mencionando si querés alguno de sus artículos habituales).
   - CIERRE CONTEXTUAL EN BURBUJA 3 Y MULETILLA DE MARTÍN: No uses de forma repetitiva "Cualquier cosa escribime por acá". Redactá siempre en "burbuja3_cierre" un cierre natural adaptado a cómo viene la charla con ese cliente; y cuando corresponda un cierre corto de cortesía, usá el estilo real de Martín ("Cualquier cosa estamos atentos.", "Quedamos atentos por cualquier cosa.", "Estoy atento por cualquier cosa."). Siempre completá "burbuja3_cierre" con una frase contextual lista por si Martín decide desplegar el 3er mensaje.
6. PAGO ADELANTADO / TRANSFERENCIA RECIBIDA CON SALDO A FAVOR Y SEGUIMIENTO DE ORDEN ("PAGO_ADELANTADO_SEGUIMIENTO_ORDEN"):
   - Si en el historial reciente de hoy/ayer se ve la secuencia donde:
     (a) Nosotros le enviamos un presupuesto/orden ("Hola, te enviamos el presupuesto N° ... de LAMDA") o existe un pedido activo en curso ("pedidos_activos_en_curso" en "cuenta_corriente_determinista"),
     (b) El cliente transfirió o pagó por adelantado (ej. mandó foto/imagen de transferencia o aviso de pago), y
     (c) Nosotros ya le enviamos el comprobante/recibo ("Comprobante de pago recibido (REC-PAGO-...)" y/o el texto automático "Ha quedado un saldo a favor de $..." porque la mercadería todavía no se entregó y el recibo deja saldo a favor en cuenta corriente), o bien "cuenta_corriente_determinista.tiene_saldo_a_favor" es true con pedido activo en preparación,
     y todavía NO le enviamos el link de seguimiento después de ese recibo:
   - Entonces OBLIGATORIAMENTE clasificá:
     - "situacion_dialogo": "PAGO_ADELANTADO_SEGUIMIENTO_ORDEN"
     - "modo_accion_sugerido": "SEGUIMIENTO_ORDEN"
     - "tipo_burbuja2_determinista": "LINK_SEGUIMIENTO_ORDEN"
     - "codigos_articulos_seleccionados": []
     - "sugerir_adjuntar_pdf": false
     - En "burbuja1_dialogo": Agradecele por la transferencia ("muchas gracias por la transferencia"), confirmale que el pago ya quedó acreditado y su pedido/orden (mencionando el N° de orden si figura) ya está en curso de preparación, y ofrecele seguir en tiempo real el estado de la orden ingresando desde el link de la plataforma/app de abajo. (NO saludes de nuevo con "Hola" si ya veníamos hablando hoy; continuá natural, ej: "${apodoSugerido ? `${apodoSugerido}, muchas` : 'Muchas'} gracias por la transferencia! Ya quedó acreditada y tu orden está en preparación. Desde el link de abajo podés ingresar a la app para hacer el seguimiento en tiempo real del estado de tu pedido:").
     - En "burbuja3_cierre": "Apenas esté listo para salir te avisamos también por acá. Cualquier cosa estamos atentos."
`.trim();

    const historialFormateado = mensajesRecientes.slice(-14).map(m => {
        const quien = m.from_me ? 'NOSOTROS (Martín/LAMDA)' : `CLIENTE (${apodoSugerido || contactoNombre || clienteNombre})`;
        const fecha = m.fecha_mensaje || m.creado_en || '';
        return `[${fecha}] ${quien}: ${String(m.cuerpo || '').replace(/\s+/g, ' ').trim()}`;
    }).join('\n');

    const catalogoFiltradoBase = (Array.isArray(catalogoCompacto) ? catalogoCompacto : [])
        .filter(c => !/^(?:PROD\s+(?:AP|UP)\s+Externo|Caja\s+MICRO|Bolsa\s+Polipropileno)/i.test(String(c?.nombre || '')));

    // Optimización de velocidad y foco: filtrar el catálogo relevante para los últimos mensajes + instrucción + habituales
    // (evita enviar 350 artículos pesados cuando es un saludo semanal, respondiendo en ~2.5s en vez de agotar 28s)
    const textoContextoBusqueda = `${historialFormateado} ${instClean}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    const palabrasClaveContexto = Array.from(new Set(
        textoContextoBusqueda
            .split(/[^a-z0-9]+/)
            .filter(w => w.length >= 3 && !['hola', 'buen', 'dia', 'buenas', 'tardes', 'como', 'estas', 'todo', 'bien', 'para', 'esta', 'semana', 'dale', 'gracias', 'martin', 'lamda', 'nosotros', 'cliente', 'mensaje', 'audio', 'por', 'los', 'las', 'que', 'una', 'uno', 'con', 'sin', 'del'].includes(w))
    ));

    let catalogoSeleccionPrompt = [];
    if (palabrasClaveContexto.length > 0) {
        const coincidencias = catalogoFiltradoBase.filter(c => {
            const nomNorm = `${c.nombre || ''} ${c.familia || ''} ${c.codigo || ''}`
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '');
            return palabrasClaveContexto.some(w => nomNorm.includes(w));
        });
        catalogoSeleccionPrompt = coincidencias.slice(0, 80);
    }
    if (catalogoSeleccionPrompt.length < 30) {
        const vistosCod = new Set(catalogoSeleccionPrompt.map(c => c.codigo));
        for (const item of catalogoFiltradoBase) {
            if (!vistosCod.has(item.codigo)) {
                catalogoSeleccionPrompt.push(item);
                vistosCod.add(item.codigo);
            }
            if (catalogoSeleccionPrompt.length >= 65) break;
        }
    }

    const catalogoComercialLimpio = catalogoSeleccionPrompt
        .map(c => `${c.codigo} | ${c.nombre} | ${c.kilos_unidad || 1}kg | stock:${Number(c.stock_disponible || 0) > 0 ? c.stock_disponible : 0}`);

    const habitualesLimpios = (Array.isArray(habitualesCliente) ? habitualesCliente : [])
        .slice(0, 15)
        .map(h => `${h.codigo || ''} | ${h.nombre || ''}`);

    const ctxHorario = obtenerContextoHorarioArgentina();
    const promptUsuario = JSON.stringify({
        hora_local_argentina: `${ctxHorario.fechaHoraTxt} (Franja: ${ctxHorario.franja} — Saludo obligatorio si saludás: "${ctxHorario.saludoObligatorio}")`,
        instruccion_operador_prioritaria: instClean || null,
        cliente: {
            razon_social: clienteNombre,
            contacto: contactoNombre,
            apodo_confianza: apodoSugerido,
            link_portal_disponible: Boolean(linkPortalCliente)
        },
        cuenta_corriente_determinista: estadoCuentaDeterminista,
        articulos_habituales_cliente: habitualesLimpios,
        historial_reciente_whatsapp: historialFormateado,
        catalogo_bunker_disponible_formato_codigo_nombre_kg_stock: catalogoComercialLimpio
    });

    const responseSchema = {
        type: 'OBJECT',
        properties: {
            situacion_dialogo: {
                type: 'STRING',
                description: 'Código táctico: PAGO_ADELANTADO_SEGUIMIENTO_ORDEN, CLIENTE_CONSULTA_PUNTUAL, CLIENTE_PIDE_LISTA, CLIENTE_ENVIA_PEDIDO, CLIENTE_RESPONDE_TANTEO_O_SALUDO, SILENCIO_TRAS_RESUMEN_CUENTA, NOSOTROS_YA_TANTEAMOS_HOY, CLIENTE_POSTERGA_O_ESTA_BIEN, CLIENTE_AGRADECE_O_CONFIRMA, INICIAR_SALUDO_SEMANAL'
            },
            titulo_intencion: {
                type: 'STRING',
                description: 'Título corto (máx 55 caracteres) describiendo la situación actual del chat'
            },
            explicacion_razonamiento: {
                type: 'STRING',
                description: 'Explicación breve y clara para Martín de qué interpretó el agente (qué puso en el cuerpo del mensaje, qué descartó y qué preparó en el PDF de relacionados)'
            },
            modo_accion_sugerido: {
                type: 'STRING',
                description: 'Uno de: SEGUIMIENTO_ORDEN, COTIZAR, RESPONDER_CONTEXTO, TANTEO_CORTO, PING_PONG_TEMA, PASAR_PORTAL, AVISO_CORTO_CUENTA, SALUDAR_SEMANA'
            },
            codigos_articulos_seleccionados: {
                type: 'ARRAY',
                items: { type: 'STRING' },
                description: 'Lista de códigos exactos (primer campo antes de | en catalogo_bunker_disponible) para el CUERPO DEL MENSAJE (Burbuja 2). Si pidió fracciones chicas (1kg/2kg), NO poner cajas de 10kg si existe de 1kg o 2kg.'
            },
            codigos_articulos_pdf_sugeridos: {
                type: 'ARRAY',
                items: { type: 'STRING' },
                description: 'Lista de códigos exactos de artículos RELACIONADOS / COMPLEMENTARIOS en fracciones acordes (ej: castañas tostadas sin sal / con sal, damasco turco, más los cotizados) para enviar en el PDF adjunto de precios verificados de su lista.'
            },
            sugerir_adjuntar_pdf: {
                type: 'BOOLEAN',
                description: 'true si conviene adjuntar el PDF con los artículos relacionados/ofertas de su lista o si el operador lo pidió.'
            },
            conceptos_excluidos: {
                type: 'ARRAY',
                items: { type: 'STRING' },
                description: 'Palabras o productos que el cliente mencionó pero aclaró que NO quiere o que deja para después (ej: ["mix"])'
            },
            burbuja1_dialogo: {
                type: 'STRING',
                description: 'Texto de la Burbuja 1 para WhatsApp (corto, natural, sin signos ¿ ni ¡, sin precios ni links adentro, y sin repetir Hola si ya hablamos hoy)'
            },
            tipo_burbuja2_determinista: {
                type: 'STRING',
                description: 'LINK_SEGUIMIENTO_ORDEN (si ya pagó/transfirió por adelantado y corresponde pasarle el link directo al seguimiento del estado de su orden), PRECIOS_SELECCIONADOS (si corresponde estampar los precios deterministas de codigos_articulos_seleccionados), LINK_PORTAL (si corresponde estampar el link general del portal), o VACIA (si es mensaje de 1 sola burbuja)'
            },
            burbuja3_cierre: {
                type: 'STRING',
                description: 'Texto corto y contextual de cierre para la Burbuja 3 adaptado a la charla (usando el estilo real de Martín como "Cualquier cosa estamos atentos." o comentando el PDF adjunto si aplica; evitá repetir siempre "Cualquier cosa escribime por acá")'
            }
        },
        required: [
            'situacion_dialogo',
            'titulo_intencion',
            'explicacion_razonamiento',
            'modo_accion_sugerido',
            'codigos_articulos_seleccionados',
            'codigos_articulos_pdf_sugeridos',
            'sugerir_adjuntar_pdf',
            'conceptos_excluidos',
            'burbuja1_dialogo',
            'tipo_burbuja2_determinista',
            'burbuja3_cierre'
        ]
    };

    const rawJsonText = await invocarGemini25Flash({
        systemInstruction,
        parts: [{ text: promptUsuario }],
        responseSchema,
        temperature: 0.35,
        timeoutMs: 28000
    });

    const parsed = JSON.parse(rawJsonText);
    const resultadoBlindado = {
        usando_ia_real: true,
        modo_credencial: cred.modo,
        _usage: _ultimoUsageGemini || null,
        situacion_dialogo: String(parsed.situacion_dialogo || 'CLIENTE_CONSULTA_PUNTUAL').trim(),
        titulo_intencion: aplicarClavijasTextoDeterministaWa(parsed.titulo_intencion || ''),
        explicacion_razonamiento: aplicarClavijasTextoDeterministaWa(parsed.explicacion_razonamiento || ''),
        modo_accion_sugerido: String(parsed.modo_accion_sugerido || 'COTIZAR').trim(),
        codigos_articulos_seleccionados: Array.isArray(parsed.codigos_articulos_seleccionados)
            ? parsed.codigos_articulos_seleccionados.map(c => String(c || '').trim()).filter(Boolean)
            : [],
        codigos_articulos_pdf_sugeridos: Array.isArray(parsed.codigos_articulos_pdf_sugeridos)
            ? parsed.codigos_articulos_pdf_sugeridos.map(c => String(c || '').trim()).filter(Boolean)
            : [],
        sugerir_adjuntar_pdf: Boolean(parsed.sugerir_adjuntar_pdf),
        conceptos_excluidos: Array.isArray(parsed.conceptos_excluidos)
            ? parsed.conceptos_excluidos.map(c => String(c || '').trim().toLowerCase()).filter(Boolean)
            : [],
        burbuja1_dialogo: aplicarClavijasTextoDeterministaWa(parsed.burbuja1_dialogo || ''),
        tipo_burbuja2_determinista: String(parsed.tipo_burbuja2_determinista || 'VACIA').trim(),
        burbuja3_cierre: aplicarClavijasTextoDeterministaWa(parsed.burbuja3_cierre || '')
    };

    _cacheRazonamientoHibrido.set(cacheKey, { ts: Date.now(), data: resultadoBlindado });
    return resultadoBlindado;
}

module.exports = {
    obtenerModoCredencialGemini,
    aplicarClavijasTextoDeterministaWa,
    transcribirAudioOggConGemini,
    razonarAsistenciaHibridaClienteWa
};
