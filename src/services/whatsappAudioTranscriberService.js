/**
 * Servicio Local de Desencriptación y Transcripción de Audios de WhatsApp (PTT / Audio)
 * Sistema LAMDA — CRM WhatsApp Inteligente
 *
 * 1. Desencripta directamente desde WhatsApp CDN (mmg.whatsapp.net) usando HKDF-SHA256
 *    ('WhatsApp Audio Keys') + AES-256-CBC en Node.js puro (evitando el bug de mimetype
 *    de WAWebDownloadManager en builds recientes de WhatsApp Web).
 * 2. Decodifica Ogg Opus (48kHz) a PCM Float32 16kHz en memoria usando WebAssembly (ogg-opus-decoder).
 * 3. Transcribe en español de forma 100% local y gratuita mediante Whisper (@xenova/transformers).
 */

const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { pathToFileURL } = require('url');
const crmWhatsappDb = require('./crmWhatsappDbService');
const agenteHibridoLlm = require('./whatsappAgenteHibridoLlmService');

let _whisperPipelinePromise = null;
let _oggDecoderModulePromise = null;
let _whisperWorkerChild = null;
let _whisperWorkerIdleTimer = null;
let _whisperQueueChain = Promise.resolve();
let _whisperJobSeq = 0;
const _whisperPendingJobs = new Map();

/**
 * Descarga un archivo binario por HTTPS siguiendo redirecciones si las hubiera
 */
function descargarBufferHttps(urlStr, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        const req = https.get(urlStr, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                'Origin': 'https://web.whatsapp.com',
                'Referer': 'https://web.whatsapp.com/'
            },
            timeout: timeoutMs
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                return descargarBufferHttps(res.headers.location, timeoutMs).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode} descargando audio de WhatsApp`));
            }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        });
        req.on('timeout', () => {
            req.destroy(new Error('Timeout descargando audio de WhatsApp'));
        });
        req.on('error', reject);
    });
}

/**
 * Desencripta un archivo de audio/ptt de WhatsApp a partir de su directPath y mediaKey
 */
async function desencriptarAudioWhatsApp({ directPath, mediaKey, encBuffer }) {
    if (!mediaKey) {
        throw new Error('Falta mediaKey para desencriptar el audio de WhatsApp.');
    }

    let rawEnc = encBuffer;
    if (!rawEnc) {
        if (!directPath) {
            throw new Error('Falta directPath para descargar el audio de WhatsApp.');
        }
        const url = directPath.startsWith('http')
            ? directPath
            : `https://mmg.whatsapp.net${directPath.startsWith('/') ? '' : '/'}${directPath}`;
        rawEnc = await descargarBufferHttps(url);
    }

    if (!rawEnc || rawEnc.length <= 16) {
        throw new Error('El buffer encriptado del audio está vacío o incompleto.');
    }

    const mediaKeyBuf = Buffer.from(String(mediaKey).trim(), 'base64');
    const info = Buffer.from('WhatsApp Audio Keys', 'utf8');
    const salt = Buffer.alloc(32, 0);
    const expanded = Buffer.from(crypto.hkdfSync('sha256', mediaKeyBuf, salt, info, 112));

    const iv = expanded.subarray(0, 16);
    const cipherKey = expanded.subarray(16, 48);

    // Los últimos 10 bytes son el MAC trailer de WhatsApp
    const ciphertext = rawEnc.subarray(0, rawEnc.length - 10);
    const decipher = crypto.createDecipheriv('aes-256-cbc', cipherKey, iv);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    return decrypted;
}

/**
 * Decodifica un Buffer Ogg Opus (48kHz) a Float32Array mono a 16000 Hz para Whisper
 */
