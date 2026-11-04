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
        this.headers = new Map(Object.entries(init.headers || {}));
    }
    async text() {
        return this._bodyText;
    }
    async json() {
        return JSON.parse(this._bodyText);
    }
};

/**
 * Realiza un fetch con reintentos, abort-timeout y fallback a caché en disco.
 * @param {string} url - URL a solicitar
 * @param {Object} options - Opciones de fetch (headers, etc.)
 * @param {number} retries - Número máximo de reintentos
 * @param {number} delay - Demora inicial en ms para backoff exponencial
 * @param {number} timeoutMs - Timeout en ms para cada intento
 * @returns {Promise<Response>} Retorna una respuesta compatible o lanza error
 */
async function supabaseFetch(url, options = {}, retries = 3, delay = 500, timeoutMs = 8000) {
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
                const statusText = response.statusText;
                console.warn(`⚠️ [Supabase Conn] HTTP ${response.status} (${statusText}) en intento ${attempt + 1}`);
                if (response.status >= 500 || response.status === 429) {
                    // Reintentar para errores de servidor o rate limits
                    if (attempt < retries) {
                        const backoff = delay * Math.pow(2, attempt);
                        console.log(`🔄 Reintentando en ${backoff}ms...`);
                        await new Promise(resolve => setTimeout(resolve, backoff));
                        continue;
                    }
                }
                // Si es un error 4xx que no sea 429, no reintentamos
                throw new Error(`HTTP ${response.status}: ${statusText}`);
            }
        } catch (err) {
            clearTimeout(timeoutId);
            const isTimeout = err.name === 'AbortError';
            console.error(`❌ [Supabase Conn] Error en intento ${attempt + 1}: ${isTimeout ? 'TIMEOUT' : err.message}`);
            
            if (attempt < retries) {
                const backoff = delay * Math.pow(2, attempt);
                console.log(`🔄 Reintentando en ${backoff}ms...`);
                await new Promise(resolve => setTimeout(resolve, backoff));
            } else {
                // Agotado los reintentos: intentar recuperar desde la caché local
                console.log(`🔌 [Supabase Fallback] Agotados reintentos. Buscando en caché local...`);
                if (fs.existsSync(cachePath)) {
                    try {
                        const cachedData = fs.readFileSync(cachePath, 'utf8');
                        console.log(`⚡ [Supabase Fallback] Servida exitosamente desde caché local offline`);
                        return new ResponseClass(cachedData, {
                            status: 200,
                            statusText: 'OK (Cached Fallback)',
                            headers: { 'Content-Type': 'application/json' }
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
    supabaseFetch
};
