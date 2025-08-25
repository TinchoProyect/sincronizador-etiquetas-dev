/**
 * Middleware de idempotencia para operaciones de escritura
 * Evita duplicados y permite reintentos seguros
 */

const crypto = require('crypto');

console.log('🔍 [IDEMPOTENCY] Configurando middleware de idempotencia...');

// Cache en memoria para operaciones (en producción usar Redis)
const operationsCache = new Map();

// TTL por defecto: 1 hora
const DEFAULT_TTL = parseInt(process.env.IDEMPOTENCY_TTL) || 3600;

/**
 * Generar hash de payload para idempotencia
 * @param {Object} payload - Datos de la operación
 * @returns {string} Hash MD5 del payload
 */
function generatePayloadHash(payload) {
    const payloadString = JSON.stringify(payload, Object.keys(payload).sort());
    const hash = crypto.createHash('md5').update(payloadString).digest('hex');
    
    console.log('🔑 [IDEMPOTENCY] Hash generado:', hash.substring(0, 8) + '...');
    
    return hash;
}

/**
 * Generar clave de idempotencia
 * @param {string} operation - Tipo de operación (CREATE, UPDATE, DELETE)
 * @param {Object} payload - Datos de la operación
 * @param {string} customKey - Clave personalizada del header
 * @returns {string} Clave de idempotencia
 */
function generateIdempotencyKey(operation, payload, customKey = null) {
    if (customKey) {
        console.log('🔑 [IDEMPOTENCY] Usando clave personalizada:', customKey);
        return customKey;
    }
    
    const timestamp = Date.now();
    const payloadHash = generatePayloadHash(payload);
    const key = `${operation}-${timestamp}-${payloadHash}`;
    
    console.log('🔑 [IDEMPOTENCY] Clave generada:', key.substring(0, 20) + '...');
    
    return key;
}

/**
 * Middleware de idempotencia
 * @param {string} operation - Tipo de operación
 * @returns {Function} Middleware function
 */
function idempotencyMiddleware(operation = 'CREATE') {
    return (req, res, next) => {
        console.log('🔍 [IDEMPOTENCY] Verificando idempotencia para:', operation);
        
        try {
            // Obtener clave de idempotencia del header
            const customKey = req.headers['idempotency-key'];
            const payload = req.body;
            
            // Generar clave de idempotencia
            const idempotencyKey = generateIdempotencyKey(operation, payload, customKey);
            
            // Verificar si la operación ya existe
            const existingOperation = operationsCache.get(idempotencyKey);
            
            if (existingOperation) {
                const now = Date.now();
                const isExpired = (now - existingOperation.timestamp) > (DEFAULT_TTL * 1000);
                
                if (isExpired) {
                    console.log('⏰ [IDEMPOTENCY] Operación expirada, removiendo:', idempotencyKey.substring(0, 20) + '...');
                    operationsCache.delete(idempotencyKey);
                } else {
                    console.log('♻️ [IDEMPOTENCY] Operación duplicada detectada:', existingOperation.status);
                    
                    // Retornar resultado de operación anterior
                    if (existingOperation.status === 'COMPLETED') {
                        return res.status(200).json({
                            success: true,
                            data: existingOperation.result,
                            message: 'Operación ya completada (idempotencia)',
                            idempotency_key: idempotencyKey,
                            original_timestamp: new Date(existingOperation.timestamp).toISOString(),
                            cached: true
                        });
                    } else if (existingOperation.status === 'FAILED') {
                        return res.status(400).json({
                            success: false,
                            error: existingOperation.error,
                            message: 'Operación falló anteriormente (idempotencia)',
                            idempotency_key: idempotencyKey,
                            original_timestamp: new Date(existingOperation.timestamp).toISOString(),
                            cached: true
                        });
                    } else if (existingOperation.status === 'IN_PROGRESS') {
                        return res.status(409).json({
                            success: false,
                            error: 'Operación en progreso',
                            message: 'La misma operación está siendo procesada',
                            idempotency_key: idempotencyKey,
                            original_timestamp: new Date(existingOperation.timestamp).toISOString(),
                            retry_after: 5
                        });
                    }
                }
            }
            
            // Registrar nueva operación como IN_PROGRESS
            operationsCache.set(idempotencyKey, {
                status: 'IN_PROGRESS',
                timestamp: Date.now(),
                operation: operation,
                payload: payload
            });
            
            console.log('🔄 [IDEMPOTENCY] Nueva operación registrada:', operation);
            
            // Agregar funciones helper al request
            req.idempotency = {
                key: idempotencyKey,
                markCompleted: (result) => markOperationCompleted(idempotencyKey, result),
                markFailed: (error) => markOperationFailed(idempotencyKey, error),
                cleanup: () => cleanupOperation(idempotencyKey)
            };
            
            next();
            
        } catch (error) {
            console.error('❌ [IDEMPOTENCY] Error en middleware:', error.message);
            
            // En caso de error, continuar sin idempotencia
            req.idempotency = {
                key: null,
                markCompleted: () => {},
                markFailed: () => {},
                cleanup: () => {}
            };
            
            next();
        }
    };
}

