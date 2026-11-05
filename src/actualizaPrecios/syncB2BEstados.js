// filepath: src/actualizaPrecios/syncB2BEstados.js
'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');

// ===== 1) Conexión a la Base de Datos Local =====
const localPool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'etiquetas',
  password: process.env.DB_PASSWORD || 'ta3Mionga',
  port: parseInt(process.env.DB_PORT || '5432'),
});

console.log('═══════════════════════════════════════════════════════');
console.log('📡 [SYNC-B2B-ESTADOS] SINCRONIZADOR UNIFICADO DE PEDIDOS Y ESTADOS B2B');
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
      
      if (response.ok || response.status === 400) {
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
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }
  throw new Error(`Agotados los ${retries} reintentos de conexión con Supabase.`);
}

function mapLocalStatusToSupabase(row) {
  const estadoLogistico = (row.estado_logistico || '').toUpperCase().trim();
  const secuencia = (row.secuencia || '').toLowerCase().trim();
  const informeGenerado = (row.informe_generado || '').toLowerCase().trim();
  const estadoComprobante = (row.estado || '').toUpperCase().trim();

  // Estado Anulado / Baja lógica
  if (row.activo === false || ['ANULADO', 'ANULADO POR EL CLIENTE', 'CANCELADO'].includes(estadoComprobante)) {
    return 'Cancelado';
  }

  // Estado 5: Entregado
  if (
    estadoLogistico === 'ENTREGADO' || 
    estadoLogistico === 'ENTREGADO_DEPOSITO' || 
    estadoComprobante === 'ENTREGADO' || 
    estadoComprobante === 'CONCILIADO'
  ) {
    return 'Entregado';
  }
  
  // Estado 4: Logística (Reparto/Retiro)
  if (estadoLogistico === 'EN_CAMINO' || estadoLogistico === 'ASIGNADO' || estadoLogistico === 'EN REPARTO') {
    return 'En ruta';
  }
  if (estadoLogistico === 'ESPERANDO_MOSTRADOR') {
    return 'Listo para retirar';
  }
  
  // Estado 3: Listo para Entregar (Controlado / Facturado)
  if (
    secuencia === 'pedido_listo' || 
    estadoComprobante === 'FACTURADO' || 
    estadoComprobante === 'ENVIADO A FACTURACIÓN'
  ) {
    return 'Listo para Entregar';
  }
  
  // Estado 2: En Proceso / Producción (Impreso o en Armado)
  if (secuencia === 'armar_pedido' || informeGenerado === 'generado' || secuencia === 'imprimir_modificado') {
    return 'En Proceso';
  }

  // Estado Standby: Sin Confirmar / En espera de confirmación
  if (secuencia === 'standby' || estadoComprobante === 'SIN CONFIRMAR' || estadoComprobante === 'STANDBY') {
    return 'Standby';
  }

  // Estado 1: Ingresado
  return 'En Preparacion';
}

async function actualizarEstadoSupabase(id, estado, facturado) {
  try {
    const url = `${SUPABASE_URL}/rest/v1/clientes_b2b_pedidos_cabecera?id=eq.${id}`;
    const bodyPayload = {
      estado: estado,
      updated_at: new Date().toISOString()
    };
    if (facturado !== undefined) {
      bodyPayload.facturado = facturado;
    }
    
    const options = {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(bodyPayload)
    };
    
    await fetchWithRetry(url, options);
    console.log(`☁️  [Supabase] Pedido ${id.slice(0, 8)} actualizado a estado: [${estado}]` + (facturado !== undefined ? `, facturado: [${facturado}]` : ''));
  } catch (err) {
    console.error(`❌ Error al actualizar estado/facturación del pedido ${id.slice(0, 8)} en Supabase:`, err.message);
  }
}

async function actualizarMontosSupabase(id, total, subtotal, iva) {
  try {
    const url = `${SUPABASE_URL}/rest/v1/clientes_b2b_pedidos_cabecera?id=eq.${id}`;
    const bodyPayload = {
      total: parseFloat(total.toFixed(2)),
      subtotal: parseFloat(subtotal.toFixed(2)),
      iva: parseFloat(iva.toFixed(2)),
      updated_at: new Date().toISOString()
    };
    
    const options = {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(bodyPayload)
    };
    
    await fetchWithRetry(url, options);
    console.log(`☁️  [Supabase-Espejo] Pedido ${id.slice(0, 8)} actualizado: Total: $${bodyPayload.total}, Subtotal (Neto): $${bodyPayload.subtotal}, IVA: $${bodyPayload.iva}`);
  } catch (err) {
    console.error(`❌ Error al actualizar montos del pedido ${id.slice(0, 8)} en Supabase:`, err.message);
  }
}

