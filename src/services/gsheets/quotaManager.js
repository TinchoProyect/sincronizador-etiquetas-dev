/**
 * GESTOR DE CUOTAS DE GOOGLE SHEETS
 * 
 * Controla la tasa de escrituras a Google Sheets para evitar exceder las cuotas:
 * - 100 escrituras por 100 segundos por usuario
 * - 500 solicitudes por 100 segundos por proyecto
 * 
 * Implementa:
 * - Rate limiting con espaciado de operaciones
 * - Reintentos automáticos con backoff exponencial
 * - Lotes controlados y secuenciales
 * - Seguimiento de uso de cuota
 */

console.log('[QUOTA-MANAGER] Inicializando gestor de cuotas...');

class QuotaManager {
    constructor() {
        // Configuración de cuotas (conservadora)
        this.config = {
            // Escrituras por minuto (conservador: 50 de 100 permitidos)
            maxWritesPerMinute: 50,
            // Milisegundos entre escrituras (1200ms = 50 escrituras/minuto)
            minDelayBetweenWrites: 1200,
            // Tamaño máximo de lote
            maxBatchSize: 10,
            // Reintentos máximos por operación
            maxRetries: 3,
            // Delay base para backoff exponencial (ms)
            baseRetryDelay: 2000,
            // Multiplicador para backoff exponencial
            retryMultiplier: 2
        };

        // Estado del gestor
        this.state = {
            writesInCurrentMinute: 0,
            currentMinuteStart: Date.now(),
            lastWriteTime: 0,
            totalWrites: 0,
            totalRetries: 0,
            quotaExceededCount: 0
        };

        console.log('[QUOTA-MANAGER] ✅ Configuración:', this.config);
    }

    /**
     * Esperar el delay necesario antes de la próxima escritura
     */
    async waitForNextSlot() {
        const now = Date.now();
        
        // Resetear contador si pasó un minuto
        if (now - this.state.currentMinuteStart >= 60000) {
            this.state.writesInCurrentMinute = 0;
            this.state.currentMinuteStart = now;
        }

        // Si alcanzamos el límite, esperar hasta el próximo minuto
        if (this.state.writesInCurrentMinute >= this.config.maxWritesPerMinute) {
            const waitTime = 60000 - (now - this.state.currentMinuteStart);
            if (waitTime > 0) {
                console.log(`[QUOTA-MANAGER] ⏳ Límite alcanzado (${this.state.writesInCurrentMinute}/${this.config.maxWritesPerMinute}), esperando ${Math.round(waitTime/1000)}s`);
                await this.sleep(waitTime);
                this.state.writesInCurrentMinute = 0;
                this.state.currentMinuteStart = Date.now();
            }
        }

        // Esperar el delay mínimo desde la última escritura
        const timeSinceLastWrite = now - this.state.lastWriteTime;
        if (timeSinceLastWrite < this.config.minDelayBetweenWrites) {
            const delayNeeded = this.config.minDelayBetweenWrites - timeSinceLastWrite;
            await this.sleep(delayNeeded);
        }

        // Registrar el slot usado
        this.state.writesInCurrentMinute++;
        this.state.totalWrites++;
        this.state.lastWriteTime = Date.now();
    }

