const memoryCache = new Map();

/**
 * Obtiene datos en caché si no han expirado el TTL.
 * @param {string} key - Clave única de la consulta.
 * @returns {any|null} - Retorna los datos o null si expiró / no existe.
 */
export function getCache(key) {
  const cached = memoryCache.get(key);
  if (!cached) {
    try {
      const stored = sessionStorage.getItem(`b2b_cache_v2_${key}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Date.now() < parsed.expiry) {
          memoryCache.set(key, parsed);
          return parsed.data;
        } else {
          sessionStorage.removeItem(`b2b_cache_v2_${key}`);
        }
      }
    } catch (e) {
      console.warn('Cache read error:', e);
    }
    return null;
  }

  if (Date.now() > cached.expiry) {
    memoryCache.delete(key);
    try {
      sessionStorage.removeItem(`b2b_cache_${key}`);
    } catch (e) {}
    return null;
  }

  return cached.data;
}

/**
 * Guarda datos en caché con un tiempo de vida (TTL) en segundos.
 * @param {string} key - Clave de la consulta.
 * @param {any} data - Datos a guardar.
 * @param {number} ttlSeconds - Tiempo de vida en segundos (predeterminado: 300s / 5 min).
 */
export function setCache(key, data, ttlSeconds = 300) {
  const expiry = Date.now() + (ttlSeconds * 1000);
  const cacheObj = { data, expiry };
  memoryCache.set(key, cacheObj);
  try {
    sessionStorage.setItem(`b2b_cache_v2_${key}`, JSON.stringify(cacheObj));
  } catch (e) {
    console.warn('Cache write error:', e);
  }
}

/**
 * Invalida una clave específica o limpia todo el caché.
 * @param {string} [key] - Clave opcional. Si no se indica, borra todo.
 */
export function invalidateCache(key) {
  if (key) {
    memoryCache.delete(key);
    try {
      sessionStorage.removeItem(`b2b_cache_${key}`);
    } catch (e) {}
  } else {
    memoryCache.clear();
    try {
      Object.keys(sessionStorage).forEach(k => {
        if (k.startsWith('b2b_cache_v2_')) {
          sessionStorage.removeItem(k);
        }
      });
    } catch (e) {}
  }
}
