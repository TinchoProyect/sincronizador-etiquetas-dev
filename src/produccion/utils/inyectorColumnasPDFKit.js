/**
 * @file inyectorColumnasPDFKit.js
 * @description Centraliza todas las manipulaciones vectoriales invasivas sobre el motor PDF.
 * Salvaguarda el Grid y evita la superposición con Zonas Seguras de Hardware (ej. Códigos ON/OFF).
 */

const TIPOS_PERFIL = {
    DEFAULT: 'DEFAULT',
    PRECIO_KILO: 'PERFIL_PRECIO_KILO',
    TOTAL_FACTURA: 'PERFIL_TOTAL_FACTURA'
};

/**
 * Inyecta una cabecera dinámica reduciendo o mutando X/Width de columnas adyacentes.
 * Debe mandarse a llamar en la zona donde PDFKit construye `doc.font('Helvetica-Bold').text('Descripción', x, y)`
 * 
 * @param {Object} doc - Instancia activa de pdfkit
 * @param {String} perfilId - 'DEFAULT', 'PERFIL_PRECIO_KILO', etc.
 * @param {Number} baseY - Eje Y de la fila de cabeceras
 */
function extenderCabeceraPerfiles(doc, perfilId, baseY) {
    if (perfilId === TIPOS_PERFIL.PRECIO_KILO) {
        // En lugar de chocar contra SubTotal, inyectamos a X=430 P/Kilo.
        // La iteración del motor PDF deberá reducir el {width} del campo Descripción
        // en base a la coordenada 430 para prevenir overlapping.
        doc.fontSize(8).font('Helvetica-Bold');
        doc.text('P/Kilo', 430, baseY);
    }
    // TOTAL_FACTURA no muta las cabeceras del Grid.
}

/**
 * Inyecta los cálculos de la línea del artículo
 * Se llama en el bucle donde se imprimen los renglones (artículos).
 * 
 * @param {Object} doc - Instancia activa de pdfkit
 * @param {String} perfilId - Perfil del cliente
 * @param {Object} dataCosto - Resultado arrojado por motorCalculadoraFiscal (kilos, precioKilo)
 * @param {Number} baseY - Eje Y actual de dibujo de esta fila
 */
function dibujarFilaPerfiles(doc, perfilId, dataCosto, baseY) {
    if (perfilId === TIPOS_PERFIL.PRECIO_KILO) {
        doc.fontSize(8).font('Helvetica');
        
        let texto = '-'; // Fallback por defecto
        
        if (dataCosto && dataCosto.validez && dataCosto.precioPorKilo !== null) {
            texto = `$${dataCosto.precioPorKilo.toFixed(2)}`;
        }

        // Se usa la misma X de la cabecera
        doc.text(texto, 430, baseY);
    }
}

/**
 * Dibuja un total flotante aislado del hardware de escaneo final de página.
 * 
 * @param {Object} doc - Instancia activa de pdfkit
 * @param {String} perfilId - Perfil del cliente
 * @param {Number} totalAcumulado - Sumatoria monetaria de todos los items
 * @param {Number} limitY - Punto de colisión Y donde inician los componentes (Firmas o Barcodes ON/OFF)
 */
function dibujarResumenGlobal(doc, perfilId, totalAcumulado, limitY) {
    if (perfilId === TIPOS_PERFIL.TOTAL_FACTURA) {
        // Dibujarlo antes del límite crítico (ej limitY = doc.page.height - pieAltura - 100)
        let rectY = limitY - 40; 
        
        // Caja estética sombreada
        doc.rect(400, rectY, 150, 25).fillAndStroke('#f0f0f0', '#999999');
        doc.fillColor('#000000');
        doc.font('Helvetica-Bold').fontSize(12);
        
        // Formatear a pesos
        let totalPesos = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(totalAcumulado);
        
        doc.text(`TOTAL: ${totalPesos}`, 410, rectY + 7);
    }
}

module.exports = {
    TIPOS_PERFIL,
    extenderCabeceraPerfiles,
    dibujarFilaPerfiles,
    dibujarResumenGlobal
};