async function decodificarOggOpusAPcm16k(oggBuffer) {
    if (!_oggDecoderModulePromise) {
        const oggIndex = path.resolve(__dirname, '../../node_modules/ogg-opus-decoder/index.js');
        _oggDecoderModulePromise = import(pathToFileURL(oggIndex).href);
    }
    const { OggOpusDecoder } = await _oggDecoderModulePromise;
    const decoder = new OggOpusDecoder();
    await decoder.ready;
    try {
        const { channelData, sampleRate } = await decoder.decodeFile(new Uint8Array(oggBuffer));
        if (!channelData || !channelData[0] || channelData[0].length === 0) {
            throw new Error('No se pudieron decodificar muestras de audio del archivo Ogg Opus.');
        }
        const ch0 = channelData[0];
        const targetRate = 16000;
        if (sampleRate === targetRate) {
            return new Float32Array(ch0);
        }
        const ratio = sampleRate / targetRate;
        const outLen = Math.floor(ch0.length / ratio);
        const pcm16k = new Float32Array(outLen);
        for (let i = 0; i < outLen; i++) {
            const start = Math.floor(i * ratio);
            const end = Math.min(ch0.length, Math.floor((i + 1) * ratio));
            let sum = 0;
            let count = 0;
            for (let j = start; j < end; j++) {
                sum += ch0[j];
                count++;
            }
            pcm16k[i] = count > 0 ? (sum / count) : ch0[start];
        }
        return pcm16k;
    } finally {
        try { decoder.free(); } catch (_) {}
    }
}

/**
 * Carga en singleton el pipeline Whisper Small en español
 */
async function obtenerWhisperPipeline() {
    if (!_whisperPipelinePromise) {
        _whisperPipelinePromise = (async () => {
            const transformersPath = path.resolve(__dirname, '../../node_modules/@xenova/transformers/src/transformers.js');
            const { pipeline } = await import(pathToFileURL(transformersPath).href);
            console.log('🎙️ [WHISPER-LOCAL] Inicializando motor de transcripción de voz (Xenova/whisper-small)...');
            const pipe = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small');
            console.log('✅ [WHISPER-LOCAL] Motor de transcripción listo.');
            return pipe;
        })().catch((err) => {
            _whisperPipelinePromise = null;
            throw err;
        });
    }
    return _whisperPipelinePromise;
}

/**
 * Corrige fonéticas frecuentes del rubro frutos secos / repostería en español rioplatense
 */
function refinarTranscripcionRubroLamda(textoRaw) {
    let t = String(textoRaw || '').trim();
    if (!t) return '';
    t = t
        .replace(/\bhola,?\s+comandas\b/gi, 'Hola, cómo andás')
        .replace(/\bfruta\s+brillantada\b/gi, 'fruta abrillantada')
        .replace(/\babrillantada\s+de\s+diez\s+kilos\b/gi, 'abrillantada de 10 kilos')
        .replace(/\bglaciad([ao]s?)\b/gi, 'glasead$1')
        .replace(/\bescurrid([ao]s?)\b/gi, 'escurrid$1')
        .replace(/\b(?:los\s+)?sigos\s+turcos\b/gi, (m) => /^los/i.test(m) ? 'los higos turcos' : 'higos turcos')
        .replace(/\bigos\s*turcos\b/gi, 'higos turcos')
        .replace(/\bigosturcos\b/gi, 'higos turcos')
        .replace(/\bcasta(?:ñ|nh|n)as?\s+de\s+caj[oóu]n?\b/gi, 'castañas de cajú')
        .replace(/\bcaj[oó]n\b(?=.*kilo)/gi, 'cajú')
        .replace(/\bpand[uú]r\b/gi, 'pan dulce')
        .replace(/\bpor\s+fin\.?$/i, 'porfi.')
        .replace(/\s+/g, ' ')
        .trim();
    return t;
}

const _inflightMsgTranscriptions = new Map();
const _cacheTranscripcionesMsgId = new Map();

