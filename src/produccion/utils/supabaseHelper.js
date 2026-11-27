const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Directorio de caché
const CACHE_DIR = path.join(__dirname, '..', 'cache', 'supabase');

// Asegurar que el directorio de caché existe
try {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
} catch (err) {
    console.error('❌ Error creando directorio de caché Supabase:', err);
}

function getCachePath(url) {
    const hash = crypto.createHash('sha256').update(url).digest('hex');
    return path.join(CACHE_DIR, `${hash}.json`);
}

// Clase de respuesta simulada para cuando no esté disponible global Response
const ResponseClass = typeof globalThis.Response !== 'undefined' ? globalThis.Response : class MockResponse {
    constructor(bodyText, init = {}) {
        this._bodyText = bodyText;
        this.status = init.status || 200;
        this.statusText = init.statusText || 'OK';
        this.ok = this.status >= 200 && this.status < 300;
        const rawHeaders = init.headers || {};
        this._headersLower = new Map();
        if (rawHeaders instanceof Map || typeof rawHeaders.forEach === 'function') {
            rawHeaders.forEach((v, k) => this._headersLower.set(String(k).toLowerCase(), String(v)));
        } else {
            for (const [k, v] of Object.entries(rawHeaders)) {
                this._headersLower.set(String(k).toLowerCase(), String(v));
            }
        }
        this.headers = {
            get: (name) => this._headersLower.get(String(name || '').toLowerCase()) ?? null,
            has: (name) => this._headersLower.has(String(name || '').toLowerCase())
        };
    }
    async text() {
        return this._bodyText;
    }
    async json() {
        return JSON.parse(this._bodyText);
    }
};

/**
 * Extrae los metadatos de contingencia/caché agregados por `supabaseFetch`.
 * @param {Response|Object} response - Respuesta HTTP o MockResponse
 * @returns {{ fromCache: boolean, cachedAt: string|null, reason: string|null }}
 */
function extraerMetaCacheSupabase(response) {
    if (!response || !response.headers) {
        return { fromCache: false, cachedAt: null, reason: null };
    }
    const getHeader = (name) => {
        if (typeof response.headers.get === 'function') {
            return response.headers.get(name) || response.headers.get(name.toLowerCase()) || null;
        }
        const target = name.toLowerCase();
        for (const [k, v] of Object.entries(response.headers)) {
            if (String(k).toLowerCase() === target) return v;
        }
        return null;
    };
    const cacheFlag = getHeader('x-lamda-supabase-cache');
    const cacheDate = getHeader('x-lamda-supabase-cache-date');
    const fallbackReason = getHeader('x-lamda-supabase-fallback-reason');
    return {
        fromCache: cacheFlag === 'HIT_FALLBACK',
        cachedAt: cacheDate || null,
        reason: fallbackReason || null
    };
}

const READONLY_SUPABASE_HOSTS = new Set([
    'wofttcnpipozwupmpuul.supabase.co'
]);

/**
 * Determina si una URL apunta a un host externo de Supabase de solo consulta.
 * @param {string} rawUrl
 * @returns {boolean}
 */
function esHostSupabaseSoloLectura(rawUrl) {
    const str = String(rawUrl || '').trim();
    if (!str) return false;
    try {
        const parsed = new URL(str);
        const host = parsed.hostname.toLowerCase();
        if (READONLY_SUPABASE_HOSTS.has(host)) return true;
        for (const protectedHost of READONLY_SUPABASE_HOSTS) {
            if (host.endsWith(`.${protectedHost}`)) return true;
        }
        return false;
    } catch (_) {
        const lower = str.toLowerCase();
        for (const protectedHost of READONLY_SUPABASE_HOSTS) {
            if (lower.includes(protectedHost)) return true;
        }
        return false;
    }
}

/**
 * Extrae el header X-HTTP-Method-Override si el caller intentara tunelizar escrituras sobre GET/POST.
 */
function extraerMetodoOverride(headers) {
    if (!headers) return null;
    if (typeof headers.get === 'function') {
        return headers.get('x-http-method-override') || headers.get('X-HTTP-Method-Override') || null;
    }
    if (typeof headers === 'object') {
        for (const [k, v] of Object.entries(headers)) {
            if (String(k).toLowerCase() === 'x-http-method-override' && v) {
                return String(v);
            }
        }
    }
    return null;
}

