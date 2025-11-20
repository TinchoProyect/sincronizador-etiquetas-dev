/**
 * Generador de imágenes de códigos de barras Code128
 * Utiliza JsBarcode con node-canvas para generar imágenes en memoria
 */

const { createCanvas } = require('canvas');
const JsBarcode = require('jsbarcode');

console.log('🔍 [BARCODE-IMAGE] Cargando generador de imágenes de código de barras...');

/**
 * Genera una imagen PNG del código de barras Code128
 * @param {string} barcodeValue - Valor del código de barras (42 dígitos)
 * @param {Object} options - Opciones de generación
 * @param {number} options.width - Ancho de cada barra (default: 2)
 * @param {number} options.height - Alto del código de barras en px (default: 50)
 * @param {boolean} options.displayValue - Mostrar valor debajo (default: true)
 * @param {number} options.fontSize - Tamaño de fuente (default: 12)
 * @returns {Buffer} Buffer de la imagen PNG
 */
function generateBarcodeImage(barcodeValue, options = {}) {
    try {
        console.log('📊 [BARCODE-IMAGE] Generando código de barras:', barcodeValue);
        
        // Opciones por defecto
        const opts = {
            width: options.width || 2,
            height: options.height || 50,
            displayValue: options.displayValue !== undefined ? options.displayValue : true,
            fontSize: options.fontSize || 12,
            margin: options.margin || 10,
            format: 'CODE128'
        };
        
        // Calcular dimensiones aproximadas del canvas
        // Code128 necesita ~11 barras por carácter + start/stop + checksum
        const estimatedWidth = (barcodeValue.length * 11 * opts.width) + (opts.margin * 2);
        const estimatedHeight = opts.height + (opts.displayValue ? opts.fontSize + 10 : 0) + (opts.margin * 2);
        
        // Crear canvas
        const canvas = createCanvas(estimatedWidth, estimatedHeight);
        
        // Generar código de barras
        JsBarcode(canvas, barcodeValue, {
            format: opts.format,
            width: opts.width,
            height: opts.height,
            displayValue: opts.displayValue,
            fontSize: opts.fontSize,
            margin: opts.margin,
            background: '#ffffff',
            lineColor: '#000000'
        });
        
        // Convertir a buffer PNG
        const buffer = canvas.toBuffer('image/png');
        
        console.log('✅ [BARCODE-IMAGE] Código de barras generado:', buffer.length, 'bytes');
        
        return buffer;
        
    } catch (error) {
        console.error('❌ [BARCODE-IMAGE] Error generando código de barras:', error.message);
        throw error;
    }
}

/**
 * Genera una imagen data URL del código de barras
 * @param {string} barcodeValue - Valor del código de barras
 * @param {Object} options - Opciones de generación
 * @returns {string} Data URL de la imagen (data:image/png;base64,...)
 */
function generateBarcodeDataUrl(barcodeValue, options = {}) {
    const buffer = generateBarcodeImage(barcodeValue, options);
    const base64 = buffer.toString('base64');
    return `data:image/png;base64,${base64}`;
}

console.log('✅ [BARCODE-IMAGE] Generador de código de barras cargado');

module.exports = {
    generateBarcodeImage,
    generateBarcodeDataUrl
};
