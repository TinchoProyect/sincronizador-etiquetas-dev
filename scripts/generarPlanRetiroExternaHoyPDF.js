/**
 * Generador del PDF Operativo: RETIRO PARA PRODUCCIÓN EXTERNA — LÍNEA DE NEGOCIO 4, 5 Y 6 (MIÉRCOLES 04/11/2026)
 * DIRECTRIZ OFICIAL DEL DIRECTOR:
 * - "En cuanto a retiro externo, si no hay nada para retirar, solamente el informe tiene que decir
 *    que no hay nada para producir y nada más, no tiene que decir 'ah, ya trajiste esto, entonces'."
 * Ubicación servida en la Pizarra Principal: /documentos/Plan_Retiro_Produccion_Externa_Hoy.pdf
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const docsDir = path.join(__dirname, '..', 'src', 'app-etiquetas', 'documentos');
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}
const outputPdfPath = path.join(docsDir, 'Plan_Retiro_Produccion_Externa_Hoy.pdf');
const logoPath = path.join(__dirname, '..', 'src', 'app-etiquetas', 'img', 'logo_LAMDA.png');

async function generarPDFRetiroExternaHoy() {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 26, bottom: 26, left: 36, right: 36 }
  });

  const stream = fs.createWriteStream(outputPdfPath);
  doc.pipe(stream);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const startX = doc.page.margins.left;

  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, startX, 24, { height: 34 });
  }

  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(11.2)
    .text('RETIRO PARA PRODUCCIÓN EXTERNA — LÍNEA DE NEGOCIO 4, 5 Y 6', startX + 125, 27, {
      width: pageWidth - 125,
      align: 'right',
      lineBreak: false
    });

  doc.fillColor('#475569').font('Helvetica').fontSize(8.2)
    .text('Miércoles 04/11/2026  ·  Total a retirar hoy: 0 UPs  ·  Finitud Externa Alcanzada', startX + 115, 44, {
      width: pageWidth - 115,
      align: 'right',
      lineBreak: false
    });

  doc.moveTo(startX, 66).lineTo(startX + pageWidth, 66).lineWidth(1.2).stroke('#0f172a');
  doc.y = 85;

  const boxY = 110;
  const boxH = 100;
  doc.rect(startX, boxY, pageWidth, boxH).fillAndStroke('#f8fafc', '#cbd5e1');

  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(13.0)
    .text('0 UPs — NO HAY NADA PARA PRODUCIR EXTERNAMENTE HOY', startX + 16, boxY + 26, {
      width: pageWidth - 32,
      align: 'center',
      lineBreak: false
    });

  doc.fillColor('#475569').font('Helvetica').fontSize(10.0)
    .text(
      'Las Líneas de Negocio 4, 5 y 6 se encuentran cubiertas (Stock >= 30 a 50 días).\n' +
      'La jornada presencial de hoy se destina íntegramente a tareas de Producción Interna en el depósito.',
      startX + 20,
      boxY + 54,
      {
        width: pageWidth - 40,
        align: 'center',
        lineGap: 4
      }
    );

  const yFin = boxY + boxH + 20;
  doc.rect(startX, yFin, pageWidth, 28).fillAndStroke('#f0fdf4', '#16a34a');
  doc.fillColor('#166534').font('Helvetica-Bold').fontSize(8.5)
    .text(
      'FINITUD EXTERNA ALCANZADA: 0 UPs A RETIRAR HOY (LÍNEAS 4, 5 Y 6 CUBIERTAS POR 30 A 50 DÍAS)',
      startX + 6,
      yFin + 9,
      { width: pageWidth - 12, align: 'center', lineBreak: false }
    );

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(outputPdfPath));
    stream.on('error', reject);
  });
}

if (require.main === module) {
  generarPDFRetiroExternaHoy()
    .then(p => {
      console.log(`✅ PDF de Retiro para Producción Externa generado en: ${p}`);
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ Error generando PDF de Retiro Externa:', err);
      process.exit(1);
    });
}

module.exports = { generarPDFRetiroExternaHoy };