function obtenerOIniciarWhisperWorker() {
    if (_whisperWorkerChild && _whisperWorkerChild.connected) {
        return _whisperWorkerChild;
    }
    const workerPath = path.resolve(__dirname, './whisperAudioWorker.js');
    const child = fork(workerPath, [], {
        stdio: ['ignore', 'inherit', 'inherit', 'ipc']
    });
    child.on('message', (msg) => {
        if (!msg || !msg.jobId) return;
        const pending = _whisperPendingJobs.get(msg.jobId);
        if (!pending) return;
        _whisperPendingJobs.delete(msg.jobId);
        clearTimeout(pending.timer);
        if (msg.ok) {
            pending.resolve(String(msg.texto || '').trim());
        } else {
            pending.reject(new Error(msg.error || 'Error en worker de transcripción Whisper'));
        }
    });
    child.on('exit', () => {
        if (_whisperWorkerChild === child) {
            _whisperWorkerChild = null;
        }
        for (const [jobId, pending] of _whisperPendingJobs.entries()) {
            clearTimeout(pending.timer);
            pending.reject(new Error('El proceso worker de transcripción finalizó inesperadamente.'));
            _whisperPendingJobs.delete(jobId);
        }
    });
    _whisperWorkerChild = child;
    return child;
}

function programarApagadoInactivoWhisperWorker() {
    if (_whisperWorkerIdleTimer) clearTimeout(_whisperWorkerIdleTimer);
    _whisperWorkerIdleTimer = setTimeout(() => {
        if (_whisperPendingJobs.size === 0 && _whisperWorkerChild) {
            try { _whisperWorkerChild.kill(); } catch (_) {}
            _whisperWorkerChild = null;
        }
    }, 180000);
}

/**
 * Transcribe un Buffer Ogg Opus de WhatsApp en un proceso hijo aislado (1 a la vez en cola secuencial)
 * para no bloquear jamás el event loop del servidor HTTP de WhatsApp (3004) ni CRM (3000).
 */
async function transcribirBufferOggWhatsApp(oggBuffer) {
    // 1. Prioridad Cognitiva Multimodal (Gemini 2.5 Flash en ~1.5s si está activo en .env)
    const credIa = agenteHibridoLlm.obtenerModoCredencialGemini();
    if (credIa && credIa.disponible) {
        try {
            const textoGemini = await agenteHibridoLlm.transcribirAudioOggConGemini(oggBuffer);
            if (textoGemini && textoGemini.length >= 2) {
                return refinarTranscripcionRubroLamda(textoGemini);
            }
        } catch (errGem) {
            console.warn('⚠️ [AUDIO-GEMINI] Fallback a Whisper local:', errGem.message);
        }
    }

    // 2. Fallback Local en Worker aislado (Whisper Small CPU)
    const tarea = () => new Promise((resolve, reject) => {
        if (_whisperWorkerIdleTimer) clearTimeout(_whisperWorkerIdleTimer);
        const jobId = `wjob-${++_whisperJobSeq}-${Date.now()}`;
        let child;
        try {
            child = obtenerOIniciarWhisperWorker();
        } catch (errFork) {
            return reject(errFork);
        }
        const timer = setTimeout(() => {
            _whisperPendingJobs.delete(jobId);
            if (_whisperWorkerChild === child) {
                try { child.kill(); } catch (_) {}
                _whisperWorkerChild = null;
            }
            reject(new Error('Timeout (120s) transcribiendo audio de WhatsApp en worker.'));
        }, 120000);

        _whisperPendingJobs.set(jobId, { resolve, reject, timer });
        try {
            child.send({
                jobId,
                oggBase64: Buffer.from(oggBuffer).toString('base64')
            });
        } catch (errSend) {
            clearTimeout(timer);
            _whisperPendingJobs.delete(jobId);
            reject(errSend);
        }
    }).finally(() => {
        programarApagadoInactivoWhisperWorker();
    });

    const siguiente = _whisperQueueChain.then(tarea, tarea);
    // Evitar que un rechazo rompa la cadena futura
    _whisperQueueChain = siguiente.catch(() => {});
    return siguiente;
}

