/**
 * Utilidades para generar código de barras de AFIP (Code128)
 * Según especificación oficial de factura electrónica
 */

/**
 * Construye la cadena del código de barras (sin DV)
 * @param {Object} params - Parámetros del código de barras
 * @param {string} params.cuit11 - CUIT de 11 dígitos
 * @param {number} params.cbteTipo3 - Tipo de comprobante (se rellenará a 3 dígitos)
 * @param {number} params.ptoVta5 - Punto de venta (se rellenará a 5 dígitos)
 * @param {string} params.cae14 - CAE de 14 dígitos
 * @param {string} params.caeVto8 - Vencimiento CAE en formato YYYYMMDD
 * @returns {string} Cadena del código de barras sin DV
 */
function buildBarcodeString({ cuit11, cbteTipo3, ptoVta5, cae14, caeVto8 }) {
    // Validaciones
    if (!cuit11 || cuit11.length !== 11 || !/^\d{11}$/.test(cuit11)) {
        throw new Error('CUIT debe tener exactamente 11 dígitos');
    }
    
    if (!cbteTipo3 || cbteTipo3 < 1 || cbteTipo3 > 999) {
        throw new Error('Tipo de comprobante debe estar entre 1 y 999');
    }
    
    if (!ptoVta5 || ptoVta5 < 1 || ptoVta5 > 99999) {
        throw new Error('Punto de venta debe estar entre 1 y 99999');
    }
    
    // CAE puede ser de 12 o 14 dígitos, ajustar a 14 con ceros a la izquierda
    const caeStr = String(cae14).padStart(14, '0');
    if (caeStr.length !== 14 || !/^\d{14}$/.test(caeStr)) {
        throw new Error('CAE debe tener 12 o 14 dígitos');
    }
    
    if (!caeVto8 || caeVto8.length !== 8 || !/^\d{8}$/.test(caeVto8)) {
        throw new Error('Vencimiento CAE debe tener formato YYYYMMDD (8 dígitos)');
    }
    
    // Construir cadena con ceros a la izquierda
    const cbteTipoStr = String(cbteTipo3).padStart(3, '0');
    const ptoVtaStr = String(ptoVta5).padStart(5, '0');
    
    // Concatenar: CUIT(11) + TipoCbte(3) + PtoVta(5) + CAE(14) + VtoCae(8)
    return cuit11 + cbteTipoStr + ptoVtaStr + caeStr + caeVto8;
}

/**
 * Calcula el dígito verificador según algoritmo de AFIP
 * Basado en el Módulo 10 con ponderadores
 * @param {string} barcodeCore - Cadena base del código de barras (41 dígitos)
 * @returns {string} Dígito verificador (1 dígito)
 */
function computeDV_afip(barcodeCore) {
    if (!barcodeCore || barcodeCore.length !== 41) {
        throw new Error('La cadena base debe tener exactamente 41 dígitos');
    }
    
    // Ponderadores alternados: 3, 2, 7, 6, 5, 4, 3, 2, ...
    // Este es el algoritmo estándar usado por AFIP para el código de barras
    const ponderadores = [3, 2, 7, 6, 5, 4, 3, 2];
    let suma = 0;
    
    // Recorrer cada dígito de derecha a izquierda
    for (let i = barcodeCore.length - 1, j = 0; i >= 0; i--, j++) {
        const digito = parseInt(barcodeCore[i], 10);
        const ponderador = ponderadores[j % ponderadores.length];
        suma += digito * ponderador;
    }
    
    // Calcular el dígito verificador
    const resto = suma % 10;
    const dv = resto === 0 ? 0 : 10 - resto;
    
    return String(dv);
}

/**
 * Construye la cadena completa del código de barras incluyendo DV
 * @param {Object} params - Parámetros del código de barras
 * @param {string} params.cuit11 - CUIT de 11 dígitos
 * @param {number} params.cbteTipo3 - Tipo de comprobante
 * @param {number} params.ptoVta5 - Punto de venta
 * @param {string} params.cae14 - CAE de 14 dígitos
 * @param {string} params.caeVto8 - Vencimiento CAE en formato YYYYMMDD
 * @returns {string} Cadena completa del código de barras (42 dígitos: 41 + DV)
 */
function buildBarcodePayload(params) {
    // Construir cadena base
    const barcodeCore = buildBarcodeString(params);
    
    // Calcular dígito verificador
    const dv = computeDV_afip(barcodeCore);
    
    // Retornar cadena completa
    return barcodeCore + dv;
}

/**
 * Valida que una cadena de código de barras sea correcta
 * @param {string} fullBarcode - Cadena completa del código de barras (42 dígitos)
 * @returns {boolean} True si el código de barras es válido
 */
function validateBarcode(fullBarcode) {
    if (!fullBarcode || fullBarcode.length !== 42 || !/^\d{42}$/.test(fullBarcode)) {
        return false;
    }
    
    const barcodeCore = fullBarcode.substring(0, 41);
    const dvProvided = fullBarcode.substring(41);
    const dvCalculated = computeDV_afip(barcodeCore);
    
    return dvProvided === dvCalculated;
}

module.exports = {
    buildBarcodeString,
    computeDV_afip,
    buildBarcodePayload,
    validateBarcode
};