async function actualizarItemsSupabase(localClient, supabasePedidoId, localPresupuestoId) {
  try {
    // 1. Obtener líneas locales vigentes del presupuesto
    const resLines = await localClient.query(
      `SELECT d.articulo as producto_codigo, 
              COALESCE(ba.descripcion_generada, ba.descripcion, a.nombre, d.articulo) as producto_descripcion, 
              d.cantidad, d.precio1 as precio_unitario, (d.cantidad * d.precio1) as subtotal
       FROM public.presupuestos_detalles d
       LEFT JOIN public.articulos a ON a.codigo_barras = d.articulo OR a.numero = d.articulo
       LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = a.numero
       WHERE d.id_presupuesto = $1`,
      [localPresupuestoId]
    );

    if (resLines.rows.length === 0) return;

    // 2. Eliminar ítems anteriores en Supabase Cloud
    const deleteUrl = `${SUPABASE_URL}/rest/v1/clientes_b2b_pedidos_items?pedido_id=eq.${supabasePedidoId}`;
    await fetchWithRetry(deleteUrl, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });

    // 3. Insertar las nuevas líneas locales en Supabase Cloud
    const insertPayload = resLines.rows.map(row => ({
      pedido_id: supabasePedidoId,
      producto_codigo: String(row.producto_codigo).trim(),
      producto_descripcion: String(row.producto_descripcion).trim(),
      cantidad: parseFloat(row.cantidad),
      precio_unitario: parseFloat(row.precio_unitario),
      subtotal: parseFloat(row.subtotal)
    }));

    const insertUrl = `${SUPABASE_URL}/rest/v1/clientes_b2b_pedidos_items`;
    await fetchWithRetry(insertUrl, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(insertPayload)
    });
    console.log(`☁️  [Supabase-Espejo] Líneas de pedido ${supabasePedidoId.slice(0, 8)} resincronizadas con éxito (Count: ${insertPayload.length}).`);
  } catch (err) {
    console.error(`❌ Error al resincronizar líneas del pedido ${supabasePedidoId.slice(0, 8)} en Supabase:`, err.message);
  }
}

