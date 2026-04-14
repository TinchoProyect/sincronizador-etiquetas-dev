const PDFDocument = require('pdfkit');
const TratamientosModel = require('../models/tratamientosModel');

async function imprimirPDF(req, res) {
    try {
        const { hash } = req.params;
        
        // Obtenemos todos los datos desde el payload estructurado
        const data = await TratamientosModel.obtenerInfoSesion(hash);

        if (!data || !data.detalles) {
            return res.status(404).send('La Orden de Tratamiento especificada no existe o no contiene detalles de check-in consolidados.');
        }

        // Initialize PDFKit
        const doc = new PDFDocument({ margin: 50, size: 'A4' });

        // Configuration HTTP para que el browser o whatsapp asimile el PDF.
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="Tratamiento_RT-${data.id}.pdf"`);

        doc.pipe(res);

        // Header: Logo / Title
        doc.fontSize(22).font('Helvetica-Bold').fillColor('#1e40af').text('LAMDA - ETIQUETAS', { align: 'center' });
        doc.moveDown(0.2);
        doc.fontSize(12).fillColor('#64748b').text('COMPROBANTE DE RECOLECCIÓN DE MERCADERÍA - FASE 3', { align: 'center' });
        doc.moveDown(2);

        // Separators line
        doc.moveTo(50, doc.y).lineTo(540, doc.y).strokeColor('#e2e8f0').stroke();
        doc.moveDown(1.5);

        // Box: Client & General Info
        doc.fontSize(16).fillColor('#0f172a').text('Datos Formales', { underline: true });
        doc.moveDown(0.5);

        doc.fontSize(12).fillColor('#000000');
        doc.font('Helvetica-Bold').text(`Orden ID: `, { continued: true }).font('Helvetica').text(`RT-${data.id}`);
        doc.font('Helvetica-Bold').text(`Cliente: `, { continued: true }).font('Helvetica').text(`${data.nombre || ''} ${data.apellido || ''}`.trim() || 'Sin Nombre');
        doc.font('Helvetica-Bold').text(`Estado Logístico: `, { continued: true }).font('Helvetica').text(`${data.estado_logistico}`);

        // Default to now if fecha is missing
        const parseF = data.fecha_validacion_chofer ? new Date(data.fecha_validacion_chofer).toLocaleString('es-AR') : new Date().toLocaleString('es-AR');
        doc.font('Helvetica-Bold').text(`Fecha de Relevamiento: `, { continued: true }).font('Helvetica').text(parseF);
        
        doc.moveDown(1.5);

        // Details of Merchandise
        doc.fontSize(16).font('Helvetica-Bold').text('Detalle de Ingreso (Bultos Físicos)', { underline: true });
        doc.moveDown(0.5);

        const det = data.detalles;
        doc.fontSize(12).font('Helvetica');
        doc.text(`Kilos Reportados:\t ${det.kilos} Kg`);
        doc.text(`Cantidad de Bultos:\t ${det.bultos}`);
        doc.text(`Art. Número:\t\t\t${det.articulo_numero || 'S/N'}`);
        doc.text(`Motivo/Estado:\t\t  ${det.motivo}`);
        doc.text(`Contenido / Obs:\t\t${det.descripcion_externa || '-'}`);

        doc.moveDown(2);
        doc.moveTo(50, doc.y).lineTo(540, doc.y).strokeColor('#e2e8f0').stroke();
        doc.moveDown(2);

        // Responsability Fields
        doc.fontSize(16).font('Helvetica-Bold').text('Responsabilidad y Protocolo de Custodia', { underline: true });
        doc.moveDown(0.5);

        // Split into two columns for signatures
        const finalY = doc.y;

        // Responsable Cliente (Izquierda)
        doc.fontSize(11).font('Helvetica-Bold').text('RESPONSABLE CARGA (CLIENTE)', 50, finalY);
        doc.font('Helvetica').text(`Nombre: ${data.responsable_nombre || '___________________'}`);
        doc.font('Helvetica').text(`Apellido: ${data.responsable_apellido || '___________________'}`);
        doc.font('Helvetica').text(`Contacto: ${data.responsable_celular || '___________________'}`);
        
        doc.moveDown(2);
        doc.text('Firma Responsable', 50, doc.y + 30);
        doc.moveTo(50, doc.y - 1).lineTo(220, doc.y - 1).strokeColor('#000000').stroke();

        // Chofer (Derecha)
        doc.fontSize(11).font('Helvetica-Bold').text('AGENTE LOGÍSTICO (LAMDA)', 300, finalY);
        doc.font('Helvetica').text(`Nombre Chofer: ${data.chofer_nombre || '___________________'}`);
        
        doc.text('Firma Chofer', 300, doc.y + 60); // Offset to align with the other side approximately
        doc.moveTo(300, doc.y - 1).lineTo(470, doc.y - 1).strokeColor('#000000').stroke();

        doc.moveDown(4);

        // Footer
        doc.fontSize(9).fillColor('#94a3b8').text(
            'El presente documento certifica la recepción de mercadería según el protocolo FASE 3 del sistema de tratamientos y reposicionamiento, el cual entra en revisión bajo el área de Mantenimiento de LAMDA. No implica nota de crédito ni ajuste contable sin previa auditoría obligatoria.', 
            50, 
            doc.page.height - 100, 
            { align: 'justify', width: 500 }
        );

        doc.end();

    } catch (error) {
        console.error('[PDF-TRATAMIENTOS] Error de generación:', error);
        res.status(500).send('Falló la generación del comprobante PDF.');
    }
}

module.exports = {
    imprimirPDF
};