/**
 * Marcar operación como completada
 * @param {string} key - Clave de idempotencia
 * @param {Object} result - Resultado de la operación
 */
function markOperationCompleted(key, result) {
    console.log('✅ [IDEMPOTENCY] Marcando operación como completada:', key.substring(0, 20) + '...');
    
    const operation = operationsCache.get(key);
    if (operation) {
        operationsCache.set(key, {
            ...operation,
            status: 'COMPLETED',
            result: result,
            completed_at: Date.now()
        });
    }
}

/**
 * Marcar operación como fallida
 * @param {string} key - Clave de idempotencia
 * @param {string} error - Error de la operación
 */
function markOperationFailed(key, error) {
    console.log('❌ [IDEMPOTENCY] Marcando operación como fallida:', key.substring(0, 20) + '...');
    
    const operation = operationsCache.get(key);
    if (operation) {
        operationsCache.set(key, {
            ...operation,
            status: 'FAILED',
            error: error,
            failed_at: Date.now()
        });
    }
}

/**
 * Limpiar operación del cache
 * @param {string} key - Clave de idempotencia
 */
function cleanupOperation(key) {
    console.log('🧹 [IDEMPOTENCY] Limpiando operación:', key.substring(0, 20) + '...');
    operationsCache.delete(key);
}

/**
 * Obtener estado de operación
 * @param {string} key - Clave de idempotencia
 * @returns {Object|null} Estado de la operación
 */
function getOperationStatus(key) {
    const operation = operationsCache.get(key);
    
    if (!operation) {
        return null;
    }
    
    const now = Date.now();
    const isExpired = (now - operation.timestamp) > (DEFAULT_TTL * 1000);
    
    if (isExpired) {
        operationsCache.delete(key);
        return null;
    }
    
    return {
        status: operation.status,
        timestamp: operation.timestamp,
        operation: operation.operation,
        age_seconds: Math.floor((now - operation.timestamp) / 1000),
        ttl_seconds: DEFAULT_TTL - Math.floor((now - operation.timestamp) / 1000)
    };
}

/**
 * Limpiar operaciones expiradas
 */
function cleanupExpiredOperations() {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [key, operation] of operationsCache.entries()) {
        const isExpired = (now - operation.timestamp) > (DEFAULT_TTL * 1000);
        
        if (isExpired) {
            operationsCache.delete(key);
            cleanedCount++;
        }
    }
    
    if (cleanedCount > 0) {
        console.log('🧹 [IDEMPOTENCY] Operaciones expiradas limpiadas:', cleanedCount);
    }
    
    return cleanedCount;
}

/**
 * Obtener estadísticas del cache
 * @returns {Object} Estadísticas
 */
function getCacheStats() {
    const operations = Array.from(operationsCache.values());
    const now = Date.now();
    
    const stats = {
        total_operations: operations.length,
        in_progress: operations.filter(op => op.status === 'IN_PROGRESS').length,
        completed: operations.filter(op => op.status === 'COMPLETED').length,
        failed: operations.filter(op => op.status === 'FAILED').length,
        expired: operations.filter(op => (now - op.timestamp) > (DEFAULT_TTL * 1000)).length,
        ttl_seconds: DEFAULT_TTL
    };
    
    console.log('📊 [IDEMPOTENCY] Estadísticas del cache:', stats);
    
    return stats;
}

// Limpiar operaciones expiradas cada 5 minutos
setInterval(cleanupExpiredOperations, 5 * 60 * 1000);

console.log('✅ [IDEMPOTENCY] Middleware de idempotencia configurado');
console.log('⏰ [IDEMPOTENCY] TTL configurado:', DEFAULT_TTL, 'segundos');

module.exports = {
    idempotencyMiddleware,
    generateIdempotencyKey,
    markOperationCompleted,
    markOperationFailed,
    cleanupOperation,
    getOperationStatus,
    cleanupExpiredOperations,
    getCacheStats
};
