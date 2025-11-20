/**
 * Utilidades para generar código QR de AFIP
 * Según especificación oficial de factura electrónica
 */

/**
 * Construye el objeto JSON para el QR de AFIP
 * @param {Object} params - Parámetros del comprobante
 * @param {number} params.ver - Versión (siempre 1)
 * @param {string} params.fecha - Fecha en formato YYYY-MM-DD
 * @param {string} params.cuit - CUIT del emisor (11 dígitos)
 * @param {number} params.ptoVta - Punto de venta
 * @param {number} params.tipoCmp - Tipo de comprobante
 * @param {number} params.nroCmp - Número de comprobante
 * @param {number} params.importe - Importe total
 * @param {string} params.moneda - Código de moneda (ej: "PES", "DOL")
 * @param {number} params.ctz - Cotización de la moneda
 * @param {number} params.tipoDocRec - Tipo de documento del receptor (opcional)
 * @param {string} params.nroDocRec - Número de documento del receptor (opcional)
 * @param {string} params.tipoCodAut - Tipo de código de autorización (default: "E")
 * @param {string} params.codAut - Código de autorización (CAE)
 * @returns {Object} Objeto JSON para QR
 */
function buildQrJson({
    ver = 1,
    fecha,
    cuit,
    ptoVta,
    tipoCmp,
    nroCmp,
    importe,
    moneda = 'PES',
    ctz = 1,
    tipoDocRec,
    nroDocRec,
    tipoCodAut = 'E',
    codAut
}) {
    // Validaciones
    if (!cuit || cuit.length !== 11 || !/^\d{11}$/.test(cuit)) {
        throw new Error('CUIT debe tener 11 dígitos');
    }
    
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        throw new Error('Fecha debe estar en formato YYYY-MM-DD');
    }
    
    if (!ptoVta || ptoVta < 1 || ptoVta > 99999) {
        throw new Error('Punto de venta debe estar entre 1 y 99999');
    }
    
    if (!tipoCmp || tipoCmp < 1 || tipoCmp > 999) {
        throw new Error('Tipo de comprobante debe estar entre 1 y 999');
    }
    
    if (!nroCmp || nroCmp < 1 || nroCmp > 99999999) {
        throw new Error('Número de comprobante debe estar entre 1 y 99999999');
    }
    
    // CAE puede ser de 12 o 14 dígitos según entorno (homologación/producción)
    if (!codAut || (codAut.length !== 12 && codAut.length !== 14) || !/^\d+$/.test(codAut)) {
        throw new Error('CAE debe tener 12 o 14 dígitos');
    }
    
    // Construir objeto JSON según especificación AFIP
    const qrData = {
        ver,
        fecha: fecha.replace(/-/g, ''), // Convertir a YYYYMMDD
        cuit: parseInt(cuit, 10),
        ptoVta,
        tipoCmp,
        nroCmp,
        importe,
        moneda,
        ctz,
        tipoCodAut,
        codAut: parseInt(codAut, 10)
    };
    
    // Agregar campos opcionales solo si existen
    if (tipoDocRec) {
        qrData.tipoDocRec = tipoDocRec;
    }
    
    if (nroDocRec) {
        qrData.nroDocRec = parseInt(nroDocRec, 10);
    }
    
    return qrData;
}

/**
 * Codifica el objeto JSON del QR en URL de AFIP
 * @param {Object} qrJson - Objeto JSON construido con buildQrJson
 * @returns {string} URL completa del QR de AFIP
 */
function encodeQrUrl(qrJson) {
    // Convertir a JSON string
    const jsonString = JSON.stringify(qrJson);
    
    // Codificar en base64 estándar
    const base64 = Buffer.from(jsonString).toString('base64');
    
    // Construir URL de AFIP
    return `https://www.afip.gob.ar/fe/qr/?p=${base64}`;
}

/**
 * Genera la URL del QR de AFIP directamente desde los parámetros
 * @param {Object} params - Parámetros del comprobante
 * @returns {string} URL completa del QR de AFIP
 */
function generateQrUrl(params) {
    const qrJson = buildQrJson(params);
    return encodeQrUrl(qrJson);
}

module.exports = {
    buildQrJson,
    encodeQrUrl,
    generateQrUrl
};
