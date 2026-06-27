// filepath: src/actualizaPrecios/syncB2BCuentas.js
'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Pool } = require('pg');
const PDFDocument = require('pdfkit');

// ===== 1) Conexión a la Base de Datos Local =====
const localPool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'etiquetas',
  password: process.env.DB_PASSWORD || 'ta3Mionga',
  port: parseInt(process.env.DB_PORT || '5432'),
});

console.log('═══════════════════════════════════════════════════════');
console.log('📡 [SYNC-B2B-CUENTAS] CANAL DE SINCRONIZACIÓN DE CUENTAS');
console.log('═══════════════════════════════════════════════════════');
console.log(`🔌 Conectado a BD Local: ${process.env.DB_NAME || 'etiquetas'}`);
console.log(`🌍 Entorno: ${process.env.NODE_ENV || 'production'}`);
console.log(`☁️  Supabase URL: ${process.env.SUPABASE_B2B_URL}`);
console.log('═══════════════════════════════════════════════════════');

// ===== 2) Configuración de API Supabase =====
const SUPABASE_URL = process.env.SUPABASE_B2B_URL;
const SUPABASE_KEY = process.env.SUPABASE_B2B_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('💥 ERROR CRÍTICO: Variables de Supabase B2B faltantes en .env');
  process.exit(1);
}

