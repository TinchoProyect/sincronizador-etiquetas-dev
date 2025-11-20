/**
 * Generador de PDF para facturas
 * Diseño profesional con datos de empresa desde configuración
 */

const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { formatearFecha } = require('../config/timezone');
const { formatearMoneda } = require('../utils/decimales');
const { COMPANY_CONFIG } = require('../config/company');
const { TIPOS_COMPROBANTE, CONDICIONES_IVA } = require('../config/afip');
const { generateQrUrl } = require('../utils/afip-qr');
const { buildBarcodePayload } = require('../utils/afip-barcode');
const { generateBarcodeImage } = require('../utils/barcode-image');
const { obtenerAlicuota, formatearPorcentaje, normalizarCodigo } = require('../utils/iva-helper');

console.log('🔍 [FACTURACION-PDF] Cargando generador de PDF...');

/**
 * Generar PDF de factura con diseño profesional
 * @param {Object} factura - Datos de la factura
 * @param {Array} items - Items de la factura
 * @returns {Promise<Buffer>} Buffer del PDF
 */
const generarPDF = async (factura, items) => {
    console.log('📄 [FACTURACION-PDF] Generando PDF para factura ID:', factura.id);
    
    try {
        // Crear documento PDF con márgenes apropiados para A4
        const doc = new PDFDocument({
            size: 'A4',
            margin: 40,
            info: {
                Title: `Factura ${factura.cbte_nro || factura.nro_interno}`,
                Author: COMPANY_CONFIG.name,
                Subject: 'Factura Electrónica'
            }
        });
        
        // Buffer para almacenar el PDF
        const buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        
        // Promesa para esperar finalización
        const pdfPromise = new Promise((resolve, reject) => {
            doc.on('end', () => {
                const pdfBuffer = Buffer.concat(buffers);
                console.log('✅ [FACTURACION-PDF] PDF generado');
                resolve(pdfBuffer);
            });
            doc.on('error', reject);
        });
        
        // Construir contenido del PDF
        await construirPDF(doc, factura, items);
        
        // Finalizar documento
        doc.end();
        
        return await pdfPromise;
        
    } catch (error) {
        console.error('❌ [FACTURACION-PDF] Error generando PDF:', error.message);
        throw error;
    }
};

/**
 * Construir contenido del PDF con diseño profesional
 * @param {PDFDocument} doc - Documento PDF
 * @param {Object} factura - Datos de la factura
 * @param {Array} items - Items de la factura
 */