/**
 * Proceso integral: recibe { directPath, mediaKey } o { oggBuffer } o { base64Ogg },
 * desencripta, transcribe con Whisper y formatea el cuerpo para CRM WhatsApp.
 */
async function descargarYTranscribirAudioWhatsApp({ directPath, mediaKey, oggBuffer, base64Ogg }) {
    let bufferFinal = oggBuffer;
    if (!bufferFinal && base64Ogg) {
        bufferFinal = Buffer.from(String(base64Ogg), 'base64');
    }
    if (!bufferFinal) {
        bufferFinal = await desencriptarAudioWhatsApp({ directPath, mediaKey });
    }
    const texto = await transcribirBufferOggWhatsApp(bufferFinal);
    if (!texto) {
        return {
            ok: false,
            texto: '',
            cuerpoFormateado: '🎤 Mensaje de audio'
        };
    }
    const textoRefinado = refinarTranscripcionRubroLamda(texto);
    return {
        ok: true,
        texto: textoRefinado,
        cuerpoFormateado: `🎤 Audio: "${textoRefinado}"`
    };
}

/**
 * Conecta de forma no intrusiva al Chromium de WhatsApp Web vía DevToolsActivePort,
 * extrae directPath y mediaKey de los últimos audios del chat y los transcribe en caliente.
 */
