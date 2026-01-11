/**
 * ============================================================================
 * MÓDULO: DATA FETCHER
 * ============================================================================
 * 
 * Módulo para obtener datos del historial de producción interna desde la API.
 * Maneja las llamadas HTTP, caché de datos y manejo de errores.
 * 
 * Funcionalidades:
 * - Obtener historial completo de producción
 * - Obtener producción por periodo (rango de fechas)
 * - Obtener jerarquía de rubros y subrubros
 * - Caché de datos para optimizar rendimiento
 * - Manejo robusto de errores
 * 
 * @author Sistema LAMDA
 * @version 1.0.0
 */

class DataFetcher {
    constructor() {
        this.baseUrl = '/api/produccion/informe';
        this.cache = new Map();
        this.cacheDuration = 5 * 60 * 1000; // 5 minutos
    }

    /**
     * Obtener historial completo de producción
     * 
     * @param {boolean} forceRefresh - Forzar actualización ignorando caché
     * @returns {Promise<Object>} Datos del historial
     */
    async obtenerHistorial(forceRefresh = false) {
        const cacheKey = 'historial-completo';
        
        console.log('📊 [DATA-FETCHER] Obteniendo historial completo...');
        
        // Verificar caché
        if (!forceRefresh && this.isCacheValid(cacheKey)) {
            console.log('💾 [DATA-FETCHER] Usando datos en caché');
            return this.cache.get(cacheKey).data;
        }
        
        try {
            const response = await fetch(`${this.baseUrl}/historial`);
            
            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Error al obtener historial');
            }
            
            // Guardar en caché
            this.setCache(cacheKey, result);
            
            console.log(`✅ [DATA-FETCHER] Historial obtenido: ${result.data.length} artículos`);
            
            return result;
            
        } catch (error) {
            console.error('❌ [DATA-FETCHER] Error al obtener historial:', error);
            throw error;
        }
    }

    /**
     * Obtener producción por periodo
     * 
     * @param {string} fechaInicio - Fecha de inicio (YYYY-MM-DD)
     * @param {string} fechaFin - Fecha de fin (YYYY-MM-DD)
     * @param {boolean} forceRefresh - Forzar actualización ignorando caché
     * @returns {Promise<Object>} Datos del periodo
     */
    async obtenerProduccionPorPeriodo(fechaInicio, fechaFin, forceRefresh = false) {
        const cacheKey = `periodo-${fechaInicio}-${fechaFin}`;
        
        console.log(`📊 [DATA-FETCHER] Obteniendo producción del periodo: ${fechaInicio} a ${fechaFin}`);
        
        // Validar fechas
        if (!fechaInicio || !fechaFin) {
            throw new Error('Se requieren fecha de inicio y fin');
        }
        
        // Verificar caché
        if (!forceRefresh && this.isCacheValid(cacheKey)) {
            console.log('💾 [DATA-FETCHER] Usando datos en caché');
            return this.cache.get(cacheKey).data;
        }
        
        try {
            const url = `${this.baseUrl}/periodo?fecha_inicio=${fechaInicio}&fecha_fin=${fechaFin}`;
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Error al obtener producción por periodo');
            }
            
            // Guardar en caché
            this.setCache(cacheKey, result);
            
            console.log(`✅ [DATA-FETCHER] Producción del periodo obtenida: ${result.data.length} artículos`);
            
            return result;
            
        } catch (error) {
            console.error('❌ [DATA-FETCHER] Error al obtener producción por periodo:', error);
            throw error;
        }
    }

    /**
     * Obtener jerarquía de rubros y subrubros
     * 
     * @param {boolean} forceRefresh - Forzar actualización ignorando caché
     * @returns {Promise<Object>} Jerarquía de categorías
     */
    async obtenerRubrosSubrubros(forceRefresh = false) {
        const cacheKey = 'rubros-subrubros';
        
        console.log('📊 [DATA-FETCHER] Obteniendo jerarquía de rubros y subrubros...');
        
        // Verificar caché
        if (!forceRefresh && this.isCacheValid(cacheKey)) {
            console.log('💾 [DATA-FETCHER] Usando datos en caché');
            return this.cache.get(cacheKey).data;
        }
        
        try {
            const response = await fetch(`${this.baseUrl}/rubros`);
            
            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Error al obtener rubros');
            }
            
            // Guardar en caché (más duración para datos estructurales)
            this.setCache(cacheKey, result, 15 * 60 * 1000); // 15 minutos
            
            console.log(`✅ [DATA-FETCHER] Jerarquía obtenida: ${result.data.length} rubros`);
            
            return result;
            
        } catch (error) {
            console.error('❌ [DATA-FETCHER] Error al obtener rubros:', error);
            throw error;
        }
    }

    /**
     * Obtener producción mensual
     * 
     * @param {boolean} forceRefresh - Forzar actualización ignorando caché
     * @returns {Promise<Object>} Producción agrupada por mes
     */
    async obtenerProduccionMensual(forceRefresh = false) {
        const cacheKey = 'produccion-mensual';
        
        console.log('📊 [DATA-FETCHER] Obteniendo producción mensual...');
        
        // Verificar caché
        if (!forceRefresh && this.isCacheValid(cacheKey)) {
            console.log('💾 [DATA-FETCHER] Usando datos en caché');
            return this.cache.get(cacheKey).data;
        }
        
        try {
            const response = await fetch(`${this.baseUrl}/mensual`);
            
            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Error al obtener producción mensual');
            }
            
            // Guardar en caché
            this.setCache(cacheKey, result);
            
            console.log(`✅ [DATA-FETCHER] Producción mensual obtenida: ${result.data.length} meses`);
            
            return result;
            
        } catch (error) {
            console.error('❌ [DATA-FETCHER] Error al obtener producción mensual:', error);
            throw error;
        }
    }

    /**
     * Verificar si el caché es válido
     * 
     * @param {string} key - Clave del caché
     * @returns {boolean} True si el caché es válido
     */
    isCacheValid(key) {
        if (!this.cache.has(key)) {
            return false;
        }
        
        const cached = this.cache.get(key);
        const now = Date.now();
        const isValid = (now - cached.timestamp) < cached.duration;
        
        if (!isValid) {
            console.log(`🗑️ [DATA-FETCHER] Caché expirado para: ${key}`);
            this.cache.delete(key);
        }
        
        return isValid;
    }

    /**
     * Guardar datos en caché
     * 
     * @param {string} key - Clave del caché
     * @param {Object} data - Datos a guardar
     * @param {number} duration - Duración del caché en ms (opcional)
     */
    setCache(key, data, duration = null) {
        this.cache.set(key, {
            data: data,
            timestamp: Date.now(),
            duration: duration || this.cacheDuration
        });
        
        console.log(`💾 [DATA-FETCHER] Datos guardados en caché: ${key}`);
    }

    /**
     * Limpiar todo el caché
     */
    clearCache() {
        this.cache.clear();
        console.log('🗑️ [DATA-FETCHER] Caché limpiado completamente');
    }

    /**
     * Limpiar caché específico
     * 
     * @param {string} key - Clave del caché a limpiar
     */
    clearCacheKey(key) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
            console.log(`🗑️ [DATA-FETCHER] Caché limpiado: ${key}`);
        }
    }
}

// Exportar para uso global
window.DataFetcher = DataFetcher;
