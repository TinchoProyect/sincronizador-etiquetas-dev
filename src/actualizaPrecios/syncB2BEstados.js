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

  // Estado 1: Ingresado
  return 'En Preparacion';
}

async function actualizarEstadoSupabase(id, estado) {
  try {
    const url = `${SUPABASE_URL}/rest/v1/clientes_b2b_pedidos_cabecera?id=eq.${id}`;
    const options = {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        estado: estado,
        updated_at: new Date().toISOString()
      })
    };
    
    await fetchWithRetry(url, options);
    console.log(`☁️  [Supabase] Pedido ${id.slice(0, 8)} actualizado a estado: [${estado}]`);
  } catch (err) {
    console.error(`❌ Error al actualizar estado del pedido ${id.slice(0, 8)} en Supabase:`, err.message);
  }
}

async function subirPedidosLocales(localClient) {
  console.log('🔄 Fase 1: Buscando pedidos manuales locales pendientes de sincronización...');
  
  // Buscar presupuestos creados en los últimos 30 días, activos, de clientes B2B,
  // que no estén en la tabla de mapeo ni tengan un UUID en id_presupuesto_ext.
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
        bc.codigo_bunker_cliente
    FROM public.presupuestos p
    JOIN public.bunker_clientes bc ON bc.lomas_soft_id = TRIM(p.id_cliente) OR (bc.lomas_soft_id ~ '^[0-9]+$' AND p.id_cliente ~ '^[0-9]+$' AND bc.lomas_soft_id::integer = p.id_cliente::integer)
    LEFT JOIN public.b2b_pedidos_mapeo m ON m.local_presupuesto_id = p.id
    WHERE p.activo = true 
      AND m.local_presupuesto_id IS NULL
      AND (p.id_presupuesto_ext IS NULL OR p.id_presupuesto_ext !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      AND p.fecha >= NOW() - INTERVAL '30 days'
  `;
  
  const resLocales = await localClient.query(sqlBuscarLocales);
  console.log(`📊 Pedidos locales calificados encontrados: ${resLocales.rows.length}`);
  
  for (const row of resLocales.rows) {
    console.log(`⚙️ Procesando Pedido Local #${row.id} para Cliente Búnker ${row.codigo_bunker_cliente} (ID Legacy: ${row.id_cliente})...`);
    
    // Obtener los detalles del pedido local
    const sqlDetalles = `
      SELECT 
          pd.id,
          pd.articulo,
          pd.cantidad,
          pd.precio1,
          pd.iva1,
          COALESCE(ba.descripcion_generada, ba.descripcion, pd.articulo) as producto_descripcion
      FROM public.presupuestos_detalles pd
      LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = pd.articulo
      WHERE pd.id_presupuesto = $1
    `;
    
    const resDetalles = await localClient.query(sqlDetalles, [row.id]);
    
    if (resDetalles.rows.length === 0) {
      console.warn(`⚠️ Advertencia: El pedido local #${row.id} no tiene ítems de detalle. Se omite.`);
      continue;
    }
    
    let subtotalConIva = 0;
    const itemsLocal = resDetalles.rows;
    const newSupaId = crypto.randomUUID();
    
    const itemsPayload = itemsLocal.map(item => {
      const qty = parseFloat(item.cantidad || 0);
      const precioNeto = parseFloat(item.precio1 || 0);
      const alicuotaIva = parseFloat(item.iva1 || 0);
      
      const precioConIva = precioNeto * (1 + alicuotaIva / 100);
      const totalItem = qty * precioConIva;
      
      subtotalConIva += totalItem;
      
      return {
        id: crypto.randomUUID(),
        pedido_id: newSupaId,
        producto_codigo: item.articulo,
        producto_descripcion: item.producto_descripcion,
        cantidad: qty,
        precio_unitario: parseFloat(precioConIva.toFixed(2)),
        subtotal: parseFloat(totalItem.toFixed(2))
      };
    });
    
    const pctDescuento = parseFloat(row.descuento || 0);
    const valorDescuento = subtotalConIva * (pctDescuento / 100);
    const totalFinal = subtotalConIva - valorDescuento;
    
    const cabeceraPayload = {
      id: newSupaId,
      cliente_id: row.codigo_bunker_cliente,
      fecha_pedido: new Date(row.fecha).toISOString(),
      estado: mapLocalStatusToSupabase(row),
      subtotal: parseFloat(subtotalConIva.toFixed(2)),
      descuento: parseFloat(valorDescuento.toFixed(2)),
      total: parseFloat(totalFinal.toFixed(2)),
      observaciones: row.nota ? String(row.nota).trim() : null,
      sync_estado: 'Sincronizado'
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
    const url = `${SUPABASE_URL}/rest/v1/clientes_b2b_pedidos_cabecera?created_at=gte.${dateStr}&select=id,estado`;
    
    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
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
            `SELECT estado, secuencia, informe_generado, estado_logistico, activo 
             FROM public.presupuestos 
             WHERE id = $1 LIMIT 1`,
            [resMap.rows[0].local_presupuesto_id]
          );
        } else {
          // Si no hay mapeo, buscar por id_presupuesto_ext (pedido que nació en B2B)
          resLocal = await localClient.query(
            `SELECT estado, secuencia, informe_generado, estado_logistico, activo 
             FROM public.presupuestos 
             WHERE id_presupuesto_ext = $1 LIMIT 1`,
            [pedido.id]
          );
        }

        if (resLocal.rows.length === 0) {
          console.log(`⚠️ Pedido B2B ${pedido.id.slice(0, 8)} no encontrado en base de datos local.`);
          if (pedido.estado !== 'Cancelado') {
            console.log(`🔄 Marcando pedido ${pedido.id.slice(0, 8)} como Cancelado en Supabase.`);
            await actualizarEstadoSupabase(pedido.id, 'Cancelado');
          }
          continue;
        }

        const row = resLocal.rows[0];
        const localEstado = (row.estado || '').toUpperCase().trim();

        if (row.activo === false || localEstado === 'ANULADO') {
          console.log(`⚠️ Pedido B2B ${pedido.id.slice(0, 8)} está inactivo o anulado localmente.`);
          if (pedido.estado !== 'Cancelado') {
            console.log(`🔄 Marcando pedido ${pedido.id.slice(0, 8)} como Cancelado en Supabase.`);
            await actualizarEstadoSupabase(pedido.id, 'Cancelado');
          }
          continue;
        }

        const nuevoEstadoSupabase = mapLocalStatusToSupabase(row);

        if (pedido.estado !== nuevoEstadoSupabase) {
          console.log(`🔄 Cambio de estado detectado para Pedido ${pedido.id.slice(0, 8)}: [${pedido.estado}] ➔ [${nuevoEstadoSupabase}]`);
          await actualizarEstadoSupabase(pedido.id, nuevoEstadoSupabase);
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
    await localPool.end();
  }
}

sincronizarEstados()
  .catch(error => {
    console.error('💥 Error fatal en sincronización de estados B2B:', error);
    process.exitCode = 1;
  });
