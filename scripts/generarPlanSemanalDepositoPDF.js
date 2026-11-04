/**
 * Generador de PDF Operativo: Plan de Trabajo del Día y Resto de la Semana (Depósito LAMDA)
 * Basado en la auditoría del equipo de 4 especialistas y el motor de 5 reglas.
 * Salida: C:\Users\Martin\Desktop\Plan_Trabajo_Deposito_Semana.pdf
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const desktopPath = path.join(process.env.USERPROFILE || 'C:\\Users\\Martin', 'Desktop', 'Plan_Trabajo_Deposito_Semana.pdf');

function generarPDF() {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 28, bottom: 28, left: 34, right: 34 }
  });

  const stream = fs.createWriteStream(desktopPath);
  doc.pipe(stream);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const startX = doc.page.margins.left;

  // Encabezado Principal
  doc.rect(startX, 24, pageWidth, 48).fill('#0f172a');
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(14)
    .text('PLAN DE TRABAJO EN DEPÓSITO — DÍA Y RESTO DE LA SEMANA', startX + 12, 33);
  doc.fillColor('#cbd5e1').font('Helvetica').fontSize(9)
    .text('Sistema LAMDA · Bloques calibrados a ~3 hs por jornada (~180 min netos) · Excluye Abrecajas y Bultos Madre', startX + 12, 53);

  doc.y = 80;

  // Bloque recordatorio de Producción de Hoy
  const yHoy = doc.y;
  doc.rect(startX, yHoy, pageWidth, 48).fillAndStroke('#f0fdf4', '#86efac');
  doc.fillColor('#166534').font('Helvetica-Bold').fontSize(8.8)
    .text('[OK] YA PRODUCIDO Y CONFIRMADO EN LA JORNADA DE HOY (62 u. / 94 kg — No volver a producir):', startX + 10, yHoy + 6, { width: pageWidth - 20 });
  doc.fillColor('#14532d').font('Helvetica').fontSize(8.1)
    .text('• Línea 3: Mix Frutos Secos c/Pasas: Puente (MFSXK) 10 kg -> 30 u. x 300g (3 packs de 10) + 1 u. x 1kg  |  • Línea 4: Castañas Cajú Tost/Sal: 3x5kg + 3x2kg + 2x1kg (23 kg)', startX + 10, doc.y + 2, { width: pageWidth - 20 });
  doc.fillColor('#14532d').font('Helvetica').fontSize(8.1)
    .text('• Línea 2: Coco Rallado x 5kg (CRx5): 5 u. (25 kg)  ·  Avena Instantánea x 5kg (AAIx5): 4 u. (20 kg)  ·  Banana Chips x 2kg (CHBx2): 2 u.  ·  Nuez Mariposa x 1kg: 1 u.', startX + 10, doc.y + 2, { width: pageWidth - 20 });

  doc.y = yHoy + 55;

  const drawJornadaHeader = (titulo, subtitulo, colorBg, colorBorder, colorText) => {
    if (doc.y > 720) doc.addPage();
    const y0 = doc.y;
    doc.rect(startX, y0, pageWidth, 22).fillAndStroke(colorBg, colorBorder);
    doc.fillColor(colorText).font('Helvetica-Bold').fontSize(10.2)
      .text(titulo, startX + 10, y0 + 6, { width: pageWidth - 150 });
    doc.fillColor(colorText).font('Helvetica-Bold').fontSize(9.2)
      .text(subtitulo, startX + pageWidth - 140, y0 + 6, { width: 132, align: 'right' });
    doc.y = y0 + 26;
  };

  const drawLdnSubheader = (titulo) => {
    if (doc.y > 745) doc.addPage();
    const y0 = doc.y;
    doc.rect(startX, y0, pageWidth, 15).fill('#f1f5f9');
    doc.fillColor('#334155').font('Helvetica-Bold').fontSize(8.6)
      .text(titulo, startX + 8, y0 + 3.5);
    doc.y = y0 + 18;
  };

  const drawTaskRow = (titulo, linea1, linea2, tiempoTxt, notaOperativa) => {
    if (doc.y > 735) doc.addPage();
    const y0 = doc.y;

    // Checkbox cuadrado para tildar en depósito
    doc.rect(startX + 6, y0 + 3, 9.5, 9.5).lineWidth(1).stroke('#475569');

    // Tiempo a la derecha (posición absoluta fija en la fila superior)
    doc.fillColor('#1d4ed8').font('Helvetica-Bold').fontSize(8.8)
      .text(`Tiempo: ~${tiempoTxt}`, startX + pageWidth - 105, y0 + 2.5, { width: 99, align: 'right' });

    // Título de la estación
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(9.5)
      .text(titulo, startX + 21, y0 + 2.5, { width: pageWidth - 130 });

    let curY = Math.max(doc.y + 1, y0 + 14);

    if (linea1) {
      doc.fillColor('#1e293b').font('Helvetica').fontSize(8.8)
        .text(linea1, startX + 21, curY, { width: pageWidth - 28 });
      curY = doc.y + 1.5;
    }
    if (linea2) {
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(8.8)
        .text(linea2, startX + 21, curY, { width: pageWidth - 28 });
      curY = doc.y + 1.5;
    }
    if (notaOperativa) {
      doc.fillColor('#475569').font('Helvetica-Oblique').fontSize(8.0)
        .text(notaOperativa, startX + 21, curY, { width: pageWidth - 28 });
      curY = doc.y + 2;
    }

    doc.moveTo(startX, curY + 1).lineTo(startX + pageWidth, curY + 1).lineWidth(0.4).stroke('#cbd5e1');
    doc.y = curY + 4.5;
  };

  // =========================================================================
  // JORNADA 1: PLAN DEL DÍA (PRÓXIMO TURNO — LO MÁS URGENTE)
  // =========================================================================
  drawJornadaHeader(
    'JORNADA 1 — PLAN DEL DÍA (Próxima Visita · Prioridad Inmediata)',
    'Total est.: ~2h 45m',
    '#dbeafe',
    '#3b82f6',
    '#1e3a8a'
  );

  drawLdnSubheader('LÍNEAS DE NEGOCIO 4, 5 Y 6 — Pre-Mezclas Crudas para enviar a UPs Externas (Stock en 0)');
  drawTaskRow(
    'Mezcla Barra Flor x 4 kg',
    null,
    'Fraccionar: MEZCLA PARA BARRA DE CEREAL DE LA FLOR X 4 KG (MPB): 4 u. (16 kg)',
    '48 min',
    'Urgente: Hay 0 bolsas de MPB en depósito y quedan solo 2 cajas libres de BF24X50. Armar 4 bolsas de 4 kg para despachar a UP.'
  );
  drawTaskRow(
    'Granola del Sol (Pre-Mezcla a Horno)',
    null,
    'Fraccionar: MEZCLA PARA GRANOLA DEL SOL X 7KG (MPGDSX7): 2 u. (14 kg)',
    '28 min',
    'Urgente: Stock actual de MPGDSX7 en 0 u. (y solo 0,79 kg de base horneada en taller). Armar 2 bolsas de 7 kg para mandar a hornear.'
  );
  drawTaskRow(
    'Granola de la Flor (Pre-Mezcla a Horno)',
    null,
    'Fraccionar: MEZCLA PARA GRANOLA DE LA FLOR X 6,9 KG (MPGDFX6,9): 2 u. (13,8 kg)',
    '28 min',
    'Stock actual: 1 bolsa. Sumar 2 bolsas nuevas de 6,9 kg para completar tanda de 3 bolsas hacia la UP externa.'
  );

  drawLdnSubheader('LÍNEA DE NEGOCIO 3 — Mixes Internos en Quiebre Inmediato');
  drawTaskRow(
    'Mix sin Pasas',
    'Artículo puente (MFSSOXK) 10 kg',
    'Fracciones: Mix F/SCOS Sin Pasas x 2kg (MFSSPx2): 5 u.',
    '26 min',
    'Quiebre: MFSSPx2 está en 0 u. con demanda activa. El carro de 10 kg cierra exacto en 5 bolsas de 2 kg (Puente = 0 kg).'
  );
  drawTaskRow(
    'Mix Color Tropical (Vaciado de Saldo en Puente)',
    'Artículo puente (MCTXK) 3 kg (usar saldo de 4,3 kg ya abierto en puente)',
    'Fracciones: Mix F/SCOS Color Tropical x 300g (MCTX300): 10 u. (1 pack de 10 x 300g)',
    '17 min',
    'No requiere mezclar carro nuevo hoy: aprovecha los 4,3 kg ya existentes en el puente MCTXK.'
  );

  drawLdnSubheader('LÍNEA DE NEGOCIO 2 — Fraccionados Puros (Vaciado de Contenedores Abiertos y Lotes de Bulto)');
  drawTaskRow(
    'Semilla de Zapallo AA',
    null,
    'Fraccionar: SEM Zapallo AA x 5kg (SZAAx5): 3 u.',
    '11 min',
    'Vaciado de tacho: Usa exactamente los 15,0 kg ya abiertos en taller sin abrir bolsa nueva y libera el contenedor.'
  );
  drawTaskRow(
    'Sésamo Blanco',
    null,
    'Fraccionar: SEM Sesamo Blanco x 5kg (SBX5): 5 u.',
    '25 min',
    'Lote completo de bulto: Abrir 1 bolsa madre de 25 kg y envasar las 5 bolsas de 5 kg juntas (evita dejar bolsa abierta).'
  );

  doc.y += 3;

  // =========================================================================
  // JORNADA 2: RESTO DE LA SEMANA (SEGUNDA VISITA)
  // =========================================================================
  drawJornadaHeader(
    'JORNADA 2 — RESTO DE LA SEMANA (Carros de Mix y Tostados en Taller)',
    'Total est.: ~3h 05m',
    '#ede9fe',
    '#8b5cf6',
    '#4c1d95'
  );

  drawLdnSubheader('LÍNEA DE NEGOCIO 3 — Carros de Mix Calibrados al 100% (Puente en 0 kg)');
  drawTaskRow(
    'Mix Salado',
    'Artículo puente (MSXK) 20 kg',
    'Fracciones: Mix Salado x 300g (MSX300G): 30 u. (3 packs de 10 x 300g) · Mix Salado x 2kg (MSx2): 3 u. · Mix Salado x 5kg (MSx5): 1 u.',
    '1h 40m',
    'Cierre exacto de 20 kg (9 kg en 300g + 6 kg en 2kg + 5 kg en 5kg = 20,0 kg). Resuelve el quiebre de MSX300G (hoy en 0 u.).'
  );
  drawTaskRow(
    'Mix Premium',
    'Artículo puente (MFSPXK) 10 kg',
    'Fracciones: Mix F/SCOS Premiun x 300g (MFSPx300): 30 u. (3 packs de 10 x 300g) · Mix F/SCOS Premiun x 1kg (MFSPX1): 1 u.',
    '58 min',
    'Cierre exacto de 10 kg (9 kg en 300g + 1 kg en 1kg = 10,0 kg). Resuelve el quiebre de MFSPx300 (hoy en 0 u.).'
  );

  drawLdnSubheader('LÍNEAS DE NEGOCIO 4, 5 Y 6 — Fraccionamiento de Tostados Ya Listos en Taller');
  drawTaskRow(
    'Almendra Tostada y Salada',
    null,
    'Fraccionar: ALMENDRA Peladas Non Pareil Tostado y Salado x 150g (ATySx150): 10 u. (1 pack de 10 x 150g)',
    '18 min',
    'Insumo tostado disponible en taller.'
  );
  drawTaskRow(
    'Almendra Tostada sin Sal',
    null,
    'Fraccionar: ALMENDRA Tostado x 1kg (ATX1): 5 u.',
    '10 min',
    'Tanda lógica de 5 bolsas de 1 kg utilizando los 15 kg de Almendra Tostada ya listos en taller.'
  );

  doc.y += 3;

  // =========================================================================
  // JORNADA 3: CIERRE DE SEMANA / ADELANTO QUINCENA
  // =========================================================================
  drawJornadaHeader(
    'JORNADA 3 — CIERRE DE SEMANA (Saldos Abiertos y Reposición)',
    'Total est.: ~2h 20m',
    '#f1f5f9',
    '#64748b',
    '#0f172a'
  );

  drawLdnSubheader('LÍNEA DE NEGOCIO 2 — Vaciado de Saldos Abiertos en Taller (Stock 0) y Bultos Cerrados');
  drawTaskRow(
    'Semilla de Chía Gris (Vaciar saldo abierto: 14,37 kg)',
    null,
    'Fraccionar: Semilla Chia x 1kg (EMB-JYS9SJ): 14 u.',
    '22 min',
    'Presentación de 1 kg en stock 0. Se envasan los 14 kg abiertos en taller y se libera el contenedor.'
  );
  drawTaskRow(
    'Pasas de Uva Jumbo y Almendra Non Pareil (Vaciar saldos abiertos)',
    null,
    'Fraccionar: Pasas de Uva Jumbo x 1kg (EMB-JK1OOX): 8 u. · Almendra Pelada NP x 1kg (APN1x1): 4 u.',
    '20 min',
    'Ambas en stock 0. Usa los 8,29 kg abiertos de Pasas Jumbo y los 4,40 kg abiertos de Almendra NP.'
  );
  drawTaskRow(
    'Dátil Medjoul Israel y Maní con Cáscara Virginia',
    null,
    'Fraccionar: Datil Medjoul x 1kg (DIMx1): 5 u. · Mani VGNA Con cascara x 5kg (MCVX5): 4 u.',
    '25 min',
    'DIMx1 en stock 0 (1 caja entera de 5 kg = 5 bolsas de 1 kg). MCVX5 usa 20 kg disponibles.'
  );

  drawLdnSubheader('LÍNEA DE NEGOCIO 3 — Segundo Lote Mix Color Tropical (Cubriendo 2kg en Stock 0)');
  drawTaskRow(
    'Mix Color Tropical (Carro Completo)',
    'Artículo puente (MCTXK) 10 kg',
    'Fracciones: Mix Color Tropical x 2kg (EMB-AI7OIK): 2 u. · Mix F/SCOS Color Tropical x 300g (MCTX300): 20 u. (2 packs de 10 x 300g)',
    '35 min',
    'Cierre exacto de 10 kg (4 kg en 2kg + 6 kg en 300g = 10,0 kg). Cubre quiebre de bolsa de 2 kg sin sobre-stockear 5 kg.'
  );

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(desktopPath));
    stream.on('error', reject);
  });
}

generarPDF()
  .then(p => {
    console.log(`✅ PDF generado exitosamente en: ${p}`);
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Error generando PDF:', err);
    process.exit(1);
  });
