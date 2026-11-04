/**
 * Generador del PDF Operativo: PLAN DE TRABAJO EN DEPÓSITO — JORNADA DE HOY (MIÉRCOLES 04/11/2026)
 * Formato técnico ultra-limpio: Logo LAMDA + Nombre del Artículo (CÓDIGO): Cantidad + (tiempo estimado).
 * - Descuenta al 100% todos los carros confirmados ayer Martes 03/11 (#2995, #2996, #2997, #2998 y #2999):
 *   · #2995: APN1x1 (2 u.) -> CERRADO
 *   · #2996: BF24X50 (4 cajas desde puente BFX50G 4,80 kg) -> CERRADO
 *   · #2997: EMB-NU9HD0 (4 u.), CCTX1 (2 u.), ATX1 (1 u.), ATySx5 (2 u.) -> CERRADOS
 *   · #2998: NMBEX1K (2 u.), CHBx2 (2 u.), MRSSGx2 (3 u.) (adelantados por Matías ayer martes) -> CERRADOS
 * - Aplica REGLA_TANDA_EJECUTADA_ARTICULO_CERRADO_SIN_RESIDUALES (cero saldos residuales X - Y).
 * - Reúne en el Plan A de Hoy Miércoles 04/11 (~1h 50m) las 6 únicas tareas pendientes para alcanzar la Finitud Total:
 *   · Línea 2 (~25 min): EMB-0W5BOW (5 u.) y EMB-IIVL86 (10 u. = 1 pack de 10 x 250g)
 *   · Línea 3 (~44 min): Puente MFSXK (20.0 kg) -> MFSx5 (4 u., cerrando puente en 0 kg)
 *   · Líneas 5 y 6 (~41 min): Pre-Mezclas de estantería MPGDSX7 (1 u.), MPGDFX6,9 (1 u.) y MPB (1 u.)
 * - Al completarse estas 6 tareas hoy (~1h 50m), quedan 0 jornadas hacia adelante y 0 tareas pendientes en el depósito.
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
    'EMB-0W5BOW', 'EMB-IIVL86',
    'MFSXK', 'MFSx5',
    'MPGDSX7', 'MPGDFX6,9', 'MPB'
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
    margins: { top: 24, bottom: 22, left: 34, right: 34 }
  });

  const stream = fs.createWriteStream(outputPdfPath);
  doc.pipe(stream);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const startX = doc.page.margins.left;

  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, startX, 22, { height: 32 });
  }

  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(11.2)
    .text('PLAN DE TRABAJO EN DEPÓSITO — JORNADA DE HOY', startX + 120, 24, { width: pageWidth - 120, align: 'right', lineBreak: false });

  doc.fillColor('#475569').font('Helvetica').fontSize(7.8)
    .text('Miércoles 04/11/2026  ·  Plan A (Cierre Total Hoy): ~1h 50m  |  Carros Externos en Calle: 0  |  Resto Adelante: 0 min', startX + 90, 40, {
      width: pageWidth - 90,
      align: 'right',
      lineBreak: false
    });

  doc.moveTo(startX, 57).lineTo(startX + pageWidth, 57).lineWidth(1.1).stroke('#0f172a');
  doc.y = 65;

  const drawLdnHeader = (titulo, tiempoGrupo, colorBg, colorBorder, colorText) => {
    const y0 = doc.y;
    doc.rect(startX, y0, pageWidth, 17.5).fillAndStroke(colorBg, colorBorder);
    doc.fillColor(colorText).font('Helvetica-Bold').fontSize(8.0)
      .text(titulo, startX + 8, y0 + 4.7, { width: pageWidth - 130, lineBreak: false });
    doc.fillColor(colorText).font('Helvetica').fontSize(8.0)
      .text(`(tiempo estimado: ${tiempoGrupo})`, startX + pageWidth - 140, y0 + 4.6, { width: 132, align: 'right', lineBreak: false });
    doc.y = y0 + 21.5;
  };

  const drawArticuloRow = (nombreArt, sku, cantidadTxt, tiempoEstTxt, notaExtra = '') => {
    const y0 = doc.y;

    doc.rect(startX + 5, y0 + 1.8, 9, 9).lineWidth(0.9).stroke('#334155');

    doc.fillColor('#475569').font('Helvetica').fontSize(8.2)
      .text(`(tiempo estimado: ~${tiempoEstTxt})`, startX + pageWidth - 125, y0 + 1.8, { width: 120, align: 'right', lineBreak: false });

    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(8.8)
      .text(`${nombreArt} `, startX + 19, y0 + 1.2, { width: pageWidth - 140, continued: true })
      .fillColor('#475569').font('Helvetica').fontSize(8.3)
      .text(`(${sku}): `, { continued: true })
      .fillColor('#0f172a').font('Helvetica-Bold').fontSize(9.0)
      .text(cantidadTxt, { continued: !!notaExtra });

    if (notaExtra) {
      doc.fillColor('#334155').font('Helvetica').fontSize(8.2)
        .text(` ${notaExtra}`);
    }

    const endY = Math.max(doc.y + 3.0, y0 + 15.5);
    doc.moveTo(startX, endY).lineTo(startX + pageWidth, endY).lineWidth(0.35).stroke('#cbd5e1');
    doc.y = endY + 4.5;
  };

  const drawMixRow = (nombrePuente, skuPuente, kgPuenteTxt, fraccionesList, tiempoEstTxt) => {
    const y0 = doc.y;

    doc.rect(startX + 5, y0 + 1.8, 9, 9).lineWidth(0.9).stroke('#334155');

    doc.fillColor('#475569').font('Helvetica').fontSize(8.2)
      .text(`(tiempo estimado: ~${tiempoEstTxt})`, startX + pageWidth - 125, y0 + 1.8, { width: 120, align: 'right', lineBreak: false });

    doc.fillColor('#334155').font('Helvetica-Bold').fontSize(8.6)
      .text('Artículo puente: ', startX + 19, y0 + 1.2, { width: pageWidth - 145, continued: true })
      .fillColor('#0f172a').font('Helvetica-Bold').fontSize(8.8)
      .text(`${nombrePuente} `, { continued: true })
      .fillColor('#475569').font('Helvetica').fontSize(8.3)
      .text(`(${skuPuente}): `, { continued: true })
      .fillColor('#0f172a').font('Helvetica-Bold').fontSize(9.0)
      .text(kgPuenteTxt);

    let curY = Math.max(doc.y + 2.0, y0 + 14.5);

    fraccionesList.forEach(fr => {
      doc.fillColor('#0f172a').font('Helvetica').fontSize(8.5)
        .text(`• ${fr.nombre} `, startX + 29, curY, { width: pageWidth - 45, continued: true })
        .fillColor('#475569').font('Helvetica').fontSize(8.1)
        .text(`(${fr.sku}): `, { continued: true })
        .fillColor('#0f172a').font('Helvetica-Bold').fontSize(8.7)
        .text(fr.cantidad, { continued: !!fr.packNota });

      if (fr.packNota) {
        doc.fillColor('#334155').font('Helvetica').fontSize(8.2)
          .text(` ${fr.packNota}`);
      }
      curY = doc.y + 1.8;
    });

    const endY = curY + 2.5;
    doc.moveTo(startX, endY).lineTo(startX + pageWidth, endY).lineWidth(0.35).stroke('#cbd5e1');
    doc.y = endY + 4.5;
  };

  // =========================================================================
  // 1. PLAN A — LÍNEA DE NEGOCIO 2 (QUIEBRES EN STOCK 0 Y VACIADO DE TACHOS ABIERTOS)
  // =========================================================================
  drawLdnHeader(
    'PLAN A · LÍNEA DE NEGOCIO 2 — QUIEBRES EN STOCK 0 Y VACIADO DE TACHOS ABIERTOS',
    '~25 min',
    '#dcfce7',
    '#22c55e',
    '#14532d'
  );

  drawArticuloRow(
    d('EMB-0W5BOW', 'Tomate Seco x 500g'),
    'EMB-0W5BOW',
    '5 u.',
    '13 min'
  );

  drawArticuloRow(
    d('EMB-IIVL86', 'Maiz FTO Barbacoa x 250g'),
    'EMB-IIVL86',
    '10 u.',
    '12 min',
    '(1 pack de 10 x 250g)'
  );

  doc.y += 4;

  // =========================================================================
  // 2. PLAN A — LÍNEA DE NEGOCIO 3 (MEZCLA INTERNA EN TANDA ÚNICA — CIERRE PUENTE EN 0 KG)
  // =========================================================================
  drawLdnHeader(
    'PLAN A · LÍNEA DE NEGOCIO 3 — MEZCLA INTERNA EN TANDA ÚNICA (CIERRE PUENTE EN 0 KG)',
    '~44 min',
    '#fef3c7',
    '#f59e0b',
    '#92400e'
  );

  drawMixRow(
    d('MFSXK', 'Mix F/SCOS Con Pasas a Granel x 1kg'),
    'MFSXK',
    '20.0 kg',
    [
      { nombre: d('MFSx5', 'Mix F/SCOS Con Pasas x 5kg'), sku: 'MFSx5', cantidad: '4 u.', packNota: '(cierra puente en 0 kg — 300g/1kg/2kg ya cubiertos)' }
    ],
    '44 min'
  );

  doc.y += 4;

  // =========================================================================
  // 3. PLAN A — LÍNEAS DE NEGOCIO 5 Y 6 (REPOSICIÓN DE PRE-MEZCLAS DE ESTANTERÍA)
  // =========================================================================
  drawLdnHeader(
    'PLAN A · LÍNEA DE NEGOCIO 5 Y 6 — REPOSICIÓN DE PRE-MEZCLAS DE ESTANTERÍA',
    '~41 min',
    '#ede9fe',
    '#8b5cf6',
    '#4c1d95'
  );

  drawArticuloRow(
    d('MPGDSX7', 'Mezcla GRANA Sol x 7kg'),
    'MPGDSX7',
    '1 u.',
    '14 min'
  );

  drawArticuloRow(
    d('MPGDFX6,9', 'Mezcla GRANA Flor x 6.9kg'),
    'MPGDFX6,9',
    '1 u.',
    '14 min'
  );

  drawArticuloRow(
    d('MPB', 'Mezcla BARRA Flor x 4kg'),
    'MPB',
    '1 u.',
    '13 min'
  );

  doc.y += 12;

  // Banner de Finitud al pie (al entrar todo el remanente de ~1h 50m hoy, quedan 0 jornadas hacia adelante)
  const yFin = doc.y;
  doc.rect(startX, yFin, pageWidth, 24).fillAndStroke('#f0fdf4', '#16a34a');
  doc.fillColor('#166534').font('Helvetica-Bold').fontSize(7.6)
    .text('FINITUD ALCANZADA CON EL PLAN DE HOY (~1h 50m) — 0 JORNADAS HACIA ADELANTE REQUERIDAS (IDEAL 100% CUBIERTO)', startX + 6, yFin + 8, {
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
