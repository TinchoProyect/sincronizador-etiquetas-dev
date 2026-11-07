/**
 * Generador del PDF Operativo: PLAN DE TRABAJO EN DEPÓSITO — JORNADA DE HOY (JUEVES 05/11/2026)
 * Formato técnico ultra-limpio: Logo LAMDA + Nombre del Artículo (CÓDIGO): Cantidad + (tiempo estimado).
 * - Descuenta al 100% los 4 carros confirmados ayer Miércoles 04/11 (#3000 MFSXK 20kg, #3001 MFSx5 4u,
 *   #3002 EMB-0W5BOW 5u + EMB-IIVL86 10u, y #3003 MPB 2u).
 * - Incorpora los nuevos quiebres a 0 u. generados por la facturación de ayer Miércoles 04/11 (16:18 a 16:23 hs):
 *   · Línea 3 (~54 min): Mix Color Tropical MCTXK (10.0 kg) -> EMB-AI7OIK (5 u.) y Mix Salado MSXK (10.0 kg) -> MSx2 (5 u.)
 *   · Línea 2 (~60 min): APN25/27X150G (10 u. = 1 pack), NMECHAMX200G (15 u. = 1 pack + 5 sueltas) y CRx5 (5 u. = 1 bolsa de 25kg)
 *   · Línea 2 (~57 min): Vaciado de las 3 bolsas abiertas en taller de Maíz Frito en Stock 0: MFBx2,5 (5 u.), MFDQX2,5 (2 u.) y MFX2,5 (5 u.)
 * - Incluye al pie "SI SOBRA TIEMPO HOY — ADELANTO DEL PLAN HACIA ADELANTE" (+30 min: EMB-VH3OLC 2u y PRx2 5u).
 * Ubicación servida en la Pizarra Principal: /documentos/Plan_Jornada_Hoy_Deposito.pdf
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const pool = require('../src/produccion/config/database');

const docsDir = path.join(__dirname, '..', 'src', 'app-etiquetas', 'documentos');
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}
const outputPdfPath = path.join(docsDir, 'Plan_Jornada_Hoy_Deposito.pdf');
const logoPath = path.join(__dirname, '..', 'src', 'app-etiquetas', 'img', 'logo_LAMDA.png');

async function obtenerDescripcionesBunker() {
  const skus = [
    'MCTXK', 'EMB-AI7OIK',
    'MSXK', 'MSx2',
    'APN25/27X150G', 'NMECHAMX200G', 'CRx5',
    'MFBx2,5', 'MFDQX2,5', 'MFX2,5',
    'EMB-VH3OLC', 'PRx2'
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

async function generarPDFJornadaHoy() {
  const d = await obtenerDescripcionesBunker();

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 22, bottom: 20, left: 34, right: 34 }
  });

  const stream = fs.createWriteStream(outputPdfPath);
  doc.pipe(stream);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const startX = doc.page.margins.left;

  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, startX, 20, { height: 31 });
  }

  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(11.2)
    .text('PLAN DE TRABAJO EN DEPÓSITO — JORNADA DE HOY', startX + 120, 22, { width: pageWidth - 120, align: 'right', lineBreak: false });

  doc.fillColor('#475569').font('Helvetica').fontSize(7.8)
    .text('Jueves 05/11/2026  ·  Plan A (Fijo Hoy): ~2h 51m  |  Carros en Pausa: 0  |  Adelanto si sobra tiempo: +30 min', startX + 90, 38, {
      width: pageWidth - 90,
      align: 'right',
      lineBreak: false
    });

  doc.moveTo(startX, 55).lineTo(startX + pageWidth, 55).lineWidth(1.1).stroke('#0f172a');
  doc.y = 62;

  const drawLdnHeader = (titulo, tiempoGrupo, colorBg, colorBorder, colorText) => {
    const y0 = doc.y;
    doc.rect(startX, y0, pageWidth, 17).fillAndStroke(colorBg, colorBorder);
    doc.fillColor(colorText).font('Helvetica-Bold').fontSize(8.0)
      .text(titulo, startX + 8, y0 + 4.4, { width: pageWidth - 130, lineBreak: false });
    doc.fillColor(colorText).font('Helvetica').fontSize(7.9)
      .text(`(tiempo estimado: ${tiempoGrupo})`, startX + pageWidth - 140, y0 + 4.4, { width: 132, align: 'right', lineBreak: false });
    doc.y = y0 + 20.5;
  };

  const drawArticuloRow = (nombreArt, sku, cantidadTxt, tiempoEstTxt, notaExtra = '') => {
    const y0 = doc.y;

    doc.rect(startX + 5, y0 + 1.6, 8.8, 8.8).lineWidth(0.9).stroke('#334155');

    doc.fillColor('#475569').font('Helvetica').fontSize(8.0)
      .text(`(tiempo estimado: ~${tiempoEstTxt})`, startX + pageWidth - 122, y0 + 1.6, { width: 117, align: 'right', lineBreak: false });

    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(8.6)
      .text(`${nombreArt} `, startX + 19, y0 + 1.1, { width: pageWidth - 138, continued: true })
      .fillColor('#475569').font('Helvetica').fontSize(8.1)
      .text(`(${sku}): `, { continued: true })
      .fillColor('#0f172a').font('Helvetica-Bold').fontSize(8.8)
      .text(cantidadTxt, { continued: !!notaExtra });

    if (notaExtra) {
      doc.fillColor('#334155').font('Helvetica').fontSize(8.0)
        .text(` ${notaExtra}`);
    }

    const endY = Math.max(doc.y + 2.6, y0 + 14.5);
    doc.moveTo(startX, endY).lineTo(startX + pageWidth, endY).lineWidth(0.35).stroke('#cbd5e1');
    doc.y = endY + 3.8;
  };

  const drawMixRow = (nombrePuente, skuPuente, kgPuenteTxt, fraccionesList, tiempoEstTxt) => {
    const y0 = doc.y;

    doc.rect(startX + 5, y0 + 1.6, 8.8, 8.8).lineWidth(0.9).stroke('#334155');

    doc.fillColor('#475569').font('Helvetica').fontSize(8.0)
      .text(`(tiempo estimado: ~${tiempoEstTxt})`, startX + pageWidth - 125, y0 + 1.6, { width: 120, align: 'right', lineBreak: false });

    doc.fillColor('#334155').font('Helvetica-Bold').fontSize(8.4)
      .text('Artículo puente: ', startX + 19, y0 + 1.1, { width: pageWidth - 145, continued: true })
      .fillColor('#0f172a').font('Helvetica-Bold').fontSize(8.6)
      .text(`${nombrePuente} `, { continued: true })
      .fillColor('#475569').font('Helvetica').fontSize(8.1)
      .text(`(${skuPuente}): `, { continued: true })
      .fillColor('#0f172a').font('Helvetica-Bold').fontSize(8.8)
      .text(kgPuenteTxt);

    let curY = Math.max(doc.y + 1.8, y0 + 13.8);

    fraccionesList.forEach(fr => {
      doc.fillColor('#0f172a').font('Helvetica').fontSize(8.3)
        .text(`• ${fr.nombre} `, startX + 29, curY, { width: pageWidth - 45, continued: true })
        .fillColor('#475569').font('Helvetica').fontSize(7.9)
        .text(`(${fr.sku}): `, { continued: true })
        .fillColor('#0f172a').font('Helvetica-Bold').fontSize(8.5)
        .text(fr.cantidad, { continued: !!fr.packNota });

      if (fr.packNota) {
        doc.fillColor('#334155').font('Helvetica').fontSize(8.0)
          .text(` ${fr.packNota}`);
      }
      curY = doc.y + 1.5;
    });

    const endY = curY + 2.2;
    doc.moveTo(startX, endY).lineTo(startX + pageWidth, endY).lineWidth(0.35).stroke('#cbd5e1');
    doc.y = endY + 3.8;
  };

  // =========================================================================
  // 1. PLAN A — LÍNEA DE NEGOCIO 3 (MIXES EN QUIEBRE POR VENTAS DE AYER — CIERRE PUENTES EN 0 KG)
  // =========================================================================
  drawLdnHeader(
    'PLAN A · LÍNEA DE NEGOCIO 3 — MIXES EN QUIEBRE POR VENTAS DE AYER (CIERRE EN 0 KG)',
    '~54 min',
    '#fef3c7',
    '#f59e0b',
    '#92400e'
  );

  drawMixRow(
    d('MCTXK', 'PROD AP Interno F/SCOS Color Tropical Mix x 1kg'),
    'MCTXK',
    '10.0 kg',
    [
      { nombre: d('EMB-AI7OIK', 'Mix F/SCOS Color Tropical x 2kg'), sku: 'EMB-AI7OIK', cantidad: '5 u.', packNota: '(cierra puente en 0 kg — 300g y 5kg ya cubiertos)' }
    ],
    '28 min'
  );

  drawMixRow(
    d('MSXK', 'PROD AP Interno Salado Mix x 1kg'),
    'MSXK',
    '10.0 kg',
    [
      { nombre: d('MSx2', 'Mix Salado x 2kg'), sku: 'MSx2', cantidad: '5 u.', packNota: '(cierra puente en 0 kg — 300g y 5kg ya cubiertos)' }
    ],
    '26 min'
  );

  doc.y += 2;

  // =========================================================================
  // 2. PLAN A — LÍNEA DE NEGOCIO 2 (QUIEBRES POR FACTURACIÓN DE AYER MIÉRCOLES 04/11)
  // =========================================================================
  drawLdnHeader(
    'PLAN A · LÍNEA DE NEGOCIO 2 — REPOSICIÓN DE QUIEBRES POR FACTURACIÓN DE AYER',
    '~60 min',
    '#dcfce7',
    '#22c55e',
    '#14532d'
  );

  drawArticuloRow(
    d('APN25/27X150G', 'ALMENDRA Peladas x 150g'),
    'APN25/27X150G',
    '10 u.',
    '11 min',
    '(1 pack de 10 x 150g)'
  );

  drawArticuloRow(
    d('NMECHAMX200G', 'Nuez PADA CHLER MPSA EXLIGHT x 200g'),
    'NMECHAMX200G',
    '15 u.',
    '20 min',
    '(1 pack de 10 x 200g + 5 sueltas)'
  );

  drawArticuloRow(
    d('CRx5', 'Coco Rallado HF x 5kg'),
    'CRx5',
    '5 u.',
    '29 min',
    '(1 bolsa entera de 25 kg)'
  );

  doc.y += 2;

  // =========================================================================
  // 3. PLAN A — LÍNEA DE NEGOCIO 2 (VACIADO DE BOLSAS ABIERTAS DE MAÍZ FRITO EN STOCK 0)
  // =========================================================================
  drawLdnHeader(
    'PLAN A · LÍNEA DE NEGOCIO 2 — VACIADO DE BOLSAS ABIERTAS DE MAÍZ FRITO EN STOCK 0',
    '~57 min',
    '#dbeafe',
    '#3b82f6',
    '#1e3a8a'
  );

  drawArticuloRow(
    d('MFBx2,5', 'Maiz FTO Barbacoa x 2.5kg'),
    'MFBx2,5',
    '5 u.',
    '20 min'
  );

  drawArticuloRow(
    d('MFDQX2,5', 'Maiz FTO Queso x 2.5kg'),
    'MFDQX2,5',
    '2 u.',
    '17 min'
  );

  drawArticuloRow(
    d('MFX2,5', 'Maiz Frito x 2.5kg'),
    'MFX2,5',
    '5 u.',
    '20 min'
  );

  doc.y += 3;

  // =========================================================================
  // 4. SI SOBRA TIEMPO HOY — ADELANTO DEL PLAN HACIA ADELANTE (+30 min)
  // =========================================================================
  drawLdnHeader(
    'SI SOBRA TIEMPO HOY — ADELANTO DEL PLAN HACIA ADELANTE',
    '~30 min',
    '#ede9fe',
    '#8b5cf6',
    '#4c1d95'
  );

  drawArticuloRow(
    d('EMB-VH3OLC', 'Nuez Cuarto LHT x 5kg'),
    'EMB-VH3OLC',
    '2 u.',
    '10 min'
  );

  drawArticuloRow(
    d('PRx2', 'Pasas de Uva Rubia x 2kg'),
    'PRx2',
    '5 u.',
    '20 min'
  );

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(outputPdfPath));
    stream.on('error', reject);
  });
}

if (require.main === module) {
  generarPDFJornadaHoy()
    .then(p => {
      console.log(`✅ PDF de la Jornada de Hoy generado en: ${p}`);
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ Error generando PDF de hoy:', err);
      process.exit(1);
    });
}

module.exports = { generarPDFJornadaHoy };
