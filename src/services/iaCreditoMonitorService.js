/**
 * Servicio Centralizado de Monitoreo de Crédito y Consumo de Tokens IA (Sistema LAMDA)
 * Unifica el registro de consumo de todos los módulos que utilizan Gemini:
 *  1. Facturación y Cuentas Bancarias (Conciliación de extractos Home Banking)
 *  2. Producción y Recepción de Lotes (Re-Ranker semántico de ofertas de proveedores)
 *  3. Transcripción Multimodal de Audios (Clientes Búnker)
 *  4. Asistente Comercial Híbrido (CRM / Atención a clientes)
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const LEDGER_FILE = path.join(DATA_DIR, 'ia_credito_ledger.json');
const PUBLIC_TEMP_DIR = path.join(ROOT_DIR, 'src/app-etiquetas/temp');
const PUBLIC_LEDGER_FILE = path.join(PUBLIC_TEMP_DIR, 'ia_credito_ledger.json');

// Precios de referencia Gemini Flash (USD por 1M de tokens)
const PRECIO_INPUT_POR_MILLON = 0.15;
const PRECIO_OUTPUT_POR_MILLON = 0.60;

/**
 * Lee en caliente GEMINI_API_KEY y GEMINI_MODEL desde el archivo .env en la raíz del proyecto
 * para que ningún módulo (3000, 3002, 3004, 3005) quede con credenciales viejas en caché.
 */
