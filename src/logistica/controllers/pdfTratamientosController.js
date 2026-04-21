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
        // Determinar contexto de nomenclatura según el módulo que solicita el PDF
        const contexto = req.query.ctx === 'mantenimiento' ? 'mantenimiento' : 'tratamiento';
        const numCliente = data.cliente_id || 'SF';
        const strNombre = `${data.nombre || ''} ${data.apellido || ''}`.trim() || 'Sin_Nombre';
        const sanitizeNombre = strNombre.replace(/[^a-zA-Z0-9\s]/g, '').trim();
        const hoyFmt = new Date().toLocaleDateString('es-AR').replace(/\//g, '-');
        const dynamicFilename = `${numCliente} ${sanitizeNombre} mercaderia ${contexto} ${hoyFmt}.pdf`;

        // Setting info: Title will force Chrome's Print mechanism to suggest the correct name.
        const doc = new PDFDocument({ margin: 50, size: 'A4', info: { Title: dynamicFilename } });

        // Configuration HTTP para que el browser o whatsapp asimile el PDF.
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${dynamicFilename}"`);

        doc.pipe(res);

        // Header: Logo / Title
        const headerY = doc.y;
        doc.fontSize(22).font('Helvetica-Bold').fillColor('#1e40af').text('LAMDA', 50, headerY);
        const hoy = new Date().toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
        doc.fontSize(10).fillColor('#94a3b8').text(`Fecha de Emisión: ${hoy}`, 390, headerY + 8, { width: 150, align: 'right' });
        
        doc.moveDown(1.5);
        doc.fontSize(12).fillColor('#64748b').text('COMPROBANTE DE RECOLECCIÓN DE MERCADERÍA', 50, doc.y, { align: 'left' });
        doc.moveDown(2);

        // Separators line
        doc.moveTo(50, doc.y).lineTo(540, doc.y).strokeColor('#e2e8f0').stroke();
        doc.moveDown(1.5);

        // Box: Client & General Info
        doc.fontSize(16).fillColor('#0f172a').text('Datos Formales', { underline: true });
        doc.moveDown(0.5);

        doc.fontSize(12).fillColor('#000000');
        doc.font('Helvetica-Bold').text(`Orden ID: `, { continued: true }).font('Helvetica').text(`RT-${data.id}`);
        const clientText = `${data.nombre || ''} ${data.apellido || ''}`.trim() + (data.cliente_id ? ` (${data.cliente_id})` : '');
        doc.font('Helvetica-Bold').text(`Cliente: `, { continued: true }).font('Helvetica').text(clientText || 'Sin Nombre');
        doc.font('Helvetica-Bold').text(`Estado del Tratamiento: `, { continued: true }).font('Helvetica').text(`${data.inventario_estado || data.estado_tratamiento || 'RETIRO_PENDIENTE'}`);

        // Set 'Fecha de inicio de tratamiento' as the current printed date
        const parseF = new Date().toLocaleString('es-AR');
        doc.font('Helvetica-Bold').text(`Fecha de inicio de tratamiento: `, { continued: true }).font('Helvetica').text(parseF);
        
        doc.moveDown(1.5);

        // Details of Merchandise
        doc.fontSize(16).font('Helvetica-Bold').text('Detalle de Ingreso (Bultos Físicos)', { underline: true });
        doc.moveDown(0.5);

        const det = data.detalles;
        const fRetiro = data.fecha_validacion_chofer ? new Date(data.fecha_validacion_chofer).toLocaleString('es-AR') : 'No ingresada';
        
        doc.fontSize(12).font('Helvetica');
        doc.font('Helvetica-Bold').text('Fecha de Check-in:', { continued: true }).font('Helvetica').text(` ${fRetiro}`);
        doc.font('Helvetica-Bold').text('Kilos Reportados:', { continued: true }).font('Helvetica').text(` ${det.kilos} Kg`);
        doc.font('Helvetica-Bold').text('Cantidad de Bultos:', { continued: true }).font('Helvetica').text(` ${det.bultos}`);
        doc.font('Helvetica-Bold').text('Art. Número:', { continued: true }).font('Helvetica').text(` ${det.articulo_numero || 'S/N'}`);
        doc.font('Helvetica-Bold').text('Motivo/Estado:', { continued: true }).font('Helvetica').text(` ${det.motivo}`);
        doc.font('Helvetica-Bold').text('Contenido / Obs:', { continued: true }).font('Helvetica').text(` ${det.descripcion_externa || '-'}`);

        doc.moveDown(1.5);
        doc.moveTo(50, doc.y).lineTo(540, doc.y).strokeColor('#e2e8f0').stroke();
        doc.moveDown(1);

        // Fase 2: Planta (Opcional)
        if (data.planta) {
            doc.fontSize(16).fillColor('#000000').font('Helvetica-Bold').text('Fase 2: Procesamiento en Planta', { underline: true });
            doc.moveDown(0.5);
            doc.fontSize(12).font('Helvetica');
            const ptF = data.planta.fecha ? new Date(data.planta.fecha).toLocaleString('es-AR') : '-';
            doc.font('Helvetica-Bold').text('Fecha y Hora de Proceso:', { continued: true }).font('Helvetica').text(` ${ptF}`);
            doc.font('Helvetica-Bold').text('Operario Responsable:', { continued: true }).font('Helvetica').text(` ${data.planta.operario}`);
            doc.font('Helvetica-Bold').text('Kilos Consolidado:', { continued: true }).font('Helvetica').text(` ${data.planta.kilos_resultantes || det.kilos} Kg`);
            doc.font('Helvetica-Bold').text('Observaciones/Bultos:', { continued: true }).font('Helvetica').text(` ${data.planta.observaciones || '-'}`);
            doc.moveDown(1.5);
            doc.moveTo(50, doc.y).lineTo(540, doc.y).strokeColor('#e2e8f0').stroke();
            doc.moveDown(1);
        }

        // Responsability Fields
        doc.fontSize(16).font('Helvetica-Bold').text('Responsabilidad y Protocolo de Custodia', { underline: true });
        doc.moveDown(0.5);

        // Split into two columns for signatures
        const finalY = doc.y;

        // Responsable Cliente (Izquierda)
        doc.fontSize(11).font('Helvetica-Bold').text('RESPONSABLE CARGA', 50, finalY);
        doc.font('Helvetica').text(`Nombre: ${data.responsable_nombre || 'No provisto'}`);
        doc.font('Helvetica').text(`Apellido: ${data.responsable_apellido || 'No provisto'}`);
        doc.font('Helvetica').text(`Contacto: ${data.responsable_celular || 'No provisto'}`);

        // Chofer (Derecha)
        doc.fontSize(11).font('Helvetica-Bold').text('ASISTENCIA DE RECEPCIÓN (LAMDA)', 300, finalY);
        doc.font('Helvetica').text(`Nombre Chofer: ${data.chofer_nombre || 'No provisto'}`);

        doc.moveDown(4);

        // Fase 3: Entrega
        if (data.entrega) {
            doc.moveTo(50, doc.y).lineTo(540, doc.y).strokeColor('#e2e8f0').stroke();
            doc.moveDown(1.5);
            
            doc.fontSize(16).fillColor('#166534').font('Helvetica-Bold').text('Fase 3: Certificado de Entrega Final', 50, doc.y, { underline: true });
            doc.moveDown(0.5);
            doc.fontSize(12).fillColor('#000000').font('Helvetica');
            const etF = data.entrega.fecha ? new Date(data.entrega.fecha).toLocaleString('es-AR') : '-';
            doc.font('Helvetica-Bold').text('Fecha y Hora de Entrega:', { continued: true }).font('Helvetica').text(` ${etF}`);
            doc.font('Helvetica-Bold').text('Receptor:', { continued: true }).font('Helvetica').text(` ${data.entrega.receptor || 'Anonimo'}`);
            
            if (data.entrega.firma_digital) {
                try {
                    // La firma debe venir como data:image/png;base64,...
                    doc.image(data.entrega.firma_digital, 50, doc.y + 10, { width: 150 });
                    doc.moveDown(6);
                } catch(e) {
                    doc.moveDown(2);
                    doc.text('Firma [Ilegible]', 50, doc.y);
                    doc.moveDown(2);
                }
            } else {
                doc.moveDown(3);
                doc.text('Firma Receptor Final_________________', 50, doc.y);
                doc.moveDown(2);
            }
        }

        // Footer
        doc.fontSize(9).fillColor('#94a3b8').text(
            'El presente documento certifica la recolección, mantenimiento y/o devolución de mercadería según el protocolo del sistema de trazabilidad de LAMDA. Su generación es acumulativa por hitos y garantiza la integridad de los registros.', 
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
