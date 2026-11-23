/**
 * Motor Híbrido Multi-Agente por 2 Carriles (IA Generativa Gemini 2.5 Flash + Clavijas Deterministas LAMDA)
 * Sistema LAMDA — Consola Comercial & CRM WhatsApp (Fase 3)
 *
 * Arquitectura de 2 Carriles y 8 Especialistas con Prompts Cortos y Enfocados:
 * 📥 CARRIL ENTRANTE (Reactivo):
 *   1. VENTAS_COTIZADOR      — Cotizaciones, exclusiones, fracciones vs. bultos, PDF / Portal B2B
 *   2. COBRANZA_COMPROBANTES — Saldo exacto, acuse de transferencias/comprobantes, CBU Galicia
 *   3. LOGISTICA_ENTREGAS    — Estado real del último presupuesto y hoja de ruta (chofer, fecha, estado)
 *   4. RECLAMO_DEVOLUCION    — Contención sobria y empática sin inventar montos + acceso a Factura / NC
 *
 * 📤 CARRIL SALIENTE (Proactivo):
 *   1. CUENTA_CORRIENTE      — Tono adaptado al tramo real (EN_TERMINO / GRACIA_NATURAL / COMODIN / SALVAVIDAS_FINANCIADO)
 *   2. REACTIVACION_PORTAL   — Anclado en habituales reales, días sin compra e Invitación vs. Link Portal B2B
 *   3. POST_ENTREGA          — Chequeo breve apoyado en la mercadería entregada real (sin repetir saludo si ya hablamos hoy)
 *   4. SALUDO_PUNTUAL        — 1 sola burbuja corta conectada al último contexto real del hilo
 *
 * 👁️ MULTIMODAL:
 *   - transcribirAudioOggConGemini()  -> Imputa consumo al módulo AUDIOS en ia_credito_ledger.json
 *   - leerComprobanteImagenConGemini() -> Extrae banco, fecha, importe, operación, CUIT/titular de comprobantes
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const iaMonitor = require('./iaCreditoMonitorService');

let _vertexAuthClient = null;
let _ultimoUsageGemini = null;
const _cacheRazonamientoHibrido = new Map();

const CARRILES_AGENTES_WA = {
    ENTRANTE: ['VENTAS_COTIZADOR', 'COBRANZA_COMPROBANTES', 'LOGISTICA_ENTREGAS', 'RECLAMO_DEVOLUCION'],
    SALIENTE: ['CUENTA_CORRIENTE', 'REACTIVACION_PORTAL', 'POST_ENTREGA', 'SALUDO_PUNTUAL']
};

const DATOS_BANCARIOS_LAMDA = {
    banco: 'Banco Galicia',
    cuenta: '4007844-1 373-4',
    cbu: '0070373230004007844141',
    alias: 'lamda.ser.martin'
};

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
 * Capa Determinista de Clavijas de Texto:
 * - Elimina signos de apertura "¿" y "¡"
 * - Reemplaza "interés" / "intereses" por "financiación"
 * - Sincroniza "buen día" / "buenas tardes" / "buenas noches" con la hora real de Argentina
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
 * Busca GEMINI_API_KEY (principal y backup) en caliente desde .env / src/facturacion/.env
 */