    /**
     * Ejecutar operación de escritura con reintentos y manejo de cuota
     * @param {Function} operation - Función async que ejecuta la escritura
     * @param {string} operationName - Nombre descriptivo de la operación
     * @returns {Promise<any>} Resultado de la operación
     */
    async executeWrite(operation, operationName = 'write') {
        let lastError = null;
        
        for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
            try {
                // Esperar slot disponible antes de intentar
                await this.waitForNextSlot();
                
                // Ejecutar operación
                const result = await operation();
                
                // Operación exitosa
                if (attempt > 0) {
                    console.log(`[QUOTA-MANAGER] ✅ ${operationName} exitoso tras ${attempt} reintentos`);
                }
                
                return result;
                
            } catch (error) {
                lastError = error;
                
                // Verificar si es error de cuota excedida
                const isQuotaError = this.isQuotaExceededError(error);
                
                if (isQuotaError) {
                    this.state.quotaExceededCount++;
                    this.state.totalRetries++;
                    
                    if (attempt < this.config.maxRetries) {
                        const delay = this.calculateBackoffDelay(attempt);
                        console.log(`[QUOTA-MANAGER] ⚠️ Cuota excedida en ${operationName}, reintento ${attempt + 1}/${this.config.maxRetries} tras ${Math.round(delay/1000)}s`);
                        await this.sleep(delay);
                        continue;
                    } else {
                        console.error(`[QUOTA-MANAGER] ❌ ${operationName} falló tras ${this.config.maxRetries} reintentos por cuota excedida`);
                        throw new QuotaExceededError(
                            `Operación ${operationName} falló tras ${this.config.maxRetries} reintentos. La cuota de Google Sheets fue excedida. Intente nuevamente en unos minutos.`,
                            this.state
                        );
                    }
                } else {
                    // Error diferente, no reintentar
                    console.error(`[QUOTA-MANAGER] ❌ Error en ${operationName}:`, error.message);
                    throw error;
                }
            }
        }
        
