/**
 * Helper centralizado de mapeo de alícuotas de IVA
 * Códigos oficiales de AFIP
 */

console.log('🔍 [IVA-HELPER] Cargando helper de alícuotas IVA...');

/**
 * Tabla de alícuotas IVA según códigos oficiales AFIP
 * Ref: https://www.afip.gob.ar/fe/ayuda/codigo_alicuota.asp
 */
const ALICUOTAS_AFIP = {
    3: { pct: 0, factor: 0, descripcion: 'Exento' },
    4: { pct: 10.5, factor: 0.105, descripcion: 'IVA 10.5%' },
    5: { pct: 21, factor: 0.21, descripcion: 'IVA 21%' },
    6: { pct: 27, factor: 0.27, descripcion: 'IVA 27%' },
    8: { pct: 5, factor: 0.05, descripcion: 'IVA 5%' },
    9: { pct: 2.5, factor: 0.025, descripcion: 'IVA 2.5%' }
};

/**
 * Mapeo inverso: Porcentaje → Código AFIP
 */
const PCT_TO_CODE = {
    0: 3,
    10.5: 4,
    21: 5,
    27: 6,
    5: 8,
    2.5: 9
};

/**
 * Convertir porcentaje a código AFIP
 * @param {number} porcentaje - Porcentaje de IVA (21, 10.5, 0, etc.)
 * @returns {number} Código AFIP
 */
function porcentajeToCodigoAfip(porcentaje) {
    const pct = parseFloat(porcentaje) || 0;
    const codigo = PCT_TO_CODE[pct];
    
    if (codigo === undefined) {
        console.warn(`⚠️ [IVA-HELPER] Porcentaje ${pct}% no reconocido, usando Exento (3)`);
        return 3; // Default: Exento
    }
    
    return codigo;
}

/**
 * Obtener información de alícuota por código AFIP
 * @param {number} codigo - Código AFIP
 * @returns {Object} { pct, factor, descripcion }
 */
function obtenerAlicuota(codigo) {
    const alicuota = ALICUOTAS_AFIP[codigo];
    
    if (!alicuota) {
        console.warn(`⚠️ [IVA-HELPER] Código ${codigo} no reconocido, usando Exento`);
        return ALICUOTAS_AFIP[3]; // Default: Exento
    }
    
    return alicuota;
}

/**
 * Obtener porcentaje por código AFIP
 * @param {number} codigo - Código AFIP
 * @returns {number} Porcentaje (21, 10.5, 0, etc.)
 */
function obtenerPorcentaje(codigo) {
    const alicuota = obtenerAlicuota(codigo);
    return alicuota.pct;
}

/**
 * Obtener factor de cálculo por código AFIP
 * @param {number} codigo - Código AFIP
 * @returns {number} Factor (0.21, 0.105, 0, etc.)
 */
function obtenerFactor(codigo) {
    const alicuota = obtenerAlicuota(codigo);
    return alicuota.factor;
}

/**
 * Calcular IVA de un monto
 * @param {number} monto - Monto base
 * @param {number} codigo - Código AFIP de alícuota
 * @returns {number} Monto de IVA calculado (redondeado a 2 decimales)
 */
function calcularIva(monto, codigo) {
    const factor = obtenerFactor(codigo);
    const iva = monto * factor;
    return Math.round(iva * 100) / 100; // Redondear a 2 decimales
}

/**
 * Formatear porcentaje para display
 * @param {number} codigo - Código AFIP
 * @returns {string} Porcentaje formateado (ej: "21%", "10,5%")
 */
function formatearPorcentaje(codigo) {
    const pct = obtenerPorcentaje(codigo);
    
    // Formatear con coma decimal si tiene decimales
    if (pct % 1 !== 0) {
        return `${pct.toString().replace('.', ',')}%`;
    }
    
    return `${pct}%`;
}

/**
 * Validar que un código AFIP sea válido
 * @param {number} codigo - Código AFIP
 * @returns {boolean} true si es válido
 */
function esCodigoValido(codigo) {
    return ALICUOTAS_AFIP[codigo] !== undefined;
}

/**
 * Obtener tabla completa de alícuotas
 * @returns {Object} Tabla de alícuotas AFIP
 */
function obtenerTablaCompleta() {
    return { ...ALICUOTAS_AFIP };
}

/**
 * Normalizar código antiguo (incorrecto) a código correcto
 * Mapea códigos que se guardaron incorrectamente en BD
 * @param {number} codigo - Código que puede ser incorrecto
 * @returns {number} Código correcto
 */
function normalizarCodigo(codigo) {
    const MAPEO_LEGACY = {
        1: 5,  // 1 (incorrecto) → 5 (21% correcto)
        2: 4   // 2 (incorrecto) → 4 (10.5% correcto)
    };
    
    return MAPEO_LEGACY[codigo] || codigo;
}

console.log('✅ [IVA-HELPER] Helper de alícuotas IVA cargado');

module.exports = {
    ALICUOTAS_AFIP,
    PCT_TO_CODE,
    porcentajeToCodigoAfip,
    obtenerAlicuota,
    obtenerPorcentaje,
    obtenerFactor,
    calcularIva,
    formatearPorcentaje,
    esCodigoValido,
    obtenerTablaCompleta,
    normalizarCodigo
};