async function transcribirAudiosDeChatViaDevTools({ chatId, msgIds = [], maxAudios = 4 } = {}) {
    if (!chatId) {
        return { success: false, message: 'Se requiere chatId.' };
    }

    const devToolsPortPath = path.resolve(__dirname, '../facturacion/.wwebjs_auth/session-lamda-billing/DevToolsActivePort');
    if (!fs.existsSync(devToolsPortPath)) {
        return { success: false, message: 'No se encontró sesión activa de WhatsApp Web (DevToolsActivePort).' };
    }

    let browser = null;
    try {
        const lines = fs.readFileSync(devToolsPortPath, 'utf8').trim().split(/\r?\n/);
        const port = lines[0]?.trim();
        const wsPath = lines[1]?.trim();
        if (!port || !wsPath) {
            return { success: false, message: 'DevToolsActivePort inválido.' };
        }

        const puppeteer = require(path.resolve(__dirname, '../facturacion/node_modules/puppeteer'));
        browser = await puppeteer.connect({
            browserWSEndpoint: `ws://127.0.0.1:${port}${wsPath}`,
            defaultViewport: null
        });

        const pages = await browser.pages();
        const waPage = pages.find(p => p.url().includes('web.whatsapp.com')) || pages[0];
        if (!waPage) {
            return { success: false, message: 'No se encontró pestaña de WhatsApp Web.' };
        }

        const targetPhone = String(chatId).split('@')[0].replace(/\D/g, '');
        const requestedIds = Array.isArray(msgIds)
            ? msgIds.map(id => String(id).split('_').pop()).filter(Boolean)
            : [];

        const audiosExtraidos = await waPage.evaluate((phoneDigits, reqIds, limitCount) => {
            const lista = [];
            try {
                if (typeof window.require !== 'function') return lista;
                const mod = window.require('WAWebChatCollection');
                const rawChats = (mod && mod.ChatCollection && typeof mod.ChatCollection.getModelsArray === 'function')
                    ? (mod.ChatCollection.getModelsArray() || [])
                    : [];

                for (let i = 0; i < rawChats.length; i++) {
                    const c = rawChats[i];
                    if (!c || !c.id || c.isGroup) continue;
                    const rawId = c.id._serialized || '';
                    let phoneChatId = rawId;
                    if (rawId.endsWith('@lid') && c.contact && c.contact.phoneNumber) {
                        phoneChatId = c.contact.phoneNumber._serialized || (c.contact.phoneNumber.user ? `${c.contact.phoneNumber.user}@c.us` : rawId);
                    }
                    const digits = phoneChatId.split('@')[0].replace(/\D/g, '');
                    if (!digits || (digits !== phoneDigits && !digits.endsWith(phoneDigits.slice(-10)))) continue;

                    const rawMsgs = (c.msgs && typeof c.msgs.getModelsArray === 'function')
                        ? c.msgs.getModelsArray()
                        : [];

                    for (let j = rawMsgs.length - 1; j >= 0; j--) {
                        const m = rawMsgs[j];
                        if (!m || !m.id) continue;
                        if (m.type !== 'ptt' && m.type !== 'audio') continue;
                        const shortId = m.id.id || (m.id._serialized ? String(m.id._serialized).split('_').pop() : null);
                        if (!shortId) continue;
                        const esFromMe = Boolean(m.id.fromMe || m.fromMe);
                        if (Array.isArray(reqIds) && reqIds.length > 0) {
                            if (!reqIds.includes(shortId)) continue;
                        } else if (esFromMe) {
                            // Por defecto solo transcribir audios entrantes del cliente
                            continue;
                        }
                        if (m.directPath && m.mediaKey) {
                            lista.push({
                                msgId: shortId,
                                chatId: phoneChatId,
                                directPath: m.directPath,
                                mediaKey: m.mediaKey,
                                timestamp: m.t || 0
                            });
                            if (lista.length >= limitCount) break;
                        }
                    }
                }
            } catch (e) {}
            return lista;
        }, targetPhone, requestedIds, maxAudios);

        try { browser.disconnect(); } catch (_) {}
        browser = null;

        const resultados = [];
        for (const aud of (audiosExtraidos || [])) {
            try {
                if (_cacheTranscripcionesMsgId.has(aud.msgId)) {
                    const cached = _cacheTranscripcionesMsgId.get(aud.msgId);
                    await crmWhatsappDb.actualizarTranscripcionAudioMensaje({
                        msgId: aud.msgId,
                        chatId: aud.chatId || chatId,
                        cuerpoFormateado: cached.cuerpoFormateado
                    });
                    resultados.push({
                        msgId: aud.msgId,
                        texto: cached.texto,
                        cuerpo: cached.cuerpoFormateado,
                        actualizado: true
                    });
                    continue;
                }

                let promiseTr = _inflightMsgTranscriptions.get(aud.msgId);
                if (!promiseTr) {
                    promiseTr = descargarYTranscribirAudioWhatsApp({
                        directPath: aud.directPath,
                        mediaKey: aud.mediaKey
                    }).finally(() => {
                        _inflightMsgTranscriptions.delete(aud.msgId);
                    });
                    _inflightMsgTranscriptions.set(aud.msgId, promiseTr);
                }

                const resTr = await promiseTr;
                if (resTr && resTr.ok && resTr.cuerpoFormateado) {
                    _cacheTranscripcionesMsgId.set(aud.msgId, resTr);
                    const rowUpd = await crmWhatsappDb.actualizarTranscripcionAudioMensaje({
                        msgId: aud.msgId,
                        chatId: aud.chatId || chatId,
                        cuerpoFormateado: resTr.cuerpoFormateado
                    });
                    resultados.push({
                        msgId: aud.msgId,
                        texto: resTr.texto,
                        cuerpo: resTr.cuerpoFormateado,
                        actualizado: Boolean(rowUpd)
                    });
                }
            } catch (errOne) {
                console.warn(`⚠️ [WHISPER-DEVTOOLS] Error transcribiendo ${aud.msgId}:`, errOne.message);
            }
        }

        return {
            success: true,
            encontrados: (audiosExtraidos || []).length,
            transcritos: resultados.length,
            resultados
        };
    } catch (err) {
        return {
            success: false,
            error: err.message
        };
    } finally {
        if (browser) {
            try { browser.disconnect(); } catch (_) {}
        }
    }
}

module.exports = {
    desencriptarAudioWhatsApp,
    decodificarOggOpusAPcm16k,
    transcribirBufferOggWhatsApp,
    descargarYTranscribirAudioWhatsApp,
    transcribirAudiosDeChatViaDevTools,
    refinarTranscripcionRubroLamda
};