const construirPDF = async (doc, factura, items) => {
    console.log('📝 [FACTURACION-PDF] Construyendo contenido del PDF...');
    
    const pageWidth = doc.page.width;
    const pageMargin = doc.page.margins.left;
    const contentWidth = pageWidth - (pageMargin * 2);
    const leftColumn = pageMargin;
    const middleColumn = pageMargin + (contentWidth / 2);
    
    // ===========================================
    // CABECERA EN DOS COLUMNAS
    // ===========================================
    let yPos = pageMargin;
    
    // COLUMNA IZQUIERDA - Datos de la empresa
    doc.fontSize(14).font('Helvetica-Bold').text(COMPANY_CONFIG.name, leftColumn, yPos);
    yPos += 20;
    
    doc.fontSize(9).font('Helvetica');
    if (COMPANY_CONFIG.cuitFmt) {
        doc.text(`CUIT: ${COMPANY_CONFIG.cuitFmt}`, leftColumn, yPos);
        yPos += 12;
    }
    if (COMPANY_CONFIG.address) {
        doc.text(COMPANY_CONFIG.address, leftColumn, yPos);
        yPos += 12;
    }
    if (COMPANY_CONFIG.email) {
        doc.text(`Email: ${COMPANY_CONFIG.email}`, leftColumn, yPos);
        yPos += 12;
    }
    if (COMPANY_CONFIG.phone) {
        doc.text(`Tel: ${COMPANY_CONFIG.phone}`, leftColumn, yPos);
    }
    
    // COLUMNA DERECHA - Datos del comprobante
    yPos = pageMargin;
    const tipoDesc = TIPOS_COMPROBANTE[factura.tipo_cbte] || 'Comprobante';
    doc.fontSize(12).font('Helvetica-Bold').text(tipoDesc, middleColumn, yPos, { align: 'right' });
    yPos += 20;
    
    doc.fontSize(9).font('Helvetica');
    
    // Número de factura formateado
    if (factura.cbte_nro) {
        const numero = `${String(factura.pto_vta).padStart(5, '0')} - ${String(factura.cbte_nro).padStart(8, '0')}`;
        doc.text(`Nº ${numero}`, middleColumn, yPos, { align: 'right' });
        yPos += 12;
    } else if (factura.nro_interno) {
        const numero = `${factura.serie_interna} - ${String(factura.nro_interno).padStart(8, '0')}`;
        doc.text(`Nº ${numero}`, middleColumn, yPos, { align: 'right' });
        yPos += 12;
    }
    
    doc.text(`Fecha: ${formatearFecha(factura.fecha_emision)}`, middleColumn, yPos, { align: 'right' });
    
    // Línea separadora
    yPos = pageMargin + 80;
    doc.moveTo(leftColumn, yPos).lineTo(pageWidth - pageMargin, yPos).stroke();
    yPos += 20;
    
    // ===========================================
    // BLOQUE CLIENTE
    // ===========================================
    doc.fontSize(10).font('Helvetica-Bold').text('CLIENTE', leftColumn, yPos);
    yPos += 15;
    
    doc.fontSize(9).font('Helvetica');
    
    // Nombre del cliente
    if (factura.razon_social) {
        doc.text(factura.razon_social, leftColumn, yPos, { width: contentWidth / 2 });
        yPos += 12;
    }
    
    // Documento
    if (factura.doc_nro) {
        const tipoDoc = factura.doc_tipo === 80 ? 'CUIT' : factura.doc_tipo === 96 ? 'DNI' : 'Doc';
        doc.text(`${tipoDoc}: ${factura.doc_nro}`, leftColumn, yPos);
        yPos += 12;
    }
    
    // Condición IVA
    if (factura.condicion_iva_id) {
        const condicion = CONDICIONES_IVA[factura.condicion_iva_id] || '';
        doc.text(`Condición IVA: ${condicion}`, leftColumn, yPos);
        yPos += 12;
    }
    
    yPos += 10;
    
    // ===========================================
    // TABLA DE ITEMS
    // ===========================================
    doc.fontSize(10).font('Helvetica-Bold').text('DETALLE DE PRODUCTOS', leftColumn, yPos);
    yPos += 15;
    
    // Cabecera de tabla
    doc.fontSize(8).font('Helvetica-Bold');
    doc.text('Descripción', leftColumn, yPos);
    doc.text('Cant', middleColumn - 80, yPos, { width: 60, align: 'right' });
    doc.text('Precio Unit.', middleColumn - 20, yPos, { width: 80, align: 'right' });
    doc.text('IVA', middleColumn + 60, yPos, { width: 40, align: 'right' });
    doc.text('Subtotal', middleColumn + 100, yPos, { width: 80, align: 'right' });
    yPos += 12;
    
    // Línea separadora
    doc.moveTo(leftColumn, yPos).lineTo(pageWidth - pageMargin, yPos).stroke();
    yPos += 8;
    
    // Items
    doc.fontSize(8).font('Helvetica');
    items.forEach(item => {
        const subtotal = (item.qty || 0) * (item.p_unit || 0);
        
        // Normalizar código (convierte 1→5, 2→4) y obtener alícuota
        const codigoNormalizado = normalizarCodigo(item.alic_iva_id);
        const ivaLabel = formatearPorcentaje(codigoNormalizado);
        
        doc.text(item.descripcion || 'Sin descripción', leftColumn, yPos, { width: middleColumn - leftColumn - 100 });
        doc.text(String(item.qty || 0), middleColumn - 80, yPos, { width: 60, align: 'right' });
        doc.text(formatearMoneda(item.p_unit), middleColumn - 20, yPos, { width: 80, align: 'right' });
        doc.text(ivaLabel, middleColumn + 60, yPos, { width: 40, align: 'right' });
        doc.text(formatearMoneda(subtotal), middleColumn + 100, yPos, { width: 80, align: 'right' });
        
        yPos += 15;
        
        // Nueva página si es necesario
        if (yPos > doc.page.height - 200) {
            doc.addPage();
            yPos = pageMargin;
        }
    });
    
    yPos += 5;
    
    // ===========================================
    // TOTALES CON IVA DISCRIMINADO POR TASA
    // ===========================================
    const totalsX = middleColumn + 40;
    const totalsWidth = 140;
    
    // Línea separadora
    doc.moveTo(totalsX, yPos).lineTo(pageWidth - pageMargin, yPos).stroke();
    yPos += 10;
    
    // Agrupar IVA por alícuota y calcular subtotales
    const ivasPorAlicuota = {};
    let netoGravado = 0;
    let netoExento = 0;
    let subtotalAntesDescuento = 0;
    
    items.forEach(item => {
        const codigoNormalizado = normalizarCodigo(item.alic_iva_id);
        const baseImp = parseFloat(item.imp_neto) || 0;
        const impIva = parseFloat(item.imp_iva) || 0;
        const qty = parseFloat(item.qty) || 0;
        const pUnit = parseFloat(item.p_unit) || 0;
        
        // Calcular subtotal antes del descuento (qty × precio unitario)
        subtotalAntesDescuento += qty * pUnit;
        
        if (codigoNormalizado === 3) {
            // Exento
            netoExento += baseImp;
        } else {
            // Gravado
            netoGravado += baseImp;
            
            if (!ivasPorAlicuota[codigoNormalizado]) {
                ivasPorAlicuota[codigoNormalizado] = 0;
            }
            ivasPorAlicuota[codigoNormalizado] += impIva;
        }
    });
    
    doc.fontSize(9).font('Helvetica');
    
    // Subtotal antes del descuento
    const descuento = parseFloat(factura.descuento) || 0;
    if (descuento > 0) {
        doc.text('Subtotal:', totalsX, yPos);
        doc.text(formatearMoneda(subtotalAntesDescuento), totalsX + 80, yPos, { width: 60, align: 'right' });
        yPos += 12;
        
        // Descuento
        const montoDescuento = subtotalAntesDescuento * descuento;
        const porcentajeDesc = (descuento * 100).toFixed(2).replace('.', ',');
        doc.text(`Descuento (${porcentajeDesc}%):`, totalsX, yPos);
        doc.text(`-${formatearMoneda(montoDescuento)}`, totalsX + 80, yPos, { width: 60, align: 'right' });
        yPos += 12;
    }
    
    // Subtotal Neto Gravado (ya con descuento aplicado)
    if (netoGravado > 0) {
        doc.text('Neto Gravado:', totalsX, yPos);
        doc.text(formatearMoneda(netoGravado), totalsX + 80, yPos, { width: 60, align: 'right' });
        yPos += 12;
    }
    
    // Subtotal Exento (si hay)
    if (netoExento > 0) {
        doc.text('Neto Exento:', totalsX, yPos);
        doc.text(formatearMoneda(netoExento), totalsX + 80, yPos, { width: 60, align: 'right' });
        yPos += 12;
    }
    
    // IVA discriminado por tasa
    const codigosOrdenados = Object.keys(ivasPorAlicuota).map(Number).sort((a, b) => a - b);
    
    if (codigosOrdenados.length > 0) {
        codigosOrdenados.forEach(codigo => {
            const montoIva = ivasPorAlicuota[codigo];
            const etiqueta = formatearPorcentaje(codigo);
            
            doc.text(`IVA ${etiqueta}:`, totalsX, yPos);
            doc.text(formatearMoneda(montoIva), totalsX + 80, yPos, { width: 60, align: 'right' });
            yPos += 12;
        });
        
        // Total IVA (si hay múltiples alícuotas)
        if (codigosOrdenados.length > 1) {
            const totalIva = Object.values(ivasPorAlicuota).reduce((sum, val) => sum + val, 0);
            doc.font('Helvetica-Bold');
            doc.text('Total IVA:', totalsX, yPos);
            doc.text(formatearMoneda(totalIva), totalsX + 80, yPos, { width: 60, align: 'right' });
            doc.font('Helvetica');
            yPos += 12;
        }
    }
    
    if (factura.imp_trib > 0) {
        doc.text('Otros Tributos:', totalsX, yPos);
        doc.text(formatearMoneda(factura.imp_trib), totalsX + 80, yPos, { width: 60, align: 'right' });
        yPos += 12;
    }
    
    // Línea separadora antes del total
    doc.moveTo(totalsX, yPos).lineTo(pageWidth - pageMargin, yPos).stroke();
    yPos += 10;
    
    doc.fontSize(11).font('Helvetica-Bold');
    doc.text('TOTAL:', totalsX, yPos);
    doc.text(formatearMoneda(factura.imp_total), totalsX + 60, yPos, { width: 100, align: 'right' });
    yPos += 20;
    
    // ===========================================
    // BLOQUE CAE (si existe)
    // ===========================================
    if (factura.cae) {
        yPos += 10;
        doc.fontSize(10).font('Helvetica-Bold').text('COMPROBANTE AUTORIZADO', leftColumn, yPos);
        yPos += 15;
        
        // Grid de 2 columnas: QR + Código de Barras
        const qrStartY = yPos;
        
        // COLUMNA IZQUIERDA - QR Code
        try {
            console.log('📱 [FACTURACION-PDF] Generando QR y código de barras...');
            const qrBuffer = await generarQR(factura);
            doc.image(qrBuffer, leftColumn, qrStartY, { width: 130, height: 130 });
        } catch (error) {
            console.warn('⚠️ [FACTURACION-PDF] No se pudo generar QR:', error.message);
        }
        
        // COLUMNA DERECHA - Código de Barras Code128
        try {
            // Convertir fechas a formato string YYYYMMDD
            const caeVtoStr = factura.cae_vto instanceof Date 
                ? factura.cae_vto.toISOString().split('T')[0].replace(/-/g, '')
                : String(factura.cae_vto).replace(/-/g, '');
            
            // Generar cadena del código de barras
            const barcodeValue = buildBarcodePayload({
                cuit11: COMPANY_CONFIG.cuitRaw,
                cbteTipo3: factura.tipo_cbte,
                ptoVta5: factura.pto_vta,
                cae14: factura.cae,
                caeVto8: caeVtoStr
            });
            
            console.log('📊 [FACTURACION-PDF] Código de barras:', barcodeValue);
            
            // Generar imagen del código de barras
            const barcodeBuffer = generateBarcodeImage(barcodeValue, {
                width: 1.5,
                height: 50,
                displayValue: true,
                fontSize: 10,
                margin: 5
            });
            
            // Posicionar código de barras a la derecha del QR
            const barcodeX = leftColumn + 150;
            doc.image(barcodeBuffer, barcodeX, qrStartY, { width: 320, height: 80 });
            
        } catch (error) {
            console.warn('⚠️ [FACTURACION-PDF] No se pudo generar código de barras:', error.message);
        }
        
        // Leyenda de autorización debajo (alineada a la derecha)
        yPos = qrStartY + 140;
        doc.fontSize(8).font('Helvetica');
        const leyendaX = middleColumn;
        doc.text('Comprobante autorizado por AFIP', leyendaX, yPos, { align: 'right' });
        yPos += 10;
        doc.text(`CAE: ${factura.cae}`, leyendaX, yPos, { align: 'right' });
        yPos += 10;
        doc.text(`Vencimiento: ${formatearFecha(factura.cae_vto)}`, leyendaX, yPos, { align: 'right' });
        yPos += 20;
    }
    
    // ===========================================
    // BLOQUE MEDIOS DE PAGO / TRANSFERENCIA
    // ===========================================
    if (COMPANY_CONFIG.bank || COMPANY_CONFIG.cbuFmt) {
        // Ir al final de la página si es necesario
        if (yPos < doc.page.height - 120) {
            yPos = doc.page.height - 120;
        }
        
        // Línea separadora
        doc.moveTo(leftColumn, yPos).lineTo(pageWidth - pageMargin, yPos).stroke();
        yPos += 15;
        
        doc.fontSize(10).font('Helvetica-Bold').text('MEDIOS DE PAGO / TRANSFERENCIA', leftColumn, yPos);
        yPos += 15;
        
        doc.fontSize(8).font('Helvetica');
        
        // Primera línea: Banco, DU, Cuenta
        if (COMPANY_CONFIG.bank) {
            let lineaBanco = COMPANY_CONFIG.bank;
            if (COMPANY_CONFIG.du) {
                lineaBanco += ` — DU ${COMPANY_CONFIG.du}`;
            }
            if (COMPANY_CONFIG.account) {
                lineaBanco += ` — Cta ${COMPANY_CONFIG.account}`;
            }
            doc.text(lineaBanco, leftColumn, yPos);
            yPos += 12;
        }
        
        // Segunda línea: CBU y Alias
        if (COMPANY_CONFIG.cbuFmt) {
            let lineaCBU = `CBU ${COMPANY_CONFIG.cbuFmt}`;
            if (COMPANY_CONFIG.alias) {
                lineaCBU += ` — Alias ${COMPANY_CONFIG.alias}`;
            }
            doc.text(lineaCBU, leftColumn, yPos);
        }
    }
    
    console.log('✅ [FACTURACION-PDF] Contenido construido');
};

