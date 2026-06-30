// filepath: src/actualizaPrecios/syncB2BEstados.js
'use strict';

require('dotenv').config();
const { Pool } = require('pg');

// ===== 1) Conexión a la Base de Datos Local =====
const localPool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'etiquetas',
  password: process.env.DB_PASSWORD || 'ta3Mionga',
  port: parseInt(process.env.DB_PORT || '5432'),
});

console.log('═══════════════════════════════════════════════════════');
console.log('📡 [SYNC-B2B-ESTADOS] SINCRONIZADOR DE ESTADOS LOGÍSTICOS');
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

async function sincronizarEstados() {
  let localClient;
  
  try {
    // 1. Obtener de Supabase los pedidos creados en los últimos 30 días (permite detectar regresiones de cualquier estado)
    console.log('🔍 Consultando pedidos recientes en Supabase...');
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateStr = thirtyDaysAgo.toISOString();
    const url = `${SUPABASE_URL}/rest/v1/clientes_b2b_pedidos_cabecera?created_at=gte.${dateStr}&select=id,estado`;
    const options = {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    };
    
    const response = await fetchWithRetry(url, options);
    const pedidosB2B = await response.json();
    console.log(`📊 Pedidos activos encontrados en Supabase: ${pedidosB2B.length}`);

    if (pedidosB2B.length === 0) {
      console.log('✅ No hay pedidos activos en Supabase para actualizar.');
      return;
    }

    localClient = await localPool.connect();

    // 2. Por cada pedido, buscar su estado local y actualizar si difiere
    for (const pedido of pedidosB2B) {
      const resLocal = await localClient.query(
        `SELECT estado, secuencia, informe_generado, estado_logistico, activo 
         FROM public.presupuestos 
         WHERE id_presupuesto_ext = $1 LIMIT 1`,
        [pedido.id]
      );

      if (resLocal.rows.length === 0) {
        console.log(`⚠️ Pedido B2B ${pedido.id.slice(0, 8)} no encontrado en base de datos local (eliminado físicamente).`);
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
        console.log(`🔄 Cambio detectado para Pedido ${pedido.id.slice(0, 8)}: [${pedido.estado}] ➔ [${nuevoEstadoSupabase}]`);
        await actualizarEstadoSupabase(pedido.id, nuevoEstadoSupabase);
      }
    }

    console.log('✅ Sincronización de estados completada con éxito.');

  } catch (error) {
    console.error('❌ Error general durante la sincronización de estados:', error.message);
    process.exitCode = 1;
  } finally {
    if (localClient) {
      localClient.release();
    }
  }
}

sincronizarEstados()
  .catch(error => {
    console.error('💥 Error fatal en sincronización de estados B2B:', error);
    process.exitCode = 1;
  });