        throw lastError;
    }

    /**
     * Verificar si un error es por cuota excedida
     */
    isQuotaExceededError(error) {
        if (!error) return false;
        
        const errorMessage = (error.message || '').toLowerCase();
        const errorCode = error.code;
        
        // Códigos y mensajes de cuota excedida de Google Sheets API
        return (
            errorCode === 429 ||
            errorCode === 403 ||
            errorMessage.includes('quota') ||
            errorMessage.includes('rate limit') ||
            errorMessage.includes('too many requests') ||
            errorMessage.includes('user rate limit exceeded') ||
            errorMessage.includes('resource has been exhausted')
        );
    }

    /**
     * Calcular delay para backoff exponencial
     */
    calculateBackoffDelay(attempt) {
        const exponentialDelay = this.config.baseRetryDelay * Math.pow(this.config.retryMultiplier, attempt);
        // Agregar jitter aleatorio (±20%) para evitar thundering herd
        const jitter = exponentialDelay * (0.8 + Math.random() * 0.4);
        return Math.min(jitter, 30000); // Máximo 30 segundos
    }

    /**
     * Sleep helper
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Obtener estadísticas actuales
     */
    getStats() {
        return {
            totalWrites: this.state.totalWrites,
            totalRetries: this.state.totalRetries,
            quotaExceededCount: this.state.quotaExceededCount,
            currentMinuteWrites: this.state.writesInCurrentMinute,
            maxWritesPerMinute: this.config.maxWritesPerMinute,
            utilizationPercent: Math.round((this.state.writesInCurrentMinute / this.config.maxWritesPerMinute) * 100)
        };
    }

    /**
     * Resetear estadísticas
     */
    resetStats() {
        this.state = {
            writesInCurrentMinute: 0,
            currentMinuteStart: Date.now(),
            lastWriteTime: 0,
            totalWrites: 0,
            totalRetries: 0,
            quotaExceededCount: 0
        };
        console.log('[QUOTA-MANAGER] 🔄 Estadísticas reseteadas');
    }

    /**
     * Procesar operaciones en lotes con progreso
     * @param {Array} items - Items a procesar
     * @param {Function} processItem - Función que procesa un item
     * @param {Object} options - Opciones de procesamiento
     * @returns {Promise<Object>} Resultado con estadísticas
     */
    async processBatch(items, processItem, options = {}) {
        const {
            batchSize = this.config.maxBatchSize,
            onProgress = null,
            operationName = 'batch'
        } = options;

        const totalItems = items.length;
        const totalBatches = Math.ceil(totalItems / batchSize);
        
        console.log(`[QUOTA-MANAGER] 📦 Procesando ${totalItems} items en ${totalBatches} lotes de máximo ${batchSize}`);

        const results = {
            success: [],
            errors: [],
            totalProcessed: 0,
            totalBatches: totalBatches,
            currentBatch: 0,
            startTime: Date.now(),
            endTime: null,
            durationMs: null
        };

        for (let i = 0; i < totalItems; i += batchSize) {
            const batchNumber = Math.floor(i / batchSize) + 1;
            const batch = items.slice(i, i + batchSize);
            
            console.log(`[QUOTA-MANAGER] 🔄 Lote ${batchNumber}/${totalBatches} (${batch.length} items)`);
            
            results.currentBatch = batchNumber;

            // Notificar progreso
            if (onProgress) {
                try {
                    await onProgress({
                        currentBatch: batchNumber,
                        totalBatches: totalBatches,
                        itemsProcessed: results.totalProcessed,
                        totalItems: totalItems,
                        progressPercent: Math.round((results.totalProcessed / totalItems) * 100)
                    });
                } catch (progressError) {
                    console.warn('[QUOTA-MANAGER] ⚠️ Error notificando progreso:', progressError.message);
                }
            }

            // Procesar items del lote
            for (const item of batch) {
                try {
                    const result = await this.executeWrite(
                        () => processItem(item),
                        `${operationName} item ${results.totalProcessed + 1}/${totalItems}`
                    );
                    
                    results.success.push({ item, result });
                    results.totalProcessed++;
                    
                } catch (error) {
                    console.error(`[QUOTA-MANAGER] ❌ Error procesando item:`, error.message);
                    results.errors.push({
                        item,
                        error: error.message,
                        isQuotaError: this.isQuotaExceededError(error)
                    });
                    
                    // Si es error de cuota y agotamos reintentos, detener procesamiento
                    if (error instanceof QuotaExceededError) {
                        console.error('[QUOTA-MANAGER] ❌ Deteniendo procesamiento por cuota excedida');
                        break;
                    }
                }
            }

            // Si hay errores de cuota, detener
            const quotaErrors = results.errors.filter(e => e.isQuotaError);
            if (quotaErrors.length > 0 && batchNumber < totalBatches) {
                console.error(`[QUOTA-MANAGER] ❌ Deteniendo tras lote ${batchNumber} por ${quotaErrors.length} errores de cuota`);
                break;
            }

            console.log(`[QUOTA-MANAGER] ✅ Lote ${batchNumber}/${totalBatches} completado: ${batch.length} items, ${results.errors.length} errores`);
        }

        results.endTime = Date.now();
        results.durationMs = results.endTime - results.startTime;

        // Notificar progreso final
        if (onProgress) {
            try {
                await onProgress({
                    currentBatch: totalBatches,
                    totalBatches: totalBatches,
                    itemsProcessed: results.totalProcessed,
                    totalItems: totalItems,
                    progressPercent: 100,
                    completed: true
                });
            } catch (progressError) {
                console.warn('[QUOTA-MANAGER] ⚠️ Error notificando progreso final:', progressError.message);
            }
        }

        console.log(`[QUOTA-MANAGER] ✅ Procesamiento completado: ${results.totalProcessed}/${totalItems} items en ${Math.round(results.durationMs/1000)}s`);
        
        return results;
    }
}

/**
 * Error personalizado para cuota excedida
 */
class QuotaExceededError extends Error {
    constructor(message, state) {
        super(message);
        this.name = 'QuotaExceededError';
        this.code = 'QUOTA_EXCEEDED';
        this.state = state;
        this.retryAfter = 60; // Sugerir reintentar en 60 segundos
    }
}

// Exportar instancia singleton
const quotaManager = new QuotaManager();

console.log('[QUOTA-MANAGER] ✅ Gestor de cuotas configurado');

module.exports = {
    quotaManager,
    QuotaManager,
    QuotaExceededError
};
