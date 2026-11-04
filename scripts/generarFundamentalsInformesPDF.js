/**
 * Generador de los 3 Informes Gemelos de FUNDAMENTALS Y AUDITORÍA EMPÍRICA (PDF) — MIÉRCOLES 04/11/2026:
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
    'BFX50G', 'BF24X50',
    'EMB-NU9HD0', 'APN1x1', 'EMB-0W5BOW', 'EMB-IIVL86',
    'CCTX1', 'ATX1', 'ATySx5',
    'MPGDSX7', 'MPGDFX6,9', 'MPB',
    'MFSXK', 'MFSx5',
    'NMBEX1K', 'CHBx2', 'MRSSGx2'
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
    .text('CRITERIOS DE AUDITORÍA EMPÍRICA APLICADOS (MIÉRCOLES 04/11/2026):', startX + 12, y0 + 10, { width: pageWidth - 24 });

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
  ensureSpace(doc, 210);
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
// 1. FUNDAMENTALS DE LA JORNADA DE HOY (MIÉRCOLES 04/11/2026 — EXCLUSIVO HOY)
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
    'Hoy Miércoles 04/11/2026  ·  Plan A (Cierre Total Hoy: ~1h 50m) + 0 Carros en Pausa + 0 Resto Hacia Adelante'
  );

  drawFourPillarsBox(doc, startX, pageWidth, [
    {
      titulo: '1. Auditoría Empírica de lo que Matías ejecutó ayer Martes 03/11 (Jornada #34: 13:31 a 17:12 hs = 221 min)',
      detalle: 'Ayer martes Matías ejecutó y confirmó 5 Carros Internos (#2995 al #2999): a) Carro #2995: Almendra Pelada NP x 1kg (APN1x1: 2 u., vaciando a 0 kg el tacho abierto); b) Carro #2996: Encajado de las 4 cajas de BARRA Flor 24 x 50g (BF24X50: 4 u., consumiendo los 4,80 kg del puente BFX50G y cerrando la Línea 5 en 10 cajas = ~34 días); c) Carro #2997: Higo Turco x 2kg (EMB-NU9HD0: 4 u.), Castañas Cajú Tostadas x 1kg (CCTX1: 2 u.), Almendra Tostada x 1kg (ATX1: 1 u.) y Almendra Tostada/Salada x 5kg (ATySx5: 2 u.); d) Carro #2998 (adelantado del bloque "Si sobra tiempo"): Nuez Mariposa x 1kg (NMBEX1K: 2 u.), Banana Chips x 2kg (CHBx2: 2 u.) y Maní R/T S/Sal x 2kg (MRSSGx2: 3 u.); e) Carro #2999: insumos de empaque. Dejó 0 carros en pausa y ayer se emitieron 0 facturas.'
    },
    {
      titulo: '2. Aplicación de REGLA_TANDA_EJECUTADA_ARTICULO_CERRADO_SIN_RESIDUALES',
      detalle: 'Los 9 artículos producidos ayer en los Carros #2995, #2996, #2997 y #2998 alcanzaron entre 30 y 180 días de cobertura y quedan 100% CERRADOS, sin arrastrar saldos residuales.'
    },
    {
      titulo: '3. Finitud Total en la Jornada de Hoy Miércoles 04/11 (~1h 50m -> 0 Tareas Posteriores)',
      detalle: 'Descontados los 5 carros de ayer martes, en todo el depósito restan únicamente las 6 tareas no ejecutadas ayer (~25 min de Línea 2 + ~44 min de Línea 3 + ~41 min de Pre-Mezclas L5/L6 = ~1h 50m). Al entrar íntegras en el Plan de Hoy Miércoles 04/11, quedan 0 jornadas hacia adelante.'
    }
  ]);

  drawSectionBanner(
    doc,
    startX,
    pageWidth,
    '1. PLAN A · LÍNEA 2 — QUIEBRES EN STOCK 0 Y VACIADO DE TACHOS ABIERTOS',
    '~25 min',
    '#14532d'
  );

  drawAuditItemCard(doc, startX, pageWidth, {
    nombre: d('EMB-0W5BOW', 'Tomate Seco x 500g'),
    sku: 'EMB-0W5BOW',
    cantidad: '5 u. (2,5 kg)',
    tiempo: '~13 min',
    coberturaPost: 'Cobertura Post-Producción: >30 días (5 u. disponibles)',
    datosEmpiricos: 'Sigue en 0 unidades en stock_ventas (ayer martes Matías priorizó #2995, #2996, #2997 y el adelanto #2998). En el taller continúan los 2,90 kg abiertos de Tomate Seco del Carro #2991.',
    fundamental: 'Con los 2,90 kg ya abiertos en el taller, hoy miércoles se envasan las 5 bolsas de 500g (2,50 kg) en una sola tanda para dejar cubierto el mes y vaciar el contenedor abierto.'
  });

  drawAuditItemCard(doc, startX, pageWidth, {
    nombre: d('EMB-IIVL86', 'Maiz FTO Barbacoa x 250g'),
    sku: 'EMB-IIVL86',
    cantidad: '10 u. (2,5 kg — 1 pack de 10 x 250g)',
    tiempo: '~12 min',
    coberturaPost: 'Cobertura Post-Producción: ~30 días (10 u. = 1 pack disponible)',
    datosEmpiricos: 'Sigue en 0 unidades en stock_ventas tras el despacho de la Factura A #32-168 del lunes, y en el taller hay materia prima abierta lista para fraccionar.',
    fundamental: 'Se repone 1 pack de 10 x 250g (2,50 kg) con el contenedor abierto en taller para eliminar el quiebre en estantería.'
  });

  drawSectionBanner(
    doc,
    startX,
    pageWidth,
    '2. PLAN A · LÍNEA 3 — MEZCLA INTERNA EN TANDA ÚNICA (CIERRE PUENTE EN 0 KG)',
    '~44 min',
    '#92400e'
  );

  drawAuditItemCard(doc, startX, pageWidth, {
    nombre: 'Artículo puente: Mix F/SCOS Con Pasas a Granel (MFSXK: 20,0 kg) -> 4 u. Mix F/SCOS Con Pasas x 5kg (MFSx5)',
    sku: 'MFSXK -> MFSx5',
    cantidad: '20,0 kg (4 bolsas x 5 kg, Cierre Puente = 0,0 kg)',
    tiempo: '~44 min',
    coberturaPost: 'Cobertura Post-Producción: 5 bolsas de MFSx5 (~30 días sobre demanda de 5,3 bolsas/mes)',
    datosEmpiricos: 'MFSx5 tiene sólo 1 bolsa en stock (5,6 días de cobertura tras la venta en Factura A #32-166). Sus presentaciones hermanas ya están cubiertas: MFSX300G tiene 30 u. (3 packs cerrados), MFSx2 tiene 2 u. y MFSx1 tiene 1 u.',
    fundamental: 'Como ayer martes Matías ya adelantó los 3 ítems de Línea 2 de la jornada siguiente (NMBEX1K, CHBx2 y MRSSGx2 en el Carro #2998), esta tanda única de 20,0 kg de MFSXK -> 4 bolsas de MFSx5 pasa hoy miércoles al Plan A principal, cerrando el puente en 0,0 kg.'
  });

  drawSectionBanner(
    doc,
    startX,
    pageWidth,
    '3. PLAN A · LÍNEAS 5 Y 6 — REPOSICIÓN DE PRE-MEZCLAS DE ESTANTERÍA',
    '~41 min',
    '#4c1d95'
  );

  drawAuditItemCard(doc, startX, pageWidth, {
    nombre: 'Reposición de Pre-Mezclas Crudas en Estantería (MPGDSX7, MPGDFX6,9 y MPB)',
    sku: 'MPGDSX7 + MPGDFX6,9 + MPB',
    cantidad: '1 u. MPGDSX7 (7 kg) + 1 u. MPGDFX6,9 (6,9 kg) + 1 u. MPB (4 kg)',
    tiempo: '~41 min (~14m + ~14m + ~13m)',
    coberturaPost: 'Cobertura Post-Producción: Estantería en 3 bolsas de Grana Sol, 3 de Grana Flor y 2 de Barritas',
    datosEmpiricos: 'En la estantería del depósito hay actualmente 2 bolsas de MPGDSX7, 2 bolsas de MPGDFX6,9 y 1 bolsa de MPB.',
    fundamental: 'Restaura el pulmón obligatorio de pre-mezclas listas en estantería y deja el depósito en Finitud Total al concluir la jornada de hoy miércoles.'
  });

  drawLargeClosureBanner(
    doc,
    startX,
    pageWidth,
    '• FINITUD TOTAL EN LA JORNADA DE HOY MIÉRCOLES 04/11/2026 (~1h 50m).\n' +
    '• Al completarse estas 6 tareas hoy en el taller, quedan 0 tareas pendientes y 0 jornadas hacia adelante requeridas.'
  );

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
    'Hoy Miércoles 04/11/2026  ·  Total a retirar hoy: 0 UPs  ·  0 Carros Externos en la Calle'
  );

  drawFourPillarsBox(doc, startX, pageWidth, [
    {
      titulo: '1. Cero Carros Externos en la Calle (Todas las Líneas Físicamente en Depósito)',
      detalle: 'No hay ningún carro externo abierto ni mercadería en tránsito en casa de Matías. Ayer martes en el taller se encajaron las 4 cajas de BF24X50 (Carro #2996) y se completó el fraccionamiento de tostados (Carro #2997).'
    },
    {
      titulo: '2. Principio de Finitud Externa: 0 UPs a Retirar Hoy Miércoles 04/11',
      detalle: 'Las Líneas 4, 5 y 6 cuentan con su stock ideal cubierto (30 a 50 días de demanda). El informe operativo muestra única y limpiamente: 0 UPs — NO HAY NADA PARA PRODUCIR EXTERNAMENTE HOY.'
    },
    {
      titulo: '3. Buffer de Pre-Mezclas Asegurado en Depósito (Sin Necesidad de Salida Hoy)',
      detalle: 'En estantería del depósito se mantienen listas 1 bolsa MPB (4kg), 2 bolsas MPGDFX6,9 (13,8kg) y 2 bolsas MPGDSX7 (14,0kg) como colchón de reserva para cuando la demanda lo amerite.'
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
    tiempo: 'Cobertura: 30 a 120 días',
    coberturaPost: 'FINITUD LÍNEA 4: 100% Cubierta con Mercadería Tostada en Depósito',
    datosEmpiricos: 'Ayer martes se fraccionaron en taller CCTX1 (2 u.), ATX1 (1 u.) y ATySx5 (2 u.) en el Carro #2997. Con ATySx150 en 20 u. (120d) y CCTSySx150 en 11 u. (>88d), la línea no requiere tostado externo.',
    fundamental: 'No se debe enviar ningún fruto seco crudo a tostadero externo hoy.'
  });

  drawAuditItemCard(doc, startX, pageWidth, {
    nombre: 'Línea de Negocio 5 — Barritas de Cereal (Flor)',
    sku: 'MPB -> BF24X50',
    cantidad: '0 UPs a retirar hoy',
    tiempo: 'Cobertura: ~31 a 34 días (10 cajas cerradas)',
    coberturaPost: 'FINITUD LÍNEA 5: Stock Finito Completo (10 cajas en estantería)',
    datosEmpiricos: 'Ayer martes en el Carro Interno #2996 se encajaron las 4 cajas de BF24X50 consumiendo el puente BFX50G (4,80 kg), elevando el stock terminado a 10 cajas cerradas (~31 a 34 días de cobertura). En estantería queda 1 bolsa MPB (4kg).',
    fundamental: 'La línea queda en Finitud Total por un mes; no se requiere retirar ninguna bolsa de MPB hoy.'
  });

  drawAuditItemCard(doc, startX, pageWidth, {
    nombre: 'Línea de Negocio 6 — Granolas Horneadas (Sol y Flor)',
    sku: 'MPGDSX7 / MPGDFX6,9 -> GSX / GDFX',
    cantidad: '0 UPs a retirar hoy',
    tiempo: 'Cobertura: 30 a 45 días',
    coberturaPost: 'FINITUD LÍNEA 6: Cobertura Plena',
    datosEmpiricos: 'El stock actual al cierre del martes es: GSX500G = 5 u. (30d), GSX1 = 15 u. (35d), GDFX500G = 5 u. (45d) y GDFX1 = 13 u. (33d). Buffer en estantería: 2 bolsas MPGDFX6,9 y 2 bolsas MPGDSX7.',
    fundamental: 'Ambas líneas de Granola superan holgadamente los 30 días de cobertura; 0 UPs a retirar hoy.'
  });

  drawLargeClosureBanner(
    doc,
    startX,
    pageWidth,
    '• Estado Finito en Producción Externa = 0 UPs a retirar hoy miércoles 04/11/2026.\n' +
    '• Las Líneas 4, 5 y 6 se encuentran cubiertas para el horizonte operativo mensual (>= 30 a 50 días).\n' +
    '• El informe operativo cumple estrictamente la regla de mostrar únicamente que hoy no hay nada para producir externamente.'
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
    'Miércoles 04/11/2026  ·  Cantidad Libre de Jornadas hasta Completar el Ideal  ·  Requiere 0 Jornadas Hacia Adelante (0 Pendientes)'
  );

  drawFourPillarsBox(doc, startX, pageWidth, [
    {
      titulo: '1. Aplicación de REGLA_JORNADAS_HACIA_ADELANTE_LIBRES_HASTA_FINITUD (Caso 0 Jornadas)',
      detalle: 'Por instrucción expresa del Director ("Ya no me interesa si son tres jornadas, son cinco, son una o son cero, las jornadas que hagan falta hasta completar el ideal"), este informe proyecta libremente la cantidad de jornadas laborales posteriores a hoy necesarias para alcanzar el Stock Ideal. Como ayer martes Matías adelantó el Carro #2998 y las 6 tareas restantes (~1h 50m) caben íntegras hoy en el Plan de Hoy Miércoles 04/11, quedan exactamente 0 Jornadas Hacia Adelante.'
    },
    {
      titulo: '2. Descuento Total de los 5 Carros Confirmados Ayer Martes 03/11 (#2995 al #2999)',
      detalle: 'Ayer martes se confirmaron 5 carros internos en 221 minutos de jornada y se emitieron 0 facturas. En particular, en el Carro #2998 Matías ya adelantó y cerró los 3 artículos de Línea 2 que estaban en la Jornada 1 Hacia Adelante del martes (NMBEX1K: 2u, CHBx2: 2u y MRSSGx2: 3u), y la tanda de Mix Con Pasas (MFSXK: 20 kg -> MFSx5: 4u) pasó hoy al Plan A de Hoy Miércoles.'
    }
  ]);

  drawSectionBanner(
    doc,
    startX,
    pageWidth,
    '1. TRAZABILIDAD DE DESCUENTO Y CIERRE TOTAL (MARTES 03/11 -> MIÉRCOLES 04/11)',
    '0 Jornadas Posteriores',
    '#14532d'
  );

  drawAuditItemCard(doc, startX, pageWidth, {
    nombre: '[COMPLETADO AYER MARTES 03/11] 5 Carros Internos Confirmados (#2995, #2996, #2997, #2998 y #2999)',
    sku: 'APN1x1 (2u), BF24X50 (4 cajas desde puente BFX50G 4,8kg), EMB-NU9HD0 (4u), CCTX1 (2u), ATX1 (1u), ATySx5 (2u), NMBEX1K (2u), CHBx2 (2u), MRSSGx2 (3u)',
    cantidad: '39,8 kg y 96 barritas procesadas y cerradas ayer martes',
    tiempo: '221 min de jornada ejecutados ayer martes',
    coberturaPost: 'DESCONTADO AL 100%: 9 Artículos cerrados por 30 a 180 días (Cero residuales)',
    badgeColor: '#15803d',
    datosEmpiricos: 'Todos estos carros quedaron confirmados ayer en carros_produccion entre las 13:37 y las 17:01 hs ARG. En el Carro #2998 Matías adelantó NMBEX1K, CHBx2 y MRSSGx2.',
    fundamental: 'Aplicando REGLA_TANDA_EJECUTADA_ARTICULO_CERRADO_SIN_RESIDUALES, ninguno de los artículos producidos ayer vuelve a programarse.'
  });

  drawAuditItemCard(doc, startX, pageWidth, {
    nombre: '[ASIGNADO AL PLAN DE HOY MIÉRCOLES 04/11] Las 6 Únicas Tareas Restantes del Depósito (~1h 50m)',
    sku: 'EMB-0W5BOW (5u) + EMB-IIVL86 (10u) + MFSXK -> MFSx5 (4u) + MPGDSX7 (1u) + MPGDFX6,9 (1u) + MPB (1u)',
    cantidad: '2 quiebres de Línea 2 (~25m) + 1 tanda única de Mix Con Pasas L3 (~44m) + 3 Pre-Mezclas L5/L6 (~41m)',
    tiempo: '~1h 50m asignados íntegros al Plan de Hoy Miércoles 04/11',
    coberturaPost: 'SE COMPLETA HOY (Quedan 0 Jornadas Hacia Adelante y 0 Tareas Pendientes)',
    badgeColor: '#15803d',
    datosEmpiricos: 'Al sumar exactamente 110 minutos (~1h 50m), todo el trabajo remanente del taller cabe holgadamente dentro de la jornada presencial de hoy miércoles.',
    fundamental: 'No tiene sentido artificial dejar tareas sueltas para una jornada posterior cuando las 6 tareas restantes suman ~1h 50m y se completan hoy mismo.'
  });

  drawLargeClosureBanner(
    doc,
    startX,
    pageWidth,
    'DEMOSTRACIÓN DE FINITUD (CANTIDAD LIBRE DE JORNADAS HACIA ADELANTE = 0 JORNADAS -> 0 TAREAS PENDIENTES): Al ejecutarse hoy miércoles 04/11/2026 el Plan de Hoy (~1h 50m), el depósito alcanza el 100% del Stock Ideal (>= 30 días) sin requerir ninguna jornada adicional hacia adelante.'
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
      console.log(`✅ Fundamentals Jornada Hoy (Miércoles 04/11) generado en: ${p1}`);
      console.log(`✅ Fundamentals Retiro Externa (Miércoles 04/11) generado en: ${p2}`);
      console.log(`✅ Fundamentals Jornadas Hacia Adelante (Miércoles 04/11) generado en: ${p3}`);
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ Error generando PDFs de Fundamentals:', err);
      process.exit(1);
    });
}

module.exports = { generarTodosLosFundamentals };
