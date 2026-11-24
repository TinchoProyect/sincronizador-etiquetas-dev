/**
 * Generador del 4º Informe Doble Permanente: PEDIDOS A PROVEEDORES (OPERATIVO + FUNDAMENTALS)
 * Corte real auditado: MARTES 24/11/2026 — 18:55 hs (Producción Cloud, post-carros #3050–#3053 y presupuestos #8234912/#8234913).
 *
 * Genera ambos documentos gemelos:
 * 1. /documentos/Plan_Pedidos_Proveedores_Hoy.pdf          (Operativo sintético agrupado por Proveedor Habitual)
 * 2. /documentos/Fundamentals_Pedidos_Proveedores_Hoy.pdf  (Anexo Clip 📎 en tipografía grande 13–15pt)
 *
 * Regla permanente aplicada: REGLA_CUARTO_INFORME_PEDIDOS_PROVEEDORES_DUAL
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

const outOperativoPath = path.join(docsDir, 'Plan_Pedidos_Proveedores_Hoy.pdf');
const outFundamentalsPath = path.join(docsDir, 'Fundamentals_Pedidos_Proveedores_Hoy.pdf');

function fmtMoney(n) {
  const val = Number(n) || 0;
  const parts = val.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `$${parts[0]},${parts[1]}`;
}

async function obtenerDescripcionesBunker() {
  const skus = [
    'EMB-7RVGWW', 'SZAAX25', 'DACCDNX5', 'PTSx10', 'CCW4X22,68',
    'NMELCHx10', 'NCL2X5', 'APN25/27X10',
    'DIMx5', 'MFMYMX18', 'CCP3X22.68', 'LCX25',
    'AGPX10Q', 'MRSSGx25', 'EMB-67EZ0G', 'HDGX5', 'EMB-7XKJBT', 'PKX2', 'AP13-15X10'
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

// ============================================================================
// 1. PDF OPERATIVO: PLAN DE PEDIDOS A PROVEEDORES (AGRUPADO POR PROVEEDOR)
// ============================================================================
async function generarOperativoPedidosProveedores(d) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 22, bottom: 20, left: 30, right: 30 }
  });
  const stream = fs.createWriteStream(outOperativoPath);
  doc.pipe(stream);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const startX = doc.page.margins.left;

  const drawHeader = () => {
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, startX, 20, { height: 30 });
    }
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(11.0)
      .text('PEDIDOS A PROVEEDORES — PLAN DE COMPRAS', startX + 125, 22, { width: pageWidth - 125, align: 'right', lineBreak: false });
    doc.fillColor('#475569').font('Helvetica').fontSize(7.5)
      .text('Martes 24/11/2026 (18:55 hs)  ·  Horizonte 30-45d  ·  Firme: 33 bultos ($3.358.634)  |  Panizzi Cond.: $64.327', startX + 125, 37, {
        width: pageWidth - 125,
        align: 'right',
        lineBreak: false
      });
    doc.moveTo(startX, 54).lineTo(startX + pageWidth, 54).lineWidth(1.1).stroke('#0f172a');
    doc.y = 61;
  };

  drawHeader();

  const ensureSpaceOp = (hNeeded) => {
    if (doc.y + hNeeded > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      drawHeader();
    }
  };

  // Column X coordinates & widths (pageWidth = 535.28)
  const colCheck = startX + 3;
  const colPrio = startX + 16;
  const colArt = startX + 47;
  const wArt = 248;
  const colCant = startX + 297;
  const wCant = 78;
  const colUnit = startX + 377;
  const wUnit = 78;
  const colSub = startX + 457;
  const wSub = pageWidth - 457;

  const badgeColors = {
    P1: { bg: '#fee2e2', fg: '#991b1b', border: '#ef4444' },
    'P1*': { bg: '#ffedd5', fg: '#9a3412', border: '#f97316' },
    P2: { bg: '#fef3c7', fg: '#92400e', border: '#f59e0b' },
    P3: { bg: '#e0f2fe', fg: '#075985', border: '#0284c7' },
    'P3*': { bg: '#f1f5f9', fg: '#475569', border: '#94a3b8' }
  };

  const drawProveedorBlock = (prov) => {
    const estH = 22 + 14 + prov.items.length * 16.5 + 8;
    ensureSpaceOp(estH);

    // Provider banner
    const y0 = doc.y;
    doc.rect(startX, y0, pageWidth, 16.5).fillAndStroke(prov.bg, prov.border);
    doc.fillColor(prov.fg).font('Helvetica-Bold').fontSize(8.2)
      .text(prov.titulo, startX + 7, y0 + 4.3, { width: pageWidth - 175, lineBreak: false });
    doc.fillColor(prov.fg).font('Helvetica-Bold').fontSize(8.0)
      .text(prov.subtituloDer, startX + pageWidth - 172, y0 + 4.4, { width: 165, align: 'right', lineBreak: false });
    doc.y = y0 + 18.5;

    // Mini column header
    const yh = doc.y;
    doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(6.8);
    doc.text('PRIO', colPrio, yh, { width: 28, lineBreak: false });
    doc.text('ARTÍCULO BÚNKER (CÓDIGO)', colArt, yh, { width: wArt, lineBreak: false });
    doc.text('CANTIDAD', colCant, yh, { width: wCant, align: 'right', lineBreak: false });
    doc.text('COSTO REF.', colUnit, yh, { width: wUnit, align: 'right', lineBreak: false });
    doc.text('SUBTOTAL EST.', colSub, yh, { width: wSub, align: 'right', lineBreak: false });
    doc.moveTo(startX, yh + 9.5).lineTo(startX + pageWidth, yh + 9.5).lineWidth(0.5).stroke('#cbd5e1');
    doc.y = yh + 11.5;

    prov.items.forEach(it => {
      const yr = doc.y;
      // Checkbox
      doc.rect(colCheck, yr + 1.2, 8.2, 8.2).lineWidth(0.8).stroke('#334155');
      // Priority pill
      const bc = badgeColors[it.prio] || badgeColors.P3;
      doc.rect(colPrio, yr + 0.5, 25, 10).fillAndStroke(bc.bg, bc.border);
      doc.fillColor(bc.fg).font('Helvetica-Bold').fontSize(6.8)
        .text(it.prio, colPrio, yr + 2.4, { width: 25, align: 'center', lineBreak: false });

      // Article name + SKU
      const artText = `${it.nombre} (${it.sku})${it.tag ? ' ' + it.tag : ''}`;
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(7.6)
        .text(artText, colArt, yr + 1.3, { width: wArt, lineBreak: false, ellipsis: true });

      // Quantity
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(7.6)
        .text(it.cantidad, colCant, yr + 1.3, { width: wCant, align: 'right', lineBreak: false });

      // Unit price ref
      doc.fillColor('#475569').font('Helvetica').fontSize(7.2)
        .text(it.precioRef, colUnit, yr + 1.5, { width: wUnit, align: 'right', lineBreak: false });

      // Subtotal
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(7.6)
        .text(it.subtotalStr, colSub, yr + 1.3, { width: wSub, align: 'right', lineBreak: false });

      const endY = yr + 13.0;
      doc.moveTo(startX, endY).lineTo(startX + pageWidth, endY).lineWidth(0.3).stroke('#e2e8f0');
      doc.y = endY + 2.5;
    });

    doc.y += 4;
  };

  const proveedores = [
    {
      titulo: '1. BAVOSI  ·  13 bultos (127,68 kg)',
      subtituloDer: `Subtotal: ${fmtMoney(1543759.67)}`,
      bg: '#fee2e2', border: '#dc2626', fg: '#7f1d1d',
      items: [
        { prio: 'P1', nombre: d('EMB-7RVGWW', 'ALMENDRA Non Pareil 30/34 x 10kg'), sku: 'EMB-7RVGWW', cantidad: '4 cajas (40 kg)', precioRef: '$18.109/kg', subtotalStr: fmtMoney(724377.20) },
        { prio: 'P1', nombre: d('SZAAX25', 'SEM Zapallo AA x 25kg'), sku: 'SZAAX25', cantidad: '1 bolsa (25 kg)', precioRef: '$10.981/kg', subtotalStr: fmtMoney(274528.25) },
        { prio: 'P2', nombre: d('DACCDNX5', 'Datil Deglet C/ZO Argelia x 5kg'), sku: 'DACCDNX5', cantidad: '6 cajas (30 kg)', precioRef: '$4.108/kg', subtotalStr: fmtMoney(123244.50) },
        { prio: 'P2', nombre: d('PTSx10', 'Pistacho C/CAS Tostado y Salado x 10kg'), sku: 'PTSx10', cantidad: '1 caja (10 kg)', precioRef: '$20.378/kg*', subtotalStr: fmtMoney(203784.20) },
        { prio: 'P3', nombre: d('CCW4X22,68', 'Castañas de Caju W4 x 22.68kg'), sku: 'CCW4X22,68', cantidad: '1 caja (22,68 kg)', precioRef: '$9.604/kg', subtotalStr: fmtMoney(217825.52) }
      ]
    },
    {
      titulo: '2. PUEBLO VIEJO SRL  ·  8 cajas (80,00 kg)',
      subtituloDer: `Subtotal: ${fmtMoney(919669.50)}`,
      bg: '#fee2e2', border: '#dc2626', fg: '#7f1d1d',
      items: [
        { prio: 'P1', nombre: d('NMELCHx10', 'Nuez CHLER Mariposa EXLIGHT x 10kg'), sku: 'NMELCHx10', tag: '[#8234912]', cantidad: '6 cajas (60 kg)', precioRef: '$10.612/kg', subtotalStr: fmtMoney(636694.20) },
        { prio: 'P1', nombre: d('NCL2X5', 'Nuez CHLER Cuarto LHT x 10kg'), sku: 'NCL2X5', cantidad: '1 caja (10 kg)', precioRef: '$8.843/kg*', subtotalStr: fmtMoney(88429.80) },
        { prio: 'P2', nombre: d('APN25/27X10', 'ALMENDRA Peladas NP 25-27 x 10kg'), sku: 'APN25/27X10', cantidad: '1 caja (10 kg)', precioRef: '$19.455/kg', subtotalStr: fmtMoney(194545.50) }
      ]
    },
    {
      titulo: '3. VILLARES  ·  6 bultos (80,68 kg)',
      subtituloDer: `Subtotal: ${fmtMoney(610064.88)}`,
      bg: '#fee2e2', border: '#dc2626', fg: '#7f1d1d',
      items: [
        { prio: 'P1', nombre: d('DIMx5', 'Datil Medjoul C/ZO IREL x 5kg'), sku: 'DIMx5', cantidad: '3 cajas (15 kg)', precioRef: '$13.990/kg*', subtotalStr: fmtMoney(209855.70) },
        { prio: 'P1', nombre: d('MFMYMX18', 'Maiz FTO Mostaza y Miel x 18kg'), sku: 'MFMYMX18', cantidad: '1 bulto (18 kg)', precioRef: '$9.419/kg', subtotalStr: fmtMoney(169536.24) },
        { prio: 'P3', nombre: d('CCP3X22.68', 'Castañas de Caju P3 x 22.68kg'), sku: 'CCP3X22.68', cantidad: '1 caja (22,68 kg)', precioRef: '$8.110/kg*', subtotalStr: fmtMoney(183943.19) },
        { prio: 'P3', nombre: d('LCX25', 'Lentejon Importado x 25kg'), sku: 'LCX25', cantidad: '1 bolsa (25 kg)', precioRef: '$1.869/kg*', subtotalStr: fmtMoney(46729.75) }
      ]
    },
    {
      titulo: '4. QUERCUS  ·  3 bultos (60,00 kg)',
      subtituloDer: `Subtotal: ${fmtMoney(215219.75)}`,
      bg: '#fef3c7', border: '#d97706', fg: '#78350f',
      items: [
        { prio: 'P1', nombre: d('AGPX10Q', 'ALMENDRA Guara Partida x 10kg'), sku: 'AGPX10Q', cantidad: '1 caja (10 kg)', precioRef: '$12.870/kg', subtotalStr: fmtMoney(128700.00) },
        { prio: 'P2', nombre: 'Maní Tostado S2 (Para Mixes y Granola)', sku: 'Ing. 185', cantidad: '1 bolsa (25 kg)', precioRef: '$1.361/kg*', subtotalStr: fmtMoney(34019.75) },
        { prio: 'P3', nombre: d('MRSSGx25', 'Mani RELDO Sin Sal x 25kg'), sku: 'MRSSGx25', cantidad: '1 bolsa (25 kg)', precioRef: '$2.100/kg', subtotalStr: fmtMoney(52500.00) }
      ]
    },
    {
      titulo: '5. DUMAU (Mercado Libre · Alt. Villares 24-48h)  ·  1 bidón (4,50 kg)',
      subtituloDer: `Subtotal: ${fmtMoney(60498.99)}`,
      bg: '#fee2e2', border: '#dc2626', fg: '#7f1d1d',
      items: [
        { prio: 'P1', nombre: d('EMB-67EZ0G', 'Aceite de Coco NTRO x 4.5kg'), sku: 'EMB-67EZ0G', cantidad: '1 bidón (4,5 kg)', precioRef: '$13.444/kg', subtotalStr: fmtMoney(60498.99) }
      ]
    },
    {
      titulo: '6. ABEL  ·  2 bolsas (10,00 kg)',
      subtituloDer: `Subtotal: ${fmtMoney(9421.40)}`,
      bg: '#fef3c7', border: '#d97706', fg: '#78350f',
      items: [
        { prio: 'P2', nombre: d('HDGX5', 'Harina de Garbanzo x 5kg'), sku: 'HDGX5', cantidad: '2 bolsas (10 kg)', precioRef: '$942/kg', subtotalStr: fmtMoney(9421.40) }
      ]
    },
    {
      titulo: '7. PANIZZI (Envases — CONDICIONAL A CONTEO FÍSICO EN TALLER)',
      subtituloDer: `Cond. P1*: ${fmtMoney(64327.00)}`,
      bg: '#ffedd5', border: '#ea580c', fg: '#7c2d12',
      items: [
        { prio: 'P1*', nombre: 'BOLSAS 8X15 40 MIC [Verificar físico]', sku: 'Ing. 181', cantidad: '2.000 u.', precioRef: '$18,16/u.', subtotalStr: fmtMoney(36320.00) },
        { prio: 'P1*', nombre: 'CAJA MICRO M/M 20X20X10 [Verificar físico]', sku: 'Ing. 176', cantidad: '100 u.', precioRef: '$280,07/u.', subtotalStr: fmtMoney(28007.00) },
        { prio: 'P3*', nombre: 'BOLSA 30X40 55 MIC [Opcional si sale flete]', sku: 'Ing. 177', cantidad: '200 u.', precioRef: '$159,40/u.', subtotalStr: fmtMoney(31880.00) }
      ]
    },
    {
      titulo: '8. A COTIZAR (Sin lote reciente en historial)',
      subtituloDer: 'Cotizar antes de emitir OC',
      bg: '#f1f5f9', border: '#64748b', fg: '#334155',
      items: [
        { prio: 'P3', nombre: d('PKX2', 'Panko x 2kg'), sku: 'PKX2', cantidad: '2 bolsas (4 kg)', precioRef: '$14.180/b*', subtotalStr: 'A cotizar' }
      ]
    }
  ];

  proveedores.forEach(drawProveedorBlock);

  // Financial Summary Box at bottom
  ensureSpaceOp(74);
  const yBox = doc.y + 2;
  doc.rect(startX, yBox, pageWidth, 64).fillAndStroke('#f8fafc', '#0f172a');
  doc.rect(startX, yBox, pageWidth, 16).fill('#0f172a');
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8.0)
    .text('RESUMEN FINANCIERO DE CAJA ESTIMADO (BASE ÚLTIMO LOTE REAL · * PRECIO >60-90D A RECONFIRMAR)', startX + 8, yBox + 4.2, {
      width: pageWidth - 16,
      lineBreak: false
    });

  const yR1 = yBox + 21;
  const colW = (pageWidth - 16) / 4;
  const drawKpi = (idx, label, sub, val, color) => {
    const x = startX + 8 + idx * colW;
    doc.fillColor('#475569').font('Helvetica-Bold').fontSize(7.0).text(label, x, yR1, { width: colW - 6, lineBreak: false });
    doc.fillColor(color).font('Helvetica-Bold').fontSize(10.0).text(val, x, yR1 + 10, { width: colW - 6, lineBreak: false });
    doc.fillColor('#64748b').font('Helvetica').fontSize(6.8).text(sub, x, yR1 + 24, { width: colW - 6, lineBreak: false });
  };

  drawKpi(0, 'P1 CRÍTICO FIRME', '18 bultos · 182,50 kg', fmtMoney(2292620.38), '#991b1b');
  drawKpi(1, 'P2 URGENTE FIRME', '11 bultos · 85,00 kg', fmtMoney(565015.35), '#92400e');
  drawKpi(2, 'P3 PREVENTIVO FIRME', '4 bultos · 95,36 kg', fmtMoney(500998.46), '#075985');
  drawKpi(3, 'TOTAL FIRME (SIN PANIZZI)', '+ $64.327 Panizzi P1* cond.', fmtMoney(3358634.19), '#0f172a');

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(outOperativoPath));
    stream.on('error', reject);
  });
}

// ============================================================================
// 2. PDF FUNDAMENTALS: AUDITORÍA EMPÍRICA DE PEDIDOS A PROVEEDORES (13–15pt)
// ============================================================================
function ensureSpaceFund(doc, neededHeight) {
  const bottomLimit = doc.page.height - doc.page.margins.bottom;
  if (doc.y + neededHeight > bottomLimit) {
    doc.addPage();
  }
}

function drawFundHeader(doc, startX, pageWidth, titulo, subtitulo) {
  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, startX, 22, { height: 36 });
  }
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(14.0)
    .text(titulo, startX + 148, 25, { width: pageWidth - 148, align: 'right' });
  doc.fillColor('#334155').font('Helvetica').fontSize(10.8)
    .text(subtitulo, startX, 65, { width: pageWidth, align: 'left' });
  const lineY = doc.y + 6;
  doc.moveTo(startX, lineY).lineTo(startX + pageWidth, lineY).lineWidth(1.5).stroke('#0f172a');
  doc.y = lineY + 12;
}

function drawFundPillarsBox(doc, startX, pageWidth, tituloBox, pillars) {
  let estimatedH = 34;
  pillars.forEach(p => {
    doc.font('Helvetica').fontSize(12.8);
    const h = doc.heightOfString(`• ${p.titulo}: ${p.detalle}`, { width: pageWidth - 24, lineGap: 2 });
    estimatedH += h + 8;
  });

  ensureSpaceFund(doc, estimatedH + 12);
  const y0 = doc.y;
  doc.rect(startX, y0, pageWidth, estimatedH).fillAndStroke('#f8fafc', '#64748b');

  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(13.2)
    .text(tituloBox, startX + 12, y0 + 10, { width: pageWidth - 24 });

  let py = doc.y + 6;
  pillars.forEach(p => {
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(12.8)
      .text(`• ${p.titulo}: `, startX + 12, py, { width: pageWidth - 24, continued: true, lineGap: 2 })
      .fillColor('#1e293b').font('Helvetica').fontSize(12.8)
      .text(p.detalle, { lineGap: 2 });
    py = doc.y + 6;
  });

  doc.y = Math.max(py + 6, y0 + estimatedH + 12);
}

function drawFundBanner(doc, startX, pageWidth, titulo, badgeRight, bg = '#0f172a', fg = '#ffffff') {
  ensureSpaceFund(doc, 290);
  const y0 = doc.y;
  const textFull = badgeRight ? `${titulo}   (${badgeRight})` : titulo;
  doc.font('Helvetica-Bold').fontSize(13.2);
  const textH = doc.heightOfString(textFull, { width: pageWidth - 20 });
  const barH = Math.max(28, textH + 12);

  doc.rect(startX, y0, pageWidth, barH).fillAndStroke(bg, bg);
  doc.fillColor(fg).font('Helvetica-Bold').fontSize(13.2)
    .text(textFull, startX + 10, y0 + 6, { width: pageWidth - 20 });
  doc.y = y0 + barH + 10;
}

function drawFundCard(doc, startX, pageWidth, item) {
  doc.font('Helvetica-Bold').fontSize(13.8);
  const hTitle = doc.heightOfString(`${item.nombre} (${item.sku}): ${item.cantidad}  [${item.costo}]`, { width: pageWidth - 16 });
  doc.font('Helvetica-Bold').fontSize(12.8);
  const hCob = doc.heightOfString(`-> ${item.coberturaPost}`, { width: pageWidth - 20 });
  doc.font('Helvetica').fontSize(12.8);
  const hEmp = doc.heightOfString(`• Datos Empíricos: ${item.datosEmpiricos}`, { width: pageWidth - 20, lineGap: 1.5 });
  const hFund = doc.heightOfString(`• Fundamental: ${item.fundamental}`, { width: pageWidth - 20, lineGap: 1.5 });
  const totalCardH = hTitle + hCob + hEmp + hFund + 34;

  ensureSpaceFund(doc, Math.min(totalCardH, 270));

  const y0 = doc.y;
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(13.8)
    .text(`${item.nombre} `, startX + 6, y0, { width: pageWidth - 12, continued: true })
    .fillColor('#334155').font('Helvetica-Bold').fontSize(13.0)
    .text(`(${item.sku}): `, { continued: true })
    .fillColor('#0f172a').font('Helvetica-Bold').fontSize(13.8)
    .text(item.cantidad, { continued: true })
    .fillColor('#475569').font('Helvetica').fontSize(12.8)
    .text(`  [${item.costo}]`);

  doc.fillColor(item.badgeColor || '#1e40af').font('Helvetica-Bold').fontSize(12.8)
    .text(`-> ${item.coberturaPost}`, startX + 12, doc.y + 2, { width: pageWidth - 20 });

  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(12.8)
    .text('• Datos Empíricos: ', startX + 12, doc.y + 4, { width: pageWidth - 20, continued: true, lineGap: 1.5 })
    .fillColor('#1e293b').font('Helvetica').fontSize(12.8)
    .text(item.datosEmpiricos, { lineGap: 1.5 });

  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(12.8)
    .text('• Fundamental: ', startX + 12, doc.y + 3, { width: pageWidth - 20, continued: true, lineGap: 1.5 })
    .fillColor('#1e293b').font('Helvetica').fontSize(12.8)
    .text(item.fundamental, { lineGap: 1.5 });

  const endY = doc.y + 5;
  doc.moveTo(startX, endY).lineTo(startX + pageWidth, endY).lineWidth(0.8).stroke('#94a3b8');
  doc.y = endY + 7;
}

function drawClosureBannerFund(doc, startX, pageWidth, texto) {
  doc.font('Helvetica-Bold').fontSize(12.8);
  const h = doc.heightOfString(texto, { width: pageWidth - 24, lineGap: 2.0 });
  const boxH = h + 16;
  ensureSpaceFund(doc, boxH + 6);
  const yFin = doc.y + 2;
  doc.rect(startX, yFin, pageWidth, boxH).fillAndStroke('#f0fdf4', '#16a34a');
  doc.fillColor('#14532d').font('Helvetica-Bold').fontSize(12.8)
    .text(texto, startX + 12, yFin + 8, { width: pageWidth - 24, align: 'left', lineGap: 2.0 });
  doc.y = yFin + boxH + 6;
}

async function generarFundamentalsPedidosProveedores(d) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 26, bottom: 26, left: 32, right: 32 }
  });
  const stream = fs.createWriteStream(outFundamentalsPath);
  doc.pipe(stream);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const startX = doc.page.margins.left;

  drawFundHeader(
    doc,
    startX,
    pageWidth,
    'FUNDAMENTALS — PEDIDOS A PROVEEDORES',
    'Martes 24/11/2026 (Corte 18:55 hs)  ·  33 bultos firmes ($3.358.634) + Panizzi Cond. ($64.327)  ·  Horizonte 30–45 días'
  );

  drawFundPillarsBox(doc, startX, pageWidth, 'CRITERIOS DE AUDITORÍA DE COMPRAS (MARTES 24/11/2026 — 18:55 HS):', [
    {
      titulo: '1. Foto Empírica Real de las 18:55 hs (Post-Producción de Hoy #3050 a #3053)',
      detalle: 'Esta tarde Matías ejecutó y confirmó los 4 carros internos del plan: #3050/#3051 (MFSXK 10kg -> 30u MFSX300G + 1u MFSx1; MFSSOXK 10kg -> 2u MFSSPx5), #3052 (CCTX5: 4u abriendo CCWTX22,68 -> 0u; APN27/30X5: 2u abriendo APN25/27X10 -> 0u) y #3053 (MPGDSX7: 1u + MPGDFX6,9: 1u). Eso dejó [33] Almendra Guara Partida = 0,11 kg, [133] Nuez Cuarto Light = 1,75 kg, [51] Cajú Partida = 12,18 kg, [185] Maní Tostado S2 = 7,95 kg y EMB-7RVGWW = 1 caja. Los 3 carros externos del 18/11 (#3039, #3040, #3044) siguen en tránsito (NO_CONFIRMADO) y se descuentan para no duplicar compras.'
    },
    {
      titulo: '2. Auditoría de los Dos Presupuestos Activos de Hoy (#8234912 y #8234913)',
      detalle: 'Presupuesto #8234912 (Cliente 737, Armar_Pedido) exige 1 caja NMELCHx10 (stock 0 -> P1 Crítico). Presupuesto #8234913 (Cliente 55, Pedido_Listo) descuenta: NMECHAM10X200G (10u -> deja NMECHAMX200G en 5u, agravando el déficit de NMELCHx10), APN25/2710X150G (10u -> deja APN25/27X150G en 0u justo al abrirse la última APN25/27X10 hoy), LX5B (1u -> queda en 2u = 30d, dispara LCX25 P3) y PJx10 (1u -> queda en 5u = 40,9d, cubierto).'
    },
    {
      titulo: '3. Proveedores Reales de Lotes (bunker_lotes_vinculos) y Filtro Anti-Falsas Alarmas',
      detalle: 'Se utilizaron exclusivamente proveedores con compras reales documentadas (Bavosi, Pueblo Viejo SRL, Villares, Quercus, Dumau, Abel y Panizzi), ignorando tablas semilla. Se aplicó la regla "Bulto en 0 no equivale a compra automática": se excluyeron 11 bultos cerrados en 0 cuyas góndolas hijas ya cubren 40 a 450 días, ahorrando caja inmovilizada.'
    },
    {
      titulo: '4. Anomalía Crítica en Envases Panizzi (Conteo Físico Obligatorio Previo a OC)',
      detalle: 'El 16/10/2026 ingresaron 2.000 u. de Bolsas 8x15 [181] y 100 u. de Cajas 20x20x10 [176], mientras que el consumo en 39 días fue ~400 bolsas y ~16 cajas. Si bien en BD figuran 12 bolsas y 0 cajas, debe auditarse la estantería antes de emitir la orden a Panizzi ($64.327 P1 condicional): si el stock físico existe, se ajusta inventario y el gasto baja a $0.'
    }
  ]);

  // 1. BAVOSI
  drawFundBanner(doc, startX, pageWidth, '1. BAVOSI — 13 BULTOS (127,68 KG)', fmtMoney(1543759.67), '#991b1b');

  drawFundCard(doc, startX, pageWidth, {
    nombre: `[P1 CRÍTICO] ${d('EMB-7RVGWW', 'ALMENDRA Non Pareil 30/34 x 10kg')}`,
    sku: 'EMB-7RVGWW',
    cantidad: '4 cajas (40 kg)',
    costo: fmtMoney(724377.20),
    badgeColor: '#991b1b',
    coberturaPost: 'Cobertura MP: 8,0d -> 35,4d (42,2d combinado con 1 caja APN25/27X10)',
    datosEmpiricos: 'Corte 18:55 hs: 1 caja cerrada + 1,70 kg abiertos en [1] = 11,7 kg (hoy #3052 consumió la última APN25/27X10). Hijos: APN27/30X5 = 6 u. (23,5d), APN25/27X150G cae a 0 u. por #8234913. Consumo integrado real: 131,6 kg/90d (43,9 kg/mes; 53,5 kg últimos 30d). Último lote Bavosi 16/10/2026: 80 kg a $18.109,43/kg.',
    fundamental: 'Con 8 días de materia prima para el artículo de mayor salida en volumen de almendras, pedir 4 cajas a Bavosi captura un ahorro de -$1.345/kg (-6,9%) frente a Pueblo Viejo ($19.455/kg). Si se prescinde de la etiqueta 25/27, se puede subir a 5 cajas aquí.'
  });

  drawFundCard(doc, startX, pageWidth, {
    nombre: `[P1 CRÍTICO] ${d('SZAAX25', 'SEM Zapallo AA x 25kg')}`,
    sku: 'SZAAX25',
    cantidad: '1 bolsa (25 kg)',
    costo: fmtMoney(274528.25),
    badgeColor: '#991b1b',
    coberturaPost: 'Cobertura sistema: 11,3d (MP 0d) -> 39,4 días',
    datosEmpiricos: 'Stock bulto = 0 u., [42] abierto = 0,00 kg. Hijos en góndola: SZAAx5 = 2 u. (10 kg = 12,9d sobre v90=14 u.) y SZAAX1 = 6 u. (6 kg = 38d). Consumo integrado taller: 80,0 kg/90d (26,7 kg/mes; 15 kg últimos 30d). Último lote Bavosi 17/09/2026: 50 kg a $10.981,13/kg.',
    fundamental: '1 bolsa de 25 kg cubre 39,4 días de demanda consolidada (dentro del objetivo 30–45d) evitando inmovilizar $274.528 extra en una segunda bolsa innecesaria.'
  });

  drawFundCard(doc, startX, pageWidth, {
    nombre: `[P2 URGENTE] ${d('DACCDNX5', 'Datil Deglet C/ZO Argelia x 5kg')} + ${d('PTSx10', 'Pistacho Tostado y Salado x 10kg')}`,
    sku: 'DACCDNX5 (6 cajas) · PTSx10 (1 caja)',
    cantidad: '6 cajas x 5kg ($123.245) + 1 caja x 10kg ($203.784)',
    costo: fmtMoney(327028.70),
    badgeColor: '#92400e',
    coberturaPost: 'DACCDNX5: 10d -> 40,0d | PTSx10: 14d (150g en 0) -> 36,2d',
    datosEmpiricos: '1) DACCDNX5 (Flujo 1 reventa directa): stock 2 cajas (10 kg = 10,0d sobre v30=3, v60=10, v90=18 = 6 cajas/mes); último lote Bavosi 17/09: 50 kg a $4.108,15/kg. 2) PTSx10: bulto madre 0 u., PTSX150G = 0 u. (quiebre total, v90=20), PTSx2 = 3 u. (20,8d), PTSx5 = 1 u. (45d), [56] = 1,30 kg; consumo 40,5 kg/90d (13,5 kg/mes). Último lote Bavosi 25/06: $20.378,42/kg (alerta >90d: reconfirmar precio; alt. Villares 03/06: $22.208/kg).',
    fundamental: 'DACCDNX5 (6 cajas) recompone la reventa de mayor rotación en dátiles a 40 días exactos. PTSx10 (1 caja de 10 kg o 11,34 kg) destraba PTSX150G sin canibalizar PTSx5/PTSx2 y ahorra $1.830/kg (-8,2%) vs Villares.'
  });

  drawFundCard(doc, startX, pageWidth, {
    nombre: `[P3 PREVENTIVO] ${d('CCW4X22,68', 'Castañas de Caju W4 x 22.68kg')}`,
    sku: 'CCW4X22,68',
    cantidad: '1 caja (22,68 kg)',
    costo: fmtMoney(217825.52),
    badgeColor: '#075985',
    coberturaPost: 'Cobertura MP: 24,2d -> 46,5 días (consolida envío con Bavosi)',
    datosEmpiricos: 'Stock actual: 1 caja cerrada + 1,86 kg abiertos en [16] = 24,54 kg (24,2d sobre 91,35 kg/90d = 30,5 kg/mes). Hoy #3052 consumió la última caja ya tostada CCWTX22,68 -> 0 u. Hijos naturales cubiertos: CCW4X5=3 u. (30d), CCW4x1k=4 u., CCW4X2=2 u. Último lote Bavosi 16/10: 90,72 kg a $9.604,30/kg.',
    fundamental: 'Sin quiebre inmediato, pero al haberse agotado hoy CCWTX22,68 el próximo ciclo de tostadero y fraccionado natural dependerá 100% de CCW4X22,68. Consolidar 1 caja hoy con Bavosi lleva el horizonte a 46,5 días.'
  });

  // 2. PUEBLO VIEJO SRL
  drawFundBanner(doc, startX, pageWidth, '2. PUEBLO VIEJO SRL — 8 CAJAS (80,00 KG)', fmtMoney(919669.50), '#991b1b');

  drawFundCard(doc, startX, pageWidth, {
    nombre: `[P1 CRÍTICO] ${d('NMELCHx10', 'Nuez CHLER Mariposa EXLIGHT x 10kg')}`,
    sku: 'NMELCHx10',
    cantidad: '6 cajas (60 kg · Mín. caja: 5 cajas)',
    costo: fmtMoney(636694.20),
    badgeColor: '#991b1b',
    coberturaPost: 'Cobertura neta post-#8234912: -7,9d (quiebre) -> 41,2 días',
    datosEmpiricos: 'Corte 18:55 hs: NMELCHx10=0 u., NMELCHx5=0 u., NMECHX2=0 u., NMBEX1K=1 u., NMECHAMX200G cae de 15 a 5 u. por #8234913, [25]=0,40 kg. Presupuesto Activo #8234912 compromete 1 caja (10 kg) y bloquea Mix Premium MFSPXK. Demanda integrada real: v90=6 cajas directas + p90=5 cajas taller = 11 cajas/90d (36,7 kg/mes). Último lote Pueblo Viejo 09/10: 40 kg a $10.611,57/kg (sensibilidad costo_base $136.300/caja = $817.800 total).',
    fundamental: 'Compra P1 #1 del depósito: 1 caja despacha #8234912 (si Cliente 737 no aceptó NML2X5) y las 5 cajas netas cubren 41,2 días de reventa, fracciones y Mix Premium.'
  });

  drawFundCard(doc, startX, pageWidth, {
    nombre: `[P1 CRÍTICO] ${d('NCL2X5', 'Nuez CHLER Cuarto LHT x 10kg')} + [P2] ${d('APN25/27X10', 'ALMENDRA NP 25-27 x 10kg')}`,
    sku: 'NCL2X5 (1 caja) · APN25/27X10 (1 caja)',
    cantidad: '1 caja x 10kg ($88.430) + 1 caja x 10kg ($194.546)',
    costo: fmtMoney(282975.30),
    badgeColor: '#92400e',
    coberturaPost: 'NCL2X5: 6,2d -> 41,5d | APN25/27X10 destraba APN25/27X150G = 0 u.',
    datosEmpiricos: '1) NCL2X5: stock 0 u., [133] bajó hoy tras #3050/#3053 a 1,75 kg (6,2d sobre 25,5 kg/90d = 8,5 kg/mes en MFSSOXK y MPGDSX7); último lote Pueblo Viejo 29/06: $8.842,98/kg (alerta >90d: reconfirmar). 2) APN25/27X10: stock 0 u. tras abrirse hoy en #3052; #8234913 dejó APN25/27X150G en 0 u.; último lote 09/10: $19.454,55/kg.',
    fundamental: '1 caja de NCL2X5 cubre 41,5 días exactos sin sobrecomprar. En APN25/27X10 negociar igualación de precio a Bavosi ($18.109/kg) aprovechando las 7 cajas de nueces, o migrar la caja a Bavosi ahorrando $13.451.'
  });

  // 3. VILLARES
  drawFundBanner(doc, startX, pageWidth, '3. VILLARES — 6 BULTOS (80,68 KG)', fmtMoney(610064.88), '#991b1b');

  drawFundCard(doc, startX, pageWidth, {
    nombre: `[P1 CRÍTICO] ${d('DIMx5', 'Datil Medjoul C/ZO IREL x 5kg')} + ${d('MFMYMX18', 'Maiz FTO Mostaza y Miel x 18kg')}`,
    sku: 'DIMx5 (3 cajas) · MFMYMX18 (1 bulto)',
    cantidad: '3 cajas x 5kg ($209.856) + 1 bulto x 18kg ($169.536)',
    costo: fmtMoney(379391.94),
    badgeColor: '#991b1b',
    coberturaPost: 'DIMx5: 0d -> 45,0d | MFMYMX18: 5,0d -> 69,8d (MOQ = 1 bulto)',
    datosEmpiricos: '1) DIMx5: quiebre total en toda la línea (DIMx5=0, DIMx1=0, EMB-PM5YRG=0, [89]=0 kg); demanda v90=5 cajas + p90=1 caja = 6 cajas/90d (2 cajas/mes). Último lote Villares 18/08: $13.990,38/kg (alerta >90d). 2) MFMYMX18: stock 0 u., [44]=1,40 kg (5,0d sobre 25 kg/90d = 8,33 kg/mes), EMB-W8QB6Y=0 u. (v90=10). Último lote Villares 21/10: $9.418,68/kg.',
    fundamental: '3 cajas de Medjoul cubren exactamente 45 días y destraban ventas directas y fracciones 1kg/2kg. 1 bulto indivisible (MOQ=18 kg) de Maíz Mostaza y Miel resuelve el quiebre de EMB-W8QB6Y.'
  });

  drawFundCard(doc, startX, pageWidth, {
    nombre: `[P3 PREVENTIVO] ${d('CCP3X22.68', 'Castañas de Caju P3 x 22.68kg')} + ${d('LCX25', 'Lentejon Importado x 25kg')}`,
    sku: 'CCP3X22.68 (1 caja) · LCX25 (1 bolsa)',
    cantidad: '1 caja x 22,68kg ($183.943) + 1 bolsa x 25kg ($46.730)',
    costo: fmtMoney(230672.94),
    badgeColor: '#075985',
    coberturaPost: 'CCP3X22.68: 24,1d (post-MFSTXK) -> 77,8d (MOQ) | LCX25: 30d -> ~115d (MOQ)',
    datosEmpiricos: '1) CCP3X22.68: bulto 0 u., [51] bajó hoy a 12,18 kg (bajará a 10,18 kg = 24,1d tras MFSTXK 20kg de Jornada 1; consumo 38,03 kg/90d). Último lote Villares 18/08: $8.110,37/kg vs Bavosi 17/09: $9.075,02/kg (reconfirmar vigencia). 2) LCX25: bulto 0 u., [113]=3,27 kg, LX5B baja de 3 a 2 u. (30d sobre v90=6) tras #8234913; último lote Villares 02/06: $1.869,19/kg (alerta >90d).',
    fundamental: 'Consolidan flete con Villares ahorrando -$965/kg (-10,6%) en Cajú P3 vs Bavosi y anticipando la reposición de Lentejón. Al llamar a Villares, consultar también Aceite de Coco EMB-67EZ0G (lote 03/06: $13.157/kg) para consolidar si entrega en 24–48 hs.'
  });

  // 4. QUERCUS, DUMAU, ABEL Y PANIZZI
  drawFundBanner(doc, startX, pageWidth, '4. QUERCUS · DUMAU · ABEL · PANIZZI (CONDICIONAL)', 'Firme $285.140 + Panizzi $64.327*', '#78350f');

  drawFundCard(doc, startX, pageWidth, {
    nombre: `QUERCUS — [P1] ${d('AGPX10Q', 'ALMENDRA Guara Partida x 10kg')} + [P2] Maní S2 + [P3] ${d('MRSSGx25', 'Mani Sin Sal x 25kg')}`,
    sku: 'AGPX10Q (1c) · Ing. 185 (1b) · MRSSGx25 (1b)',
    cantidad: '10 kg ($128.700) + 25 kg ($34.020) + 25 kg ($52.500)',
    costo: fmtMoney(215219.75),
    badgeColor: '#991b1b',
    coberturaPost: 'AGPX10Q: 0,7d -> 60,7d | Maní S2: 11,0d -> 45,6d | MRSSGx25: 18d -> 47,7d',
    datosEmpiricos: '1) AGPX10Q: [33] bajó hoy tras #3050 a 0,11 kg (0,7d sobre 15 kg/90d), bloqueando nuevas bolsas MPB y futuras MFSXK; línea Guara de Quercus (costo_base $12.870/kg). 2) Maní Tostado S2 [185]: bajó hoy a 7,95 kg (11,0d sobre 65,05 kg/90d = 21,7 kg/mes en Mixes y Grana Sol); lote Quercus 25/06: $1.360,79/kg (reconfirmar). 3) MRSSGx25: 1 bolsa cerrada (18d en bulto sobre v90=3 + p90=2, v30=2 directas) + 16,3 kg en [36]; lote Quercus 24/09: $2.100/kg.',
    fundamental: '1 caja de AGPX10Q (MOQ) destraba Barritas y Mix Con Pasas; 1 bolsa de Maní S2 cubre 45,6 días exactos de Mixes/Granola y 1 bolsa de MRSSGx25 consolida flete con Quercus.'
  });

  drawFundCard(doc, startX, pageWidth, {
    nombre: `DUMAU (ML) — [P1] ${d('EMB-67EZ0G', 'Aceite de Coco NTRO x 4.5kg')}  ·  ABEL — [P2] ${d('HDGX5', 'Harina de Garbanzo x 5kg')}`,
    sku: 'EMB-67EZ0G (1 bidón) · HDGX5 (2 bolsas)',
    cantidad: '4,5 kg ($60.499) + 10 kg ($9.421)',
    costo: fmtMoney(69920.39),
    badgeColor: '#991b1b',
    coberturaPost: 'EMB-67EZ0G destraba UP #1 Grana Sol (35–45d) | HDGX5: 0d -> 60d',
    datosEmpiricos: '1) EMB-67EZ0G: depósito = 0 u., remanente teórico en domicilio Matías ~0,42 kg (< 0,48 kg requeridos por 1 UP de Granola), bloqueando el próximo ciclo externo; último lote Dumau ML 21/09: 4,5 kg a $13.444,22/kg (alt. Villares 03/06: $13.157,26/kg). 2) HDGX5: quiebre total (HDGX5=0, [48]=0 kg, v90=3 bolsas = 5 kg/mes); último lote Abel 21/10: $942,14/kg.',
    fundamental: 'Aceite de Coco prioriza velocidad de entrega (Villares si entrega 24–48 hs, sino compra hoy en Dumau ML; evaluar 2 bidones solo si bonifica envío). Harina de Garbanzo se pide en 2 x 5 kg (60d) por frescura de verano en lugar de bolsa de 25 kg (150d).'
  });

  drawFundCard(doc, startX, pageWidth, {
    nombre: 'PANIZZI (Envases) — [P1* CONDICIONAL A CONTEO FÍSICO] Bolsas 8x15 + Cajas 20x20x10 (+ P3* 30x40)',
    sku: 'Ing. 181 (2.000u) · Ing. 176 (100u) · Ing. 177 (200u opc.)',
    cantidad: 'Cond. P1*: $64.327 (+ P3* Opc.: $31.880 solo con flete)',
    costo: '$0 si físico OK / $64.327* si falta',
    badgeColor: '#c2410c',
    coberturaPost: 'GATE OBLIGATORIO: Contar físico en taller antes de emitir orden a Panizzi',
    datosEmpiricos: 'BD registra [181] Bolsas 8x15 = 12 u. (c30=296, c60=680, c90=968 -> 1,1d) y [176] Caja 20x20x10 = 0 u. (c30=12, c60=28, c90=40), mientras #3044 requiere 96 bolsas y 4 cajas. PERO el 16/10/2026 ingresaron 2.000 bolsas ($18,16/u.) y 100 cajas ($280,07/u.) de Panizzi -> en 39 días deberían quedar ~1.500 bolsas y ~80 cajas físicas salvo desvío de inventario. [177] Bolsa 30x40 tiene 115,5 u. (40–59d, $159,40/u.).',
    fundamental: 'Verificar físicamente antes de gastar $64.327. Si el stock existe en taller, ajustar inventario BD y anular Panizzi ($0); si falta realmente, emitir P1* de inmediato y opcionalmente sumar 200 u. de Bolsa 30x40.'
  });

  // 5. ARBITRAJES Y EXCLUSIONES
  drawFundBanner(doc, startX, pageWidth, '5. ARBITRAJES DE PROVEEDORES Y EXCLUSIONES ANTI-FALSAS ALARMAS', 'Ahorro $93.981 – $108.724', '#14532d');

  drawFundCard(doc, startX, pageWidth, {
    nombre: 'Comparativa de Proveedores Alternativos (4 Arbitrajes Reales Capturados)',
    sku: 'Bavosi vs Pueblo Viejo vs Villares vs Dumau',
    cantidad: 'Ahorro ya capturado: $93.981 · Potencial adicional: +$14.743',
    costo: 'Total: $108.724',
    badgeColor: '#14532d',
    coberturaPost: '4 decisiones basadas en precio real de últimos lotes vinculados',
    datosEmpiricos: '1) Almendra Nonpareil (50 kg): Bavosi $18.109/kg (16/10) vs Pueblo Viejo $19.455/kg (09/10) -> -$1.345/kg (-6,9%, ahorro $53.805 en 4 cajas + $13.451 si se migra la 5ª caja). 2) Pistacho (10 kg): Bavosi $20.378/kg (25/06) vs Villares $22.208/kg (03/06) -> -$1.830/kg (-8,2%, ahorro $18.298). 3) Cajú P3 (22,68 kg): Villares $8.110/kg (18/08) vs Bavosi $9.075/kg (17/09) -> -$965/kg (-10,6%, ahorro $21.878). 4) Aceite de Coco (4,5 kg): Villares $13.157/kg vs Dumau $13.444/kg -> -$287/kg (+ ahorro flete ML si Villares entrega en 24–48 hs).',
    fundamental: 'Reconfirmar los 6 precios con antigüedad >90 días (NCL2X5, PTSx10, Maní S2, DIMx5, CCP3X22.68 y LCX25) y la brecha de NMELCHx10 ($106.116 lote 09/10 vs $136.300 costo_base = +$181.106 sensibilidad).'
  });

  drawFundCard(doc, startX, pageWidth, {
    nombre: 'Exclusiones Justificadas (Anti-Falsas Alarmas, Resolución Interna y MTO #482)',
    sku: '11 Bultos en 0 Cubiertos en Góndola + AP13-15X10 + HDC + MTO',
    cantidad: 'EXCLUIDOS DEL PEDIDO FIRME DE HOY ($0 inmovilizado)',
    costo: '0 sobrecompra',
    badgeColor: '#475569',
    coberturaPost: 'Góndolas cubiertas 40 a 450 días · Sin bloqueo en Mixes ni UPs',
    datosEmpiricos: '1) 11 bultos madre en 0 con góndola cubierta: MCVX20 (MCVX5=5u 75d, MCVX2=4u 60d), SNX25 (SNx1=3u 90d, SNX5=5u 450d), SBx25 (SBX5=4u 40d, SBx1=5u 150d), SAAX25 (SAAX1=6u 77d, SAAX5=5u), TSEx5 (EMB-0W5BOW=5u 225d, TSEx3=1u 90d), HTLN4x5 (EMB-NU9HD0=4u 120d), MFQX18 (MFDQX2,5=2u 180d), CRx25B (CRx5=6u + CRx2=4u + 1b = 70+d), ADX11,34K (52+d), QP4,5 (90d) y CCWTX22,68 (recién abierta en #3052 -> CCTX5=4u 51–60d + CCTX2=3u + 3,88kg open). 2) AP13-15X10 ($0): sustituir internamente transfiriendo 1 caja de AP15+X10 (3 cajas = 30 kg en stock = 160d). 3) Harina de Coco [101]: v90=1 y 3u EMB-9KG3XS (posponer). 4) PKX2: cotizar 2 bolsas (4 kg) sin comprometer caja firme. 5) MTO Factura #482 (EMB-BFBA8P, EMB-79MVPE, EMB-Y5ZHVZ: 1u/90d) y proveedores sin necesidad hoy (Colmenares Magdalena, Kennilar, Ambay): $0.',
    fundamental: 'Protege la caja y evita comprar mercadería redundante; quedan en vigilancia para el próximo corte semanal: NMECHAMX200G (5u post-#8234913), PJx10 (5u post-#8234913) y SBX5 (40d).'
  });

  drawClosureBannerFund(
    doc,
    startX,
    pageWidth,
    'CIERRE DE AUDITORÍA DE COMPRAS (MARTES 24/11/2026 — 18:55 HS): Pedido Firme = 33 bultos (362,86 kg) por $3.358.634,19 (P1: $2.292.620 · P2: $565.015 · P3: $500.998) + Panizzi P1* Condicional $64.327,00 (previo conteo físico) · Ahorro capturado por arbitraje: $93.981,46.'
  );

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(outFundamentalsPath));
    stream.on('error', reject);
  });
}

async function generarInformePedidosProveedores() {
  const d = await obtenerDescripcionesBunker();
  const pOp = await generarOperativoPedidosProveedores(d);
  const pFund = await generarFundamentalsPedidosProveedores(d);
  return { pOp, pFund };
}

if (require.main === module) {
  generarInformePedidosProveedores()
    .then(({ pOp, pFund }) => {
      console.log(`✅ PDF Operativo Pedidos a Proveedores generado en: ${pOp}`);
      console.log(`✅ PDF Fundamentals Pedidos a Proveedores generado en: ${pFund}`);
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ Error generando PDFs de Pedidos a Proveedores:', err);
      process.exit(1);
    });
}

module.exports = { generarInformePedidosProveedores };