async function procesarReclamoCliente(localClient, pedidoSupa, localId) {
  try {
    // 1. Obtener detalles de ítems de Supabase para ver qué se reportó con discrepancias
    const selectItemsUrl = `${SUPABASE_URL}/rest/v1/clientes_b2b_pedidos_items?pedido_id=eq.${pedidoSupa.id}`;
    const itemsRes = await fetchWithRetry(selectItemsUrl, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    const itemsSupa = await itemsRes.json();
    
    // Generar resumen textual del reclamo
    let summaryLines = [];
    for (const item of itemsSupa) {
      if (item.cantidad_recibida !== null && parseFloat(item.cantidad_recibida) < parseFloat(item.cantidad)) {
        const qtyDiff = parseFloat(item.cantidad) - parseFloat(item.cantidad_recibida);
        summaryLines.push(`• Art. ${item.producto_codigo} (${item.producto_descripcion}): Recibido ${parseFloat(item.cantidad_recibida)} de ${parseFloat(item.cantidad)} [Discrepancia: ${qtyDiff}u] - Motivo: ${item.motivo_incidencia || 'No especificado'}${item.comentarios ? ` (${item.comentarios})` : ''}`);
      }
    }
    
    const itemsSummary = summaryLines.join('\n');
    let observacionesCombined = `[RECLAMO RECEPCION] Receptor: ${pedidoSupa.recibido_por_nombre || 'Cliente'} ${pedidoSupa.recibido_por_apellido || ''}\n${itemsSummary}`;
    if (pedidoSupa.comentarios_recepcion) {
      observacionesCombined += `\nComentario Global: ${pedidoSupa.comentarios_recepcion}`;
    }

    // 2. Procesar fotos Base64 si existen
    const fs = require('fs');
    const path = require('path');
    const uploadsDir = path.join(__dirname, '..', 'logistica', 'public', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    let localFoto1Url = null;
    let localFoto2Url = null;

    if (pedidoSupa.foto_reclamo_1) {
      try {
        const base64Clean = pedidoSupa.foto_reclamo_1.replace(/^data:image\/\w+;base64,/, "");
        const filename = `reclamo_${localId}_1.jpg`;
        const filepath = path.join(uploadsDir, filename);
        fs.writeFileSync(filepath, base64Clean, 'base64');
        localFoto1Url = `/public/uploads/${filename}`;
        console.log(`📸 [B2B-RECLAMO] Guardada foto 1 en: ${filepath}`);
      } catch (err) {
        console.error('⚠️ Error guardando foto 1 de reclamo:', err.message);
      }
    }

    if (pedidoSupa.foto_reclamo_2) {
      try {
        const base64Clean = pedidoSupa.foto_reclamo_2.replace(/^data:image\/\w+;base64,/, "");
        const filename = `reclamo_${localId}_2.jpg`;
        const filepath = path.join(uploadsDir, filename);
        fs.writeFileSync(filepath, base64Clean, 'base64');
        localFoto2Url = `/public/uploads/${filename}`;
        console.log(`📸 [B2B-RECLAMO] Guardada foto 2 en: ${filepath}`);
      } catch (err) {
        console.error('⚠️ Error guardando foto 2 de reclamo:', err.message);
      }
    }

    // 3. Registrar en public.entregas_eventos
    await localClient.query(
      `INSERT INTO public.entregas_eventos 
       (id_presupuesto, receptor_nombre, receptor_vinculo, dni_receptor,
        foto_conformidad_url, latitud_confirmacion, longitud_confirmacion,
        firma_digital, fecha_entrega, observaciones, tipo_evento, motivo_incidencia)
       VALUES ($1, $2, 'Cliente (Reclamo)', $3, $4, null, null, null, NOW(), $5, 'RECLAMO_RECEPCION', $6)`,
      [
        localId,
        pedidoSupa.recibido_por_nombre || 'Cliente',
        pedidoSupa.recibido_por_telefono || null,
        localFoto1Url,
        observacionesCombined + (localFoto2Url ? `\nFoto 2: ${localFoto2Url}` : ''),
        pedidoSupa.motivo_reclamo_recepcion || 'Reclamo'
      ]
    );

    // 4. Actualizar public.presupuestos para asentar la cucarda y observaciones
    const badgeText = `Reclamo: ${pedidoSupa.motivo_reclamo_recepcion || 'Novedad'}`;
    const notaAppend = `[Reclamo Cliente]: ${pedidoSupa.comentarios_recepcion || 'Ver detalles del reclamo en eventos.'}`;
    
    await localClient.query(
      `UPDATE public.presupuestos 
       SET motivo_no_entrega = $1,
           estado_logistico = 'PENDIENTE_ASIGNAR', -- Reingresa al pool de pendientes
           secuencia = 'Pedido_Listo',
           nota = CASE 
               WHEN nota IS NULL OR TRIM(nota) = '' THEN $2
               ELSE nota || ' | ' || $2
           END,
           fecha_actualizacion = NOW()
       WHERE id = $3`,
      [badgeText, notaAppend, localId]
    );

    console.log(`✅ [B2B-RECLAMO] Reclamo del Pedido Local #${localId} procesado con éxito en la central.`);
  } catch (err) {
    console.error(`❌ Error al procesar reclamo del pedido ${pedidoSupa.id.slice(0, 8)}:`, err.message);
  }
}

async function asegurarClienteSombra(db, idClienteRaw) {
  const idCliente = String(idClienteRaw).trim();
  if (!idCliente) return null;

  try {
    // 1. Verificar si ya existe en bunker_clientes
    const checkRes = await db.query(
      `SELECT codigo_bunker_cliente FROM public.bunker_clientes 
       WHERE lomas_soft_id = $1 
          OR (lomas_soft_id ~ '^[0-9]+$' AND $1 ~ '^[0-9]+$' AND lomas_soft_id::integer = $1::integer)
       LIMIT 1`,
      [idCliente]
    );

    if (checkRes.rows.length > 0) {
      return checkRes.rows[0].codigo_bunker_cliente;
    }

    // 2. No existe. Buscar datos en public.clientes (maestreo legacy)
    const legacyRes = await db.query(
      `SELECT nombre, cuit, email FROM public.clientes 
       WHERE cliente_id::text = $1 
          OR (cliente_id::text ~ '^[0-9]+$' AND $1 ~ '^[0-9]+$' AND cliente_id::integer = $1::integer)
       LIMIT 1`,
      [idCliente]
    );

    let nombre = `Cliente Sombra ${idCliente}`;
    let cuit = null;
    let email = null;

    if (legacyRes.rows.length > 0) {
      const lCli = legacyRes.rows[0];
      nombre = lCli.nombre || nombre;
      cuit = lCli.cuit ? lCli.cuit.replace(/[^0-9]/g, '') : null;
      email = lCli.email || null;
    }

    // 3. Generar siguiente código secuencial CB-XXXX
    const maxRes = await db.query(`
      SELECT MAX(CAST(SUBSTRING(codigo_bunker_cliente FROM 4) AS INTEGER)) as max_val 
      FROM public.bunker_clientes 
      WHERE codigo_bunker_cliente LIKE 'CB-%'
    `);
    const maxVal = maxRes.rows[0].max_val ? parseInt(maxRes.rows[0].max_val, 10) : 0;
    const nextVal = maxVal + 1;
    const nextCodigo = `CB-${nextVal.toString().padStart(4, '0')}`;

    // 4. Insertar cliente sombra
    console.log(`👤 [SYNC-SOMBRA] Creando cliente sombra local: ${nextCodigo} para Lomassoft ID: ${idCliente}`);
    await db.query(
      `INSERT INTO public.bunker_clientes (
          codigo_bunker_cliente, cliente_nombre, razon_social, lomas_soft_id, 
          cuit_cuil, canal_envio_preferido, email_portal, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
      [nextCodigo, nombre, nombre, idCliente, cuit, 'whatsapp', email]
    );

    return nextCodigo;
  } catch (err) {
    console.error(`❌ [SYNC-SOMBRA] Error al asegurar cliente sombra para ${idCliente}:`, err.message);
    return null;
  }
}

async function subirPedidoEspecifico(localClient, idLocal) {
  try {
    // 1. Validar si ya está mapeado
    const checkMap = await localClient.query(
      `SELECT supabase_pedido_id FROM public.b2b_pedidos_mapeo WHERE local_presupuesto_id = $1 LIMIT 1`,
      [idLocal]
    );
    if (checkMap.rows.length > 0) {
      return checkMap.rows[0].supabase_pedido_id;
    }

    // 2. Buscar datos de presupuesto
    const resPres = await localClient.query(`
      SELECT 
          p.id,
          p.id_cliente,
          p.fecha,
          p.nota,
          p.estado,
          p.secuencia,
          p.informe_generado,
          p.estado_logistico,
          p.descuento,
          p.id_presupuesto_ext,
          EXISTS (
              SELECT 1 FROM public.factura_facturas f 
              WHERE f.presupuesto_id = p.id AND f.estado IN ('APROBADA', 'APROBADA_LOCAL')
          ) as esta_facturado
      FROM public.presupuestos p
      WHERE p.id = $1 AND p.activo = true
    `, [idLocal]);

    if (resPres.rows.length === 0) {
      console.warn(`⚠️ [SYNC-SINGLE] El presupuesto #${idLocal} no existe o está inactivo.`);
      return null;
    }

    const row = resPres.rows[0];

    // 3. Asegurar cliente sombra
    const codigoBunkerCliente = await asegurarClienteSombra(localClient, row.id_cliente);
    if (!codigoBunkerCliente) {
      throw new Error(`No se pudo resolver o crear un código de cliente búnker para el cliente ${row.id_cliente}`);
    }

    // 4. Detalles
    const sqlDetalles = `
      SELECT 
          pd.id,
          pd.articulo,
          pd.cantidad,
          pd.valor1,
          pd.precio1,
          pd.camp2,
          COALESCE(ba.descripcion_generada, ba.descripcion, a.nombre, pd.articulo) as producto_descripcion
      FROM public.presupuestos_detalles pd
      LEFT JOIN public.articulos a ON a.codigo_barras = pd.articulo OR a.numero = pd.articulo
      LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = a.numero
      WHERE pd.id_presupuesto = $1
    `;
    const resDet = await localClient.query(sqlDetalles, [row.id]);
    if (resDet.rows.length === 0) {
      console.warn(`⚠️ [SYNC-SINGLE] El presupuesto #${idLocal} no tiene detalles. Se omite.`);
      return null;
    }

    // Calcular importes
    let subtotalNeto = 0;
    let totalIva = 0;
    const itemsLocal = resDet.rows;
    const newSupaId = crypto.randomUUID();

    let discountRate = 0;
    const rawDesc = parseFloat(row.descuento || 0);
    if (rawDesc > 0) {
      if (rawDesc < 1) {
        discountRate = rawDesc;
      } else {
        discountRate = rawDesc / 100;
      }
    }

    const itemsPayload = itemsLocal.map(item => {
      const qty = parseFloat(item.cantidad || 0);
      let alicDec = parseFloat(item.camp2 || 0);
      if (alicDec > 1) alicDec = alicDec / 100;
      
      let netUnitPrice = parseFloat(item.valor1 || 0);
      if (netUnitPrice === 0 && item.precio1) {
        netUnitPrice = parseFloat(item.precio1) / (1 + alicDec);
      }
      
      const lineNetTotal = qty * netUnitPrice;
      const lineIva = lineNetTotal * (1 - discountRate) * alicDec;
      
      subtotalNeto += lineNetTotal;
      totalIva += lineIva;
      
      const grossUnitPrice = netUnitPrice * (1 + alicDec);
      const lineGrossTotal = qty * grossUnitPrice;

      return {
        id: crypto.randomUUID(),
        pedido_id: newSupaId,
        producto_codigo: item.articulo,
        producto_descripcion: item.producto_descripcion,
        cantidad: qty,
        precio_unitario: parseFloat(grossUnitPrice.toFixed(2)),
        subtotal: parseFloat(lineGrossTotal.toFixed(2))
      };
    });

    const netDescuento = subtotalNeto * discountRate;
    const totalFinal = subtotalNeto - netDescuento + totalIva;

    const baseNota = row.nota ? String(row.nota).trim() : '';
    const metaTag = `[REF:${row.id_presupuesto_ext || ''}][LOCAL:${row.id}]`;
    const finalObs = baseNota ? `${baseNota} ${metaTag}` : metaTag;

    const cabeceraPayload = {
      id: newSupaId,
      cliente_id: codigoBunkerCliente,
      fecha_pedido: new Date(row.fecha).toISOString(),
      estado: mapLocalStatusToSupabase(row),
      subtotal: parseFloat(subtotalNeto.toFixed(2)),
      descuento: parseFloat(netDescuento.toFixed(2)),
      iva: parseFloat(totalIva.toFixed(2)),
      total: parseFloat(totalFinal.toFixed(2)),
      observaciones: finalObs,
      sync_estado: 'Sincronizado',
      facturado: row.esta_facturado || false
    };

    // Subir a Supabase
    const urlCabecera = `${SUPABASE_URL}/rest/v1/clientes_b2b_pedidos_cabecera`;
    await fetchWithRetry(urlCabecera, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(cabeceraPayload)
    });

    const urlItems = `${SUPABASE_URL}/rest/v1/clientes_b2b_pedidos_items`;
    await fetchWithRetry(urlItems, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(itemsPayload)
    });

    // Mapeo local
    await localClient.query(
      `INSERT INTO public.b2b_pedidos_mapeo (local_presupuesto_id, supabase_pedido_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [row.id, newSupaId]
    );

    console.log(`✅ [SYNC-SINGLE] Sincronizado on-the-fly Pedido Local #${row.id} -> Supabase UUID: ${newSupaId}`);
    return newSupaId;
  } catch (err) {
    console.error(`❌ [SYNC-SINGLE] Error al sincronizar on-the-fly pedido #${idLocal}:`, err.message);
    return null;
  }
}

async function subirPedidosLocales(localClient) {
  console.log('🔄 Fase 1: Buscando pedidos manuales locales pendientes de sincronización...');
  
  // Buscar presupuestos creados en los últimos 30 días, activos, de clientes B2B,
  // que no estén en la tabla de mapeo ni tengan un UUID en id_presupuesto_ext.
  // NOTA: Se cambia JOIN a LEFT JOIN para incluir a clientes sin ficha búnker y pre-crearles ficha sombra.
  const sqlBuscarLocales = `
    SELECT 
        p.id,
        p.id_cliente,
        p.fecha,
        p.nota,
        p.estado,
        p.secuencia,
        p.informe_generado,
        p.estado_logistico,
        p.descuento,
        p.id_presupuesto_ext,
        bc.codigo_bunker_cliente,
        EXISTS (
            SELECT 1 FROM public.factura_facturas f 
            WHERE f.presupuesto_id = p.id AND f.estado IN ('APROBADA', 'APROBADA_LOCAL')
        ) as esta_facturado
    FROM public.presupuestos p
    LEFT JOIN public.bunker_clientes bc ON bc.lomas_soft_id = TRIM(p.id_cliente) OR (bc.lomas_soft_id ~ '^[0-9]+$' AND p.id_cliente ~ '^[0-9]+$' AND bc.lomas_soft_id::integer = p.id_cliente::integer)
    LEFT JOIN public.b2b_pedidos_mapeo m ON m.local_presupuesto_id = p.id
    WHERE p.activo = true 
      AND m.local_presupuesto_id IS NULL
      AND (p.id_presupuesto_ext IS NULL OR p.id_presupuesto_ext !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      AND p.fecha >= NOW() - INTERVAL '30 days'
      AND p.tipo_comprobante != 'Orden de Retiro'
  `;
  
  const resLocales = await localClient.query(sqlBuscarLocales);
  console.log(`📊 Pedidos locales calificados encontrados: ${resLocales.rows.length}`);
  
  for (const row of resLocales.rows) {
    // Asegurar cliente sombra si no está en la base búnker
    const codigoBunkerCliente = row.codigo_bunker_cliente || await asegurarClienteSombra(localClient, row.id_cliente);
    if (!codigoBunkerCliente) {
      console.warn(`⚠️ Omitiendo Pedido Local #${row.id}: no se pudo resolver un código de cliente.`);
      continue;
    }

    console.log(`⚙️ Procesando Pedido Local #${row.id} para Cliente Búnker ${codigoBunkerCliente} (ID Legacy: ${row.id_cliente})...`);
    
    // Obtener los detalles del pedido local cruzando con la tabla articulos local y bunker_articulos
    const sqlDetalles = `
      SELECT 
          pd.id,
          pd.articulo,
          pd.cantidad,
          pd.valor1,
          pd.precio1,
          pd.camp2,
          COALESCE(ba.descripcion_generada, ba.descripcion, a.nombre, pd.articulo) as producto_descripcion
      FROM public.presupuestos_detalles pd
      LEFT JOIN public.articulos a ON a.codigo_barras = pd.articulo OR a.numero = pd.articulo
      LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = a.numero
      WHERE pd.id_presupuesto = $1
    `;
    
    const resDetalles = await localClient.query(sqlDetalles, [row.id]);
    
    if (resDetalles.rows.length === 0) {
      console.warn(`⚠️ Advertencia: El pedido local #${row.id} no tiene ítems de detalle. Se omite.`);
      continue;
    }
    
    let subtotalNeto = 0;
    let totalIva = 0;
    const itemsLocal = resDetalles.rows;
    const newSupaId = crypto.randomUUID();

    // Fix the discount percentage parsing bug: if it's 0.05 treat as 5%, not 0.05%
    let discountRate = 0;
    const rawDesc = parseFloat(row.descuento || 0);
    if (rawDesc > 0) {
      if (rawDesc < 1) {
        discountRate = rawDesc;
      } else {
        discountRate = rawDesc / 100;
      }
    }
    
    const itemsPayload = itemsLocal.map(item => {
      const qty = parseFloat(item.cantidad || 0);
      let alicDec = parseFloat(item.camp2 || 0);
      if (alicDec > 1) {
        alicDec = alicDec / 100;
      }
      
      let netUnitPrice = parseFloat(item.valor1 || 0);
      if (netUnitPrice === 0 && item.precio1) {
        netUnitPrice = parseFloat(item.precio1) / (1 + alicDec);
      }
      
      const lineNetTotal = qty * netUnitPrice;
      const lineIva = lineNetTotal * (1 - discountRate) * alicDec;
      
      subtotalNeto += lineNetTotal;
      totalIva += lineIva;
      
      const grossUnitPrice = netUnitPrice * (1 + alicDec);
      const lineGrossTotal = qty * grossUnitPrice;

      return {
        id: crypto.randomUUID(),
        pedido_id: newSupaId,
        producto_codigo: item.articulo,
        producto_descripcion: item.producto_descripcion,
        cantidad: qty,
        precio_unitario: parseFloat(grossUnitPrice.toFixed(2)),
        subtotal: parseFloat(lineGrossTotal.toFixed(2))
      };
    });
    
    const netDescuento = subtotalNeto * discountRate;
    const totalFinal = subtotalNeto - netDescuento + totalIva;
    
    const cabeceraPayload = {
      id: newSupaId,
      cliente_id: codigoBunkerCliente,
      fecha_pedido: new Date(row.fecha).toISOString(),
      estado: mapLocalStatusToSupabase(row),
      subtotal: parseFloat(subtotalNeto.toFixed(2)),
      descuento: parseFloat(netDescuento.toFixed(2)),
      iva: parseFloat(totalIva.toFixed(2)),
      total: parseFloat(totalFinal.toFixed(2)),
      observaciones: row.nota ? String(row.nota).trim() : null,
      sync_estado: 'Sincronizado',
      facturado: row.esta_facturado || false
    };
    
    try {
      // Subir Cabecera
      const urlCabecera = `${SUPABASE_URL}/rest/v1/clientes_b2b_pedidos_cabecera`;
      await fetchWithRetry(urlCabecera, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(cabeceraPayload)
      });
      
      // Subir ítems
      const urlItems = `${SUPABASE_URL}/rest/v1/clientes_b2b_pedidos_items`;
      await fetchWithRetry(urlItems, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(itemsPayload)
      });
      
      // Registrar la asociación en la tabla de mapeo local
      await localClient.query(
        `INSERT INTO public.b2b_pedidos_mapeo (local_presupuesto_id, supabase_pedido_id) VALUES ($1, $2)`,
        [row.id, newSupaId]
      );
      
      console.log(`✅ Sincronizado exitosamente Pedido Local #${row.id} a Supabase con UUID: ${newSupaId.slice(0, 8)}`);
      
    } catch (err) {
      console.error(`❌ Error al subir el pedido local #${row.id} a Supabase:`, err.message);
    }
  }
}

