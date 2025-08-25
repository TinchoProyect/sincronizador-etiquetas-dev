/**
 * Generador de IDs únicos para presupuestos usando timestamp + random
 * Evita colisiones y mantiene orden cronológico
 */

console.log('🔍 [ID-GENERATOR] Configurando generador de IDs simple...');

/**
 * Generar UUID simple basado en timestamp + random
 * @returns {string} ID formato similar a UUID
 */
function generateSimpleUUID() {
    const timestamp = Date.now().toString(16).padStart(12, '0');
    const random1 = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
    const random2 = Math.floor(Math.random() * 0xfff).toString(16).padStart(3, '0');
    const random3 = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
    const random4 = Math.floor(Math.random() * 0xffffffffffff).toString(16).padStart(12, '0');
    
    return `${timestamp.substr(0, 8)}-${random1}-7${random2}-${random3}-${random4}`;
}

/**
 * Generar ID único para presupuesto con prefijo P-
 * @returns {string} ID formato P-{UUID-like}
 */
function generatePresupuestoId() {
    const uuid = generateSimpleUUID();
    const presupuestoId = `P-${uuid}`;
    
    console.log('🆔 [ID-GEN] Presupuesto ID generado:', presupuestoId);
    
    return presupuestoId;
}

/**
 * Generar ID único para detalle de presupuesto con prefijo D-
 * @returns {string} ID formato D-{UUID-like}
 */
function generateDetalleId() {
    const uuid = generateSimpleUUID();
    const detalleId = `D-${uuid}`;
    
    console.log('🆔 [ID-GEN] Detalle ID generado:', detalleId);
    
    return detalleId;
}

/**
 * Generar múltiples IDs de detalle
 * @param {number} cantidad - Número de IDs a generar
 * @returns {string[]} Array de IDs formato D-{UUIDv7}
 */
function generateMultipleDetalleIds(cantidad) {
    const ids = [];
    
    for (let i = 0; i < cantidad; i++) {
        ids.push(generateDetalleId());
    }
    
    console.log('🆔 [ID-GEN] Múltiples detalle IDs generados:', ids.length);
    
    return ids;
}

/**
 * Validar formato de ID de presupuesto
 * @param {string} id - ID a validar
 * @returns {boolean} true si es válido
 */
function isValidPresupuestoId(id) {
    if (!id || typeof id !== 'string') {
        return false;
    }
    
    // Formato: P-{UUIDv7}
    const regex = /^P-[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return regex.test(id);
}

/**
 * Validar formato de ID de detalle
 * @param {string} id - ID a validar
 * @returns {boolean} true si es válido
 */
function isValidDetalleId(id) {
    if (!id || typeof id !== 'string') {
        return false;
    }
    
    // Formato: D-{UUIDv7}
    const regex = /^D-[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return regex.test(id);
}

/**
 * Extraer timestamp de UUIDv7 para ordenamiento
 * @param {string} id - ID con formato P-{UUIDv7} o D-{UUIDv7}
 * @returns {number|null} Timestamp en milisegundos o null si inválido
 */
function extractTimestampFromId(id) {
    try {
        if (!id || typeof id !== 'string') {
            return null;
        }
        
        // Remover prefijo P- o D-
        const uuid = id.substring(2);
        
        // Extraer los primeros 48 bits (timestamp en UUIDv7)
        const timestampHex = uuid.substring(0, 12);
        const timestamp = parseInt(timestampHex, 16);
        
        return timestamp;
    } catch (error) {
        console.error('❌ [ID-GEN] Error extrayendo timestamp:', error.message);
        return null;
    }
}

console.log('✅ [ID-GENERATOR] Generador de IDs UUIDv7 configurado');

module.exports = {
    generatePresupuestoId,
    generateDetalleId,
    generateMultipleDetalleIds,
    isValidPresupuestoId,
    isValidDetalleId,
    extractTimestampFromId
};
