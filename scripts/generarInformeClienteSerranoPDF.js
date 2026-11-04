/**
 * Generador de Informe PDF para Cliente:
 * "TUS FRUTOS SECOS — SERRANO NICOLÁS" (Cliente #0387 / CB-0002)
 * Período: Últimos 5 meses hasta la fecha (Junio 2026 – 03 de Noviembre de 2026)
 * Ordenado por Mes y por Semana, incluyendo el presupuesto del día de hoy (03/11/2026).
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const docsDir = path.join(__dirname, '..', 'src', 'app-etiquetas', 'documentos');
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}

const outputPdfPath = path.join(docsDir, 'Informe_Compras_Tus_Frutos_Secos_Serrano_Nicolas.pdf');
const logoPath = path.join(__dirname, '..', 'src', 'app-etiquetas', 'img', 'logo_LAMDA.png');

function fmtMoney(n) {
  return '$' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtKg(n) {
  return Number(n).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' kg';
}

const mesesData = [
  {
    mesTitulo: 'JUNIO 2026',
    resumenMes: { ops: 7, bultos: 20, kilos: 49.2, neto: 425628.45, final: 501321.81 },
    semanas: [
      {
        semanaTitulo: 'Semana 1 (01/06/2026 al 07/06/2026)',
        subtotalSemana: { ops: 2, bultos: 6, kilos: 15.0, final: 120441.96 },
        pedidos: [
          {
            fecha: '01/06/2026',
            comprobante: 'Presupuesto #8234416',
            estado: 'Entregado',
            kilos: 14.0,
            totalNeto: 87951.84,
            totalFinal: 106421.73,
            items: [
              { sku: 'MFSx5', desc: 'Mix F/SCOS Con Pasas x 5kg', cant: '1 u.', unit: 45897.25, sub: 45897.25 },
              { sku: 'HSX1', desc: 'Hongo Seco Boletus x 1kg', cant: '1 u.', unit: 27757.59, sub: 27757.59 },
              { sku: 'GDFX1', desc: 'GRANA Flor x 1kg', cant: '1 u.', unit: 14020.25, sub: 14020.25 },
              { sku: 'MRSx5', desc: 'Maní RELDO Salado x 5kg', cant: '1 u.', unit: 11995.89, sub: 11995.89 },
              { sku: 'MCVX2', desc: 'Maní VGNA Con cáscara x 2kg', cant: '1 u.', unit: 6750.75, sub: 6750.75 }
            ]
          },
          {
            fecha: '01/06/2026',
            comprobante: 'Presupuesto #8234417',
            estado: 'Entregado',
            kilos: 1.0,
            totalNeto: 11586.97,
            totalFinal: 14020.23,
            items: [
              { sku: 'GDFX1', desc: 'GRANA Flor x 1kg', cant: '1 u.', unit: 14020.23, sub: 14020.23 }
            ]
          }
        ]
      },
      {
        semanaTitulo: 'Semana 2 (08/06/2026 al 14/06/2026)',
        subtotalSemana: { ops: 2, bultos: 5, kilos: 9.2, final: 115375.20 },
        pedidos: [
          {
            fecha: '09/06/2026',
            comprobante: 'Presupuesto #8234423 (Comp. #4)',
            estado: 'Entregado',
            kilos: 4.2,
            totalNeto: 57419.82,
            totalFinal: 69477.98,
            items: [
              { sku: 'BF24X50', desc: 'BARRA Flor 24 x 50g (Caja 1,2kg)', cant: '1 u.', unit: 30525.63, sub: 30525.63 },
              { sku: 'GDFX1', desc: 'GRANA Flor x 1kg', cant: '2 u.', unit: 14020.25, sub: 28040.50 },
              { sku: 'GSX1', desc: 'GRANA Sol x 1kg', cant: '1 u.', unit: 10911.86, sub: 10911.86 }
            ]
          },
          {
            fecha: '12/06/2026',
            comprobante: 'Presupuesto #8234396 (Comp. #1)',
            estado: 'Entregado',
            kilos: 5.0,
            totalNeto: 37931.59,
            totalFinal: 45897.22,
            items: [
              { sku: 'MFSx5', desc: 'Mix F/SCOS Con Pasas x 5kg', cant: '1 u.', unit: 45897.22, sub: 45897.22 }
            ]
          }
        ]
      },
      {
        semanaTitulo: 'Semana 3 (15/06/2026 al 21/06/2026)',
        subtotalSemana: { ops: 1, bultos: 1, kilos: 6.0, final: 34608.60 },
        pedidos: [
          {
            fecha: '16/06/2026',
            comprobante: 'Presupuesto #8234435 (Comp. #5)',
            estado: 'Entregado',
            kilos: 6.0,
            totalNeto: 31320.00,
            totalFinal: 34608.60,
            items: [
              { sku: 'M6x1', desc: 'Miel Pura 6 x 1kg', cant: '1 pack', unit: 34608.60, sub: 34608.60 }
            ]
          }
        ]
      },
      {
        semanaTitulo: 'Semana 4 (22/06/2026 al 28/06/2026)',
        subtotalSemana: { ops: 1, bultos: 4, kilos: 9.0, final: 109447.71 },
        pedidos: [
          {
            fecha: '25/06/2026',
            comprobante: 'Presupuesto #8234472 (Comp. #7)',
            estado: 'Entregado',
            kilos: 9.0,
            totalNeto: 99047.70,
            totalFinal: 109447.71,
            items: [
              { sku: 'MFSx5', desc: 'Mix F/SCOS Con Pasas x 5kg', cant: '1 u.', unit: 45897.28, sub: 45897.28 },
              { sku: 'HSX1', desc: 'Hongo Seco Boletus x 1kg', cant: '1 u.', unit: 27757.60, sub: 27757.60 },
              { sku: 'ADX2K', desc: 'Arándanos Pasas x 2kg', cant: '1 u.', unit: 21772.59, sub: 21772.59 },
              { sku: 'GDFX1', desc: 'GRANA Flor x 1kg', cant: '1 u.', unit: 14020.24, sub: 14020.24 }
            ]
          }
        ]
      },
      {
        semanaTitulo: 'Semana 5 (29/06/2026 al 30/06/2026)',
        subtotalSemana: { ops: 1, bultos: 4, kilos: 10.0, final: 121448.34 },
        pedidos: [
          {
            fecha: '30/06/2026',
            comprobante: 'Presupuesto #8234482 (Comp. #9)',
            estado: 'Facturado / Retirado',
            kilos: 10.0,
            totalNeto: 100370.53,
            totalFinal: 121448.34,
            items: [
              { sku: 'PTSx2', desc: 'Pistacho C/CAS Tostado y Salado x 2kg', cant: '1 u.', unit: 66300.00, sub: 66300.00 },
              { sku: 'HASPx1', desc: 'Harina de Almendra S/PIEL x 1kg', cant: '1 u.', unit: 24265.80, sub: 24265.80 },
              { sku: 'PRx2', desc: 'Pasas de Uva Rubia x 2kg', cant: '1 u.', unit: 19147.44, sub: 19147.44 },
              { sku: 'MRSSGx5', desc: 'Maní RELDO Sin Sal x 5kg', cant: '1 u.', unit: 11735.10, sub: 11735.10 }
            ]
          }
        ]
      }
    ]
  },
  {
    mesTitulo: 'JULIO 2026',
    resumenMes: { ops: 6, bultos: 10, kilos: 18.0, neto: 116125.27, final: 140511.58 },
    semanas: [
      {
        semanaTitulo: 'Semana 1 (01/07/2026 al 05/07/2026)',
        subtotalSemana: { ops: 0, bultos: 0, kilos: 0.0, final: 0 },
        pedidos: []
      },
      {
        semanaTitulo: 'Semana 2 (06/07/2026 al 12/07/2026)',
        subtotalSemana: { ops: 1, bultos: 2, kilos: 7.0, final: 29805.46 },
        pedidos: [
          {
            fecha: '08/07/2026',
            comprobante: 'Presupuesto #8234524 (Comp. #12)',
            estado: 'Facturado / Retirado',
            kilos: 7.0,
            totalNeto: 24632.61,
            totalFinal: 29805.46,
            items: [
              { sku: 'MSEGx5', desc: 'Mix Semillas x 5kg', cant: '1 u.', unit: 23054.72, sub: 23054.72 },
              { sku: 'MCVX2', desc: 'Maní VGNA Con cáscara x 2kg', cant: '1 u.', unit: 6750.74, sub: 6750.74 }
            ]
          }
        ]
      },
      {
        semanaTitulo: 'Semana 3 (13/07/2026 al 19/07/2026)',
        subtotalSemana: { ops: 2, bultos: 3, kilos: 4.0, final: 32719.74 },
        pedidos: [
          {
            fecha: '14/07/2026',
            comprobante: 'Presupuesto #8234561 (Comp. #17)',
            estado: 'Facturado / Retirado',
            kilos: 3.0,
            totalNeto: 17166.10,
            totalFinal: 20770.99,
            items: [
              { sku: 'GDFX1', desc: 'GRANA Flor x 1kg', cant: '1 u.', unit: 14020.25, sub: 14020.25 },
              { sku: 'MCVX2', desc: 'Maní VGNA Con cáscara x 2kg', cant: '1 u.', unit: 6750.74, sub: 6750.74 }
            ]
          },
          {
            fecha: '15/07/2026',
            comprobante: 'Presupuesto #8234567 (Comp. #18)',
            estado: 'Entregado',
            kilos: 1.0,
            totalNeto: 9875.00,
            totalFinal: 11948.75,
            items: [
              { sku: 'GSX1', desc: 'GRANA Sol x 1kg', cant: '1 u.', unit: 11948.75, sub: 11948.75 }
            ]
          }
        ]
      },
      {
        semanaTitulo: 'Semana 4 (20/07/2026 al 26/07/2026)',
        subtotalSemana: { ops: 1, bultos: 2, kilos: 3.0, final: 33895.16 },
        pedidos: [
          {
            fecha: '21/07/2026',
            comprobante: 'Presupuesto #8234601 (Comp. #21)',
            estado: 'Entregado',
            kilos: 3.0,
            totalNeto: 28012.53,
            totalFinal: 33895.16,
            items: [
              { sku: 'CHBx2', desc: 'Banana Chips x 2kg', cant: '1 u.', unit: 20729.32, sub: 20729.32 },
              { sku: 'GSX1', desc: 'GRANA Sol x 1kg', cant: '1 u.', unit: 13165.84, sub: 13165.84 }
            ]
          }
        ]
      },
      {
        semanaTitulo: 'Semana 5 (27/07/2026 al 31/07/2026)',
        subtotalSemana: { ops: 2, bultos: 3, kilos: 4.0, final: 44091.22 },
        pedidos: [
          {
            fecha: '27/07/2026',
            comprobante: 'Presupuesto #8234615 (Comp. #25)',
            estado: 'Entregado',
            kilos: 2.0,
            totalNeto: 5579.11,
            totalFinal: 6750.72,
            items: [
              { sku: 'MCVX2', desc: 'Maní VGNA Con cáscara x 2kg', cant: '1 u.', unit: 6750.72, sub: 6750.72 }
            ]
          },
          {
            fecha: '30/07/2026',
            comprobante: 'Presupuesto #8234622 (Comp. #24)',
            estado: 'Entregado',
            kilos: 2.0,
            totalNeto: 30859.92,
            totalFinal: 37340.50,
            items: [
              { sku: 'GDFX1', desc: 'GRANA Flor x 1kg', cant: '2 u.', unit: 18670.25, sub: 37340.50 }
            ]
          }
        ]
      }
    ]
  },
  {
    mesTitulo: 'AGOSTO 2026',
    resumenMes: { ops: 5, bultos: 21, kilos: 53.5, neto: 353493.83, final: 427727.53 },
    semanas: [
      {
        semanaTitulo: 'Semana 1 (03/08/2026 al 09/08/2026)',
        subtotalSemana: { ops: 1, bultos: 7, kilos: 18.0, final: 172833.31 },
        pedidos: [
          {
            fecha: '04/08/2026',
            comprobante: 'Presupuesto #8234632 (Comp. #26)',
            estado: 'Entregado',
            kilos: 18.0,
            totalNeto: 142837.45,
            totalFinal: 172833.31,
            items: [
              { sku: 'APx2', desc: 'Avellanas Peladas x 2kg', cant: '1 u.', unit: 66272.37, sub: 66272.37 },
              { sku: 'GDFX1', desc: 'GRANA Flor x 1kg', cant: '2 u.', unit: 18670.25, sub: 37340.50 },
              { sku: 'CCW4X2', desc: 'Castañas de Cajú x 2kg', cant: '1 u.', unit: 25130.44, sub: 25130.44 },
              { sku: 'CRx2', desc: 'Coco Rallado HF x 2kg', cant: '1 u.', unit: 17576.56, sub: 17576.56 },
              { sku: 'MRSx5', desc: 'Maní RELDO Salado x 5kg', cant: '1 u.', unit: 13256.72, sub: 13256.72 },
              { sku: 'MRSSGx5', desc: 'Maní RELDO Sin Sal x 5kg', cant: '1 u.', unit: 13256.72, sub: 13256.72 }
            ]
          }
        ]
      },
      {
        semanaTitulo: 'Semana 2 (10/08/2026 al 16/08/2026)',
        subtotalSemana: { ops: 2, bultos: 4, kilos: 10.0, final: 96472.78 },
        pedidos: [
          {
            fecha: '11/08/2026',
            comprobante: 'Presupuesto #8234656 (Comp. #28)',
            estado: 'Facturado / Retirado',
            kilos: 8.0,
            totalNeto: 55603.51,
            totalFinal: 67280.25,
            items: [
              { sku: 'MFSx5', desc: 'Mix F/SCOS Con Pasas x 5kg', cant: '1 u.', unit: 38825.03, sub: 38825.03 },
              { sku: 'HASPx1', desc: 'Harina de Almendra S/PIEL x 1kg', cant: '1 u.', unit: 18778.78, sub: 18778.78 },
              { sku: 'MCVX2', desc: 'Maní VGNA Con cáscara x 2kg', cant: '1 u.', unit: 9676.44, sub: 9676.44 }
            ]
          },
          {
            fecha: '11/08/2026',
            comprobante: 'Presupuesto #8234659 (Comp. #29)',
            estado: 'Facturado / Retirado',
            kilos: 2.0,
            totalNeto: 24126.06,
            totalFinal: 29192.53,
            items: [
              { sku: 'ADX2K', desc: 'Arándanos Pasas x 2kg', cant: '1 u.', unit: 29192.53, sub: 29192.53 }
            ]
          }
        ]
      },
      {
        semanaTitulo: 'Semana 3 (17/08/2026 al 23/08/2026)',
        subtotalSemana: { ops: 0, bultos: 0, kilos: 0.0, final: 0 },
        pedidos: []
      },
      {
        semanaTitulo: 'Semana 4 (24/08/2026 al 31/08/2026)',
        subtotalSemana: { ops: 2, bultos: 10, kilos: 25.5, final: 158421.44 },
        pedidos: [
          {
            fecha: '25/08/2026',
            comprobante: 'Presupuesto #8234684 (Comp. #32)',
            estado: 'Entregado',
            kilos: 7.5,
            totalNeto: 69949.21,
            totalFinal: 84638.54,
            items: [
              { sku: 'GDFX1', desc: 'GRANA Flor x 1kg', cant: '3 u.', unit: 18927.05, sub: 56781.15 },
              { sku: 'CDMX3,5', desc: 'Maíz Copos x 3.5kg', cant: '1 u.', unit: 13975.50, sub: 13975.50 },
              { sku: 'GSX1', desc: 'GRANA Sol x 1kg', cant: '1 u.', unit: 13881.90, sub: 13881.90 }
            ]
          },
          {
            fecha: '28/08/2026',
            comprobante: 'Presupuesto #8234694 (Comp. #33)',
            estado: 'Entregado',
            kilos: 18.0,
            totalNeto: 60977.60,
            totalFinal: 73782.90,
            items: [
              { sku: 'GDFX1', desc: 'GRANA Flor x 1kg', cant: '1 u.', unit: 18927.05, sub: 18927.05 },
              { sku: 'MRSSGx5', desc: 'Maní RELDO Sin Sal x 5kg', cant: '1 u.', unit: 16242.62, sub: 16242.62 },
              { sku: 'CRx2', desc: 'Coco Rallado HF x 2kg', cant: '1 u.', unit: 15226.28, sub: 15226.28 },
              { sku: 'MRSx5', desc: 'Maní RELDO Salado x 5kg', cant: '1 u.', unit: 13031.92, sub: 13031.92 },
              { sku: 'AAIx5', desc: 'Avena ALLDA Instantánea x 5kg', cant: '1 u.', unit: 10355.03, sub: 10355.03 }
            ]
          }
        ]
      }
    ]
  },
  {
    mesTitulo: 'SEPTIEMBRE 2026 (Mes Pico de Actividad)',
    resumenMes: { ops: 6, bultos: 37, kilos: 61.1, neto: 660362.39, final: 799038.50 },
    semanas: [
      {
        semanaTitulo: 'Semana 1 (01/09/2026 al 06/09/2026)',
        subtotalSemana: { ops: 2, bultos: 12, kilos: 20.0, final: 296260.96 },
        pedidos: [
          {
            fecha: '01/09/2026',
            comprobante: 'Presupuesto #8234705 (Comp. #41)',
            estado: 'Entregado',
            kilos: 17.0,
            totalNeto: 202086.75,
            totalFinal: 244524.97,
            items: [
              { sku: 'PTSx2', desc: 'Pistacho C/CAS Tostado y Salado x 2kg', cant: '1 u.', unit: 60226.07, sub: 60226.07 },
              { sku: 'GDFX1', desc: 'GRANA Flor x 1kg', cant: '3 u.', unit: 18927.05, sub: 56781.15 },
              { sku: 'MFSx5', desc: 'Mix F/SCOS Con Pasas x 5kg', cant: '1 u.', unit: 38849.05, sub: 38849.05 },
              { sku: 'CCW4X2', desc: 'Castañas de Cajú x 2kg', cant: '1 u.', unit: 29753.84, sub: 29753.84 },
              { sku: 'ADX2K', desc: 'Arándanos Pasas x 2kg', cant: '1 u.', unit: 29192.53, sub: 29192.53 },
              { sku: 'HASPx1', desc: 'Harina de Almendra S/PIEL x 1kg', cant: '1 u.', unit: 18778.78, sub: 18778.78 },
              { sku: 'MCVX2', desc: 'Maní VGNA Con cáscara x 2kg', cant: '1 u.', unit: 10943.55, sub: 10943.55 }
            ]
          },
          {
            fecha: '02/09/2026',
            comprobante: 'Presupuesto #8234707 (Comp. #42)',
            estado: 'Entregado',
            kilos: 3.0,
            totalNeto: 42757.02,
            totalFinal: 51735.99,
            items: [
              { sku: 'GDFX1', desc: 'GRANA Flor x 1kg', cant: '2 u.', unit: 18927.05, sub: 37854.10 },
              { sku: 'GSX1', desc: 'GRANA Sol x 1kg', cant: '1 u.', unit: 13881.90, sub: 13881.90 }
            ]
          }
        ]
      },
      {
        semanaTitulo: 'Semana 2 (07/09/2026 al 13/09/2026)',
        subtotalSemana: { ops: 0, bultos: 0, kilos: 0.0, final: 0 },
        pedidos: []
      },
      {
        semanaTitulo: 'Semana 3 (14/09/2026 al 20/09/2026)',
        subtotalSemana: { ops: 1, bultos: 7, kilos: 9.0, final: 102058.79 },
        pedidos: [
          {
            fecha: '15/09/2026',
            comprobante: 'Presupuesto #8234740 (Comp. #45)',
            estado: 'Entregado',
            kilos: 9.0,
            totalNeto: 84346.10,
            totalFinal: 102058.79,
            items: [
              { sku: 'CCW4x1k', desc: 'Castañas de Cajú x 1kg', cant: '2 u.', unit: 13345.49, sub: 26690.98 },
              { sku: 'GDFX1', desc: 'GRANA Flor x 1kg', cant: '1 u.', unit: 19753.36, sub: 19753.36 },
              { sku: 'CRx2', desc: 'Coco Rallado HF x 2kg', cant: '1 u.', unit: 15226.28, sub: 15226.28 },
              { sku: 'SZAAX1', desc: 'SEM Zapallo AA x 1kg', cant: '1 u.', unit: 14093.43, sub: 14093.43 },
              { sku: 'GSX1', desc: 'GRANA Sol x 1kg', cant: '1 u.', unit: 13801.46, sub: 13801.46 },
              { sku: 'PJx2', desc: 'Pasas de Uva Jumbo x 2kg', cant: '1 u.', unit: 12493.28, sub: 12493.28 }
            ]
          }
        ]
      },
      {
        semanaTitulo: 'Semana 4 (21/09/2026 al 27/09/2026)',
        subtotalSemana: { ops: 2, bultos: 16, kilos: 29.9, final: 355096.50 },
        pedidos: [
          {
            fecha: '22/09/2026',
            comprobante: 'Presupuesto #8234757 (Comp. #46)',
            estado: 'Facturado / Retirado',
            kilos: 26.7,
            totalNeto: 239438.75,
            totalFinal: 289720.89,
            items: [
              { sku: 'APx2', desc: 'Avellanas Peladas x 2kg', cant: '1 u.', unit: 68491.81, sub: 68491.81 },
              { sku: 'GSX1', desc: 'GRANA Sol x 1kg', cant: '3 u.', unit: 13801.47, sub: 41404.41 },
              { sku: 'MFSx5', desc: 'Mix F/SCOS Con Pasas x 5kg', cant: '1 u.', unit: 39215.47, sub: 39215.47 },
              { sku: 'NCBxK', desc: 'Nuez CHLER Cuarto EXLIGHT x 2kg', cant: '1 u.', unit: 27134.31, sub: 27134.31 },
              { sku: 'CCW4x1k', desc: 'Castañas de Cajú x 1kg', cant: '2 u.', unit: 13345.49, sub: 26690.98 },
              { sku: 'BF24X50', desc: 'BARRA Flor 24 x 50g (Caja 1,2kg)', cant: '1 u.', unit: 25868.89, sub: 25868.89 },
              { sku: 'GDFX1', desc: 'GRANA Flor x 1kg', cant: '1 u.', unit: 19753.36, sub: 19753.36 },
              { sku: 'MRSSGx5', desc: 'Maní RELDO Sin Sal x 5kg', cant: '1 u.', unit: 16242.62, sub: 16242.62 },
              { sku: 'CDMX3,5', desc: 'Maíz Copos x 3.5kg', cant: '1 u.', unit: 13975.50, sub: 13975.50 },
              { sku: 'MCVX2', desc: 'Maní VGNA Con cáscara x 2kg', cant: '1 u.', unit: 10943.55, sub: 10943.55 }
            ]
          },
          {
            fecha: '23/09/2026',
            comprobante: 'Presupuesto #8234759 (Comp. #47)',
            estado: 'Entregado',
            kilos: 3.2,
            totalNeto: 54029.43,
            totalFinal: 65375.61,
            items: [
              { sku: 'GDFX1', desc: 'GRANA Flor x 1kg', cant: '2 u.', unit: 19753.36, sub: 39506.72 },
              { sku: 'BF24X50', desc: 'BARRA Flor 24 x 50g (Caja 1,2kg)', cant: '1 u.', unit: 25868.89, sub: 25868.89 }
            ]
          }
        ]
      },
      {
        semanaTitulo: 'Semana 5 (28/09/2026 al 30/09/2026)',
        subtotalSemana: { ops: 1, bultos: 2, kilos: 2.2, final: 45622.25 },
        pedidos: [
          {
            fecha: '29/09/2026',
            comprobante: 'Presupuesto #8234772 (Comp. #49)',
            estado: 'Facturado / Retirado',
            kilos: 2.2,
            totalNeto: 37704.34,
            totalFinal: 45622.25,
            items: [
              { sku: 'BF24X50', desc: 'BARRA Flor 24 x 50g (Caja 1,2kg)', cant: '1 u.', unit: 25868.89, sub: 25868.89 },
              { sku: 'GDFX1', desc: 'GRANA Flor x 1kg', cant: '1 u.', unit: 19753.36, sub: 19753.36 }
            ]
          }
        ]
      }
    ]
  },
  {
    mesTitulo: 'OCTUBRE 2026 (Caída del -74,8% respecto a Septiembre)',
    resumenMes: { ops: 3, bultos: 9, kilos: 18.2, neto: 166526.23, final: 201496.75 },
    semanas: [
      {
        semanaTitulo: 'Semana 1 (01/10/2026 al 11/10/2026)',
        subtotalSemana: { ops: 1, bultos: 3, kilos: 12.0, final: 81439.92 },
        pedidos: [
          {
            fecha: '06/10/2026',
            comprobante: 'Presupuesto #8234795 (Comp. #57)',
            estado: 'Entregado',
            kilos: 12.0,
            totalNeto: 67305.72,
            totalFinal: 81439.92,
            items: [
              { sku: 'MFSx5', desc: 'Mix F/SCOS Con Pasas x 5kg', cant: '1 u.', unit: 39215.47, sub: 39215.47 },
              { sku: 'ADX2K', desc: 'Arándanos Pasas x 2kg', cant: '1 u.', unit: 29192.53, sub: 29192.53 },
              { sku: 'MRSx5', desc: 'Maní RELDO Salado x 5kg', cant: '1 u.', unit: 13031.92, sub: 13031.92 }
            ]
          }
        ]
      },
      {
        semanaTitulo: 'Semana 2 (12/10/2026 al 18/10/2026)',
        subtotalSemana: { ops: 1, bultos: 4, kilos: 4.0, final: 72578.77 },
        pedidos: [
          {
            fecha: '13/10/2026',
            comprobante: 'Presupuesto #8234813 (Comp. #58)',
            estado: 'Facturado / Retirado',
            kilos: 4.0,
            totalNeto: 59982.45,
            totalFinal: 72578.77,
            items: [
              { sku: 'GDFX1', desc: 'GRANA Flor x 1kg', cant: '3 u.', unit: 19609.83, sub: 58829.49 },
              { sku: 'GSX1', desc: 'GRANA Sol x 1kg', cant: '1 u.', unit: 13749.28, sub: 13749.28 }
            ]
          }
        ]
      },
      {
        semanaTitulo: 'Semana 3 (19/10/2026 al 25/10/2026)',
        subtotalSemana: { ops: 0, bultos: 0, kilos: 0.0, final: 0 },
        pedidos: []
      },
      {
        semanaTitulo: 'Semana 4 (26/10/2026 al 31/10/2026)',
        subtotalSemana: { ops: 1, bultos: 2, kilos: 2.2, final: 47478.06 },
        pedidos: [
          {
            fecha: '27/10/2026',
            comprobante: 'Presupuesto #8234840 (Comp. #60)',
            estado: 'Facturado / Retirado',
            kilos: 2.2,
            totalNeto: 39238.06,
            totalFinal: 47478.06,
            items: [
              { sku: 'BF24X50', desc: 'BARRA Flor 24 x 50g (Caja 1,2kg)', cant: '1 u.', unit: 26988.97, sub: 26988.97 },
              { sku: 'GDFX1', desc: 'GRANA Flor x 1kg', cant: '1 u.', unit: 20489.09, sub: 20489.09 }
            ]
          }
        ]
      }
    ]
  },
  {
    mesTitulo: 'NOVIEMBRE 2026 (Hasta la fecha: Martes 03/11/2026)',
    resumenMes: { ops: 1, bultos: 1, kilos: 1.0, neto: 15519.65, final: 18778.78 },
    semanas: [
      {
        semanaTitulo: 'Semana 1 (01/11/2026 al 03/11/2026 — En curso)',
        subtotalSemana: { ops: 1, bultos: 1, kilos: 1.0, final: 18778.78 },
        pedidos: [
          {
            fecha: '03/11/2026',
            comprobante: 'Presupuesto #8234853 (Portal B2B - Hoy)',
            estado: 'Presupuesto del Día',
            kilos: 1.0,
            totalNeto: 15519.65,
            totalFinal: 18778.78,
            items: [
              { sku: 'HASPx1', desc: 'Harina de Almendra S/PIEL x 1kg', cant: '1 u.', unit: 18778.78, sub: 18778.78 }
            ]
          }
        ]
      }
    ]
  }
];

function generarPDF() {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 36, bottom: 18, left: 38, right: 38 },
      bufferPages: true
    });

    const stream = fs.createWriteStream(outputPdfPath);
    doc.pipe(stream);

    const pageW = doc.page.width;
    const leftM = 38;
    const rightM = pageW - 38;
    const contentW = rightM - leftM;

    function checkSpace(needed) {
      if (doc.y + needed > doc.page.height - 46) {
        doc.addPage();
      }
    }

    // --- HEADER ---
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, leftM, 30, { width: 88 });
    }

    doc.font('Helvetica-Bold').fontSize(14).fillColor('#1e293b')
       .text('INFORME DETALLADO DE COMPRAS Y RETIROS', leftM + 102, 32, { width: contentW - 102, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a')
       .text('Cliente: TUS FRUTOS SECOS — SERRANO NICOLÁS (#0387)', leftM + 102, 50, { width: contentW - 102, align: 'right' });
    doc.font('Helvetica').fontSize(8.5).fillColor('#475569')
       .text('Período Analizado: Últimos 5 meses hasta la fecha (01/06/2026 al 03/11/2026) | Ordenado por Mes y Semana', leftM + 102, 65, { width: contentW - 102, align: 'right' });

    doc.moveTo(leftM, 85).lineTo(rightM, 85).lineWidth(1.2).strokeColor('#cbd5e1').stroke();
    doc.y = 95;

    // --- 1. RESUMEN EJECUTIVO MENSUAL ---
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#0f172a')
       .text('1. EVOLUCIÓN MENSUAL DE RETIROS (JUNIO 2026 – 03 DE NOVIEMBRE 2026)', leftM, doc.y);
    doc.moveDown(0.35);

    const tableTop = doc.y;
    const colWidths = [135, 58, 62, 65, 95, 104];
    const headers = ['Mes / Período', 'Retiros', 'Bultos', 'Volumen (Kg)', 'Total Neto s/IVA', 'Total Comprobante'];

    doc.rect(leftM, tableTop, contentW, 18).fill('#1e293b');
    let cx = leftM;
    headers.forEach((h, idx) => {
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff')
         .text(h, cx + 4, tableTop + 5, { width: colWidths[idx] - 8, align: idx === 0 ? 'left' : 'right' });
      cx += colWidths[idx];
    });

    let ry = tableTop + 18;
    const rowsResumen = [
      ['Junio 2026', '7', '20 u.', '49,2 kg', fmtMoney(425628.45), fmtMoney(501321.81), false],
      ['Julio 2026', '6', '10 u.', '18,0 kg', fmtMoney(116125.27), fmtMoney(140511.58), false],
      ['Agosto 2026', '5', '21 u.', '53,5 kg', fmtMoney(353493.83), fmtMoney(427727.53), false],
      ['Septiembre 2026 (Pico)', '6', '37 u.', '61,1 kg', fmtMoney(660362.39), fmtMoney(799038.50), false],
      ['Octubre 2026 (-74,8%)', '3', '9 u.', '18,2 kg', fmtMoney(166526.23), fmtMoney(201496.75), true],
      ['Noviembre 2026 (al 03/11)', '1 (Presup.)', '1 u.', '1,0 kg', fmtMoney(15519.65), fmtMoney(18778.78), true]
    ];

    rowsResumen.forEach((r, idx) => {
      const bg = r[6] ? '#fef2f2' : (idx % 2 === 0 ? '#f8fafc' : '#ffffff');
      doc.rect(leftM, ry, contentW, 16).fill(bg);
      doc.rect(leftM, ry, contentW, 16).lineWidth(0.3).strokeColor('#e2e8f0').stroke();
      let x = leftM;
      for (let i = 0; i < 6; i++) {
        doc.font(r[6] || i === 0 || i === 5 ? 'Helvetica-Bold' : 'Helvetica')
           .fontSize(8)
           .fillColor(r[6] ? '#991b1b' : '#1e293b')
           .text(r[i], x + 4, ry + 4, { width: colWidths[i] - 8, align: i === 0 ? 'left' : 'right' });
        x += colWidths[i];
      }
      ry += 16;
    });

    // Total Row
    doc.rect(leftM, ry, contentW, 18).fill('#e2e8f0');
    let tx = leftM;
    const totRow = ['TOTAL PERÍODO (JUN–NOV)', '28 ops.', '98 u.', '201,0 kg', fmtMoney(1737655.82), fmtMoney(2088874.95)];
    totRow.forEach((t, i) => {
      doc.font('Helvetica-Bold').fontSize(8.0).fillColor('#0f172a')
         .text(t, tx + 4, ry + 5, { width: colWidths[i] - 8, align: i === 0 ? 'left' : 'right', lineBreak: false });
      tx += colWidths[i];
    });
    ry += 24;
    doc.y = ry;

    // Box de Observación de Caída
    doc.rect(leftM, doc.y, contentW, 46).fillAndStroke('#fff7ed', '#fdba74');
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#9a3412')
       .text('SÍNTESIS DE COMPORTAMIENTO DE COMPRA:', leftM + 8, doc.y + 6);
    doc.font('Helvetica').fontSize(8).fillColor('#7c2d12')
       .text(
         '• Entre Junio y Septiembre 2026 el ritmo de compra alcanzó un pico de 61,1 kg mensuales ($799.038,50 en Septiembre), con reposición constante de frutos secos, semillas, mixes, granolas y barritas.\n' +
         '• En Octubre 2026 las compras cayeron un 74,8% en monto y un 70,2% en kilos (18,2 kg totales). Desde el 07/10/2026 hasta hoy 03/11/2026 (4 semanas), no se registraron retiros de frutos secos ni mixes (únicamente 4 bolsas de Grana Flor, 1 de Grana Sol, 1 caja de Barra Flor y el presupuesto de hoy de 1 kg de Harina de Almendra S/Piel).',
         leftM + 8, doc.y + 2, { width: contentW - 16 }
       );
    doc.y += 18;

    // --- 2. DETALLE ORDENADO POR MES Y POR SEMANA ---
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#0f172a')
       .text('2. DETALLE CRONOLÓGICO DE COMPRAS POR MES Y POR SEMANA', leftM, doc.y);
    doc.moveDown(0.3);

    for (const mes of mesesData) {
      checkSpace(85);
      // Mes Banner
      const my = doc.y;
      doc.rect(leftM, my, contentW, 20).fill('#0f172a');
      doc.font('Helvetica-Bold').fontSize(9.2).fillColor('#ffffff')
         .text(mes.mesTitulo, leftM + 8, my + 5, { width: 280, align: 'left' });
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#f8fafc')
         .text(
           `${mes.resumenMes.ops} op. | ${mes.resumenMes.bultos} bultos (${fmtKg(mes.resumenMes.kilos)}) | Total Mes: ${fmtMoney(mes.resumenMes.final)}`,
           leftM + 200, my + 5.5, { width: contentW - 208, align: 'right' }
         );
      doc.y = my + 24;

      for (const sem of mes.semanas) {
        const isZero = sem.pedidos.length === 0;
        const firstPedHeight = isZero ? 0 : (18 + sem.pedidos[0].items.length * 11.5 + 8);
        checkSpace(18 + firstPedHeight);

        const sy = doc.y;
        doc.rect(leftM, sy, contentW, 15).fill(isZero ? '#f1f5f9' : '#e0f2fe');
        doc.font('Helvetica-Bold').fontSize(8.2).fillColor(isZero ? '#64748b' : '#0369a1')
           .text(sem.semanaTitulo, leftM + 6, sy + 3.5, { width: 290 });
        doc.font('Helvetica-Bold').fontSize(8).fillColor(isZero ? '#64748b' : '#0c4a6e')
           .text(
             isZero
               ? 'Sin retiros ni pedidos registrados en la semana'
               : `Subtotal Semana: ${sem.subtotalSemana.ops} op. | ${sem.subtotalSemana.bultos} bultos (${fmtKg(sem.subtotalSemana.kilos)}) | ${fmtMoney(sem.subtotalSemana.final)}`,
             leftM + 210, sy + 3.5, { width: contentW - 216, align: 'right' }
           );
        doc.y = sy + 18;

        for (const ped of sem.pedidos) {
          const neededH = 18 + ped.items.length * 11.5 + 8;
          checkSpace(neededH);

          const py = doc.y;
          doc.font('Helvetica-Bold').fontSize(8.2).fillColor('#1e293b')
             .text(`Fecha: ${ped.fecha}  —  ${ped.comprobante}  [${ped.estado}]`, leftM + 8, py, { width: 355, lineBreak: false });
          doc.font('Helvetica-Bold').fontSize(8.2).fillColor('#0f172a')
             .text(`Volumen: ${fmtKg(ped.kilos)}   |   Total: ${fmtMoney(ped.totalFinal)}`, leftM + 310, py, { width: contentW - 316, align: 'right', lineBreak: false });
          doc.y = py + 13;

          for (const it of ped.items) {
            const iy = doc.y;
            doc.font('Helvetica').fontSize(7.8).fillColor('#334155')
               .text(`• ${it.desc} (${it.sku}): ${it.cant}`, leftM + 18, iy, { width: 310, lineBreak: false });
            doc.font('Helvetica').fontSize(7.8).fillColor('#475569')
               .text(`Unit: ${fmtMoney(it.unit)}   |   Subtotal: ${fmtMoney(it.sub)}`, leftM + 310, iy, { width: contentW - 318, align: 'right', lineBreak: false });
            doc.y = iy + 11.5;
          }
          doc.moveTo(leftM + 8, doc.y + 1).lineTo(rightM - 8, doc.y + 1).lineWidth(0.3).strokeColor('#cbd5e1').stroke();
          doc.y += 5;
        }
      }
      doc.y += 4;
    }

    // --- 3. TABLA COMPARATIVA DE ARTÍCULOS HABITUALES QUE DEJÓ DE RETIRAR ---
    checkSpace(190);
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a')
       .text('3. COMPARATIVA POR ARTÍCULO: JUNIO–SEPTIEMBRE vs. OCTUBRE–NOVIEMBRE 2026', leftM, doc.y);
    doc.moveDown(0.3);

    const cTop = doc.y;
    const cW = [225, 85, 85, 124];
    const cHeaders = ['Artículo Habitual (Código Búnker)', 'Jun–Sep (4 meses)', 'Oct–Nov (Actual)', 'Última Compra Registrada'];

    doc.rect(leftM, cTop, contentW, 16).fill('#1e293b');
    let ccx = leftM;
    cHeaders.forEach((h, i) => {
      doc.font('Helvetica-Bold').fontSize(7.8).fillColor('#ffffff')
         .text(h, ccx + 4, cTop + 4, { width: cW[i] - 8, align: i === 0 ? 'left' : 'center', lineBreak: false });
      ccx += cW[i];
    });

    const prodRows = [
      ['GRANA Flor x 1kg (GDFX1)', '24 bolsas (24 kg)', '4 bolsas (4 kg)', '27/10/2026 (Bajó -83%)'],
      ['GRANA Sol x 1kg (GSX1)', '9 bolsas (9 kg)', '1 bolsa (1 kg)', '13/10/2026 (Bajó -89%)'],
      ['Maní VGNA Con cáscara x 2kg (MCVX2)', '7 bolsas (14 kg)', '0 bolsas (0 kg)', '22/09/2026 (Sin compras)'],
      ['Mix F/SCOS Con Pasas x 5kg (MFSx5)', '6 bolsas (30 kg)', '1 bolsa (5 kg)', '06/10/2026 (1 mes sin compra)'],
      ['BARRA Flor 24 x 50g (BF24X50)', '4 cajas (96 barritas)', '1 caja (24 barritas)', '27/10/2026 (Bajó -75%)'],
      ['Maní RELDO Sin Sal x 5kg (MRSSGx5)', '4 bolsas (20 kg)', '0 bolsas (0 kg)', '22/09/2026 (Sin compras)'],
      ['Castañas de Cajú x 1kg y x 2kg (CCW4)', '6 bolsas (8 kg)', '0 bolsas (0 kg)', '22/09/2026 (Sin compras)'],
      ['Maní RELDO Salado x 5kg (MRSx5)', '3 bolsas (15 kg)', '1 bolsa (5 kg)', '06/10/2026 (1 mes sin compra)'],
      ['Harina de Almendra S/PIEL x 1kg (HASPx1)', '3 bolsas (3 kg)', '1 bolsa (1 kg - Hoy)', '03/11/2026 (Presupuesto hoy)'],
      ['Arándanos Pasas x 2kg (ADX2K)', '3 bolsas (6 kg)', '1 bolsa (2 kg)', '06/10/2026 (1 mes sin compra)'],
      ['Coco Rallado HF x 2kg (CRx2)', '3 bolsas (6 kg)', '0 bolsas (0 kg)', '15/09/2026 (Sin compras)'],
      ['Avellanas Peladas x 2kg (APx2)', '2 bolsas (4 kg)', '0 bolsas (0 kg)', '22/09/2026 (Sin compras)'],
      ['Pistacho C/CAS Tostado y Salado x 2kg (PTSx2)', '2 bolsas (4 kg)', '0 bolsas (0 kg)', '01/09/2026 (Sin compras)'],
      ['Maíz Copos x 3.5kg (CDMX3,5)', '2 bolsas (7 kg)', '0 bolsas (0 kg)', '22/09/2026 (Sin compras)'],
      ['Hongo Seco Boletus x 1kg (HSX1)', '2 bolsas (2 kg)', '0 bolsas (0 kg)', '25/06/2026 (Sin compras)'],
      ['Nuez CHLER Cuarto EXLIGHT x 2kg (NCBxK)', '1 bolsa (2 kg)', '0 bolsas (0 kg)', '22/09/2026 (Sin compras)']
    ];

    let pry = cTop + 16;
    prodRows.forEach((pr, idx) => {
      checkSpace(15);
      if (doc.y > pry) pry = doc.y;
      const isZeroOct = pr[2].startsWith('0 ');
      const bg = isZeroOct ? '#fff1f2' : (idx % 2 === 0 ? '#f8fafc' : '#ffffff');
      doc.rect(leftM, pry, contentW, 13.5).fill(bg);
      doc.rect(leftM, pry, contentW, 13.5).lineWidth(0.25).strokeColor('#cbd5e1').stroke();
      let px = leftM;
      for (let i = 0; i < 4; i++) {
        doc.font(i === 0 ? 'Helvetica-Bold' : 'Helvetica')
           .fontSize(7.4)
           .fillColor(isZeroOct && i >= 2 ? '#9f1239' : '#1e293b')
           .text(pr[i], px + 4, pry + 3, { width: cW[i] - 8, align: i === 0 ? 'left' : 'center', lineBreak: false });
        px += cW[i];
      }
      pry += 13.5;
      doc.y = pry;
    });

    // Footer on all pages (using lineBreak: false so PDFKit doesn't overflow pages)
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(7.5).fillColor('#64748b')
         .text(
           `Sistema LAMDA — Informe de Evolución de Compras | Cliente: Tus Frutos Secos (Serrano Nicolás) | Emisión: 03/11/2026 | Página ${i + 1} de ${range.count}`,
           leftM,
           doc.page.height - 28,
           { width: contentW, align: 'center', lineBreak: false }
         );
    }

    doc.end();
    stream.on('finish', () => resolve(outputPdfPath));
    stream.on('error', reject);
  });
}

generarPDF()
  .then((p) => {
    console.log('✅ PDF generado exitosamente en:', p);
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Error generando PDF:', err);
    process.exit(1);
  });