function leerApiKeyGeminiEnCaliente() {
    const credCentral = iaMonitor.leerCredencialesGeminiEnCaliente();
    const candidatosEnv = [
        path.resolve(__dirname, '../../.env'),
        path.resolve(__dirname, '../facturacion/.env')
    ];
    for (const envPath of candidatosEnv) {
        try {
            if (!fs.existsSync(envPath)) continue;
            const contenido = fs.readFileSync(envPath, 'utf8');
            const matchBackup = contenido.match(/^\s*GEMINI_API_KEY_BACKUP\s*=\s*([^\r\n#]+)/m);
            if (matchBackup && matchBackup[1]) {
                process.env.GEMINI_API_KEY_BACKUP = matchBackup[1].trim().replace(/^["']|["']$/g, '');
            }
            if (!credCentral.disponible) {
                const match = contenido.match(/^\s*GEMINI_API_KEY\s*=\s*([^\r\n#]+)/m);
                if (match && match[1]) {
                    const val = match[1].trim().replace(/^["']|["']$/g, '');
                    if (val.length > 15 && !val.includes('YOUR_GEMINI_API_KEY')) {
                        process.env.GEMINI_API_KEY = val;
                        return val;
                    }
                }
            }
        } catch (_) {}
    }
    if (credCentral.disponible) return credCentral.apiKey;
    const enMemoria = String(process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || '').trim();
    if (enMemoria && enMemoria.length > 15 && !enMemoria.includes('YOUR_GEMINI_API_KEY')) {
        return enMemoria;
    }
    return '';
}

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
 * Desactiva thinking interno innecesario en toda la familia Gemini Flash con soporte thinkingBudget
 * (2.5+, 3.x+, 4.x+, flash-latest), excluyendo variantes legacy (1.5/2.0) y modelos TTS/Image.
 */
function aplicarThinkingBudgetCeroSiFlash(generationConfig, modelName) {
    const m = String(modelName || '').trim().toLowerCase();
    const esFlashConThinking = /flash/.test(m)
        && !/(?:^|-)gemini-(?:1\.|2\.0)/.test(m)
        && !/(?:-tts|-image)\b/.test(m);
    if (esFlashConThinking) {
        generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }
    return generationConfig;
}

const CODIGOS_HTTP_ROTACION_API_KEY = new Set([401, 402, 403, 429]);
const CODIGOS_HTTP_FALLBACK_MODELO = new Set([404, 500, 502, 503, 504]);

/**
 * Invocador unificado de Gemini Flash con modelo válido, presupuesto total de tiempo (deadlineMs),
 * thinkingBudget=0 para respuestas rápidas, rotación de backup key solo ante auth/cuota e imputación por módulo.
 */
async function invocarGemini25Flash({
    systemInstruction,
    parts,
    responseSchema = null,
    temperature = 0.15,
    timeoutMs = 28000,
    moduloLedger = 'COMERCIAL_CRM',
    detalleLedger = 'Asistente Comercial'
}) {
    const cred = obtenerModoCredencialGemini();
    if (!cred.disponible) {
        throw new Error('GEMINI_NO_CONFIGURADO: Falta configurar GEMINI_API_KEY en .env (o habilitar Vertex AI).');
    }

    const credCentral = iaMonitor.leerCredencialesGeminiEnCaliente();
    const modeloPrimario = iaMonitor.normalizarModeloGeminiValido(credCentral.model || iaMonitor.MODELO_GEMINI_OFICIAL);
    const modelosCandidatos = Array.from(new Set([modeloPrimario, ...iaMonitor.MODELOS_GEMINI_FALLBACK]));
    const keysCandidatas = cred.modo === 'API_KEY' ? (cred.apiKeys || [cred.apiKey]) : ['VERTEX'];

    const totalBudgetMs = Math.max(8000, Math.min(Number(timeoutMs) || 26000, 30000));
    const startedAt = Date.now();
    const deadlineAt = startedAt + totalBudgetMs;
    let ultimoError = null;

    for (let keyIdx = 0; keyIdx < keysCandidatas.length; keyIdx++) {
        const activeKey = keysCandidatas[keyIdx];
        const keyTag = cred.modo === 'API_KEY' ? `key#${keyIdx + 1}` : 'vertex';
        let rotarSiguienteKey = false;

        for (let modelIdx = 0; modelIdx < modelosCandidatos.length; modelIdx++) {
            const modelName = modelosCandidatos[modelIdx];
            const restanteMs = deadlineAt - Date.now();
            if (restanteMs < 2500) {
                console.warn(`⏱️ [GEMINI-LLM] Presupuesto total agotado (${Date.now() - startedAt}ms/${totalBudgetMs}ms) antes de probar ${modelName} (${keyTag}, ${detalleLedger}).`);
                break;
            }

            const hayFallbackModelo = modelIdx < modelosCandidatos.length - 1;
            const perAttemptTimeout = hayFallbackModelo
                ? Math.min(restanteMs, Math.max(12000, Math.round(totalBudgetMs * 0.70)))
                : restanteMs;

            const generationConfig = { temperature };
            if (responseSchema) {
                generationConfig.responseMimeType = 'application/json';
                generationConfig.responseSchema = responseSchema;
            }
            aplicarThinkingBudgetCeroSiFlash(generationConfig, modelName);

            const bodyPayload = {
                contents: [{ role: 'user', parts }],
                generationConfig
            };
            if (systemInstruction) {
                bodyPayload.systemInstruction = { parts: [{ text: systemInstruction }] };
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
            const tAttempt0 = Date.now();
            const timer = setTimeout(() => controller.abort(), perAttemptTimeout);
            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(bodyPayload),
                    signal: controller.signal
                });
                const elapsedMs = Date.now() - tAttempt0;
                if (!res.ok) {
                    const errTxt = await res.text().catch(() => '');
                    ultimoError = new Error(`Gemini (${modelName}) HTTP ${res.status}: ${errTxt.slice(0, 240)}`);
                    console.warn(`⚠️ [GEMINI-LLM] HTTP ${res.status} en ${modelName} (${keyTag}, ${elapsedMs}ms, ${detalleLedger}): ${errTxt.slice(0, 160).replace(/\s+/g, ' ')}`);
                    iaMonitor.registrarEventoIaSistema({
                        modulo: moduloLedger,
                        detalle: `${detalleLedger} (HTTP ${res.status})`,
                        modelo: modelName,
                        errorMsg: ultimoError.message
                    });
                    if (CODIGOS_HTTP_ROTACION_API_KEY.has(res.status)) {
                        rotarSiguienteKey = true;
                        break;
                    }
                    if (CODIGOS_HTTP_FALLBACK_MODELO.has(res.status)) continue;
                    break;
                }
                const data = await res.json();
                const metricas = iaMonitor.calcularMetricasTokens(data, modelName);
                const thoughtsTokens = Number(data?.usageMetadata?.thoughtsTokenCount || 0);
                _ultimoUsageGemini = {
                    modelName,
                    promptTokens: metricas.promptTokens,
                    completionTokens: metricas.outputTokens,
                    thoughtsTokens,
                    totalTokens: metricas.totalTokens,
                    costoUsd: metricas.costoUsd,
                    latencyMs: elapsedMs,
                    modulo: moduloLedger,
                    timestamp: Date.now()
                };
                iaMonitor.registrarEventoIaSistema({
                    modulo: moduloLedger,
                    detalle: detalleLedger,
                    rawResponseData: data,
                    modelo: modelName
                });
                const partsResp = data?.candidates?.[0]?.content?.parts || [];
                const partTexto = partsResp.find(p => typeof p.text === 'string' && !p.thought) || partsResp[0];
                return String(partTexto?.text || '').trim();
            } catch (err) {
                const elapsedMs = Date.now() - tAttempt0;
                const fueTimeout = err?.name === 'AbortError' || /aborted/i.test(String(err?.message || ''));
                const motivo = fueTimeout
                    ? `Timeout tras ${elapsedMs}ms (límite intento ${perAttemptTimeout}ms)`
                    : (err?.message || 'Error de conexión');
                ultimoError = new Error(`Gemini (${modelName}) ${motivo}`);
                console.warn(`⚠️ [GEMINI-LLM] Fallo en ${modelName} (${keyTag}, ${elapsedMs}ms, ${detalleLedger}): ${motivo}`);
                // Ante timeout o error de red nunca rotar a GEMINI_API_KEY_BACKUP; solo probar modelo fallback si queda margen en deadlineAt.
            } finally {
                clearTimeout(timer);
            }
        }

        if (!rotarSiguienteKey) break;
    }
    throw ultimoError || new Error('Error invocando Gemini.');
}

/**
 * 🎙️ AGENTE OÍDO MULTIMODAL (Imputado al rubro AUDIOS en ia_credito_ledger.json)
 */
async function transcribirAudioOggConGemini(audioBuffer, mimeType = 'audio/ogg', detalleOrigen = 'Transcripción Audio WA') {
    if (!audioBuffer || audioBuffer.length < 32) {
        throw new Error('Buffer de audio vacío.');
    }
    const rawMime = String(mimeType || 'audio/ogg').split(';')[0].trim().toLowerCase() || 'audio/ogg';
    const candidatosMime = (rawMime === 'audio/webm' || rawMime === 'application/octet-stream')
        ? ['audio/ogg', 'video/webm']
        : [rawMime, 'audio/ogg', 'video/webm'];

    const audioBase64 = Buffer.from(audioBuffer).toString('base64');
    const systemPrompt = [
        'Sos el transcriptor experto en español argentino (rioplatense) de LAMDA, distribuidora mayorista de frutos secos, frutas disecadas, frutas glaseadas/escurridas (abrillantadas), cereales, semillas, legumbres, mixes, granolas y barritas.',
        'Escuchá el audio y devolvé ÚNICAMENTE la transcripción exacta en texto plano de lo que dice la persona, sin agregar comentarios ni introducciones.',
        'Prestá especial atención a términos del rubro e instrucciones operativas: higos turcos, higos negros, damasco turco, castañas de cajú, castañas tostadas sin sal, castañas tostadas y saladas, avellanas, almendras Non Pareil / Guara, nueces mariposa / Chandler, fruta abrillantada/escurrida, pasas de uva Flame / Sultanina / Jumbo, arándanos, dátiles, ciruelas Presidente, azúcar mascabo, mixes, granolas, barritas, fracciones chicas, por 1kg/2kg/5kg/10kg, PDF adjunto, lista de precios, transferencia, comprobante, cuenta corriente.'
    ].join(' ');

    const audioStartedAt = Date.now();
    const audioDeadlineMs = 24000;
    let ultimoErr = null;
    for (const mimeIntento of candidatosMime) {
        const restanteAudioMs = audioDeadlineMs - (Date.now() - audioStartedAt);
        if (restanteAudioMs < 4000) break;
        try {
            const texto = await invocarGemini25Flash({
                systemInstruction: systemPrompt,
                parts: [
                    { inlineData: { mimeType: mimeIntento, data: audioBase64 } },
                    { text: 'Transcribí exactamente este mensaje de voz en español argentino.' }
                ],
                temperature: 0.05,
                timeoutMs: Math.min(22000, restanteAudioMs),
                moduloLedger: 'AUDIOS',
                detalleLedger: detalleOrigen
            });
            const limpio = String(texto || '').replace(/^["'«»]+|["'«»]+$/g, '').trim();
            if (limpio) return limpio;
        } catch (err) {
            ultimoErr = err;
            const msgErr = String(err?.message || '');
            // Solo probar otro MIME ante rechazo de formato/payload (ej. HTTP 400), no multiplicar timeouts o errores de auth/cuota
            if (/Timeout|aborted|HTTP\s*(401|402|403|429)/i.test(msgErr)) break;
        }
    }
    if (ultimoErr) throw ultimoErr;
    return '';
}

/**
 * 👁️ AGENTE VISIÓN MULTIMODAL:
 * Analiza una imagen enviada en el chat (comprobante de transferencia, depósito, cheque o foto de mercadería)
 * y extrae datos estructurados para conciliar sin abrir el celular.
 */
async function leerComprobanteImagenConGemini({ imageBuffer, mimeType = 'image/jpeg', contextoCliente = '' } = {}) {
    if (!imageBuffer || imageBuffer.length < 32) {
        throw new Error('Imagen vacía o inválida para analizar.');
    }
    const cleanMime = String(mimeType || 'image/jpeg').split(';')[0].trim().toLowerCase();
    const mimeFinal = /^image\/(jpeg|jpg|png|webp|gif)$/i.test(cleanMime)
        ? (cleanMime === 'image/jpg' ? 'image/jpeg' : cleanMime)
        : 'image/jpeg';
    const imageBase64 = Buffer.from(imageBuffer).toString('base64');

    const systemInstruction = [
        'Sos el analista visual administrativo de LAMDA (distribuidora mayorista en Argentina).',
        'Inspeccioná la imagen adjunta (habitualmente un comprobante bancario, Mercado Pago, transferencia, depósito, cheque o foto de mercadería) y extraé con precisión absoluta los campos visibles.',
        'Reglas estrictas:',
        '1. JAMÁS inventes dígitos, fechas ni importes que no sean legibles en la imagen. Si un campo no aparece, devolvé "" (o 0 en importe).',
        '2. En "importe" devolvé el número decimal exacto en formato numérico (ej: 254904.92 para "$ 254.904,92").',
        '3. En "resumen_corto" redactá 1 línea clara en español argentino sin signos "¿" ni "¡" (ej: "Transferencia Banco Galicia por $254.904,92 del 19/11 (Op. 849201) - Titular: Sopresatta SRL").'
    ].join('\n');

    const responseSchema = {
        type: 'OBJECT',
        properties: {
            es_comprobante_pago: { type: 'BOOLEAN' },
            tipo_documento: {
                type: 'STRING',
                description: 'TRANSFERENCIA, DEPOSITO, CHEQUE, MERCADO_PAGO, FACTURA, FOTO_MERCADERIA, OTRO'
            },
            banco: { type: 'STRING', description: 'Banco o billetera origen/emisora (ej: Banco Galicia, Mercado Pago, Banco Provincia)' },
            fecha: { type: 'STRING', description: 'Fecha visible del comprobante (ej: 19/11/2026 o 19/11/2026 14:32)' },
            importe: { type: 'NUMBER', description: 'Importe numérico exacto (0 si no aplica)' },
            moneda: { type: 'STRING', description: 'ARS o USD' },
            nro_operacion: { type: 'STRING', description: 'Número de operación, COELSA ID o referencia visible' },
            cuit_titular: { type: 'STRING', description: 'CUIT/CUIL visible del pagador o titular' },
            titular_origen: { type: 'STRING', description: 'Nombre o razón social de quien envía el pago' },
            destinatario: { type: 'STRING', description: 'Cuenta o titular destinatario visible' },
            observaciones: { type: 'STRING', description: 'Detalle adicional breve si hay foto de mercadería, reclamo o leyenda relevante' },
            resumen_corto: { type: 'STRING', description: 'Resumen conciso en 1 sola línea para mostrar en el chat y en el Copiloto' }
        },
        required: [
            'es_comprobante_pago',
            'tipo_documento',
            'banco',
            'fecha',
            'importe',
            'moneda',
            'nro_operacion',
            'cuit_titular',
            'titular_origen',
            'destinatario',
            'observaciones',
            'resumen_corto'
        ]
    };

    const rawText = await invocarGemini25Flash({
        systemInstruction,
        parts: [
            { inlineData: { mimeType: mimeFinal, data: imageBase64 } },
            { text: `Analizá esta imagen del chat${contextoCliente ? ` (cliente: ${contextoCliente})` : ''} y devolvé el JSON estructurado.` }
        ],
        responseSchema,
        temperature: 0.05,
        timeoutMs: 24000,
        moduloLedger: 'COMERCIAL_CRM',
        detalleLedger: 'Visión Comprobante / Imagen'
    });

    const parsed = JSON.parse(rawText);
    return {
        es_comprobante_pago: Boolean(parsed.es_comprobante_pago),
        tipo_documento: String(parsed.tipo_documento || 'OTRO').trim().toUpperCase(),
        banco: String(parsed.banco || '').trim(),
        fecha: String(parsed.fecha || '').trim(),
        importe: Number(parsed.importe || 0),
        moneda: String(parsed.moneda || 'ARS').trim().toUpperCase(),
        nro_operacion: String(parsed.nro_operacion || '').trim(),
        cuit_titular: String(parsed.cuit_titular || '').trim(),
        titular_origen: String(parsed.titular_origen || '').trim(),
        destinatario: String(parsed.destinatario || '').trim(),
        observaciones: aplicarClavijasTextoDeterministaWa(parsed.observaciones || ''),
        resumen_corto: aplicarClavijasTextoDeterministaWa(parsed.resumen_corto || 'Imagen analizada'),
        _usage: _ultimoUsageGemini || null
    };
}

/**
 * Clasificador liviano de Carril y Agente Especialista cuando agenteObjetivo === 'AUTO'
 */
function resolverCarrilYAgenteEspecialista({
    carrilSolicitado = '',
    agenteObjetivo = 'AUTO',
    mensajesRecientes = [],
    estadoCuentaDeterminista = {},
    contextoLogistico = {},
    diasSinCompra = null,
    comprobanteLeido = null,
    rolOperativo = null
}) {
    const arrMsgs = Array.isArray(mensajesRecientes) ? mensajesRecientes : [];
    const ultMsg = arrMsgs.length > 0 ? arrMsgs[arrMsgs.length - 1] : null;
    const ultEntrantes = arrMsgs.filter(m => !m.from_me).slice(-3);
    const txtEntranteNorm = ultEntrantes
        .map(m => String(m.cuerpo || ''))
        .join(' ')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    const objNorm = String(agenteObjetivo || 'AUTO').trim().toUpperCase();
    let carril = String(carrilSolicitado || '').trim().toUpperCase();

    // Si el operador eligió explícitamente un especialista, respetar su carril automáticamente
    if (CARRILES_AGENTES_WA.ENTRANTE.includes(objNorm)) {
        return { carril: 'ENTRANTE', agente: objNorm };
    }
    if (CARRILES_AGENTES_WA.SALIENTE.includes(objNorm)) {
        return { carril: 'SALIENTE', agente: objNorm };
    }

    if (carril !== 'ENTRANTE' && carril !== 'SALIENTE') {
        carril = (ultMsg && !ultMsg.from_me) ? 'ENTRANTE' : 'SALIENTE';
    }

    if (carril === 'ENTRANTE') {
        // 1. Reclamo / devolución / diferencia en factura o mercadería
        if (/\b(reclamo|error\s+en|mal\s+estado|fe[oa]s?|vencid|hongos?|bichos?|devoluc|nota\s+de\s+credito|diferencia\s+en|falt[oó]|faltaron|me\s+cobraron\s+de\s+m[aá]s|vino\s+roto|vino\s+mal)\b/i.test(txtEntranteNorm)) {
            return { carril: 'ENTRANTE', agente: 'RECLAMO_DEVOLUCION' };
        }
        // 2. Cobranza / transferencia / comprobante / CBU / saldo
        if (comprobanteLeido?.es_comprobante_pago ||
            /\b(transfer|comprobante|cbu|alias|pagu[eé]|te\s+pas[eé]\s+el\s+pago|saldo|cuenta\s+corriente|cuanto\s+debo|cuanto\s+te\s+debo|efectivo|ensobrado|recibo|resumen\s+de\s+cuenta)\b/i.test(txtEntranteNorm) ||
            (estadoCuentaDeterminista?.tiene_saldo_a_favor && (estadoCuentaDeterminista?.pedidos_activos_en_curso || []).length > 0)) {
            return { carril: 'ENTRANTE', agente: 'COBRANZA_COMPROBANTES' };
        }
        // 3. Logística / entrega / camión / chofer / cuándo llega
        if (/\b(cuando\s+llega|a\s+que\s+hora\s+pasa|camion|chofer|reparto|hoja\s+de\s+ruta|salio\s+el\s+pedido|envio|entrega|llegan\s+hoy|pasan\s+hoy|estado\s+del\s+pedido|mi\s+pedido)\b/i.test(txtEntranteNorm)) {
            return { carril: 'ENTRANTE', agente: 'LOGISTICA_ENTREGAS' };
        }
        // 4. Default entrante comercial: Ventas / Cotizador
        return { carril: 'ENTRANTE', agente: 'VENTAS_COTIZADOR' };
    }

    // CARRIL SALIENTE (Proactivo)
    const saldo = Number(estadoCuentaDeterminista?.saldo_total || 0);
    const rolNoCobranza = rolOperativo === 'COMPRAS_PEDIDOS' || rolOperativo === 'RECEPCION_LOCAL';
    if (saldo > 100 && !rolNoCobranza) {
        return { carril: 'SALIENTE', agente: 'CUENTA_CORRIENTE' };
    }
    if (contextoLogistico?.entregado_reciente_48h) {
        return { carril: 'SALIENTE', agente: 'POST_ENTREGA' };
    }
    if (diasSinCompra !== null && Number(diasSinCompra) > 30) {
        return { carril: 'SALIENTE', agente: 'REACTIVACION_PORTAL' };
    }
    return { carril: 'SALIENTE', agente: 'SALUDO_PUNTUAL' };
}

/**
 * Construye el prompt corto, enfocado y libre de contradicciones para cada uno de los 8 especialistas
 * incorporando reglas de Trato Aprendido (apodoConfirmadoMartin), Teléfono Compartido y Rol Operativo.
 */
function construirPromptEspecialistaWa({
    carril,
    agente,
    apodoSugerido,
    apodoConfirmadoMartin = '',
    notaTrato = '',
    rolOperativo = null,
    esTelefonoCompartido = false,
    tipoAccesoPortal = '',
    aprobadorNombre = '',
    requiereValidacion4Digitos = false,
    yaHablamosHoy
}) {
    const tipoPortalNorm = String(tipoAccesoPortal || '').trim().toUpperCase();
    const esArmadorActivo = tipoPortalNorm === 'ENCARGADO_ARMADOR_PEDIDO';
    const esArmadorPendiente = tipoPortalNorm === 'ENCARGADO_ARMADOR_PENDIENTE';
    const esEmpleadoPortal = esArmadorActivo || esArmadorPendiente;
    const aprobTxt = String(aprobadorNombre || '').trim() || 'el titular';

    const reglaPortalBase = esArmadorActivo
        ? `- ACCESO PORTAL DE ESTE CONTACTO (ENCARGADO_ARMADOR_PEDIDO): Esta persona NO usa el Portal de Titular ni ve Cuenta Corriente. Tiene un LINK ESPECIAL DE ARMADOR DE PEDIDO para armar la lista de mercadería y mandársela a ${aprobTxt} para que la apruebe.${requiereValidacion4Digitos ? ' La 1ra vez le pedirá los últimos 4 dígitos de su celular.' : ''} Hablale de "tu link para armar el pedido" (para que después lo apruebe ${aprobTxt}). PROHIBIDO hablarle de "activar cuenta/clave del Portal", "Portal de Titular", saldos o Cuenta Corriente.`
        : (esArmadorPendiente
            ? `- ACCESO PORTAL DE ESTE CONTACTO (ENCARGADO_ARMADOR_PENDIENTE): Esta persona es empleado/encargado y todavía NO tiene habilitado su link especial de Armador de Pedido. PROHIBIDO prometerle un link abajo, PROHIBIDO pasar link o código de activación del Portal Titular y PROHIBIDO mencionar Cuenta Corriente. Dejá tipo_burbuja2_determinista="VACIA" (o "PRECIOS_SELECCIONADOS" si cotizás artículos puntuales).`
            : '- Respetá "tipo_acceso_portal" y "ya_ingreso_portal_anteriormente": si es TITULAR_INVITACION_INICIAL (false), hablá de "invitación para activar tu cuenta por primera vez en el portal"; si es TITULAR_ACTIVO (true), del "link del portal".');

    const reglasBase = [
        'Sos el copiloto comercial de Martín en el WhatsApp mayorista B2B de LAMDA (frutos secos, disecados, semillas, cereales, mixes, granolas y barritas).',
        'REGLAS INNEGOCIABLES:',
        '- Tono real de Martín: argentino rioplatense cercano, claro, humano y breve. CERO signos de apertura "¿" ni "¡".',
        '- PROHIBIDO usar la palabra "interés" o "intereses": siempre decir "financiación".',
        '- JAMÁS inventes precios de artículos ni montos de saldo: la Capa Determinista de LAMDA estampa precios exactos y links en Burbuja 2.',
        yaHablamosHoy
            ? '- YA HABLAMOS HOY con este cliente: NO vuelvas a saludar con "Hola X, buen día". Continuá directo al pie.'
            : '- Si abrís conversación hoy, usá el saludo acorde a la franja horaria de Argentina indicada.',
        reglaPortalBase,
        '- Si existe "instruccion_operador_prioritaria", obedecela con prioridad absoluta.',
        '- Cierre estilo Martín cuando corresponda Burbuja 3: "Cualquier cosa estamos atentos." o "Quedamos atentos por cualquier cosa." (evitá repetir siempre "escribime por acá").'
    ];

    if (apodoConfirmadoMartin) {
        reglasBase.push(`- TRATO CONFIRMADO POR MARTÍN: Martín llama a este interlocutor "${apodoConfirmadoMartin}". Usá SIEMPRE "${apodoConfirmadoMartin}" al dirigirte a esta persona e ignorá cualquier otro nombre histórico de agenda.${notaTrato ? ` Nota de trato: ${notaTrato}.` : ''}`);
    } else if (esTelefonoCompartido || rolOperativo === 'COMPARTIDO') {
        reglasBase.push('- TELÉFONO EMPRESARIAL COMPARTIDO: Varias personas operan esta misma línea. NO asumas un nombre de persona fijo al saludar (usá saludo neutro/plural como "Hola, cómo andan?" o "Buen día, cómo vienen?"), SALVO que alguien se haya presentado explícitamente por su nombre en los últimos 2 mensajes.');
    } else if (notaTrato) {
        reglasBase.push(`- NOTA DE TRATO DE MARTÍN: ${notaTrato}.`);
    }

    const esAgenteCobranza = agente === 'COBRANZA_COMPROBANTES' || agente === 'CUENTA_CORRIENTE';
    if (!esAgenteCobranza && (rolOperativo === 'COMPRAS_PEDIDOS' || rolOperativo === 'RECEPCION_LOCAL')) {
        reglasBase.push(`- ROL DEL INTERLOCUTOR (${rolOperativo}): Esta persona atiende compras/pedidos o recepción del local, NO maneja pagos ni cuenta corriente. JAMÁS menciones deuda, saldos pendientes ni cobranza en este mensaje.`);
    }

    const bloquesEspecialista = {
        // 📥 CARRIL ENTRANTE
        VENTAS_COTIZADOR: [
            'ESPECIALISTA ACTIVO: 📥 ENTRANTE · VENTAS_COTIZADOR.',
            '- Leé la intención completa y respetá exclusiones/negaciones ("el mix no" -> agregalo en "conceptos_excluidos" y JAMÁS lo pongas en "codigos_articulos_seleccionados").',
            '- Distinguí presentaciones chicas (1kg/2kg) vs. bultos cerrados (5kg/10kg+): si pidió fracciones chicas y existe 1kg/2kg en catálogo, NO pongas cajas de 10kg en "codigos_articulos_seleccionados" (máx. 6-8 códigos en cuerpo).',
            '- En "codigos_articulos_pdf_sugeridos" poné variantes relacionadas útiles para enviar en PDF adjunto prolijo y activá "sugerir_adjuntar_pdf": true si suma valor o lo pidió el operador.',
            '- Nunca elijas códigos internos ("PROD AP/UP Externo", "Caja MICRO").',
            esArmadorActivo
                ? `- Si corresponde pasar precios seleccionados usá tipo_burbuja2_determinista="PRECIOS_SELECCIONADOS"; si pidió lista general o armar pedido usá "LINK_PORTAL" y aclarale que ahí puede armar el pedido para que después lo apruebe ${aprobTxt}.`
                : (esArmadorPendiente
                    ? '- Si corresponde pasar precios seleccionados usá tipo_burbuja2_determinista="PRECIOS_SELECCIONADOS"; si no, dejá tipo_burbuja2_determinista="VACIA" (NUNCA uses "LINK_PORTAL" porque aún no tiene link de Armador habilitado).'
                    : '- Si corresponde pasar precios seleccionados usá tipo_burbuja2_determinista="PRECIOS_SELECCIONADOS"; si pidió lista general o portal usá "LINK_PORTAL".')
        ],
        COBRANZA_COMPROBANTES: [
            'ESPECIALISTA ACTIVO: 📥 ENTRANTE · COBRANZA_COMPROBANTES.',
            '- Apoyate estrictamente en "cuenta_corriente_determinista" (composicionSaldoService) y en "comprobante_leido" si se analizó una imagen.',
            '- Si el cliente envió comprobante o aviso de pago: agradecelo por su nombre, confirmá los datos leídos (banco/importe/fecha solo si figuran en comprobante_leido) sin inventar nada y aclarale que ya lo pasamos a administración para acreditar.',
            '- Si el cliente ya transfirió por adelantado con saldo a favor y tiene pedido activo ("pedidos_activos_en_curso"), ofrecele seguir su orden en vivo y usá tipo_burbuja2_determinista="LINK_SEGUIMIENTO_ORDEN".',
            '- Si pidió datos bancarios para transferir, incluí los datos exactos de "datos_bancarios_lamda" (Banco Galicia / CBU / Alias) o consultá si quiere el Extracto PDF ("sugerir_adjuntar_pdf_cc": true).',
            '- Si preguntó cuánto debe, respondé con claridad usando SOLO el saldo exacto de "cuenta_corriente_determinista" y sugerí "sugerir_adjuntar_pdf_cc": true.'
        ],
        LOGISTICA_ENTREGAS: [
            'ESPECIALISTA ACTIVO: 📥 ENTRANTE · LOGISTICA_ENTREGAS.',
            '- Respondé con certeza usando ÚNICAMENTE "contexto_logistico_determinista" (presupuesto #, estado_normalizado: EN_PREPARACION / EN_CAMINO / ENTREGADO / SIN_PEDIDO_ACTIVO, ruta, chofer, fecha_salida, fecha_entrega_real y receptor).',
            '- Si el estado es EN_CAMINO, informá que ya está en ruta (mencionando chofer/fecha solo si están cargados).',
            esEmpleadoPortal
                ? '- Si es EN_PREPARACION, informá que el pedido # está en armado/asignación y apenas salga le avisamos. Dejá tipo_burbuja2_determinista="VACIA" (NO ofrecer link de seguimiento de Portal Titular a un empleado).'
                : '- Si es EN_PREPARACION, informá que el pedido # está en armado/asignación y apenas salga le avisamos (ofreciendo "LINK_SEGUIMIENTO_ORDEN" si tiene Portal).',
            '- Si es ENTREGADO, confirmá fecha y receptor reales si figuran. JAMÁS inventes horarios de llegada ni nombres de chofer que no estén en los datos.'
        ],
        RECLAMO_DEVOLUCION: [
            'ESPECIALISTA ACTIVO: 📥 ENTRANTE · RECLAMO_DEVOLUCION.',
            '- Respuesta sobria, empática, profesional y serena (tono del Taller LAMDA que asume responsabilidad).',
            '- Acusá recibo concreto del inconveniente mencionado, pedí el dato faltante mínimo (lote/foto/cantidad si aún no la pasó) y transmití que lo revisamos de inmediato para resolverlo.',
            '- JAMÁS inventes montos de descuento, notas de crédito ni promesas monetarias no confirmadas.',
            '- Dejá tipo_burbuja2_determinista="VACIA", sugerir_adjuntar_pdf=false y habilitá "habilitar_gestion_factura": true.'
        ],
        // 📤 CARRIL SALIENTE
        CUENTA_CORRIENTE: [
            'ESPECIALISTA ACTIVO: 📤 SALIENTE · CUENTA_CORRIENTE.',
            '- Adaptá el tono exactamente al "tramo_real" de "cuenta_corriente_determinista":',
            '  * EN_TERMINO (<=7d): toque muy cordial y breve, recordando beneficio 5% (> $300k) y cuenta al día.',
            '  * GRACIA_NATURAL (8-14d): recordatorio amable mencionando que está cerrando el plazo habitual de cuenta corriente.',
            '  * COMODIN (15-21d): mensaje cercano pero claro detallando las facturas abiertas y consultando cómo prefieren organizarse para achicar el saldo.',
            '  * SALVAVIDAS_FINANCIADO (>21d): mensaje respetuoso, transparente y ordenado sobre el saldo pendiente y las condiciones de financiación (NUNCA digas "interés").',
            '- Mencioná las facturas abiertas reales de "capas_saldo" sin inventar cifras, y activá "sugerir_adjuntar_pdf_cc": true si tiene saldo > $100.'
        ],
        REACTIVACION_PORTAL: [
            'ESPECIALISTA ACTIVO: 📤 SALIENTE · REACTIVACION_PORTAL.',
            '- Anclate en los "articulos_habituales_cliente" reales (mencioná 1 o 2 productos que suele llevar con naturalidad) y en los "dias_sin_compra" sin sonar invasivo.',
            esArmadorActivo
                ? `- Usá tipo_burbuja2_determinista="LINK_PORTAL" y comentale con naturalidad que abajo le dejás su link para ir armando el pedido y mandárselo a ${aprobTxt} para que lo apruebe (jamás hables de clave/invitación ni Cuenta Corriente).`
                : (esArmadorPendiente
                    ? '- Como todavía no tiene link de Armador habilitado, preguntale con calidez cómo vienen de stock con sus habituales y qué necesitan reponer, dejando tipo_burbuja2_determinista="VACIA" (sin prometer link abajo).'
                    : '- Si "tipo_acceso_portal" es TITULAR_INVITACION_INICIAL ("ya_ingreso_portal_anteriormente" false), comentale que le dejás la invitación para activar por primera vez su acceso al Portal B2B y ver precios actualizados; si es TITULAR_ACTIVO (true), recordale que tiene los precios actualizados en el Portal B2B. En ambos casos usá tipo_burbuja2_determinista="LINK_PORTAL".')
        ],
        POST_ENTREGA: [
            'ESPECIALISTA ACTIVO: 📤 SALIENTE · POST_ENTREGA.',
            '- Chequeo breve y genuino apoyado en la mercadería entregada real ("contexto_logistico_determinista.ultimo_entregado.items", ej: preguntar si llegó todo bien con los productos que recibieron).',
            '- Si ya hubo conversación hoy ("ya_hablamos_hoy": true), NO repitas el saludo inicial.',
            '- Mantenelo corto (1 burbuja principal y tipo_burbuja2_determinista="VACIA", salvo que el operador pida sumar portal/PDF).'
        ],
        SALUDO_PUNTUAL: [
            'ESPECIALISTA ACTIVO: 📤 SALIENTE · SALUDO_PUNTUAL.',
            '- Redactá UNA SOLA burbuja bien corta y natural (1 a 2 líneas máx.) conectada al último tema real del historial (o a cómo vienen de stock esta semana si no hubo charla reciente).',
            '- PROHIBIDO usar frases clonadas genéricas. Dejá tipo_burbuja2_determinista="VACIA", burbuja3_cierre="" y sugerir_adjuntar_pdf=false.'
        ]
    };

    const bloque = bloquesEspecialista[agente] || bloquesEspecialista.VENTAS_COTIZADOR;
    return [...reglasBase, '', ...bloque].join('\n');
}

/**
 * 🧠 MOTOR COGNITIVO POR 2 CARRILES (Entrante / Saliente)
 */
async function razonarAsistenciaHibridaClienteWa({
    clienteNombre = '',
    contactoNombre = '',
    apodoSugerido = '',
    apodoConfirmadoMartin = '',
    notaTrato = '',
    rolOperativo = null,
    contactoCargo = '',
    esTelefonoCompartido = false,
    otrosContactosCliente = [],
    mensajesRecientes = [],
    catalogoCompacto = [],
    habitualesCliente = [],
    estadoCuentaDeterminista = {},
    contextoLogistico = {},
    diasSinCompra = null,
    linkPortalCliente = '',
    yaIngresoPortal = false,
    tipoAccesoPortal = '',
    aprobadorNombre = '',
    requiereValidacion4Digitos = false,
    instruccionOperador = '',
    carril = '',
    agenteObjetivo = 'AUTO',
    comprobanteLeido = null,
    forzarRecalculo = false
}) {
    const cred = obtenerModoCredencialGemini();
    if (!cred.disponible) {
        throw new Error('GEMINI_NO_CONFIGURADO: No se encontró GEMINI_API_KEY activa en el servidor.');
    }

    const rolNorm = rolOperativo ? String(rolOperativo).trim().toUpperCase() : null;
    const esCompartidoReal = Boolean(esTelefonoCompartido || rolNorm === 'COMPARTIDO');
    const apodoConfirmadoClean = String(apodoConfirmadoMartin || '').trim();
    const notaTratoClean = String(notaTrato || '').trim();
    const apodoEfectivo = apodoConfirmadoClean || (esCompartidoReal ? '' : String(apodoSugerido || '').trim());
    const tipoPortalNorm = String(tipoAccesoPortal || '').trim().toUpperCase()
        || ((rolNorm === 'COMPRAS_PEDIDOS' || rolNorm === 'RECEPCION_LOCAL')
            ? (linkPortalCliente ? 'ENCARGADO_ARMADOR_PEDIDO' : 'ENCARGADO_ARMADOR_PENDIENTE')
            : (yaIngresoPortal ? 'TITULAR_ACTIVO' : 'TITULAR_INVITACION_INICIAL'));
    const aprobadorClean = String(aprobadorNombre || '').trim();

    const { carril: carrilFinal, agente: agenteFinal } = resolverCarrilYAgenteEspecialista({
        carrilSolicitado: carril,
        agenteObjetivo,
        mensajesRecientes,
        estadoCuentaDeterminista,
        contextoLogistico,
        diasSinCompra,
        comprobanteLeido,
        rolOperativo: rolNorm
    });

    const ultMsg = mensajesRecientes.length > 0 ? mensajesRecientes[mensajesRecientes.length - 1] : null;
    const instClean = String(instruccionOperador || '').trim();
    const cacheKey = [
        clienteNombre,
        contactoNombre,
        rolNorm || '',
        tipoPortalNorm,
        aprobadorClean,
        apodoConfirmadoClean,
        notaTratoClean,
        carrilFinal,
        agenteFinal,
        ultMsg?.id || ultMsg?.msg_id || mensajesRecientes.length,
        String(ultMsg?.cuerpo || '').slice(0, 60),
        yaIngresoPortal ? 'P1' : 'P0',
        comprobanteLeido?.nro_operacion || '',
        instClean
    ].join('|');

    if (!forzarRecalculo && !instClean && _cacheRazonamientoHibrido.has(cacheKey)) {
        const cached = _cacheRazonamientoHibrido.get(cacheKey);
        if (Date.now() - cached.ts < 90000) {
            return cached.data;
        }
    }

    // Detectar si ya hubo conversación real hoy (fecha local Argentina)
    const hoyIsoAr = new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
    const yaHablamosHoy = mensajesRecientes.some(m => {
        if (!m || !m.from_me) return false;
        const rawF = m.fecha_mensaje || m.creado_en || m.fecha;
        if (!rawF) return false;
        try {
            const fAr = new Date(rawF).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
            const txt = String(m.cuerpo || '');
            const esAuto = /entrega confirmada|comprobante de pago recibido|extracto de cuenta corriente|su pedido #\d+ ha sido entregado/i.test(txt);
            return fAr === hoyIsoAr && !esAuto;
        } catch (_) {
            return false;
        }
    });

    const systemInstruction = construirPromptEspecialistaWa({
        carril: carrilFinal,
        agente: agenteFinal,
        apodoSugerido: apodoEfectivo,
        apodoConfirmadoMartin: apodoConfirmadoClean,
        notaTrato: notaTratoClean,
        rolOperativo: rolNorm,
        esTelefonoCompartido: esCompartidoReal,
        tipoAccesoPortal: tipoPortalNorm,
        aprobadorNombre: aprobadorClean,
        requiereValidacion4Digitos: Boolean(requiereValidacion4Digitos),
        yaHablamosHoy
    });

    const historialFormateado = mensajesRecientes.slice(-14).map(m => {
        const quien = m.from_me ? 'NOSOTROS (Martín/LAMDA)' : `CLIENTE (${apodoSugerido || contactoNombre || clienteNombre})`;
        const fecha = m.fecha_mensaje || m.creado_en || '';
        return `[${fecha}] ${quien}: ${String(m.cuerpo || '').replace(/\s+/g, ' ').trim()}`;
    }).join('\n');

    // Solo inyectar catálogo cuando el agente realmente lo necesita (ahorra tokens y mejora velocidad/foco)
    const necesitaCatalogo = agenteFinal === 'VENTAS_COTIZADOR' || agenteFinal === 'REACTIVACION_PORTAL' || instClean.length > 0;
    let catalogoComercialLimpio = [];
    if (necesitaCatalogo) {
        const catalogoFiltradoBase = (Array.isArray(catalogoCompacto) ? catalogoCompacto : [])
            .filter(c => !/^(?:PROD\s+(?:AP|UP)\s+Externo|Caja\s+MICRO|Bolsa\s+Polipropileno)/i.test(String(c?.nombre || '')));

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
            catalogoSeleccionPrompt = coincidencias.slice(0, 75);
        }
        if (catalogoSeleccionPrompt.length < 25) {
            const vistosCod = new Set(catalogoSeleccionPrompt.map(c => c.codigo));
            for (const item of catalogoFiltradoBase) {
                if (!vistosCod.has(item.codigo)) {
                    catalogoSeleccionPrompt.push(item);
                    vistosCod.add(item.codigo);
                }
                if (catalogoSeleccionPrompt.length >= 55) break;
            }
        }
        catalogoComercialLimpio = catalogoSeleccionPrompt
            .map(c => `${c.codigo} | ${c.nombre} | ${c.kilos_unidad || 1}kg | stock:${Number(c.stock_disponible || 0) > 0 ? c.stock_disponible : 0}`);
    }

    const habitualesLimpios = (Array.isArray(habitualesCliente) ? habitualesCliente : [])
        .slice(0, 12)
        .map(h => `${h.codigo || h.articulo_id || ''} | ${h.nombre || h.descripcion || ''}`);

    const ctxHorario = obtenerContextoHorarioArgentina();
    const payloadContexto = {
        carril_activo: carrilFinal,
        especialista_activo: agenteFinal,
        hora_local_argentina: `${ctxHorario.fechaHoraTxt} (${ctxHorario.franja} — saludo: "${ctxHorario.saludoObligatorio}")`,
        ya_hablamos_hoy: yaHablamosHoy,
        instruccion_operador_prioritaria: instClean || null,
        cliente: {
            razon_social: clienteNombre,
            contacto_agenda: contactoNombre,
            apodo_confianza: apodoEfectivo,
            apodo_confirmado_por_martin: apodoConfirmadoClean || null,
            nota_trato: notaTratoClean || null,
            rol_operativo: rolNorm || 'SIN_DEFINIR',
            cargo_agenda: contactoCargo || null,
            es_telefono_compartido: esCompartidoReal,
            otros_contactos_cliente: Array.isArray(otrosContactosCliente) && otrosContactosCliente.length > 0
                ? otrosContactosCliente.slice(0, 6).map(c => ({ nombre: c.contacto_nombre || c.nombre || '', rol: c.rol_operativo || c.contacto_cargo || '' }))
                : undefined,
            dias_sin_compra: diasSinCompra,
            tipo_acceso_portal: tipoPortalNorm,
            aprobador_pedido_nombre: aprobadorClean || null,
            link_portal_disponible: tipoPortalNorm !== 'ENCARGADO_ARMADOR_PENDIENTE' && Boolean(linkPortalCliente),
            ya_ingreso_portal_anteriormente: tipoPortalNorm === 'TITULAR_ACTIVO'
        },
        cuenta_corriente_determinista: estadoCuentaDeterminista,
        contexto_logistico_determinista: contextoLogistico || {},
        comprobante_leido: comprobanteLeido || null,
        datos_bancarios_lamda: (agenteFinal === 'COBRANZA_COMPROBANTES' || agenteFinal === 'CUENTA_CORRIENTE') ? DATOS_BANCARIOS_LAMDA : undefined,
        articulos_habituales_cliente: habitualesLimpios,
        historial_reciente_whatsapp: historialFormateado,
        catalogo_bunker_codigo_nombre_kg_stock: catalogoComercialLimpio.length > 0 ? catalogoComercialLimpio : undefined
    };

    const responseSchema = {
        type: 'OBJECT',
        properties: {
            situacion_dialogo: { type: 'STRING', description: 'Código breve de situación del chat' },
            titulo_intencion: { type: 'STRING', description: 'Título corto (máx 55 caracteres)' },
            explicacion_razonamiento: { type: 'STRING', description: 'Resumen breve (1 línea) para Martín de qué criterio aplicó el especialista' },
            modo_accion_sugerido: { type: 'STRING', description: 'Código del especialista o acción sugerida' },
            codigos_articulos_seleccionados: {
                type: 'ARRAY',
                items: { type: 'STRING' },
                description: 'Códigos exactos del catálogo para Burbuja 2 (vacío si no corresponde cotizar)'
            },
            codigos_articulos_pdf_sugeridos: {
                type: 'ARRAY',
                items: { type: 'STRING' },
                description: 'Códigos exactos sugeridos para PDF de precios (vacío si no aplica)'
            },
            sugerir_adjuntar_pdf: { type: 'BOOLEAN', description: 'true si conviene adjuntar PDF de lista de precios' },
            sugerir_adjuntar_pdf_cc: { type: 'BOOLEAN', description: 'true si conviene adjuntar PDF de Extracto de Cuenta Corriente' },
            habilitar_gestion_factura: { type: 'BOOLEAN', description: 'true si corresponde habilitar acceso directo a Gestionar Factura / NC' },
            conceptos_excluidos: {
                type: 'ARRAY',
                items: { type: 'STRING' },
                description: 'Productos o términos que el cliente aclaró que NO quiere'
            },
            burbuja1_dialogo: {
                type: 'STRING',
                description: 'Burbuja 1 corta y natural en estilo Martín (sin ¿/¡, sin palabra interés, sin precios inventados)'
            },
            tipo_burbuja2_determinista: {
                type: 'STRING',
                description: 'PRECIOS_SELECCIONADOS, LINK_PORTAL, LINK_SEGUIMIENTO_ORDEN o VACIA'
            },
            burbuja3_cierre: {
                type: 'STRING',
                description: 'Cierre breve estilo Martín (vacío si es SALUDO_PUNTUAL o mensaje único corto)'
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
            'sugerir_adjuntar_pdf_cc',
            'habilitar_gestion_factura',
            'conceptos_excluidos',
            'burbuja1_dialogo',
            'tipo_burbuja2_determinista',
            'burbuja3_cierre'
        ]
    };

    const rawJsonText = await invocarGemini25Flash({
        systemInstruction,
        parts: [{ text: JSON.stringify(payloadContexto) }],
        responseSchema,
        temperature: 0.3,
        timeoutMs: 26000,
        moduloLedger: 'COMERCIAL_CRM',
        detalleLedger: `${carrilFinal} · ${agenteFinal}`
    });

    const parsed = JSON.parse(rawJsonText);

    // Clavijas deterministas por especialista (garantizan cumplimiento estricto de negocio)
    let tipoB2Final = String(parsed.tipo_burbuja2_determinista || 'VACIA').trim().toUpperCase();
    let b3Final = aplicarClavijasTextoDeterministaWa(parsed.burbuja3_cierre || '');
    let sugerirPdfFinal = Boolean(parsed.sugerir_adjuntar_pdf);
    let sugerirPdfCcFinal = Boolean(parsed.sugerir_adjuntar_pdf_cc);
    let habilitarGestionFacturaFinal = agenteFinal === 'RECLAMO_DEVOLUCION'
        || (Boolean(parsed.habilitar_gestion_factura) && /\b(nota\s+de\s+cr[eé]dito|nc\b|refactur|anular\s+factura|reclamo)\b/i.test(instClean));
    let codsSel = Array.isArray(parsed.codigos_articulos_seleccionados)
        ? parsed.codigos_articulos_seleccionados.map(c => String(c || '').trim()).filter(Boolean)
        : [];
    let codsPdf = Array.isArray(parsed.codigos_articulos_pdf_sugeridos)
        ? parsed.codigos_articulos_pdf_sugeridos.map(c => String(c || '').trim()).filter(Boolean)
        : [];

    if (agenteFinal === 'SALUDO_PUNTUAL' && !instClean) {
        tipoB2Final = 'VACIA';
        b3Final = '';
        sugerirPdfFinal = false;
        sugerirPdfCcFinal = false;
        codsSel = [];
        codsPdf = [];
    } else if (agenteFinal === 'RECLAMO_DEVOLUCION') {
        habilitarGestionFacturaFinal = true;
        if (!instClean) {
            tipoB2Final = 'VACIA';
            sugerirPdfFinal = false;
            codsSel = [];
        }
    } else if (agenteFinal === 'CUENTA_CORRIENTE' && Number(estadoCuentaDeterminista?.saldo_total || 0) > 100) {
        sugerirPdfCcFinal = true;
    }

    // Blindaje determinista de link Portal por Rol (cero fugas de link titular hacia empleados)
    if (tipoPortalNorm === 'ENCARGADO_ARMADOR_PENDIENTE' && (tipoB2Final === 'LINK_PORTAL' || tipoB2Final === 'LINK_SEGUIMIENTO_ORDEN')) {
        tipoB2Final = 'VACIA';
    } else if (tipoPortalNorm === 'ENCARGADO_ARMADOR_PEDIDO' && tipoB2Final === 'LINK_SEGUIMIENTO_ORDEN') {
        tipoB2Final = 'VACIA';
    }

    const resultadoBlindado = {
        usando_ia_real: true,
        modo_credencial: cred.modo,
        carril_utilizado: carrilFinal,
        agente_utilizado: agenteFinal,
        tipo_acceso_portal: tipoPortalNorm,
        _usage: _ultimoUsageGemini || null,
        situacion_dialogo: String(parsed.situacion_dialogo || agenteFinal).trim(),
        titulo_intencion: aplicarClavijasTextoDeterministaWa(parsed.titulo_intencion || ''),
        explicacion_razonamiento: aplicarClavijasTextoDeterministaWa(parsed.explicacion_razonamiento || ''),
        modo_accion_sugerido: String(parsed.modo_accion_sugerido || agenteFinal).trim(),
        codigos_articulos_seleccionados: codsSel,
        codigos_articulos_pdf_sugeridos: codsPdf,
        sugerir_adjuntar_pdf: sugerirPdfFinal,
        sugerir_adjuntar_pdf_cc: sugerirPdfCcFinal,
        habilitar_gestion_factura: habilitarGestionFacturaFinal,
        conceptos_excluidos: Array.isArray(parsed.conceptos_excluidos)
            ? parsed.conceptos_excluidos.map(c => String(c || '').trim().toLowerCase()).filter(Boolean)
            : [],
        burbuja1_dialogo: aplicarClavijasTextoDeterministaWa(parsed.burbuja1_dialogo || ''),
        tipo_burbuja2_determinista: tipoB2Final,
        burbuja3_cierre: b3Final
    };

    _cacheRazonamientoHibrido.set(cacheKey, { ts: Date.now(), data: resultadoBlindado });
    return resultadoBlindado;
}

module.exports = {
    CARRILES_AGENTES_WA,
    DATOS_BANCARIOS_LAMDA,
    obtenerModoCredencialGemini,
    aplicarClavijasTextoDeterministaWa,
    transcribirAudioOggConGemini,
    leerComprobanteImagenConGemini,
    resolverCarrilYAgenteEspecialista,
    razonarAsistenciaHibridaClienteWa
};
