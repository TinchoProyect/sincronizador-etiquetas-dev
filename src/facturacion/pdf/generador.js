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
        // Crear documento PDF con márgenes apropiados para A4 y bufferPages habilitado para numerar al final
        const doc = new PDFDocument({
            size: 'A4',
            margin: 40,
            bufferPages: true,
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
        
        // Agregar números de página al final (Página X de Y) en el pie de página
        const range = doc.bufferedPageRange();
        for (let i = 0; i < range.count; i++) {
            doc.switchToPage(i);
            doc.save();
            doc.fontSize(7.5).font('Helvetica').fillColor('#64748b');
            const oldBottomMargin = doc.page.margins.bottom;
            doc.page.margins.bottom = 0;
            doc.text(
                `Página ${i + 1} de ${range.count}`, 
                40, 
                doc.page.height - 25, 
                { align: 'center', width: doc.page.width - 80 }
            );
            doc.page.margins.bottom = oldBottomMargin;
            doc.restore();
        }
        
        // Finalizar documento
        doc.end();
        
        return await pdfPromise;
        
    } catch (error) {
        console.error('❌ [FACTURACION-PDF] Error generando PDF:', error.message);
        throw error;
    }
};

/**
 * Obtener la letra del comprobante según normativa AFIP
 */
const obtenerLetraComprobante = (tipoCbte) => {
    const tipo = parseInt(tipoCbte);
    if ([1, 2, 3, 81, 82].includes(tipo)) return 'A';
    if ([6, 7, 8, 115, 116].includes(tipo)) return 'B';
    if ([11, 12, 13].includes(tipo)) return 'C';
    return 'X';
};

/**
 * Construir contenido del PDF con diseño profesional
 * @param {PDFDocument} doc - Documento PDF
 * @param {Object} factura - Datos de la factura
 * @param {Array} items - Items de la factura
 */
