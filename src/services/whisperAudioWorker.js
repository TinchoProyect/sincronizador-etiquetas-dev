/**
 * Worker dedicado en proceso separado (child_process.fork) para decodificación Ogg Opus + Whisper (@xenova/transformers).
 * Aísla completamente el uso intensivo de CPU de ONNX Runtime respecto del event loop HTTP de los servidores
 * de Facturación/WhatsApp (puerto 3004) y CRM/Etiquetas (puerto 3000), evitando cualquier bloqueo al enviar mensajes.
 */

const path = require('path');
const { pathToFileURL } = require('url');

let _whisperPipelinePromise = null;
let _oggDecoderModulePromise = null;

function compactarSilenciosPcm16k(pcm16k) {
    if (!pcm16k || pcm16k.length <= 16000 * 18) return pcm16k;
    const frameSize = 800; // 50ms a 16kHz
    const numFrames = Math.ceil(pcm16k.length / frameSize);
    const active = new Uint8Array(numFrames);
    const rmsThreshold = 0.0065;

    for (let f = 0; f < numFrames; f++) {
        const start = f * frameSize;
        const end = Math.min(pcm16k.length, start + frameSize);
        let sumSq = 0;
        for (let i = start; i < end; i++) {
            const v = pcm16k[i];
            sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / Math.max(1, end - start));
        if (rms >= rmsThreshold) {
            active[f] = 1;
        }
    }

    // Conservar 5 frames (250ms) de margen antes y después de cada segmento hablado
    const padFrames = 5;
    const keep = new Uint8Array(numFrames);
    for (let f = 0; f < numFrames; f++) {
        if (active[f]) {
            const from = Math.max(0, f - padFrames);
            const to = Math.min(numFrames - 1, f + padFrames);
            for (let k = from; k <= to; k++) keep[k] = 1;
        }
    }

    let keptFrames = 0;
    for (let f = 0; f < numFrames; f++) {
        if (keep[f]) keptFrames++;
    }
    if (keptFrames === 0 || keptFrames >= numFrames * 0.92) {
        return pcm16k;
    }

    const out = new Float32Array(keptFrames * frameSize);
    let writePos = 0;
    for (let f = 0; f < numFrames; f++) {
        if (!keep[f]) continue;
        const start = f * frameSize;
        const end = Math.min(pcm16k.length, start + frameSize);
        for (let i = start; i < end; i++) {
            out[writePos++] = pcm16k[i];
        }
    }
    return out.subarray(0, writePos);
}

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
            return compactarSilenciosPcm16k(new Float32Array(ch0));
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
        return compactarSilenciosPcm16k(pcm16k);
    } finally {
        try { decoder.free(); } catch (_) {}
    }
}

async function obtenerWhisperPipeline() {
    if (!_whisperPipelinePromise) {
        _whisperPipelinePromise = (async () => {
            const transformersPath = path.resolve(__dirname, '../../node_modules/@xenova/transformers/src/transformers.js');
            const { pipeline } = await import(pathToFileURL(transformersPath).href);
            console.log('🎙️ [WHISPER-WORKER] Inicializando motor de transcripción de voz (Xenova/whisper-small)...');
            const pipe = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small');
            console.log('✅ [WHISPER-WORKER] Motor de transcripción listo.');
            return pipe;
        })().catch((err) => {
            _whisperPipelinePromise = null;
            throw err;
        });
    }
    return _whisperPipelinePromise;
}

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

process.on('message', async (msg) => {
    if (!msg || !msg.jobId) return;
    const { jobId, oggBase64 } = msg;
    try {
        const oggBuffer = Buffer.from(String(oggBase64 || ''), 'base64');
        const pcm16k = await decodificarOggOpusAPcm16k(oggBuffer);
        const transcriber = await obtenerWhisperPipeline();
        const res = await transcriber(pcm16k, {
            language: 'spanish',
            task: 'transcribe',
            chunk_length_s: 30,
            stride_length_s: 5
        });
        const rawText = String(res?.text || '').trim();
        const texto = refinarTranscripcionRubroLamda(rawText);
        if (process.send) {
            process.send({ jobId, ok: true, texto });
        }
    } catch (err) {
        if (process.send) {
            process.send({ jobId, ok: false, error: err?.message || String(err) });
        }
    }
});