// Helper para realizar llamadas HTTP con reintentos y timeout (Resiliencia)
async function fetchWithRetry(url, options = {}, retries = 3, delay = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      if (response.ok) {
        return response;
      }
      
      const errorText = await response.text();
      console.warn(`⚠️ [Supabase REST] Intento ${attempt}/${retries} falló: HTTP ${response.status} - ${errorText}`);
    } catch (err) {
      clearTimeout(timeoutId);
      const isTimeout = err.name === 'AbortError';
      console.error(`❌ [Supabase Conn] Intento ${attempt}/${retries} error: ${isTimeout ? 'TIMEOUT' : err.message}`);
    }
    
    if (attempt < retries) {
      const backoff = delay * Math.pow(2, attempt - 1);
      console.log(`🔄 Reintentando en ${backoff}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }
  throw new Error(`Agotados los ${retries} reintentos de conexión con Supabase.`);
}

// Verifica si un PDF existe en el bucket comprobantes de Supabase Storage (vía HEAD)
async function checkFileExistsInStorage(filename) {
  const url = `${SUPABASE_URL}/storage/v1/object/public/comprobantes/${filename}`;
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch (err) {
    return false;
  }
}

// Sube un Buffer de PDF a Supabase Storage
async function uploadPdfToStorage(filename, buffer) {
  const url = `${SUPABASE_URL}/storage/v1/object/comprobantes/${filename}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/pdf',
      'x-upsert': 'true'
    },
    body: buffer
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Carga de almacenamiento fallida: ${response.status} - ${text}`);
  }
}

// Genera el buffer de PDF para un recibo o ajuste local
function generarComprobantePdfBuffer(mov) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 40, bottom: 25, left: 40, right: 40 },
        info: {
          Title: `Recibo de Pago - ${mov.numero_comprobante || mov.local_movimiento_id}`,
          Author: 'LAMDA'
        }
      });

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', err => reject(err));

      const pageWidth = doc.page.width;
      const leftColumn = 40;
      const contentWidth = pageWidth - 80;

      // 1. Cargar Logo
      const logoPath = path.join(__dirname, '..', 'facturacion', 'img', 'logo_LAMDA_grande.png');
      let hasLogo = false;
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, leftColumn, 40, { width: 90 });
        hasLogo = true;
      }

      // Datos de la empresa debajo del logo
      let companyY = 40 + (hasLogo ? 38 : 0);
      doc.fontSize(8).font('Helvetica').fillColor('#1e293b');
      doc.text('Dirección: Calle 20 No. 638, La Plata', leftColumn, companyY);
      doc.text('Condición frente al IVA: Responsable Inscripto', leftColumn, companyY + 9);
      doc.text('Tel / WA: 221-6615746 | Email: administracion@lamda.com.ar', leftColumn, companyY + 18);

      // Letra R en recuadro para Recibo/Comprobante de Pago
      const boxWidth = 32;
      const boxHeight = 32;
      const boxX = (pageWidth / 2) - (boxWidth / 2);
      const boxY = 40;
      doc.save();
      doc.rect(boxX, boxY, boxWidth, boxHeight).fillColor('#8e4785').fill();
      doc.fontSize(18).font('Helvetica-Bold').fillColor('#ffffff').text('R', boxX, boxY + 6, { width: boxWidth, align: 'center' });
      doc.restore();
      doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#8e4785').text('COMPROBANTE', (pageWidth / 2) - 50, boxY + boxHeight + 4, { width: 100, align: 'center' });

      // Línea divisoria vertical
      doc.moveTo(pageWidth / 2, boxY + boxHeight + 16)
         .lineTo(pageWidth / 2, 40 + 82)
         .strokeColor('#e2e8f0')
         .lineWidth(1)
         .stroke();

      // Columna Derecha - Datos del Comprobante
      let rightY = 40;
      const esAjuste = ['AJUSTE_MANUAL', 'AJUSTE_AUTOMATICO'].includes(mov.tipo_comprobante_original);
      const labelTitulo = esAjuste ? 'COMPROBANTE DE AJUSTE' : 'RECIBO DE PAGO';
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#8e4785').text(labelTitulo, (pageWidth / 2) + 20, rightY);
      
      const nroComprobanteStr = mov.numero_comprobante ? mov.numero_comprobante : `REC-PAGO-${String(mov.local_movimiento_id).padStart(8, '0')}`;
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#1e293b').text(`Nro: ${nroComprobanteStr}`, (pageWidth / 2) + 20, rightY + 14);
      
      const fechaFmt = new Date(mov.fecha).toLocaleDateString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
      doc.fontSize(8).font('Helvetica').fillColor('#64748b').text(`Fecha: ${fechaFmt}`, (pageWidth / 2) + 20, rightY + 26);
      doc.text(`Hora registro: ${new Date(mov.fecha_registro || mov.fecha).toLocaleTimeString()}`, (pageWidth / 2) + 20, rightY + 35);
      doc.text(`Sistema: Autogestión LAMDA`, (pageWidth / 2) + 20, rightY + 44);

      // Línea divisoria horizontal debajo de la cabecera
      let lineY = Math.max(companyY + 32, rightY + 56);
      doc.moveTo(leftColumn, lineY)
         .lineTo(pageWidth - leftColumn, lineY)
         .strokeColor('#8e4785')
         .lineWidth(1.5)
         .stroke();

      // Bloque del Cliente
      let clientY = lineY + 12;
      doc.save();
      doc.rect(leftColumn, clientY, contentWidth, 54).fillColor('#f8fafc').fill();
      doc.rect(leftColumn, clientY, contentWidth, 54).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
      doc.restore();

      doc.fontSize(7).font('Helvetica-Bold').fillColor('#64748b').text('DATOS DEL CLIENTE', leftColumn + 8, clientY + 6);
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#1e293b').text(mov.razon_social || 'Cliente sin Razón Social', leftColumn + 8, clientY + 16);
      doc.fontSize(8).font('Helvetica').fillColor('#475569').text(`Código Búnker: ${mov.cliente_id || 'N/D'}`, leftColumn + 8, clientY + 28);
      if (mov.cuit) {
        doc.text(`CUIT: ${mov.cuit}`, leftColumn + 8, clientY + 38);
      }

      // Datos del Recibo
      let detailY = clientY + 70;
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#8e4785').text('Detalle del Movimiento', leftColumn, detailY);

      // Concepto y Monto
      const conceptoStr = mov.numero_comprobante ? mov.numero_comprobante : (esAjuste ? 'Ajuste de saldo de cuenta corriente' : 'Pago recibido - Cuenta Corriente');
      const conceptoHeight = doc.heightOfString(conceptoStr, { width: contentWidth - 140 });

      // Recuadro de detalles (altura dinámica)
      let tableTop = detailY + 16;
      let tableHeight = Math.max(90, 64 + conceptoHeight);
      doc.save();
      doc.rect(leftColumn, tableTop, contentWidth, tableHeight).fillColor('#ffffff').fill();
      doc.rect(leftColumn, tableTop, contentWidth, tableHeight).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
      doc.restore();

      // Cabecera de la tabla
      doc.save();
      doc.rect(leftColumn, tableTop, contentWidth, 18).fillColor('#8e4785').fill();
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#ffffff');
      doc.text('Concepto / Razón del Movimiento', leftColumn + 8, tableTop + 5);
      doc.text('Monto', pageWidth - leftColumn - 108, tableTop + 5, { width: 100, align: 'right' });
      doc.restore();

      let rowY = tableTop + 24;
      doc.fontSize(9).font('Helvetica').fillColor('#1e293b').text(conceptoStr, leftColumn + 8, rowY, { width: contentWidth - 140 });

      const formatCurrency = (val) => {
        return new Intl.NumberFormat('es-AR', {
          style: 'currency',
          currency: 'ARS'
        }).format(val);
      };
      const montoVal = parseFloat(mov.haber) > 0 ? parseFloat(mov.haber) : parseFloat(mov.debe);
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#16a34a').text(formatCurrency(montoVal), pageWidth - leftColumn - 108, rowY, { width: 100, align: 'right' });

      // Métodos de pago (si existen metadatos) con posicionamiento dinámico para evitar solapamientos
      let metaY = rowY + Math.max(conceptoHeight + 8, 30);
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#64748b').text('INFORMACIÓN DE COBRO:', leftColumn + 8, metaY);
      let metaText = 'Forma de cobro: Efectivo';
      if (mov.metadatos) {
        const meta = typeof mov.metadatos === 'string' ? JSON.parse(mov.metadatos) : mov.metadatos;
        const tipoPago = meta.tipo_pago || 'Transferencia';
        metaText = `Forma de cobro: ${tipoPago}`;
        if (meta.banco_origen) metaText += ` | Banco de origen: ${meta.banco_origen}`;
        if (meta.nro_operacion) metaText += ` | Operación Nro: ${meta.nro_operacion}`;
      }
      doc.fontSize(8).font('Helvetica').fillColor('#475569').text(metaText, leftColumn + 8, metaY + 10);

      // Totales
      let totalsY = tableTop + tableHeight + 16;
      doc.save();
      doc.rect(pageWidth - leftColumn - 180, totalsY, 180, 48).fillColor('#f1f5f9').fill();
      doc.rect(pageWidth - leftColumn - 180, totalsY, 180, 48).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
      doc.restore();

      doc.fontSize(8).font('Helvetica-Bold').fillColor('#475569').text('SALDO DE CUENTA RESULTANTE', pageWidth - leftColumn - 172, totalsY + 8);
      doc.fontSize(13).font('Helvetica-Bold').fillColor('#1e293b').text(formatCurrency(parseFloat(mov.saldo)), pageWidth - leftColumn - 172, totalsY + 22, { width: 164, align: 'left' });

      // Footer
      let footerY = totalsY + 80;
      doc.fontSize(7).font('Helvetica-Oblique').fillColor('#64748b').text(
        'Este documento sirve como constancia oficial de recepción de fondos en el sistema administrativo de la distribuidora. Generado desde el Portal de Clientes B2B.',
        leftColumn,
        footerY,
        { align: 'center', width: contentWidth }
      );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

async function sincronizarB2BCuentas() {
  let localClient;

  try {
    // 1. Obtener movimientos de cuenta corriente de la base de datos local
    localClient = await localPool.connect();
    console.log('🔍 Consultando movimientos contables en base de datos local...');
    
    const localQuery = `
      SELECT 
          m.id as local_movimiento_id,
          cc.codigo_bunker_cliente as cliente_id,
          m.fecha_movimiento::date as fecha,
          m.comprobante_id,
          bc.razon_social,
          bc.cuit_cuil AS cuit,
          m.fecha_movimiento AS fecha_registro,
          m.tipo_comprobante AS tipo_comprobante_original,
          CASE 
              WHEN m.tipo_comprobante IN ('FACTURA', 'FACTURA_A') THEN 'FC'
              WHEN m.tipo_comprobante = 'NOTA_CREDITO' THEN 'NC'
              WHEN m.tipo_comprobante = 'NOTA_DEBITO' THEN 'ND'
              WHEN m.tipo_comprobante IN ('RECIBO', 'RECIBO_PAGO', 'COBRO_BANCARIO', 'COBRO_CHEQUE') THEN 'RC'
              ELSE 'OT'
          END as tipo_comprobante,
          COALESCE(m.descripcion, '') as numero_comprobante,
          CASE WHEN m.tipo_movimiento = 'DEBITO' THEN m.monto ELSE 0.00 END as debe,
          CASE WHEN m.tipo_movimiento = 'CREDITO' THEN m.monto ELSE 0.00 END as haber,
          m.saldo_resultante as saldo,
          m.metadatos
      FROM public.factura_cuenta_corriente_movimientos m
      JOIN public.factura_cuentas_corrientes cc ON cc.id = m.cuenta_corriente_id
      LEFT JOIN public.bunker_clientes bc ON bc.codigo_bunker_cliente = cc.codigo_bunker_cliente
      ORDER BY cc.codigo_bunker_cliente, m.fecha_movimiento ASC, m.id ASC;
    `;
    
    const resLocal = await localClient.query(localQuery);
    const totalMovimientos = resLocal.rows.length;
    console.log(`📊 Movimientos contables encontrados localmente: ${totalMovimientos}`);
    
    if (totalMovimientos === 0) {
      console.log('ℹ️ No hay movimientos para sincronizar.');
      return;
    }

    // Procesar PDFs y subirlos a Supabase Storage antes del Upsert en base de datos
    console.log('⚡ Procesando y asegurando comprobantes PDF en Supabase Storage...');
    const payloads = [];

    for (let i = 0; i < resLocal.rows.length; i++) {
      const row = resLocal.rows[i];
      const debeVal = parseFloat(row.debe);
      const haberVal = parseFloat(row.haber);
      
      // Asegurar metadatos por defecto si vienen nulos para cobros o ajustes
      if (!row.metadatos && ['RECIBO_PAGO', 'COBRO_BANCARIO', 'COBRO_CHEQUE', 'AJUSTE_MANUAL'].includes(row.tipo_comprobante_original)) {
          const defaultTipo = row.tipo_comprobante_original === 'COBRO_BANCARIO' ? 'Transferencia' :
                              row.tipo_comprobante_original === 'COBRO_CHEQUE' ? 'Cheque' :
                              row.tipo_comprobante_original === 'AJUSTE_MANUAL' ? 'Ajuste de Saldo' : 'Efectivo';
          row.metadatos = { tipo_pago: defaultTipo };
      }
      
      let comprobanteUrl = null;
      if (['FC', 'NC', 'ND', 'RC'].includes(row.tipo_comprobante)) {
        const filename = `comprobante_${row.local_movimiento_id}.pdf`;
        comprobanteUrl = `${SUPABASE_URL}/storage/v1/object/public/comprobantes/${filename}`;
        
        try {
          // Verificar si el archivo ya existe en Supabase Storage
          const fileExists = await checkFileExistsInStorage(filename);
          if (!fileExists) {
            console.log(`📥 [PDF-SYNC] El PDF ${filename} no existe en la nube. Generando y subiendo...`);
            
            let pdfBuffer = null;
            if (['FC', 'NC', 'ND'].includes(row.tipo_comprobante) && row.comprobante_id) {
              try {
                const resFact = await fetch(`http://localhost:3004/facturacion/facturas/${row.comprobante_id}/pdf`, {
                  method: 'POST'
                });
                if (resFact.ok) {
                  const arrBuf = await resFact.arrayBuffer();
                  pdfBuffer = Buffer.from(arrBuf);
                } else {
                  console.warn(`⚠️ [PDF-SYNC] No se pudo obtener PDF de facturación (Status: ${resFact.status}) para comprobante local ID ${row.comprobante_id}`);
                }
              } catch (err) {
                console.warn(`⚠️ [PDF-SYNC] Error conectando a facturación en puerto 3004: ${err.message}`);
              }
            } else if (row.tipo_comprobante === 'RC') {
              try {
                pdfBuffer = await generarComprobantePdfBuffer(row);
              } catch (err) {
                console.error(`❌ [PDF-SYNC] Error generando recibo PDF local para ID ${row.local_movimiento_id}:`, err.message);
              }
            }
            
            // Subir a Supabase Storage si tenemos buffer
            if (pdfBuffer) {
              await uploadPdfToStorage(filename, pdfBuffer);
              console.log(`✅ [PDF-SYNC] PDF ${filename} subido correctamente a Supabase Storage.`);
            } else {
              console.warn(`⚠️ [PDF-SYNC] No se generó buffer para comprobante ${filename}. Se omitirá el enlace de descarga.`);
              comprobanteUrl = null;
            }
          }
        } catch (err) {
          console.error(`❌ [PDF-SYNC] Error al procesar PDF para movimiento ID ${row.local_movimiento_id}:`, err.message);
        }
      }
      
      payloads.push({
        local_movimiento_id: parseInt(row.local_movimiento_id),
        cliente_id: String(row.cliente_id).trim(),
        fecha: row.fecha,
        tipo_comprobante: row.tipo_comprobante,
        numero_comprobante: row.numero_comprobante.trim().substring(0, 255),
        debe: debeVal,
        haber: haberVal,
        saldo: parseFloat(row.saldo),
        comprobante_url: comprobanteUrl,
        metadatos: row.metadatos
      });
    }

    // 2. Enviar movimientos a Supabase en lotes (batching de 50 registros)
    const batchSize = 50;
    let upsertados = 0;
    
    console.log('🚀 Iniciando subida de lotes a Supabase (Upsert)...');
    
    for (let i = 0; i < payloads.length; i += batchSize) {
      const batch = payloads.slice(i, i + batchSize);
      
      const url = `${SUPABASE_URL}/rest/v1/clientes_b2b_cuentas_corrientes?on_conflict=local_movimiento_id`;
      const options = {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(batch)
      };

      await fetchWithRetry(url, options);
      upsertados += batch.length;
      console.log(`🔄 Sincronizados ${upsertados}/${totalMovimientos} movimientos contables...`);
    }

    // ===== 3) Limpieza de Movimientos Huérfanos =====
    console.log('🔍 Buscando movimientos huérfanos en Supabase para su depuración...');
    try {
      const activeLocalIds = new Set(resLocal.rows.map(row => parseInt(row.local_movimiento_id)));
      
      const getUrl = `${SUPABASE_URL}/rest/v1/clientes_b2b_cuentas_corrientes?select=local_movimiento_id`;
      const getOptions = {
        method: 'GET',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      };
      
      const resSup = await fetchWithRetry(getUrl, getOptions);
      const supData = await resSup.json();
      
      const orphanIds = supData
        .map(row => parseInt(row.local_movimiento_id))
        .filter(id => !isNaN(id) && !activeLocalIds.has(id));
        
      if (orphanIds.length > 0) {
        console.log(`🗑️ Se detectaron ${orphanIds.length} movimientos huérfanos en Supabase. Eliminando de la nube...`);
        const deleteBatchSize = 100;
        for (let i = 0; i < orphanIds.length; i += deleteBatchSize) {
          const batchDelete = orphanIds.slice(i, i + deleteBatchSize);
          const deleteUrl = `${SUPABASE_URL}/rest/v1/clientes_b2b_cuentas_corrientes?local_movimiento_id=in.(${batchDelete.join(',')})`;
          const deleteOptions = {
            method: 'DELETE',
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`
            }
          };
          await fetchWithRetry(deleteUrl, deleteOptions);
        }
        console.log(`✅ Eliminación de ${orphanIds.length} movimientos huérfanos completada.`);
      } else {
        console.log('✅ No se detectaron movimientos huérfanos en la nube (Base de Datos sincronizada).');
      }
    } catch (err) {
      console.error('⚠️ [SYNC-CLEANUP] Error al depurar movimientos huérfanos:', err.message);
    }

    console.log('✅ Sincronización de cuenta corriente completada exitosamente.');
    
  } catch (error) {
    console.error('❌ Error durante la sincronización de cuenta corriente B2B:', error.message);
    process.exitCode = 1;
  } finally {
    if (localClient) {
      localClient.release();
    }
  }
}

sincronizarB2BCuentas()
  .catch(error => {
    console.error('💥 Error fatal en sincronización de cuenta corriente B2B:', error);
    process.exitCode = 1;
  });