const construirPDF = async (doc, factura, items) => {
    console.log('📝 [FACTURACION-PDF] Construyendo contenido del PDF...');
    
    const path = require('path');
    const fs = require('fs');
    const pageWidth = doc.page.width;
    const pageMargin = doc.page.margins.left;
    const contentWidth = pageWidth - (pageMargin * 2);
    const leftColumn = pageMargin;
    const middleColumn = pageMargin + (contentWidth / 2);
    
    // Función auxiliar para dibujar la cabecera repetible y el bloque del cliente en cada página
    const dibujarHeaderYCliente = async (esPrimera) => {
        let localY = pageMargin;
        
        // 1. Cargar Logo de la Empresa
        const logoPath = path.join(__dirname, '../img/logo_LAMDA_grande.png');
        let hasLogo = false;
        if (fs.existsSync(logoPath)) {
            doc.image(logoPath, leftColumn, localY, { width: 90 }); // Ancho reducido de 110 a 90 para compactar
            hasLogo = true;
        }
        
        // Datos de la empresa debajo del logo (sin el nombre duplicado)
        let companyY = localY + (hasLogo ? 38 : 0);
        
        doc.fontSize(8).font('Helvetica').fillColor('#1e293b');
        doc.text(`Dirección: ${COMPANY_CONFIG.address}`, leftColumn, companyY);
        doc.text(`Condición frente al IVA: Responsable Inscripto`, leftColumn, companyY + 9);
        
        const phoneToShow = COMPANY_CONFIG.phone || '221-6615746';
        let contactLine = `Tel / WA: ${phoneToShow}`;
        if (COMPANY_CONFIG.email) contactLine += ` | Email: ${COMPANY_CONFIG.email}`;
        doc.text(contactLine, leftColumn, companyY + 18);
        
        // 2. Recuadro del Tipo de Comprobante (Letra Central AFIP)
        const tipoCbte = parseInt(factura.tipo_cbte);
        const letra = obtenerLetraComprobante(tipoCbte);
        
        const boxWidth = 32;
        const boxHeight = 32;
        const boxX = (pageWidth / 2) - (boxWidth / 2);
        const boxY = localY;
        
        doc.save();
        doc.rect(boxX, boxY, boxWidth, boxHeight).fillColor('#8e4785').fill();
        doc.fontSize(18).font('Helvetica-Bold').fillColor('#ffffff').text(letra, boxX, boxY + 6, { width: boxWidth, align: 'center' });
        doc.restore();
        
        // Código del comprobante AFIP debajo del recuadro
        const codigoCbte = String(tipoCbte).padStart(3, '0');
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#8e4785').text(`COD. ${codigoCbte}`, (pageWidth / 2) - 50, boxY + boxHeight + 3, { width: 100, align: 'center' });
        
        // Línea divisoria vertical
        doc.moveTo(pageWidth / 2, boxY + boxHeight + 12)
           .lineTo(pageWidth / 2, localY + 82)
           .strokeColor('#e2e8f0')
           .lineWidth(1)
           .stroke();
        
        // 3. Columna Derecha - Datos del Comprobante
        let rightY = localY;
        const tipoDesc = TIPOS_COMPROBANTE[factura.tipo_cbte] || 'Comprobante';
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#8e4785').text(tipoDesc.toUpperCase(), middleColumn + 20, rightY);
        
        rightY += 15;
        
        // Número formateado
        let compNum = '';
        if (factura.cbte_nro) {
            compNum = `${String(factura.pto_vta).padStart(5, '0')} - ${String(factura.cbte_nro).padStart(8, '0')}`;
        } else if (factura.nro_interno) {
            compNum = `${factura.serie_interna || 'B'} - ${String(factura.nro_interno).padStart(8, '0')}`;
        }
        
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#1e293b').text(`Nº ${compNum}`, middleColumn + 20, rightY);
        
        rightY += 14;
        doc.fontSize(8).font('Helvetica').fillColor('#475569');
        doc.text(`Fecha de Emisión: ${formatearFecha(factura.fecha_emision)}`, middleColumn + 20, rightY);
        doc.text(`CUIT: ${COMPANY_CONFIG.cuitFmt}`, middleColumn + 20, rightY + 9);
        doc.text(`Ingresos Brutos: ${COMPANY_CONFIG.cuitFmt}`, middleColumn + 20, rightY + 18);
        doc.text(`Inicio de Actividades: ${COMPANY_CONFIG.inicioActividad || '01/01/2026'}`, middleColumn + 20, rightY + 27);
        
        // Separador de cabecera
        localY = localY + 80;
        doc.moveTo(leftColumn, localY).lineTo(pageWidth - pageMargin, localY).strokeColor('#8e4785').lineWidth(1.5).stroke();
        localY += 6;
        
        // 4. BLOQUE RECEPTOR (CLIENTE)
        doc.save();
        doc.roundedRect(leftColumn, localY, contentWidth, 54, 4).fillColor('#f8fafc').fill();
        doc.roundedRect(leftColumn, localY, contentWidth, 54, 4).strokeColor('#e2e8f0').lineWidth(0.75).stroke();
        doc.restore();
        
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#8e4785').text('RECEPTOR DEL COMPROBANTE', leftColumn + 10, localY + 5);
        
        let clientY = localY + 15;
        doc.fontSize(8).font('Helvetica').fillColor('#1e293b');
        
        // Razón Social
        doc.text(`Razón Social: ${factura.razon_social || 'Consumidor Final'}`, leftColumn + 10, clientY, { width: contentWidth / 2 - 20 });
        
        // Domicilio Fiscal (debajo de Razón Social)
        doc.text(`Domicilio Fiscal: ${factura.cliente_domicilio || 'S/D'}`, leftColumn + 10, clientY + 16, { width: contentWidth / 2 - 20 });
        
        // Documento (CUIT/DNI)
        const tipoDoc = factura.doc_tipo === 80 ? 'CUIT' : factura.doc_tipo === 96 ? 'DNI' : 'Doc';
        doc.text(`${tipoDoc}: ${factura.cliente_cuit || factura.doc_nro || 'S/D'}`, middleColumn + 10, clientY);
        
        // Condición IVA
        const condicion = factura.cliente_condicion_iva || CONDICIONES_IVA[factura.condicion_iva_id] || 'Consumidor Final';
        doc.text(`Condición IVA: ${condicion}`, middleColumn + 10, clientY + 12);
        
        // Provincia
        doc.text(`Provincia: ${factura.cliente_provincia || 'S/D'}`, middleColumn + 10, clientY + 24);
        
        localY += 60;
        
        // 5. CABECERA DE LA TABLA
        doc.save();
        doc.rect(leftColumn, localY, contentWidth, 12).fillColor('#8e4785').fill();
        doc.restore();
        
        doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#ffffff');
        doc.text('Descripción', leftColumn + 8, localY + 2.5);
        doc.text('Cant', middleColumn - 80, localY + 2.5, { width: 60, align: 'right' });
        doc.text('Precio Unit.', middleColumn - 20, localY + 2.5, { width: 80, align: 'right' });
        doc.text('IVA', middleColumn + 60, localY + 2.5, { width: 40, align: 'right' });
        doc.text('Subtotal', middleColumn + 100, localY + 2.5, { width: 80, align: 'right' });
        
        return localY + 15;
    };
    
    // Iniciar dibujando la primera página
    let yPos = await dibujarHeaderYCliente(true);
    
    // ===========================================
    // DETALLE DE PRODUCTOS (TABLA)
    // ===========================================
    doc.fontSize(8).font('Helvetica').fillColor('#1e293b');
    for (let index = 0; index < items.length; index++) {
        const item = items[index];
        const subtotal = (item.qty || 0) * (item.p_unit || 0);
        const codigoNormalizado = normalizarCodigo(item.alic_iva_id);
        const ivaLabel = formatearPorcentaje(codigoNormalizado);
        
        // Escribir contenido del item
        doc.text(item.descripcion || 'Sin descripción', leftColumn + 8, yPos, { width: middleColumn - leftColumn - 100 });
        doc.text(String(item.qty || 0), middleColumn - 80, yPos, { width: 60, align: 'right' });
        doc.text(formatearMoneda(item.p_unit), middleColumn - 20, yPos, { width: 80, align: 'right' });
        doc.text(ivaLabel, middleColumn + 60, yPos, { width: 40, align: 'right' });
        doc.text(formatearMoneda(subtotal), middleColumn + 100, yPos, { width: 80, align: 'right' });
        
        yPos += 13; // Espaciado vertical reducido de 16 a 13 (sándwich de jamón)
        
        // Línea sutil de división entre filas
        doc.moveTo(leftColumn, yPos - 2)
           .lineTo(pageWidth - pageMargin, yPos - 2)
           .strokeColor('#f1f5f9')
           .lineWidth(0.5)
           .stroke();
        
        // Salto de página si excede el límite y quedan más items
        if (yPos > doc.page.height - 60 && index < items.length - 1) {
            doc.addPage();
            yPos = await dibujarHeaderYCliente(false);
            doc.fontSize(8).font('Helvetica').fillColor('#1e293b');
        }
    }
    
    yPos += 5;
    
    // ===========================================
    // TOTALES Y RESUMEN FINANCIERO (Al final del doc)
    // ===========================================
    const totalsX = middleColumn + 40;
    const totalsWidth = 140;
    
    // Calcular totales y subtotales
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
        
        subtotalAntesDescuento += qty * pUnit;
        
        if (codigoNormalizado === 3) {
            netoExento += baseImp;
        } else {
            netoGravado += baseImp;
            if (!ivasPorAlicuota[codigoNormalizado]) {
                ivasPorAlicuota[codigoNormalizado] = 0;
            }
            ivasPorAlicuota[codigoNormalizado] += impIva;
        }
    });
    
    // Calcular altura total requerida por el panel de totales
    let totalRows = 1; // Para TOTAL
    const descuento = parseFloat(factura.descuento) || 0;
    if (descuento > 0) totalRows += 2;
    if (netoGravado > 0) totalRows += 1;
    if (netoExento > 0) totalRows += 1;
    totalRows += Object.keys(ivasPorAlicuota).length;
    if (factura.imp_trib > 0) totalRows += 1;
    
    const cardHeight = (totalRows * 10) + 18; // Cada fila toma 10 pt
    
    // Validar si los totales, el bloque de autorización AFIP y los datos bancarios caben en la página actual
    const espacioAutorizacion = factura.cae ? 132 : 40;
    const tieneBanco = !!(COMPANY_CONFIG.bank || COMPANY_CONFIG.cbuFmt);
    const espacioBanco = tieneBanco ? 65 : 0;
    const espacioRequeridoTotal = cardHeight + espacioAutorizacion + espacioBanco;
    
    if (yPos > doc.page.height - (espacioRequeridoTotal + 20)) {
        doc.addPage();
        yPos = await dibujarHeaderYCliente(false);
    }
    
    // Dibujar tarjeta del resumen de totales
    doc.save();
    doc.rect(totalsX - 10, yPos - 5, totalsWidth + 10, cardHeight).fillColor('#f8fafc').fill();
    doc.rect(totalsX - 10, yPos - 5, totalsWidth + 10, cardHeight).strokeColor('#e2e8f0').lineWidth(0.75).stroke();
    doc.restore();
    
    let localY = yPos;
    doc.fontSize(8).font('Helvetica').fillColor('#475569');
    
    if (descuento > 0) {
        doc.text('Subtotal:', totalsX, localY);
        doc.font('Helvetica-Bold').fillColor('#1e293b').text(formatearMoneda(subtotalAntesDescuento), totalsX + 70, localY, { width: 70, align: 'right' });
        doc.font('Helvetica').fillColor('#475569');
        localY += 10;
        
        const montoDescuento = subtotalAntesDescuento * descuento;
        const porcentajeDesc = (descuento * 100).toFixed(2).replace('.', ',');
        doc.text(`Desc. (${porcentajeDesc}%):`, totalsX, localY);
        doc.font('Helvetica-Bold').fillColor('#ef4444').text(`-${formatearMoneda(montoDescuento)}`, totalsX + 70, localY, { width: 70, align: 'right' });
        doc.font('Helvetica').fillColor('#475569');
        localY += 10;
    }
    
    if (netoGravado > 0) {
        doc.text('Neto Gravado:', totalsX, localY);
        doc.font('Helvetica-Bold').fillColor('#1e293b').text(formatearMoneda(netoGravado), totalsX + 70, localY, { width: 70, align: 'right' });
        doc.font('Helvetica').fillColor('#475569');
        localY += 10;
    }
    
    if (netoExento > 0) {
        doc.text('Neto Exento:', totalsX, localY);
        doc.font('Helvetica-Bold').fillColor('#1e293b').text(formatearMoneda(netoExento), totalsX + 70, localY, { width: 70, align: 'right' });
        doc.font('Helvetica').fillColor('#475569');
        localY += 10;
    }
    
    const codigosOrdenados = Object.keys(ivasPorAlicuota).map(Number).sort((a, b) => a - b);
    if (codigosOrdenados.length > 0) {
        codigosOrdenados.forEach(codigo => {
            const montoIva = ivasPorAlicuota[codigo];
            const etiqueta = formatearPorcentaje(codigo);
            
            doc.text(`IVA ${etiqueta}:`, totalsX, localY);
            doc.font('Helvetica-Bold').fillColor('#1e293b').text(formatearMoneda(montoIva), totalsX + 70, localY, { width: 70, align: 'right' });
            doc.font('Helvetica').fillColor('#475569');
            localY += 10;
        });
    }
    
    if (factura.imp_trib > 0) {
        doc.text('Otros Tributos:', totalsX, localY);
        doc.font('Helvetica-Bold').fillColor('#1e293b').text(formatearMoneda(factura.imp_trib), totalsX + 70, localY, { width: 70, align: 'right' });
        doc.font('Helvetica').fillColor('#475569');
        localY += 10;
    }
    
    // Separador total
    doc.moveTo(totalsX - 5, localY + 1).lineTo(totalsX + totalsWidth, localY + 1).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
    localY += 4;
    
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#8e4785');
    doc.text('TOTAL:', totalsX, localY);
    doc.text(formatearMoneda(factura.imp_total), totalsX + 60, localY, { width: 80, align: 'right' });
    
    yPos = Math.max(yPos + cardHeight + 10, localY + 16);
    
    // ===========================================
    // PIE DE AUTORIZACIÓN AFIP (CAE / QR / BARCODE)
    // ===========================================
    if (factura.cae) {
        yPos += 10;
        
        doc.save();
        // Recuadro CAE compactado (altura 110 pt)
        doc.rect(leftColumn, yPos, contentWidth, 110).strokeColor('#8e4785').lineWidth(1).stroke();
        doc.restore();
        
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#8e4785').text('COMPROBANTE AUTORIZADO POR ARCA', leftColumn + 10, yPos + 6);
        
        const qrStartY = yPos + 16;
        
        // Renderizar Código QR
        try {
            const qrBuffer = await generarQR(factura);
            doc.image(qrBuffer, leftColumn + 10, qrStartY, { width: 85, height: 85 }); // Redimensionado de 72 a 85 pt
        } catch (error) {
            console.warn('⚠️ [FACTURACION-PDF] No se pudo generar QR:', error.message);
        }
        
        // Renderizar Código de Barras Code128
        try {
            const caeVtoStr = factura.cae_vto instanceof Date 
                ? factura.cae_vto.toISOString().split('T')[0].replace(/-/g, '')
                : String(factura.cae_vto).replace(/-/g, '');
            
            const barcodeValue = buildBarcodePayload({
                cuit11: COMPANY_CONFIG.cuitRaw,
                cbteTipo3: factura.tipo_cbte,
                ptoVta5: factura.pto_vta,
                cae14: factura.cae,
                caeVto8: caeVtoStr
            });
            
            const barcodeBuffer = generateBarcodeImage(barcodeValue, {
                width: 1.3,
                height: 32,
                displayValue: true,
                fontSize: 8,
                margin: 1
            });
            
            const barcodeX = leftColumn + 110;
            doc.image(barcodeBuffer, barcodeX, qrStartY + 10, { width: 250, height: 45 }); // Centrado y espaciado
            
        } catch (error) {
            console.warn('⚠️ [FACTURACION-PDF] No se pudo generar código de barras:', error.message);
        }
        
        // Leyenda de autorización AFIP
        doc.fontSize(7.5).font('Helvetica').fillColor('#475569');
        doc.text(`CAE: ${factura.cae}`, middleColumn + 85, qrStartY + 62, { align: 'right' });
        doc.text(`Vencimiento CAE: ${formatearFecha(factura.cae_vto)}`, middleColumn + 85, qrStartY + 72, { align: 'right' });
        
        yPos += 120;
    }
    
    // ===========================================
    // PIE DE PÁGINA - DATOS BANCARIOS (SI APLICA)
    // ===========================================
    if (COMPANY_CONFIG.bank || COMPANY_CONFIG.cbuFmt) {
        if (yPos < doc.page.height - 95) {
            yPos = doc.page.height - 95;
        }
        
        doc.moveTo(leftColumn, yPos).lineTo(pageWidth - pageMargin, yPos).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
        yPos += 6;
        
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#8e4785').text('MEDIOS DE PAGO / TRANSFERENCIA', leftColumn, yPos);
        yPos += 10;
        
        // Dibujar recuadro destacado para el ALIAS a la derecha
        if (COMPANY_CONFIG.alias) {
            const aliasBoxWidth = 155;
            const aliasBoxHeight = 28;
            const aliasBoxX = pageWidth - pageMargin - aliasBoxWidth;
            const aliasBoxY = yPos - 2;
            
            doc.save();
            doc.roundedRect(aliasBoxX, aliasBoxY, aliasBoxWidth, aliasBoxHeight, 4)
               .fillColor('#fdf6fd') // Violeta muy claro
               .fill();
            doc.roundedRect(aliasBoxX, aliasBoxY, aliasBoxWidth, aliasBoxHeight, 4)
               .strokeColor('#8e4785')
               .lineWidth(0.75)
               .stroke();
            doc.restore();
            
            doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#8e4785').text('ALIAS PARA TRANSFERIR', aliasBoxX, aliasBoxY + 5, { width: aliasBoxWidth, align: 'center' });
            doc.fontSize(10.5).font('Helvetica-Bold').fillColor('#8e4785').text(COMPANY_CONFIG.alias, aliasBoxX, aliasBoxY + 13, { width: aliasBoxWidth, align: 'center' });
        }
        
        doc.fontSize(7.5).font('Helvetica').fillColor('#475569');
        let textY = yPos;
        
        if (COMPANY_CONFIG.bank) {
            let bankLine = COMPANY_CONFIG.bank;
            if (COMPANY_CONFIG.du) bankLine += ` — DU: ${COMPANY_CONFIG.du}`;
            if (COMPANY_CONFIG.account) bankLine += ` — Cta. Corriente: ${COMPANY_CONFIG.account}`;
            doc.text(bankLine, leftColumn, textY);
            textY += 10;
        }
        
        if (COMPANY_CONFIG.cbuFmt) {
            doc.text(`CBU: ${COMPANY_CONFIG.cbuFmt}`, leftColumn, textY);
            textY += 10;
        }
        
        doc.text(`CUIT/CUIL: ${COMPANY_CONFIG.cuitFmt}`, leftColumn, textY);
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
            width: 160 // Reducido ancho del QR generado de 200 a 160
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