function leerCredencialesGeminiEnCaliente() {
    let key = '';
    let model = '';
    try {
        const envPath = path.join(ROOT_DIR, '.env');
        if (fs.existsSync(envPath)) {
            const raw = fs.readFileSync(envPath, 'utf8');
            const mKey = raw.match(/^\s*GEMINI_API_KEY\s*=\s*([^\r\n#]+)/m);
            if (mKey && mKey[1]) {
                key = mKey[1].trim().replace(/^['"]|['"]$/g, '');
                process.env.GEMINI_API_KEY = key;
            }
            const mModel = raw.match(/^\s*GEMINI_MODEL\s*=\s*([^\r\n#]+)/m);
            if (mModel && mModel[1]) {
                model = mModel[1].trim().replace(/^['"]|['"]$/g, '');
                process.env.GEMINI_MODEL = model;
            }
        }
    } catch (_) {}

    if (!key) key = String(process.env.GEMINI_API_KEY || '').trim();
    if (!model) model = String(process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();

    const disponible = Boolean(key && !key.includes('YOUR_GEMINI_API_KEY') && key.length > 15);
    return { apiKey: disponible ? key : '', model, disponible };
}

function asegurarDirectorioDatos() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        if (!fs.existsSync(PUBLIC_TEMP_DIR)) {
            fs.mkdirSync(PUBLIC_TEMP_DIR, { recursive: true });
        }
    } catch (_) {}
}

function leerLedgerDisco() {
    const hoyKey = new Date().toISOString().slice(0, 10);
    const base = {
        saldoInicialUsd: 9.99,
        fechaRecarga: '04/11/2026',
        recargaAutomatica: true,
        billingAccountId: '01B986-C7D7EB-F97B7A',
        tokensDesdeRecarga: 0,
        consumidoDesdeRecargaUsd: 0,
        llamadasDesdeRecarga: 0,
        hoyFecha: hoyKey,
        tokensHoy: 0,
        consumidoHoyUsd: 0,
        llamadasHoy: 0,
        estadoCuenta: 'OK',
        ultimoError: '',
        ultimaVerificacionEn: null,
        porModulo: {
            CUENTAS_BANCARIAS: { nombre: 'Cuentas Bancarias y Conciliación', tokens: 0, costoUsd: 0, llamadas: 0 },
            PRODUCCION_LOTES: { nombre: 'Producción / Recepción de Lotes', tokens: 0, costoUsd: 0, llamadas: 0 },
            COMERCIAL_CRM: { nombre: 'Asistente Comercial / CRM', tokens: 0, costoUsd: 0, llamadas: 0 },
            AUDIOS: { nombre: 'Transcripción de Audios', tokens: 0, costoUsd: 0, llamadas: 0 }
        },
        historialReciente: []
    };

    try {
        asegurarDirectorioDatos();
        if (fs.existsSync(LEDGER_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8'));
            const merged = { ...base, ...(parsed || {}) };
            merged.porModulo = { ...base.porModulo, ...(parsed?.porModulo || {}) };
            if (merged.hoyFecha !== hoyKey) {
                merged.hoyFecha = hoyKey;
                merged.tokensHoy = 0;
                merged.consumidoHoyUsd = 0;
                merged.llamadasHoy = 0;
            }
            return merged;
        }
    } catch (_) {}
    return base;
}

function guardarLedgerDisco(ledger) {
    try {
        asegurarDirectorioDatos();
        const jsonStr = JSON.stringify(ledger, null, 2);
        fs.writeFileSync(LEDGER_FILE, jsonStr, 'utf8');
        fs.writeFileSync(PUBLIC_LEDGER_FILE, jsonStr, 'utf8');
    } catch (_) {}
}

/**
 * Extrae el conteo de tokens y calcula el costo en USD a partir de la respuesta de Gemini
 */
function calcularMetricasTokens(rawResponseData, modelo = 'gemini-2.5-flash') {
    const usageMeta = rawResponseData?.usageMetadata || {};
    const promptTokens = Number(usageMeta.promptTokenCount || 0);
    const outputTokens = Number(usageMeta.candidatesTokenCount || 0) + Number(usageMeta.thoughtsTokenCount || 0);
    const totalTokens = Number(usageMeta.totalTokenCount || (promptTokens + outputTokens));
    const costoUsd = Number(((promptTokens / 1_000_000) * PRECIO_INPUT_POR_MILLON + (outputTokens / 1_000_000) * PRECIO_OUTPUT_POR_MILLON).toFixed(6));

    return {
        promptTokens,
        outputTokens,
        totalTokens,
        costoUsd,
        modelo
    };
}

/**
 * Registra en el archivo central cualquier consumo o error de cuota de cualquiera de los módulos del sistema
 */
function registrarEventoIaSistema({
    modulo = 'COMERCIAL_CRM',
    detalle = 'Consulta IA',
    rawResponseData = null,
    usageDirecto = null,
    modelo = 'gemini-2.5-flash',
    errorMsg = ''
}) {
    const ledger = leerLedgerDisco();
    if (errorMsg) {
        const errStr = String(errorMsg);
        if (errStr.includes('402') || errStr.toLowerCase().includes('prepayment credits are depleted') || errStr.toLowerCase().includes('quota')) {
            ledger.estadoCuenta = 'SIN_SALDO_402';
            ledger.ultimoError = errStr;
        }
        ledger.ultimaVerificacionEn = new Date().toISOString();
        guardarLedgerDisco(ledger);
        return { ledger, usage: null };
    }

    const usage = usageDirecto || calcularMetricasTokens(rawResponseData, modelo);
    const tokens = Number(usage.totalTokens || 0);
    const costo = Number(usage.costoUsd || 0);

    ledger.estadoCuenta = 'OK';
    ledger.ultimoError = '';
    ledger.ultimaVerificacionEn = new Date().toISOString();

    if (tokens > 0 || costo > 0) {
        ledger.tokensDesdeRecarga = Number(ledger.tokensDesdeRecarga || 0) + tokens;
        ledger.consumidoDesdeRecargaUsd = Number((Number(ledger.consumidoDesdeRecargaUsd || 0) + costo).toFixed(6));
        ledger.llamadasDesdeRecarga = Number(ledger.llamadasDesdeRecarga || 0) + 1;

        ledger.tokensHoy = Number(ledger.tokensHoy || 0) + tokens;
        ledger.consumidoHoyUsd = Number((Number(ledger.consumidoHoyUsd || 0) + costo).toFixed(6));
        ledger.llamadasHoy = Number(ledger.llamadasHoy || 0) + 1;

        const modKey = ledger.porModulo[modulo] ? modulo : 'COMERCIAL_CRM';
        ledger.porModulo[modKey].tokens = Number(ledger.porModulo[modKey].tokens || 0) + tokens;
        ledger.porModulo[modKey].costoUsd = Number((Number(ledger.porModulo[modKey].costoUsd || 0) + costo).toFixed(6));
        ledger.porModulo[modKey].llamadas = Number(ledger.porModulo[modKey].llamadas || 0) + 1;

        ledger.historialReciente = [
            {
                ts: new Date().toISOString(),
                hora: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                modulo: ledger.porModulo[modKey].nombre,
                detalle: String(detalle || 'Consulta IA').slice(0, 60),
                tokens,
                costoUsd: costo
            },
            ...(Array.isArray(ledger.historialReciente) ? ledger.historialReciente : [])
        ].slice(0, 40);
    }

    guardarLedgerDisco(ledger);
    return { ledger, usage };
}

module.exports = {
    leerCredencialesGeminiEnCaliente,
    leerLedgerDisco,
    guardarLedgerDisco,
    calcularMetricasTokens,
    registrarEventoIaSistema
};