/**
 * Candado duro arquitectónico: bloquea inmediatamente antes de salir a red cualquier operación
 * distinta de GET o HEAD hacia wofttcnpipozwupmpuul.supabase.co (tanto en Producción como en Laboratorio).
 */
function assertSupabaseReadOnlyPolicy(url, options = {}) {
    const method = String((options && options.method) || 'GET').trim().toUpperCase();
    const overrideMethod = extraerMetodoOverride(options && options.headers);
    const overrideUpper = overrideMethod ? String(overrideMethod).trim().toUpperCase() : null;
    const esSoloLectura = esHostSupabaseSoloLectura(url);

    if (esSoloLectura) {
        const metodoProhibido = (method !== 'GET' && method !== 'HEAD')
            ? method
            : (overrideUpper && overrideUpper !== 'GET' && overrideUpper !== 'HEAD' ? `OVERRIDE:${overrideUpper}` : null);
        if (metodoProhibido) {
            const err = new Error(
                `🔒 [SUPABASE-READONLY-GUARD] Bloqueo duro: operación ${metodoProhibido} prohibida hacia origen externo de solo consulta (wofttcnpipozwupmpuul.supabase.co). Solo se permiten métodos GET/HEAD.`
            );
            err.code = 'SUPABASE_READONLY_VIOLATION';
            err.httpStatus = 403;
            err.statusCode = 403;
            err.noRetry = true;
            err.noCacheFallback = true;
            throw err;
        }
    }

    const isLab = String(process.env.DB_NAME || '').trim().toLowerCase() === 'etiquetas_pruebas'
        || String(process.env.LAMDA_MODO_LABORATORIO || '').trim().toLowerCase() === 'true';
    if (isLab && method !== 'GET' && method !== 'HEAD') {
        const err = new Error(`🔒 [SUPABASE-COSTOS-GUARD] Operación de escritura (${method}) hacia Supabase Costos/Lotes bloqueada en Modo Laboratorio.`);
        err.code = 'SUPABASE_LAB_READONLY_VIOLATION';
        err.httpStatus = 403;
        err.statusCode = 403;
        err.noRetry = true;
        err.noCacheFallback = true;
        throw err;
    }
}

/**
 * Realiza un fetch con reintentos, abort-timeout y fallback a caché en disco.
 * Los rechazos de autenticación/permisos (401/403) y otros 4xx (excepto 429)
 * NUNCA utilizan caché de respaldo para evitar enmascarar credenciales inválidas.
 * @param {string} url - URL a solicitar
 * @param {Object} options - Opciones de fetch (headers, etc.)
 * @param {number} retries - Número máximo de reintentos
 * @param {number} delay - Demora inicial en ms para backoff exponencial
 * @param {number} timeoutMs - Timeout en ms para cada intento
 * @returns {Promise<Response>} Retorna una respuesta compatible o lanza error
 */