/**
 * Generar código QR para factura usando helpers oficiales
 * @param {Object} factura - Datos de la factura
 * @returns {Promise<Buffer>} Buffer del QR
 */
const generarQR = async (factura) => {
    console.log('📱 [FACTURACION-PDF] Generando código QR...');
    
    try {
        // Convertir fecha a formato string YYYY-MM-DD
        const fechaStr = factura.fecha_emision instanceof Date
            ? factura.fecha_emision.toISOString().split('T')[0]
            : String(factura.fecha_emision).split('T')[0];
        
        // Generar URL del QR usando el helper oficial
        const qrUrl = generateQrUrl({
            ver: 1,
            fecha: fechaStr,
            cuit: COMPANY_CONFIG.cuitRaw,
            ptoVta: factura.pto_vta,
            tipoCmp: factura.tipo_cbte,
            nroCmp: factura.cbte_nro,
            importe: factura.imp_total,
            moneda: factura.moneda || 'PES',
            ctz: factura.mon_cotiz || 1,
            tipoDocRec: factura.doc_tipo,
            nroDocRec: factura.doc_nro,
            tipoCodAut: 'E',
            codAut: factura.cae
        });
        
        console.log('🔗 [FACTURACION-PDF] URL QR generada:', qrUrl);
        
        // Generar imagen QR desde la URL
        const qrBuffer = await QRCode.toBuffer(qrUrl, {
            errorCorrectionLevel: 'M',
            type: 'png',
            width: 200
        });
        
        console.log('✅ [FACTURACION-PDF] Código QR generado');
        
        return qrBuffer;
        
    } catch (error) {
        console.error('❌ [FACTURACION-PDF] Error generando QR:', error.message);
        throw error;
    }
};

/**
 * Generar PDF y guardarlo en archivo
 * @param {Object} factura - Datos de la factura
 * @param {Array} items - Items de la factura
 * @param {string} rutaArchivo - Ruta donde guardar el PDF
 * @returns {Promise<string>} Ruta del archivo generado
 */
const generarYGuardarPDF = async (factura, items, rutaArchivo) => {
    console.log('💾 [FACTURACION-PDF] Generando y guardando PDF en:', rutaArchivo);
    
    try {
        const pdfBuffer = await generarPDF(factura, items);
        
        const fs = require('fs').promises;
        await fs.writeFile(rutaArchivo, pdfBuffer);
        
        console.log('✅ [FACTURACION-PDF] PDF guardado exitosamente');
        
        return rutaArchivo;
        
    } catch (error) {
        console.error('❌ [FACTURACION-PDF] Error guardando PDF:', error.message);
        throw error;
    }
};

console.log('✅ [FACTURACION-PDF] Generador de PDF cargado');

module.exports = {
    generarPDF,
    generarQR,
    generarYGuardarPDF
};
