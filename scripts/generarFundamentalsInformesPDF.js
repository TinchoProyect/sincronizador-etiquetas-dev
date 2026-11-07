/**
 * Generador de los 3 Informes Gemelos de FUNDAMENTALS Y AUDITORÍA EMPÍRICA (PDF) — JUEVES 05/11/2026:
 * 1. /documentos/Fundamentals_Jornada_Hoy_Deposito.pdf
 * 2. /documentos/Fundamentals_Retiro_Produccion_Externa_Hoy.pdf
 * 3. /documentos/Fundamentals_Semanal_3_Jornadas_Deposito.pdf
 *
 * FORMATO DE ALTA LEGIBILIDAD (LETRA AL DOBLE DE TAMAÑO: 13.5pt a 16pt, MULTI-HOJA AUTOMÁTICO)
 * Reglas aplicadas:
 * - REGLA_JORNADAS_HACIA_ADELANTE_LIBRES_HASTA_FINITUD
 * - REGLA_TANDA_EJECUTADA_ARTICULO_CERRADO_SIN_RESIDUALES
 * - REGLA_CERO_SUPERPOSICION_HOY_VS_SEMANAL_SUBSIGUIENTE
 * - REGLA_AUDITORIA_CARROS_INTERNOS_EN_PAUSA_O_SIN_TERMINAR
 * - REGLA_INGREDIENTES_COMPARTIDOS_CON_MIXES_NO_VACIAR
 * - REGLA_LDN2_EXCLUSION_ABRECAJA_Y_MADRE
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const pool = require('../src/produccion/config/database');

const docsDir = path.join(__dirname, '..', 'src', 'app-etiquetas', 'documentos');
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}
const logoPath = path.join(__dirname, '..', 'src', 'app-etiquetas', 'img', 'logo_LAMDA.png');

async function obtenerDescripcionesBunker() {
  const skus = [
    'MCTXK', 'EMB-AI7OIK',
    'MSXK', 'MSx2',
    'APN25/27X150G', 'NMECHAMX200G', 'CRx5',
    'MFBx2,5', 'MFDQX2,5', 'MFX2,5',
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

function ensureSpace(doc, neededHeight) {
  const bottomLimit = doc.page.height - doc.page.margins.bottom;
  if (doc.y + neededHeight > bottomLimit) {
    doc.addPage();
  }
}

function drawDocumentHeader(doc, startX, pageWidth, titulo, subtitulo) {
  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, startX, 22, { height: 38 });
  }
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(15.5)
    .text(titulo, startX + 135, 22, { width: pageWidth - 135, align: 'right' });
  doc.fillColor('#334155').font('Helvetica').fontSize(11.5)
    .text(subtitulo, startX, 66, { width: pageWidth, align: 'left' });
  const lineY = doc.y + 6;
  doc.moveTo(startX, lineY).lineTo(startX + pageWidth, lineY).lineWidth(1.5).stroke('#0f172a');
  doc.y = lineY + 12;
}

function drawFourPillarsBox(doc, startX, pageWidth, pillars) {
  let estimatedH = 34;
  pillars.forEach(p => {
    doc.font('Helvetica').fontSize(13.0);
    const h = doc.heightOfString(`• ${p.titulo}: ${p.detalle}`, { width: pageWidth - 24, lineGap: 2 });
    estimatedH += h + 8;
  });

  ensureSpace(doc, estimatedH + 12);
  const y0 = doc.y;
  doc.rect(startX, y0, pageWidth, estimatedH).fillAndStroke('#f8fafc', '#64748b');

  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(13.5)
    .text('CRITERIOS DE AUDITORÍA EMPÍRICA APLICADOS (JUEVES 05/11/2026):', startX + 12, y0 + 10, { width: pageWidth - 24 });

  let py = doc.y + 6;
  pillars.forEach(p => {
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(13.0)
      .text(`• ${p.titulo}: `, startX + 12, py, { width: pageWidth - 24, continued: true, lineGap: 2 })
      .fillColor('#1e293b').font('Helvetica').fontSize(13.0)
      .text(p.detalle, { lineGap: 2 });
    py = doc.y + 6;
  });

  doc.y = Math.max(py + 6, y0 + estimatedH + 12);
}

function drawSectionBanner(doc, startX, pageWidth, titulo, badgeRight, bg = '#0f172a', fg = '#ffffff') {
  ensureSpace(doc, 195);
  const y0 = doc.y;
  const textFull = badgeRight ? `${titulo}   (${badgeRight})` : titulo;
  doc.font('Helvetica-Bold').fontSize(13.5);
  const textH = doc.heightOfString(textFull, { width: pageWidth - 20 });
  const barH = Math.max(28, textH + 12);

  doc.rect(startX, y0, pageWidth, barH).fillAndStroke(bg, bg);
  doc.fillColor(fg).font('Helvetica-Bold').fontSize(13.5)
    .text(textFull, startX + 10, y0 + 6, { width: pageWidth - 20 });
  doc.y = y0 + barH + 10;
}

function drawAuditItemCard(doc, startX, pageWidth, item) {
  doc.font('Helvetica-Bold').fontSize(14.2);
  const hTitle = doc.heightOfString(`${item.nombre} (${item.sku}): ${item.cantidad}  [${item.tiempo}]`, { width: pageWidth - 16 });
  doc.font('Helvetica').fontSize(13.2);
  const hEmp = doc.heightOfString(`• Datos Empíricos: ${item.datosEmpiricos}`, { width: pageWidth - 20, lineGap: 1.5 });
  const hFund = doc.heightOfString(`• Fundamental (Por qué se organizó así): ${item.fundamental}`, { width: pageWidth - 20, lineGap: 1.5 });
  const totalCardH = hTitle + hEmp + hFund + 38;

  ensureSpace(doc, totalCardH);

  const y0 = doc.y;

  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(14.5)
    .text(`${item.nombre} `, startX + 6, y0, { width: pageWidth - 12, continued: true })
    .fillColor('#334155').font('Helvetica-Bold').fontSize(13.5)
    .text(`(${item.sku}): `, { continued: true })
    .fillColor('#0f172a').font('Helvetica-Bold').fontSize(14.5)
    .text(item.cantidad, { continued: true })
    .fillColor('#475569').font('Helvetica').fontSize(13.2)
    .text(`  [${item.tiempo}]`);

  doc.fillColor(item.badgeColor || '#1e40af').font('Helvetica-Bold').fontSize(13.0)
    .text(`-> ${item.coberturaPost}`, startX + 12, doc.y + 2, { width: pageWidth - 20 });

  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(13.2)
    .text('• Datos Empíricos: ', startX + 12, doc.y + 4, { width: pageWidth - 20, continued: true, lineGap: 1.5 })
    .fillColor('#1e293b').font('Helvetica').fontSize(13.2)
    .text(item.datosEmpiricos, { lineGap: 1.5 });

  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(13.2)
    .text('• Fundamental (Por qué se organizó así): ', startX + 12, doc.y + 3, { width: pageWidth - 20, continued: true, lineGap: 1.5 })
    .fillColor('#1e293b').font('Helvetica').fontSize(13.2)
    .text(item.fundamental, { lineGap: 1.5 });

  const endY = doc.y + 5;
  doc.moveTo(startX, endY).lineTo(startX + pageWidth, endY).lineWidth(0.8).stroke('#94a3b8');
  doc.y = endY + 7;
}

function drawLargeClosureBanner(doc, startX, pageWidth, texto) {
  doc.font('Helvetica-Bold').fontSize(13.2);
  const h = doc.heightOfString(texto, { width: pageWidth - 24, lineGap: 2.0 });
  const boxH = h + 16;
  ensureSpace(doc, boxH + 6);
  const yFin = doc.y + 2;
  doc.rect(startX, yFin, pageWidth, boxH).fillAndStroke('#f0fdf4', '#16a34a');
  doc.fillColor('#14532d').font('Helvetica-Bold').fontSize(13.2)
    .text(texto, startX + 12, yFin + 8, { width: pageWidth - 24, align: 'left', lineGap: 2.0 });
  doc.y = yFin + boxH + 6;
}

// ============================================================================
// 1. FUNDAMENTALS DE LA JORNADA DE HOY (JUEVES 05/11/2026 — EXCLUSIVO HOY)
// ============================================================================
async function generarFundamentalsJornadaHoy(d) {
  const outPath = path.join(docsDir, 'Fundamentals_Jornada_Hoy_Deposito.pdf');
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 26, bottom: 26, left: 32, right: 32 }
  });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const startX = doc.page.margins.left;

  drawDocumentHeader(
    doc,
    startX,
    pageWidth,
    'FUNDAMENTALS — PLAN JORNADA DE HOY',
    'Hoy Jueves 05/11/2026  ·  Plan A (~2h 51m) + 0 Carros en Pausa + Adelanto (+30 min)'
  );

  drawFourPillarsBox(doc, startX, pageWidth, [
    {
      titulo: '1. Auditoría Empírica de lo que Matías ejecutó ayer Miércoles 04/11 (Jornada #35: 13:27 a 16:36 hs = 189 min)',
      detalle: 'Ayer miércoles Matías ejecutó y confirmó los 4 Carros Internos del plan (#3000 al #3003): a) Carros #3000 y #3001 (Línea 3): armó los 20,00 kg del artículo puente MFSXK y los fraccionó íntegros en 4 bolsas de Mix Con Pasas x 5kg (MFSx5: 4 u., cerrando el puente en 0,0 kg); b) Carro #3002 (Línea 2): Tomate Seco x 500g (EMB-0W5BOW: 5 u., vaciando la bolsa abierta a 0,39 kg) y Maíz Frito Barbacoa x 250g (EMB-IIVL86: 10 u. = 1 pack); c) Carro #3003 (Línea 5): Mezcla BARRA Flor x 4kg (MPB: 2 u. = 8,0 kg, reponiendo la bolsa salida a las 10:02 hs en Factura Interna #90-64 y dejando 2 bolsas de MPB, 2 de MPGDSX7 y 2 de MPGDFX6,9 listas en estantería). Dejó 0 carros en pausa.'
    },
    {
      titulo: '2. Por qué hoy Jueves 05/11 ingresan nuevas tareas (8 Facturas emitidas ayer de 16:18 a 16:23 hs)',
      detalle: 'Ayer miércoles por la tarde (entre las 16:18 y las 16:23 hs, justo al cierre de la jornada de Matías) se emitieron las Facturas A #32-169 a #32-174, Factura B #32-43 y Facturas Internas #90-65 y #90-66 (34 renglones despachados). Esas ventas dejaron en 0 u. (quiebre real) a Mix Color Tropical x 2kg (EMB-AI7OIK), Almendra Pelada x 150g (APN25/27X150G) y Nuez Mariposa x 200g (NMECHAMX200G), y bajaron Mix Salado x 2kg (MSx2) a 1 u. (15d) y Coco Rallado x 5kg (CRx5) a 2 u. (12d).'
    },
    {
      titulo: '3. Aplicación de REGLA_TANDA_EJECUTADA_ARTICULO_CERRADO_SIN_RESIDUALES',
      detalle: 'Todo lo producido ayer en los Carros #3000, #3001, #3002 y #3003 (MFSx5, EMB-0W5BOW, EMB-IIVL86 y MPB) queda 100% CERRADO y descontado.'
    }
  ]);

  drawSectionBanner(
    doc,
    startX,
    pageWidth,
    '1. PLAN A · LÍNEA 3 — MIXES EN QUIEBRE POR VENTAS DE AYER (CIERRE PUENTES EN 0 KG)',
    '~54 min',
    '#92400e'
  );

  drawAuditItemCard(doc, startX, pageWidth, {
    nombre: 'Artículo puente: PROD AP Interno F/SCOS Color Tropical Mix (MCTXK: 10,0 kg) -> 5 u. Mix F/SCOS Color Tropical x 2kg (EMB-AI7OIK)',
    sku: 'MCTXK -> EMB-AI7OIK',
    cantidad: '10,0 kg (5 bolsas x 2 kg, Cierre Puente = 0,0 kg)',
    tiempo: '~28 min',
    coberturaPost: 'Cobertura Post-Producción: 5 bolsas de EMB-AI7OIK (~30 a 90 días)',
    datosEmpiricos: 'Ayer miércoles a las 16:18 y 16:23 hs (Factura B #32-43 y Factura Interna #90-65) se vendieron las 2 unidades de EMB-AI7OIK que había en estantería, cayendo el stock a 0 u. Sus hermanos ya están cubiertos: MCTX300 tiene 40 u. (4 packs cerrados = 120d) y MCTX5 tiene 1 u.',
    fundamental: 'Se elabora 1 carro de 10,0 kg del puente MCTXK (absorbiendo el saldo técnico de 1,30 kg en taller) y se fracciona 100% en 5 bolsas de 2 kg (EMB-AI7OIK), cerrando el puente en 0,0 kg.'
  });

  drawAuditItemCard(doc, startX, pageWidth, {
    nombre: 'Artículo puente: PROD AP Interno Salado Mix (MSXK: 10,0 kg) -> 5 u. Mix Salado x 2kg (MSx2)',
    sku: 'MSXK -> MSx2',
    cantidad: '10,0 kg (5 bolsas x 2 kg, Cierre Puente = 0,0 kg)',
    tiempo: '~26 min',
    coberturaPost: 'Cobertura Post-Producción: 6 bolsas de MSx2 (~90 días)',
    datosEmpiricos: 'Ayer miércoles a las 16:23 hs (Factura Interna #90-65) salió 1 bolsa de MSx2, quedando sólo 1 u. en estantería (~15 días) y 1,28 kg abiertos en el puente MSXK. Sus hermanos MSX300G (10 u. = 45d) y MSx5 (3 u. = 45d) ya están cubiertos.',
    fundamental: 'Se arma 1 carro de 10,0 kg del puente MSXK (sumando los 8,70 kg nuevos más el saldo abierto en puente) y se envasan 5 bolsas de MSx2, cerrando el puente en 0,0 kg.'
  });

  drawSectionBanner(
    doc,
    startX,
    pageWidth,
    '2. PLAN A · LÍNEA 2 — REPOSICIÓN DE QUIEBRES POR FACTURACIÓN DE AYER',
    '~60 min',
    '#14532d'
  );

  drawAuditItemCard(doc, startX, pageWidth, {
    nombre: d('APN25/27X150G', 'ALMENDRA Peladas x 150g'),
    sku: 'APN25/27X150G',
    cantidad: '10 u. (1,5 kg — 1 pack de 10 x 150g)',
    tiempo: '~11 min',
    coberturaPost: 'Cobertura Post-Producción: ~30 días (1 pack de 10 x 150g disponible)',
    datosEmpiricos: 'Ayer miércoles a las 16:18 hs en la Factura A #32-170 se vendieron las 10 u. (1 pack) de APN25/27X150G que se habían envasado el lunes, quedando hoy en 0 u. Sus hermanos mayores (APN27/30X5 = 7u, APNx2 = 3u, APN1x1 = 1u) están cubiertos.',
    fundamental: 'Se repone 1 pack cerrado de 10 x 150g (1,5 kg) reservando las cajas de Almendra Nonparei para el Mix Premium.'
  });

  drawAuditItemCard(doc, startX, pageWidth, {
    nombre: d('NMECHAMX200G', 'Nuez PADA CHLER MPSA EXLIGHT x 200g'),
    sku: 'NMECHAMX200G',
    cantidad: '15 u. (3,0 kg — 1 pack de 10 x 200g + 5 sueltas)',
    tiempo: '~20 min',
    coberturaPost: 'Cobertura Post-Producción: ~45 días (15 u. disponibles)',
    datosEmpiricos: 'Ayer miércoles a las 16:18 hs en la Factura A #32-170 se vendieron las 10 u. (1 pack) de NMECHAMX200G, cayendo su stock a 0 u. En el taller hay 6,22 kg abiertos de Nuez Mariposa Extra Light (Ing. #25).',
    fundamental: 'Usando sólo 3,0 kg de los 6,22 kg abiertos en taller, se envasan 15 unidades de 200g (1 pack + 5 sueltas) y se preservan 3,22 kg en taller más las 3 cajas cerradas para el Mix Premium (REGLA_INGREDIENTES_COMPARTIDOS_CON_MIXES_NO_VACIAR).'
  });

  drawAuditItemCard(doc, startX, pageWidth, {
    nombre: d('CRx5', 'Coco Rallado HF x 5kg'),
    sku: 'CRx5',
    cantidad: '5 u. (25,0 kg — 1 bolsa entera de 25 kg)',
    tiempo: '~29 min',
    coberturaPost: 'Cobertura Post-Producción: 7 bolsas (~42 días sobre demanda de 5 bolsas/mes)',
    datosEmpiricos: 'Ayer miércoles a las 16:18 hs salieron 3 bolsas de 5 kg en tres comprobantes distintos (Factura A #32-171, Factura A #32-173 y Factura B #32-43), cayendo el stock a sólo 2 bolsas (12 días de cobertura). En depósito hay 2 bolsas cerradas de 25 kg de Coco Rallado.',
    fundamental: 'Se baja 1 bolsa cerrada entera de 25 kg y se fracciona completa en 5 bolsas de 5 kg (CRx5), llevando el stock de 2 a 7 bolsas (~42 días) sin dejar sobrante abierto en taller.'
  });

  drawSectionBanner(
    doc,
    startX,
    pageWidth,
    '3. PLAN A · LÍNEA 2 — VACIADO DE BOLSAS ABIERTAS DE MAÍZ FRITO EN STOCK 0',
    '~57 min',
    '#1e3a8a'
  );

  drawAuditItemCard(doc, startX, pageWidth, {
    nombre: 'Maíz FTO Barbacoa x 2.5kg (5 u.) + Maíz FTO Queso x 2.5kg (2 u.) + Maíz Frito x 2.5kg (5 u.)',
    sku: 'MFBx2,5 (5u) + MFDQX2,5 (2u) + MFX2,5 (5u)',
    cantidad: '5 u. MFBx2,5 (12,5 kg) + 2 u. MFDQX2,5 (5,0 kg) + 5 u. MFX2,5 (12,5 kg)',
    tiempo: '~57 min (~20m + ~17m + ~20m)',
    coberturaPost: 'Cobertura Post-Producción: 60 a 150 días (y 3 tachos abiertos vaciados en taller)',
    datosEmpiricos: 'Las 3 presentaciones de 2,5 kg de Maíz Frito están en 0 unidades (quiebre total) y las 3 tienen su bolsa abierta en el taller: 13,00 kg abiertos de Maíz Barbacoa (tras hacer ayer los 2,5 kg de 250g en el Carro #3002), 6,40 kg abiertos de Maíz Queso y 13,76 kg abiertos de Maíz Frito Clásico (tras descontar Mix Salado).',
    fundamental: 'Envasar 5 bolsas de MFBx2,5 (12,5 kg), 2 bolsas de MFDQX2,5 (5,0 kg) y 5 bolsas de MFX2,5 (12,5 kg) elimina los 3 quiebres en estantería y vacía los 3 contenedores abiertos del taller en una sola sesión.'
  });

  drawSectionBanner(
    doc,
    startX,
    pageWidth,
    '4. SI SOBRA TIEMPO HOY — ADELANTO DEL PLAN HACIA ADELANTE',
    '~30 min',
    '#4c1d95'
  );

  drawAuditItemCard(doc, startX, pageWidth, {
    nombre: 'Adelanto de la Jornada 1 Hacia Adelante: Nuez Cuarto LHT x 5kg (2 u.) + Pasas de Uva Rubia x 2kg (5 u.)',
    sku: 'EMB-VH3OLC (2u) + PRx2 (5u)',
    cantidad: '2 u. EMB-VH3OLC (10,0 kg, ~10m) + 5 u. PRx2 (10,0 kg, ~20m)',
    tiempo: '~30 min',
    coberturaPost: 'Cobertura Post-Producción: 45 a 150 días',
    datosEmpiricos: 'EMB-VH3OLC tiene 1 u. (15 días) y 10,25 kg abiertos en taller; PRx2 está en 0 u. con 7 cajas cerradas de 10 kg en depósito.',
    fundamental: 'Pertenecen a la Jornada 1 Hacia Adelante, pero figuran al pie del Plan de Hoy por si sobra tiempo en la jornada.'
  });

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(outPath));
    stream.on('error', reject);
  });
}

// ============================================================================
// 2. FUNDAMENTALS DE RETIRO PARA PRODUCCIÓN EXTERNA (LÍNEAS 4, 5 Y 6)
// ============================================================================
async function generarFundamentalsRetiroExterna() {
  const outPath = path.join(docsDir, 'Fundamentals_Retiro_Produccion_Externa_Hoy.pdf');
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 26, bottom: 26, left: 32, right: 32 }
  });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const startX = doc.page.margins.left;

  drawDocumentHeader(
    doc,
    startX,
    pageWidth,
    'FUNDAMENTALS — RETIRO PRODUCCIÓN EXTERNA',
    'Hoy Jueves 05/11/2026  ·  Total a retirar hoy: 0 UPs  ·  0 Carros Externos en la Calle'
  );

  drawFourPillarsBox(doc, startX, pageWidth, [
    {
      titulo: '1. Cero Carros Externos en la Calle y Estantería de Pre-Mezclas al 100%',
      detalle: 'No hay ningún carro externo abierto ni mercadería en tránsito en casa de Matías. Ayer miércoles en el Carro Interno #3003 Matías elaboró 2 bolsas nuevas de MPB (8,0 kg), dejando el pulmón de estantería completo: 2 bolsas de MPB, 2 bolsas de MPGDFX6,9 y 2 bolsas de MPGDSX7.'
    },
    {
      titulo: '2. Principio de Finitud Externa: 0 UPs a Retirar Hoy Jueves 05/11',
      detalle: 'Las Líneas 4, 5 y 6 cuentan con su stock ideal cubierto (30 a 50 días de demanda). El informe operativo muestra única y limpiamente: 0 UPs — NO HAY NADA PARA PRODUCIR EXTERNAMENTE HOY.'
    }
  ]);

  drawSectionBanner(
    doc,
    startX,
    pageWidth,
    '1. AUDITORÍA EMPÍRICA DE COBERTURA EN LÍNEAS 4, 5 Y 6 (0 UPs A RETIRAR)',
    '0 UPs a retirar hoy',
    '#1e3a8a'
  );

  drawAuditItemCard(doc, startX, pageWidth, {
    nombre: 'Línea de Negocio 4 — Tostadero Externo',
    sku: 'ATXKUP / CCTSGXKUP / APTSPGUP',
    cantidad: '0 UPs a retirar hoy',
    tiempo: 'Cobertura: 30 a 180 días',
    coberturaPost: 'FINITUD LÍNEA 4: 100% Cubierta con Mercadería Tostada en Depósito',
    datosEmpiricos: 'CCTX1 (2 u. = 180d), ATX1 (1 u. = 30d), ATySx5 (2 u. = 60d), ATySx150 (20 u. = 90d), CCTX5 (2 u. = 36d), CCTX2 (4 u. = 360d) y CCTSx150/2B/5 (20/4/3 u. > 45d) están cubiertos.',
    fundamental: 'No se requiere enviar ningún fruto seco crudo a tostadero externo hoy.'
  });

  drawAuditItemCard(doc, startX, pageWidth, {
    nombre: 'Línea de Negocio 5 — Barritas de Cereal (Flor)',
    sku: 'MPB -> BF24X50',
    cantidad: '0 UPs a retirar hoy',
    tiempo: 'Cobertura: 30,0 días (9 cajas cerradas + 2 bolsas MPB)',
    coberturaPost: 'FINITUD LÍNEA 5: Stock Finito Completo (9 cajas libres + 2 bolsas MPB en estantería)',
    datosEmpiricos: 'Tras despacharse ayer el presupuesto comprometido de 1 caja en la Factura Interna #90-65, quedan 9 cajas libres de BF24X50 (30,0 días exactos sobre ventas de 9 cajas/mes) y 2 bolsas de pre-mezcla MPB (8,0 kg) producidas ayer en el Carro #3003.',
    fundamental: 'Con 30 días de producto terminado y 2 bolsas de pre-mezcla listas en estantería, no se requiere retirar ninguna bolsa de MPB hoy.'
  });

  drawAuditItemCard(doc, startX, pageWidth, {
    nombre: 'Línea de Negocio 6 — Granolas Horneadas (Sol y Flor)',
    sku: 'MPGDSX7 / MPGDFX6,9 -> GSX / GDFX',
    cantidad: '0 UPs a retirar hoy',
    tiempo: 'Cobertura: 30 a 48 días',
    coberturaPost: 'FINITUD LÍNEA 6: Cobertura Plena',
    datosEmpiricos: 'El stock actual hoy jueves es: GSX1 = 14 u. (46,7d), GSX500G = 5 u. (30d), GDFX1 = 13 u. (48,8d) y GDFX500G = 5 u. (45d). Buffer en estantería: 2 bolsas MPGDFX6,9 y 2 bolsas MPGDSX7.',
    fundamental: 'Ambas líneas de Granola superan los 30 días de cobertura; 0 UPs a retirar hoy.'
  });

  drawLargeClosureBanner(
    doc,
    startX,
    pageWidth,
    '• Estado Finito en Producción Externa = 0 UPs a retirar hoy jueves 05/11/2026.\n' +
    '• Las Líneas 4, 5 y 6 se encuentran cubiertas para el horizonte operativo mensual (>= 30 a 50 días).'
  );

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(outPath));
    stream.on('error', reject);
  });
}

// ============================================================================
// 3. FUNDAMENTALS DEL PLAN DE JORNADAS HACIA ADELANTE (CANTIDAD LIBRE HASTA FINITUD)
// ============================================================================
async function generarFundamentalsPlan3Jornadas() {
  const outPath = path.join(docsDir, 'Fundamentals_Semanal_3_Jornadas_Deposito.pdf');
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 26, bottom: 26, left: 32, right: 32 }
  });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const startX = doc.page.margins.left;

  drawDocumentHeader(
    doc,
    startX,
    pageWidth,
    'FUNDAMENTALS — JORNADAS HACIA ADELANTE',
    'Jueves 05/11/2026  ·  Cantidad Libre de Jornadas hasta Completar el Ideal  ·  Se completa en 1 Jornada (~2h 13m -> 0 Pendientes)'
  );

  drawFourPillarsBox(doc, startX, pageWidth, [
    {
      titulo: '1. Aplicación de REGLA_JORNADAS_HACIA_ADELANTE_LIBRES_HASTA_FINITUD (1 Jornada Hacia Adelante)',
      detalle: 'Descontando el Plan de Hoy Jueves 05/11 (~2h 51m), la totalidad del trabajo restante en el depósito suma ~2h 13m (133 minutos) y se completa íntegramente en 1 única Jornada Hacia Adelante, tras la cual quedan 0 tareas pendientes.'
    },
    {
      titulo: '2. Descuento Total de los 4 Carros Confirmados Ayer Miércoles 04/11 (#3000 al #3003)',
      detalle: 'Se descontaron al 100% los Carros #3000 (MFSXK: 20 kg), #3001 (MFSx5: 4 u.), #3002 (EMB-0W5BOW: 5 u. + EMB-IIVL86: 10 u.) y #3003 (MPB: 2 u.) confirmados ayer miércoles por Matías.'
    }
  ]);

  drawSectionBanner(
    doc,
    startX,
    pageWidth,
    '1. JORNADA 1 HACIA ADELANTE — VACIADO DE TACHOS ABIERTOS Y CIERRE DE STOCK IDEAL',
    '~2h 13m',
    '#14532d'
  );

  drawAuditItemCard(doc, startX, pageWidth, {
    nombre: '[JORNADA 1 HACIA ADELANTE · PARTE A] Nuez Cuarto LHT x 5kg (2 u.) + Pasas Rubias x 2kg (5 u.) + Pasas Jumbo x 1kg (8 u.) + Harina de Coco x 1kg (3 u.)',
    sku: 'EMB-VH3OLC (2u) + PRx2 (5u) + EMB-JK1OOX (8u) + EMB-9KG3XS (3u)',
    cantidad: '2 u. EMB-VH3OLC (10kg, ~10m) + 5 u. PRx2 (10kg, ~20m) + 8 u. EMB-JK1OOX (8kg, ~35m) + 3 u. EMB-9KG3XS (3kg, ~25m)',
    tiempo: '~1h 30m',
    coberturaPost: 'Post-Prod: 45 a 240 días de cobertura y 3 contenedores abiertos vaciados en taller',
    datosEmpiricos: '1) EMB-VH3OLC tiene 1 u. (15d) y 10,25 kg abiertos en taller (Ing. #133); 2) PRx2 está en 0 u. con 7 cajas cerradas de 10 kg en depósito (Ing. #35); 3) EMB-JK1OOX está en 0 u. con 8,29 kg abiertos en taller (Ing. #153); 4) EMB-9KG3XS está en 0 u. con 3,59 kg abiertos en taller (Ing. #101).',
    fundamental: 'Vacía los contenedores abiertos de Nuez Cuarto Light, Pasas Jumbo y Harina de Coco y fracciona 1 caja entera de 10 kg de Pasas Rubias sin dejar sobrantes.'
  });

  drawAuditItemCard(doc, startX, pageWidth, {
    nombre: '[JORNADA 1 HACIA ADELANTE · PARTE B] Maní Salado x 5kg (3 u.) + Avellanas Peladas x 2kg (4 u.) + Semilla Chía Gris x 1kg (3 u.) + Semilla Quinoa x 1kg (3 u.)',
    sku: 'MRSx5 (3u) + APx2 (4u) + EMB-JYS9SJ (3u) + QRX1 (3u)',
    cantidad: '3 u. MRSx5 (15kg, ~12m) + 4 u. APx2 (8kg, ~10m) + 3 u. EMB-JYS9SJ (3kg, ~7m) + 3 u. QRX1 (3kg, ~14m)',
    tiempo: '~43 min',
    coberturaPost: 'Post-Prod: 45 a 240 días de cobertura y 4 contenedores abiertos vaciados en taller',
    datosEmpiricos: '1) MRSx5 tiene 3 u. (22,5d) y 16,80 kg abiertos en taller (Ing. #45) más 1 bolsa cerrada de 25 kg; 2) APx2 está en 0 u. con 8,45 kg abiertos en taller (Ing. #21); 3) EMB-JYS9SJ está en 0 u. con 3,76 kg abiertos (Ing. #147); 4) QRX1 está en 0 u. con 3,83 kg abiertos (Ing. #97).',
    fundamental: 'Envasa los 4 saldos abiertos en taller (respetando la bolsa cerrada de 25 kg de Maní Salado para Mix Salado) y completa el 100% del Stock Ideal.'
  });

  drawAuditItemCard(doc, startX, pageWidth, {
    nombre: '[ANEXO DE COMPRAS — EXCLUIDOS DE TALLER POR FALTA DE MATERIA PRIMA]',
    sku: 'PKX2 + EMB-W8QB6Y + HDGX5 + DIMx1 + SBX5 + MFSTXK (Mix Tropical)',
    cantidad: 'Bloqueados hasta ingreso de mercadería de proveedor',
    tiempo: '0 min en taller hoy',
    coberturaPost: 'Derivar a Compras: Panko, Maíz Mostaza y Miel, Harina Garbanzo, Dátil, Sésamo Blanco y Kiwi',
    badgeColor: '#b91c1c',
    datosEmpiricos: 'PKX2 (Ing. #165: 0,05 kg disp.), EMB-W8QB6Y (Ing. #44: 1,40 kg disp. vs 2,50 kg req.), HDGX5 (Ing. #48: 0 kg), DIMx1 (Ing. #89: 0 kg), SBX5 (Ing. #128: 0,72 kg) y Mix Tropical MFSTXK (Ing. #126 Kiwi: 0,41 kg disp. vs 0,75 kg req.) no cuentan con materia prima suficiente.',
    fundamental: 'No se incluyen en la hoja operativa de Matías para evitar tareas imposibles en taller hasta que ingrese la compra.'
  });

  drawLargeClosureBanner(
    doc,
    startX,
    pageWidth,
    'DEMOSTRACIÓN DE FINITUD (CANTIDAD LIBRE DE JORNADAS HACIA ADELANTE = 1 JORNADA DE ~2h 13m -> 0 TAREAS PENDIENTES): Al completarse esta única Jornada Hacia Adelante (~2h 13m), el depósito alcanza el 100% del Stock Ideal con 0 jornadas adicionales requeridas.'
  );

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(outPath));
    stream.on('error', reject);
  });
}

async function generarTodosLosFundamentals() {
  const d = await obtenerDescripcionesBunker();
  const p1 = await generarFundamentalsJornadaHoy(d);
  const p2 = await generarFundamentalsRetiroExterna();
  const p3 = await generarFundamentalsPlan3Jornadas();
  return { p1, p2, p3 };
}

if (require.main === module) {
  generarTodosLosFundamentals()
    .then(({ p1, p2, p3 }) => {
      console.log(`✅ Fundamentals Jornada Hoy (Jueves 05/11) generado en: ${p1}`);
      console.log(`✅ Fundamentals Retiro Externa (Jueves 05/11) generado en: ${p2}`);
      console.log(`✅ Fundamentals Jornadas Hacia Adelante (Jueves 05/11) generado en: ${p3}`);
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ Error generando PDFs de Fundamentals:', err);
      process.exit(1);
    });
}

module.exports = { generarTodosLosFundamentals };