async function supabaseFetch(url, options = {}, retries = 3, delay = 500, timeoutMs = 8000) {
    assertSupabaseReadOnlyPolicy(url, options);
    const cachePath = getCachePath(url);
    
    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        
        try {
            const fetchOptions = {
                ...options,
                signal: controller.signal
            };
            
            console.log(`📡 [Supabase Conn] Fetching (Intento ${attempt + 1}/${retries + 1}): ${url.substring(0, 100)}...`);
            const response = await fetch(url, fetchOptions);
            clearTimeout(timeoutId);
            
            if (response.ok) {
                // Leer el body como texto para guardarlo en la caché y poder clonarlo
                const textBody = await response.text();
                
                // Guardar en la caché asincrónicamente para no demorar la respuesta
                fs.writeFile(cachePath, textBody, 'utf8', (err) => {
                    if (err) console.error(`⚠️ [Supabase Cache] Error escribiendo caché para ${url.substring(0, 60)}:`, err);
                });
                
                // Retornar un objeto de respuesta compatible
                return new ResponseClass(textBody, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers
                });
            } else {
                const statusText = response.statusText || '';
                const errBodyText = await response.text().catch(() => '');
                let detailMsg = '';
                if (errBodyText) {
                    try {
                        const parsed = JSON.parse(errBodyText);
                        detailMsg = parsed?.message || parsed?.error || parsed?.hint || errBodyText;
                    } catch (_) {
                        detailMsg = errBodyText;
                    }
                    detailMsg = String(detailMsg).replace(/\s+/g, ' ').trim().slice(0, 240);
                }
                console.warn(`⚠️ [Supabase Conn] HTTP ${response.status} (${statusText}) en intento ${attempt + 1}`);

                if (response.status === 401 || response.status === 403) {
                    console.error(`🔒 [Supabase Auth] Rechazo HTTP ${response.status} (${statusText})${detailMsg ? ' — ' + detailMsg : ''}. Fallback a caché DESHABILITADO.`);
                    const authErr = new Error(`HTTP ${response.status} (${statusText})${detailMsg ? ': ' + detailMsg : ''}`);
                    authErr.statusCode = response.status;
                    authErr.httpStatus = response.status;
                    authErr.code = 'SUPABASE_AUTH_ERROR';
                    authErr.noRetry = true;
                    authErr.noCacheFallback = true;
                    throw authErr;
                }

                if (response.status >= 500 || response.status === 429) {
                    // Reintentar para errores de servidor o rate limits
                    if (attempt < retries) {
                        const backoff = delay * Math.pow(2, attempt);
                        console.log(`🔄 Reintentando en ${backoff}ms...`);
                        await new Promise(resolve => setTimeout(resolve, backoff));
                        continue;
                    }
                    const upstreamErr = new Error(`HTTP ${response.status}: ${statusText}${detailMsg ? ' - ' + detailMsg : ''}`);
                    upstreamErr.statusCode = response.status;
                    upstreamErr.httpStatus = response.status;
                    upstreamErr.code = 'SUPABASE_UPSTREAM_ERROR';
                    throw upstreamErr;
                }

                // Otros errores 4xx (no 429): no reintentar ni enmascarar con caché vieja
                const clientErr = new Error(`HTTP ${response.status}: ${statusText}${detailMsg ? ' - ' + detailMsg : ''}`);
                clientErr.statusCode = response.status;
                clientErr.httpStatus = response.status;
                clientErr.code = 'SUPABASE_CLIENT_ERROR';
                clientErr.noRetry = true;
                clientErr.noCacheFallback = true;
                throw clientErr;
            }
        } catch (err) {
            clearTimeout(timeoutId);
            const isTimeout = err.name === 'AbortError';
            console.error(`❌ [Supabase Conn] Error en intento ${attempt + 1}: ${isTimeout ? 'TIMEOUT' : err.message}`);
            
            if (err.noCacheFallback) {
                throw err;
            }

            if (attempt < retries && !err.noRetry) {
                const backoff = delay * Math.pow(2, attempt);
                console.log(`🔄 Reintentando en ${backoff}ms...`);
                await new Promise(resolve => setTimeout(resolve, backoff));
            } else {
                // Agotado los reintentos por caída real (5xx/429/timeout/red): intentar recuperar desde caché local de contingencia
                console.log(`🔌 [Supabase Fallback] Buscando en caché local...`);
                if (fs.existsSync(cachePath)) {
                    try {
                        const cachedData = fs.readFileSync(cachePath, 'utf8');
                        const stat = fs.statSync(cachePath);
                        const cachedAt = stat.mtime.toISOString();
                        const rawReason = isTimeout ? 'TIMEOUT' : (err.message || 'NETWORK_ERROR');
                        const reasonSanitized = String(rawReason).replace(/[^\x20-\x7E]+/g, ' ').trim().slice(0, 160) || 'NETWORK_ERROR';
                        console.log(`⚡ [Supabase Fallback] Servida desde caché local de contingencia (actualizada: ${cachedAt})`);
                        return new ResponseClass(cachedData, {
                            status: 200,
                            statusText: 'OK (Cached Fallback)',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-Lamda-Supabase-Cache': 'HIT_FALLBACK',
                                'X-Lamda-Supabase-Cache-Date': cachedAt,
                                'X-Lamda-Supabase-Fallback-Reason': reasonSanitized
                            }
                        });
                    } catch (readErr) {
                        console.error('❌ [Supabase Fallback] Error leyendo archivo de caché:', readErr);
                    }
                }
                // Si no hay caché, propagamos el error original
                throw err;
            }
        }
    }
}

module.exports = {
    supabaseFetch,
    extraerMetaCacheSupabase,
    assertSupabaseReadOnlyPolicy,
    esHostSupabaseSoloLectura,
    READONLY_SUPABASE_HOSTS
};
