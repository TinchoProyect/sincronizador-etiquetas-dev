/**
 * Generador del PDF Operativo: PLAN DE JORNADAS HACIA ADELANTE (SIN CONTAR HOY — HASTA COMPLETAR EL STOCK IDEAL)
 * Fecha: MIÉRCOLES 04/11/2026
 * Reglas aplicadas:
 * - REGLA_JORNADAS_HACIA_ADELANTE_LIBRES_HASTA_FINITUD (Cantidad libre de jornadas: 0, 1, 2, 3, 5 o las que hagan falta
 *   hasta completar el Stock Ideal y terminar todo lo que hay para hacer, sin especificar día calendario de la semana).
 * - REGLA_CERO_SUPERPOSICION_HOY_VS_SEMANAL_SUBSIGUIENTE
 * - REGLA_TANDA_EJECUTADA_ARTICULO_CERRADO_SIN_RESIDUALES
 * - REGLA_LDN2_EXCLUSION_ABRECAJA_Y_MADRE
 *
 * Estado al Miércoles 04/11/2026:
 * - Habiéndose descontado los 5 carros confirmados ayer Martes 03/11 (#2995 al #2999, incluyendo el adelanto de NMBEX1K, CHBx2 y MRSSGx2),
 *   la totalidad del trabajo restante en el depósito (~1h 50m) ingresa íntegramente en el Plan de Hoy Miércoles 04/11/2026.
 * - Por lo tanto, la cantidad de jornadas hacia adelante (sin contar hoy) es: 0 JORNADAS HACIA ADELANTE (0 TAREAS PENDIENTES).
 * Ubicación servida en la Pizarra Principal: /documentos/Plan_Semanal_3_Jornadas_Deposito.pdf
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const docsDir = path.join(__dirname, '..', 'src', 'app-etiquetas', 'documentos');
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}
const outputPdfPath = path.join(docsDir, 'Plan_Semanal_3_Jornadas_Deposito.pdf');
const logoPath = path.join(__dirname, '..', 'src', 'app-etiquetas', 'img', 'logo_LAMDA.png');

async function generarPDFPlan3Jornadas() {
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
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(9.2)
    .text('PLAN DE JORNADAS HACIA ADELANTE (SIN CONTAR HOY — HASTA COMPLETAR EL IDEAL)', startX + 100, 26, {
      width: pageWidth - 100,
      align: 'right',
      lineBreak: false
    });
  doc.fillColor('#475569').font('Helvetica').fontSize(7.8)
    .text('Miércoles 04/11/2026  ·  Cantidad Libre de Jornadas hasta Finitud  ·  0 Jornadas Hacia Adelante (0 Pendientes)', startX + 95, 42, {
      width: pageWidth - 95,
      align: 'right',
      lineBreak: false
    });
  doc.moveTo(startX, 64).lineTo(startX + pageWidth, 64).lineWidth(1.2).stroke('#0f172a');
  doc.y = 85;

  const boxY = 110;
  const boxH = 120;
  doc.rect(startX, boxY, pageWidth, boxH).fillAndStroke('#f8fafc', '#cbd5e1');

  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(12.6)
    .text('0 JORNADAS HACIA ADELANTE — FINITUD TOTAL CON EL PLAN DE HOY', startX + 16, boxY + 26, {
      width: pageWidth - 32,
      align: 'center',
      lineBreak: false
    });

  doc.fillColor('#475569').font('Helvetica').fontSize(10.0)
    .text(
      'Todas las tareas pendientes del depósito (~1h 50m) están incluidas hoy en el Plan de Trabajo de Hoy Miércoles 04/11/2026.\n' +
      'Una vez completada la jornada de hoy, quedan 0 tareas pendientes y el Stock Ideal (>= 30 días) queda 100% cubierto.',
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
  doc.fillColor('#166534').font('Helvetica-Bold').fontSize(8.3)
    .text(
      'FINITUD TOTAL ALCANZADA: 0 JORNADAS ADICIONALES REQUERIDAS DESPUÉS DE HOY (0 TAREAS PENDIENTES)',
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
  generarPDFPlan3Jornadas()
    .then(p => {
      console.log(`✅ PDF de Plan de Jornadas Hacia Adelante generado en: ${p}`);
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ Error generando PDF Hacia Adelante:', err);
      process.exit(1);
    });
}

module.exports = { generarPDFPlan3Jornadas };