async function sincronizarEstados() {
  let localClient;
  
  try {
    localClient = await localPool.connect();
    
    // Crear tabla de mapeo local si no existe
    await localClient.query(`
      CREATE TABLE IF NOT EXISTS public.b2b_pedidos_mapeo (
          local_presupuesto_id INTEGER PRIMARY KEY REFERENCES public.presupuestos(id) ON DELETE CASCADE,
          supabase_pedido_id UUID NOT NULL UNIQUE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    
    // Fase 1: Subir pedidos que nacieron localmente y no están en Supabase
    await subirPedidosLocales(localClient);
    
    // Fase 2: Sincronizar estados de pedidos existentes (de local a Supabase)
    console.log('\n🔄 Fase 2: Sincronizando estados de pedidos recientes de Supabase...');
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateStr = thirtyDaysAgo.toISOString();
    
    let selectFields = 'id,estado,facturado,total,subtotal,iva,recibido_por_nombre,recibido_por_apellido,recibido_por_telefono,recibido_fecha,motivo_reclamo_recepcion,foto_reclamo_1,foto_reclamo_2,comentarios_recepcion,reclamado_fecha,entregado_chofer_nombre,entregado_chofer_fecha';
    let url = `${SUPABASE_URL}/rest/v1/clientes_b2b_pedidos_cabecera?created_at=gte.${dateStr}&select=${selectFields}`;
    
    let response;
    let fallbackToNoFacturado = false;
    
    try {
      response = await fetchWithRetry(url, {
        method: 'GET',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      });
      if (!response.ok) {
        const errorText = await response.text();
        if (errorText.includes('facturado') && (errorText.includes('does not exist') || errorText.includes('42703'))) {
          console.warn('⚠️ La columna [facturado] no existe en Supabase. Se requiere aplicar la migración: supabase_migration/12_add_facturado_column_pedidos.sql');
          console.log('🔄 Reintentando sincronización de estados sin campo [facturado] (Compatibilidad Activa)...');
          fallbackToNoFacturado = true;
        } else {
          throw new Error(`HTTP ${response.status} - ${errorText}`);
        }
      }
    } catch (err) {
      if (err.message.includes('facturado') || err.message.includes('HTTP 400') || err.message.includes('42703')) {
        fallbackToNoFacturado = true;
      } else {
        throw err;
      }
    }

    if (fallbackToNoFacturado) {
      selectFields = 'id,estado,total,subtotal,iva,recibido_por_nombre,recibido_por_apellido,recibido_por_telefono,recibido_fecha,motivo_reclamo_recepcion,foto_reclamo_1,foto_reclamo_2,comentarios_recepcion,reclamado_fecha,entregado_chofer_nombre,entregado_chofer_fecha';
      url = `${SUPABASE_URL}/rest/v1/clientes_b2b_pedidos_cabecera?created_at=gte.${dateStr}&select=${selectFields}`;
      response = await fetchWithRetry(url, {
        method: 'GET',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      });
    }

    const pedidosB2B = await response.json();
    console.log(`📊 Pedidos activos encontrados en Supabase: ${pedidosB2B.length}`);

    if (pedidosB2B.length > 0) {
      for (const pedido of pedidosB2B) {
        // Buscar si existe un mapeo en b2b_pedidos_mapeo
        const resMap = await localClient.query(
          `SELECT local_presupuesto_id FROM public.b2b_pedidos_mapeo WHERE supabase_pedido_id = $1 LIMIT 1`,
          [pedido.id]
        );
        
        let resLocal;
        if (resMap.rows.length > 0) {
          // Si hay mapeo, buscar por el ID local primario
          resLocal = await localClient.query(
            `SELECT p.id, p.estado, p.secuencia, p.informe_generado, p.estado_logistico, p.activo, p.archivado,
                    COALESCE(sums.total_bruto, 0) * (1 - (CASE WHEN COALESCE(p.descuento, 0) > 1 THEN p.descuento / 100.0 ELSE COALESCE(p.descuento, 0) END)) as total_local,
                    COALESCE(sums.total_neto, 0) * (1 - (CASE WHEN COALESCE(p.descuento, 0) > 1 THEN p.descuento / 100.0 ELSE COALESCE(p.descuento, 0) END)) as subtotal_local,
                    COALESCE(sums.total_iva, 0) * (1 - (CASE WHEN COALESCE(p.descuento, 0) > 1 THEN p.descuento / 100.0 ELSE COALESCE(p.descuento, 0) END)) as iva_local,
                    EXISTS (
                        SELECT 1 FROM public.factura_facturas f 
                        WHERE f.presupuesto_id = p.id AND f.estado IN ('APROBADA', 'APROBADA_LOCAL')
                    ) as esta_facturado
             FROM public.presupuestos p
             LEFT JOIN (
                 SELECT 
                     id_presupuesto,
                     SUM(cantidad * precio1) as total_bruto,
                     SUM(cantidad * valor1) as total_neto,
                     SUM(cantidad * (precio1 - valor1)) as total_iva
                 FROM public.presupuestos_detalles
                 GROUP BY id_presupuesto
             ) sums ON sums.id_presupuesto = p.id
             WHERE p.id = $1 LIMIT 1`,
            [resMap.rows[0].local_presupuesto_id]
          );
        } else {
          // Si no hay mapeo, buscar por id_presupuesto_ext (pedido que nació en B2B)
          resLocal = await localClient.query(
            `SELECT p.id, p.estado, p.secuencia, p.informe_generado, p.estado_logistico, p.activo, p.archivado,
                    COALESCE(sums.total_bruto, 0) * (1 - (CASE WHEN COALESCE(p.descuento, 0) > 1 THEN p.descuento / 100.0 ELSE COALESCE(p.descuento, 0) END)) as total_local,
                    COALESCE(sums.total_neto, 0) * (1 - (CASE WHEN COALESCE(p.descuento, 0) > 1 THEN p.descuento / 100.0 ELSE COALESCE(p.descuento, 0) END)) as subtotal_local,
                    COALESCE(sums.total_iva, 0) * (1 - (CASE WHEN COALESCE(p.descuento, 0) > 1 THEN p.descuento / 100.0 ELSE COALESCE(p.descuento, 0) END)) as iva_local,
                    EXISTS (
                        SELECT 1 FROM public.factura_facturas f 
                        WHERE f.presupuesto_id = p.id AND f.estado IN ('APROBADA', 'APROBADA_LOCAL')
                    ) as esta_facturado
             FROM public.presupuestos p
             LEFT JOIN (
                 SELECT 
                     id_presupuesto,
                     SUM(cantidad * precio1) as total_bruto,
                     SUM(cantidad * valor1) as total_neto,
                     SUM(cantidad * (precio1 - valor1)) as total_iva
                 FROM public.presupuestos_detalles
                 GROUP BY id_presupuesto
             ) sums ON sums.id_presupuesto = p.id
             WHERE p.id_presupuesto_ext = $1 LIMIT 1`,
            [pedido.id]
          );
        }

        if (resLocal.rows.length === 0) {
          console.log(`⚠️ Pedido B2B ${pedido.id.slice(0, 8)} no encontrado en base de datos local.`);
          if (pedido.estado !== 'Cancelado') {
            console.log(`🔄 Marcando pedido ${pedido.id.slice(0, 8)} como Cancelado en Supabase.`);
            await actualizarEstadoSupabase(pedido.id, 'Cancelado', false);
          }
          continue;
        }

        const row = resLocal.rows[0];

        // CORRECCIÓN MIGRACIÓN EN CALIENTE: Si no existía mapeo previo, insertarlo ahora
        if (resMap.rows.length === 0) {
          try {
            await localClient.query(
              `INSERT INTO public.b2b_pedidos_mapeo (local_presupuesto_id, supabase_pedido_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
              [row.id, pedido.id]
            );
            console.log(`📲 [SYNC-MAP] Mapeo corregido e insertado para Pedido Local #${row.id} ➔ Supabase: ${pedido.id.slice(0, 8)}`);
          } catch (mapErr) {
            console.error('❌ Error al insertar mapeo correctivo:', mapErr.message);
          }
        }

        const localEstado = (row.estado || '').toUpperCase().trim();
        const localMotivo = (row.motivo_no_entrega || '').trim();
        const estadoSupabase = (pedido.estado || '').toUpperCase().trim();

        // Interceptar si el pedido tiene un reclamo asentado en Supabase y no lo hemos procesado localmente
        if (estadoSupabase === 'RECLAMADO' && !localMotivo.startsWith('Reclamo:')) {
          console.log(`⚠️ [B2B-RECLAMO] Reclamo detectado en Supabase para Pedido B2B ${pedido.id.slice(0, 8)} (Local ID: #${row.id}). Descargando auditoría...`);
          await procesarReclamoCliente(localClient, pedido, row.id);
          continue;
        }

        // Si ya está procesado localmente, simplemente lo saltamos para no sobreescribir el estado en Supabase
        if (estadoSupabase === 'RECLAMADO') {
          continue;
        }

        if (estadoSupabase === 'CANCELADO' || estadoSupabase === 'CANCELLED') {
          // Si ya está archivado localmente, simplemente continuamos
          if (row.archivado === true) {
            continue;
          }

          // Si ya estaba anulado pero NO archivado, le ponemos el flag archivado = true (Micro-Etapa 2: usar PK numérica row.id)
          if (row.activo === false || localEstado === 'ANULADO' || localEstado === 'ANULADO POR EL CLIENTE') {
            console.log(`🗂️ Archivando silenciosamente presupuesto local ya anulado correspondiente al pedido B2B ${pedido.id.slice(0, 8)}...`);
            const localId = (resMap.rows.length > 0 ? resMap.rows[0].local_presupuesto_id : null) || row.id;
            if (localId) {
              await localClient.query(
                `UPDATE public.presupuestos SET archivado = true WHERE id = $1`,
                [localId]
              );
            } else {
              await localClient.query(
                `UPDATE public.presupuestos SET archivado = true WHERE id_presupuesto_ext = $1`,
                [pedido.id]
              );
            }
            continue;
          }
          
          console.log(`🛑 El cliente canceló el pedido B2B ${pedido.id.slice(0, 8)} desde el portal .com.`);
          console.log(`🔄 Anulando integralmente y archivando presupuesto local correspondiente...`);
          const localId = (resMap.rows.length > 0 ? resMap.rows[0].local_presupuesto_id : null) || row.id;
          if (localId) {
            const { anularPresupuestoIntegral } = require('../presupuestos/controllers/presupuestosWrite');
            await anularPresupuestoIntegral(localClient, localId, 'Cancelado por el cliente en Portal B2B', 'Anulado por el Cliente');
            await localClient.query(
              `UPDATE public.presupuestos SET archivado = true WHERE id = $1`,
              [localId]
            );
          } else {
            await localClient.query(
              `UPDATE public.presupuestos SET activo = false, estado = 'Anulado por el Cliente', id_ruta = NULL, archivado = true WHERE id_presupuesto_ext = $1`,
              [pedido.id]
            );
          }
          continue;
        }

        if (row.activo === false || localEstado === 'ANULADO' || localEstado === 'ANULADO POR EL CLIENTE') {
          console.log(`⚠️ Pedido B2B ${pedido.id.slice(0, 8)} está inactivo o anulado localmente.`);
          if (pedido.estado !== 'Cancelado') {
            console.log(`🔄 Marcando pedido ${pedido.id.slice(0, 8)} como Cancelado en Supabase.`);
            await actualizarEstadoSupabase(pedido.id, 'Cancelado', false);
          }
          continue;
        }

        const nuevoEstadoSupabase = mapLocalStatusToSupabase(row);
        const estaFacturadoLocal = row.esta_facturado || false;

        const requiereActualizarFacturado = !fallbackToNoFacturado && (pedido.facturado === null || pedido.facturado !== estaFacturadoLocal);
        
        if (pedido.estado !== nuevoEstadoSupabase || requiereActualizarFacturado) {
          console.log(`🔄 Cambio detectado para Pedido ${pedido.id.slice(0, 8)}: [${pedido.estado}] ➔ [${nuevoEstadoSupabase}]` + (!fallbackToNoFacturado ? `, Facturado: [${pedido.facturado}] ➔ [${estaFacturadoLocal}]` : ''));
          await actualizarEstadoSupabase(pedido.id, nuevoEstadoSupabase, fallbackToNoFacturado ? undefined : estaFacturadoLocal);
        }

        // Bucle espejo: Validar discrepancias numéricas (total local vs total en la nube)
        const totalLocal = parseFloat(row.total_local || 0);
        const subtotalLocal = parseFloat(row.subtotal_local || 0);
        const ivaLocal = parseFloat(row.iva_local || 0);
        const totalSupabase = parseFloat(pedido.total || 0);

        if (totalLocal > 0 && Math.abs(totalLocal - totalSupabase) > 0.05) {
          console.log(`🔄 [B2B-ESPEJO] Discrepancia detectada en Pedido B2B ${pedido.id.slice(0, 8)}. Local: $${totalLocal} vs Nube: $${totalSupabase}. Resincronizando montos y líneas...`);
          
          // Actualizar cabecera en Supabase
          await actualizarMontosSupabase(pedido.id, totalLocal, subtotalLocal, ivaLocal);

          // Actualizar líneas en Supabase
          const localId = row.id;
          if (localId) {
            await actualizarItemsSupabase(localClient, pedido.id, localId);
          }
        }
      }
    }

    console.log('✅ Sincronización de pedidos y estados completada con éxito.');

  } catch (error) {
    console.error('❌ Error general durante la sincronización de estados:', error.message);
    process.exitCode = 1;
  } finally {
    if (localClient) {
      localClient.release();
    }
    if (require.main === module) {
      await localPool.end();
    }
  }
}

if (require.main === module) {
  sincronizarEstados()
    .catch(error => {
      console.error('💥 Error fatal en sincronización de estados B2B:', error);
      process.exitCode = 1;
    });
} else {
  module.exports = {
    subirPedidoEspecifico,
    asegurarClienteSombra,
    sincronizarEstados,
    mapLocalStatusToSupabase,
    localPool
  };
}
