/**
 * Generador del PDF Operativo: PLAN DE JORNADAS HACIA ADELANTE (SIN CONTAR HOY — HASTA COMPLETAR EL STOCK IDEAL)
 * Fecha: JUEVES 05/11/2026
 * Reglas aplicadas:
 * - REGLA_JORNADAS_HACIA_ADELANTE_LIBRES_HASTA_FINITUD (Cantidad libre de jornadas: 0, 1, 2, 3, 5 o las que hagan falta
 *   hasta completar el Stock Ideal y terminar todo lo que hay para hacer, sin especificar día calendario de la semana).
 * - REGLA_CERO_SUPERPOSICION_HOY_VS_SEMANAL_SUBSIGUIENTE
 * - REGLA_TANDA_EJECUTADA_ARTICULO_CERRADO_SIN_RESIDUALES
 * - REGLA_LDN2_EXCLUSION_ABRECAJA_Y_MADRE
 *
 * Estado al Jueves 05/11/2026:
 * - Descontando el Plan de Hoy Jueves 05/11 (~2h 51m), la totalidad del trabajo restante en el depósito (~2h 13m)
 *   se completa íntegramente en 1 JORNADA HACIA ADELANTE (~2h 13m -> 0 Tareas Pendientes).
 * Ubicación servida en la Pizarra Principal: /documentos/Plan_Semanal_3_Jornadas_Deposito.pdf
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const pool = require('../src/produccion/config/database');

const docsDir = path.join(__dirname, '..', 'src', 'app-etiquetas', 'documentos');
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}
const outputPdfPath = path.join(docsDir, 'Plan_Semanal_3_Jornadas_Deposito.pdf');
const logoPath = path.join(__dirname, '..', 'src', 'app-etiquetas', 'img', 'logo_LAMDA.png');

async function obtenerDescripcionesBunker() {
  const skus = [
    'EMB-VH3OLC', 'PRx2', 'EMB-JK1OOX', 'EMB-9KG3XS',
    'MRSx5', 'APx2', 'EMB-JYS9SJ', 'QRX1'
  ];
  const res = await pool.query(
    `SELECT articulo_id,
            COALESCE(NULLIF(TRIM(descripcion_generada), ''), NULLIF(TRIM(descripcion), ''), articulo_id) AS nombre
     FROM public.bunker_articulos
     WHERE UPPER(TRIM(articulo_id)) = ANY($1)`,
    [skus.map(s => s.toUpperCase())]
  );
  const map = new Map();
  res.rows.forEach(r => {
    map.set(String(r.articulo_id).trim().toUpperCase(), r.nombre.trim());
  });
  return (sku, fallback) => map.get(String(sku).trim().toUpperCase()) || fallback || sku;
}

async function generarPDFPlan3Jornadas() {
  const d = await obtenerDescripcionesBunker();

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 24, bottom: 22, left: 34, right: 34 }
  });

  const stream = fs.createWriteStream(outputPdfPath);
  doc.pipe(stream);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const startX = doc.page.margins.left;

  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, startX, 22, { height: 32 });
  }
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(9.2)
    .text('PLAN DE JORNADAS HACIA ADELANTE (SIN CONTAR HOY — HASTA COMPLETAR EL IDEAL)', startX + 100, 24, {
      width: pageWidth - 100,
      align: 'right',
      lineBreak: false
    });
  doc.fillColor('#475569').font('Helvetica').fontSize(7.8)
    .text('Jueves 05/11/2026  ·  Cantidad Libre de Jornadas hasta Finitud  ·  Requiere 1 Jornada (~2h 13m -> 0 Pendientes)', startX + 100, 39, {
      width: pageWidth - 100,
      align: 'right',
      lineBreak: false
    });
  doc.moveTo(startX, 57).lineTo(startX + pageWidth, 57).lineWidth(1.1).stroke('#0f172a');
  doc.y = 65;

  const drawJornadaBanner = (tituloJornada, tiempoTotalJornada) => {
    const y0 = doc.y;
    doc.rect(startX, y0, pageWidth, 19).fillAndStroke('#0f172a', '#0f172a');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8.3)
      .text(tituloJornada, startX + 9, y0 + 5.2, { width: pageWidth - 165, lineBreak: false });
    doc.fillColor('#e2e8f0').font('Helvetica-Bold').fontSize(8.1)
      .text(`(tiempo estimado jornada: ${tiempoTotalJornada})`, startX + pageWidth - 162, y0 + 5.3, {
        width: 154,
        align: 'right',
        lineBreak: false
      });
    doc.y = y0 + 23;
  };

  const drawLdnSubheader = (tituloLdn, tiempoGrupo, colorBg, colorBorder, colorText) => {
    const y0 = doc.y;
    doc.rect(startX, y0, pageWidth, 17).fillAndStroke(colorBg, colorBorder);
    doc.fillColor(colorText).font('Helvetica-Bold').fontSize(8.0)
      .text(tituloLdn, startX + 8, y0 + 4.4, { width: pageWidth - 128, lineBreak: false });
    doc.fillColor(colorText).font('Helvetica').fontSize(8.0)
      .text(`(tiempo estimado: ${tiempoGrupo})`, startX + pageWidth - 125, y0 + 4.4, {
        width: 118,
        align: 'right',
        lineBreak: false
      });
    doc.y = y0 + 21;
  };

  const drawArticuloRow = (nombreArt, sku, cantidadTxt, tiempoEstTxt) => {
    const y0 = doc.y;
    doc.rect(startX + 5, y0 + 1.8, 9, 9).lineWidth(0.9).stroke('#334155');
    doc.fillColor('#475569').font('Helvetica').fontSize(8.2)
      .text(`(tiempo estimado: ~${tiempoEstTxt})`, startX + pageWidth - 125, y0 + 1.8, {
        width: 120,
        align: 'right',
        lineBreak: false
      });

    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(8.9)
      .text(`${nombreArt} `, startX + 19, y0 + 1.2, { width: pageWidth - 145, continued: true })
      .fillColor('#475569').font('Helvetica').fontSize(8.4)
      .text(`(${sku}): `, { continued: true })
      .fillColor('#0f172a').font('Helvetica-Bold').fontSize(9.0)
      .text(cantidadTxt);

    const endY = Math.max(doc.y + 3, y0 + 15.5);
    doc.moveTo(startX, endY).lineTo(startX + pageWidth, endY).lineWidth(0.35).stroke('#cbd5e1');
    doc.y = endY + 4.5;
  };

  // =========================================================================
  // JORNADA 1 HACIA ADELANTE (CANTIDAD LIBRE DE JORNADAS HASTA FINITUD)
  // =========================================================================
  drawJornadaBanner('JORNADA 1 HACIA ADELANTE — PRÓXIMA JORNADA LABORAL (SIN CONTAR HOY)', '~2h 13m');

  drawLdnSubheader('LÍNEA DE NEGOCIO 2 — VACIADO DE TACHOS ABIERTOS Y CIERRE DE STOCK IDEAL', '~2h 13m', '#dcfce7', '#22c55e', '#14532d');
  drawArticuloRow(d('EMB-VH3OLC', 'Nuez Cuarto LHT x 5kg'), 'EMB-VH3OLC', '2 u.', '10 min');
  drawArticuloRow(d('PRx2', 'Pasas de Uva Rubia x 2kg'), 'PRx2', '5 u.', '20 min');
  drawArticuloRow(d('EMB-JK1OOX', 'Pasas de Uva Jumbo x 1kg'), 'EMB-JK1OOX', '8 u.', '35 min');
  drawArticuloRow(d('EMB-9KG3XS', 'Harina de Coco x 1kg'), 'EMB-9KG3XS', '3 u.', '25 min');
  drawArticuloRow(d('MRSx5', 'Mani RELDO Salado x 5kg'), 'MRSx5', '3 u.', '12 min');
  drawArticuloRow(d('APx2', 'Avellanas Peladas x 2kg'), 'APx2', '4 u.', '10 min');
  drawArticuloRow(d('EMB-JYS9SJ', 'SEM Chia Gris x 1kg'), 'EMB-JYS9SJ', '3 u.', '7 min');
  drawArticuloRow(d('QRX1', 'SEM Quinoa x 1kg'), 'QRX1', '3 u.', '14 min');

  doc.y += 10;

  const yFin = doc.y;
  doc.rect(startX, yFin, pageWidth, 23).fillAndStroke('#f0fdf4', '#16a34a');
  doc.fillColor('#166534').font('Helvetica-Bold').fontSize(7.1)
    .text('FINITUD ALCANZADA EN 1 JORNADA HACIA ADELANTE (~2h 13m) — 0 JORNADAS ADICIONALES REQUERIDAS (IDEAL 100% CUBIERTO)', startX + 6, yFin + 7.5, {
      width: pageWidth - 12,
      align: 'center',
      lineBreak: false
    });

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
