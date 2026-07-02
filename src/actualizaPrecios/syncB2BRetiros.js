// filepath: src/actualizaPrecios/syncB2BRetiros.js
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
console.log('📡 [SYNC-B2B-RETIROS] SINCRONIZADOR DE TICKETS DE RETIRO B2B');
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

// Helper para realizar llamadas HTTP con reintentos
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

async function sincronizarRetiros() {
  let localClient;
  
  try {
    localClient = await localPool.connect();

    // =================================================================
    // PARTE A: Sincronización Directa (Local ➔ Supabase)
    // Subir órdenes locales creadas/modificadas en los últimos 30 días
    // =================================================================
    console.log('🔄 Iniciando Sincronización Directa (Local ➔ Supabase)...');
    
    const sqlLocal = `
      SELECT 
        o.id, 
        o.id_cliente, 
        o.codigo_qr_hash, 
        o.estado_logistico, 
        o.fecha_creacion,
        o.responsable_nombre,
        o.responsable_apellido,
        o.responsable_celular,
        o.chofer_nombre,
        o.fecha_validacion_chofer,
        o.id_domicilio_entrega,
        o.id_ruta,
        d.articulo_numero,
        d.descripcion_externa,
        d.kilos,
        d.bultos,
        d.motivo,
        bc.codigo_bunker_cliente as bunker_cliente_id
      FROM public.ordenes_tratamiento o
      LEFT JOIN public.ordenes_tratamiento_detalles d ON d.id_orden_tratamiento = o.id
      LEFT JOIN public.bunker_clientes bc ON bc.lomas_soft_id = TRIM(CAST(o.id_cliente AS TEXT)) OR (bc.lomas_soft_id ~ '^[0-9]+$' AND bc.lomas_soft_id::integer = o.id_cliente)
      WHERE o.fecha_creacion >= NOW() - INTERVAL '30 days'
    `;
    
    const resLocal = await localClient.query(sqlLocal);
    console.log(`📊 Órdenes locales encontradas recientes: ${resLocal.rows.length}`);
    
    let subidosCount = 0;
    
    for (const row of resLocal.rows) {
      if (!row.bunker_cliente_id) {
        console.warn(`⚠️ Advertencia: Lote/Tratamiento #${row.id} no tiene mapeo a cliente Búnker para ID local: ${row.id_cliente}. Se omite.`);
        continue;
      }
      
      const payload = {
        id: parseInt(row.id),
        cliente_id: row.bunker_cliente_id,
        codigo_qr_hash: row.codigo_qr_hash,
        estado_logistico: row.estado_logistico,
        fecha_creacion: row.fecha_creacion,
        responsable_nombre: row.responsable_nombre || null,
        responsable_apellido: row.responsable_apellido || null,
        responsable_celular: row.responsable_celular || null,
        articulo_numero: row.articulo_numero || null,
        descripcion_externa: row.descripcion_externa || null,
        kilos: row.kilos ? parseFloat(row.kilos) : null,
        bultos: row.bultos ? parseInt(row.bultos) : null,
        motivo: row.motivo || null,
        chofer_nombre: row.chofer_nombre || null,
        fecha_validacion_chofer: row.fecha_validacion_chofer || null,
        id_domicilio_entrega: row.id_domicilio_entrega ? parseInt(row.id_domicilio_entrega) : null,
        id_ruta: row.id_ruta ? parseInt(row.id_ruta) : null
      };

      const urlUpsert = `${SUPABASE_URL}/rest/v1/clientes_b2b_retiros`;
      const optionsUpsert = {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(payload)
      };

      try {
        await fetchWithRetry(urlUpsert, optionsUpsert);
        subidosCount++;
      } catch (upsertErr) {
        console.error(`❌ Error al subir orden local #${row.id} a Supabase:`, upsertErr.message);
      }
    }
    
    console.log(`✅ Sincronización Directa completada. Se subieron/actualizaron ${subidosCount} órdenes.`);

    // =================================================================
    // PARTE B: Sincronización Inversa (Supabase ➔ Local)
    // Bajar check-ins listos de clientes
    // =================================================================
    console.log('\n🔄 Iniciando Sincronización Inversa (Supabase ➔ Local)...');
    
    const urlQuery = `${SUPABASE_URL}/rest/v1/clientes_b2b_retiros?estado_logistico=eq.PENDIENTE_VALIDACION&sincronizado_local=eq.false`;
    const optionsQuery = {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    };
    
    const resSupa = await fetchWithRetry(urlQuery, optionsQuery);
    const retirosSupa = await resSupa.json();
    console.log(`📊 Check-ins pendientes en Supabase: ${retirosSupa.length}`);
    
    let bajadosCount = 0;
    
    for (const ret of retirosSupa) {
      console.log(`📥 Bajando Check-in de Retiro #${ret.id} para cliente ID: ${ret.cliente_id}...`);
      
      try {
        await localClient.query('BEGIN');
        
        // 1. Actualizar cabecera en ordenes_tratamiento
        const sqlUpdateCabecera = `
          UPDATE public.ordenes_tratamiento
          SET 
            estado_logistico = 'PENDIENTE_VALIDACION',
            responsable_nombre = $1,
            responsable_apellido = $2,
            responsable_celular = $3
          WHERE id = $4
        `;
        await localClient.query(sqlUpdateCabecera, [
          ret.responsable_nombre,
          ret.responsable_apellido,
          ret.responsable_celular,
          ret.id
        ]);
        
        // 2. Actualizar detalles en ordenes_tratamiento_detalles
        // Primero limpiar anterior si existiera
        await localClient.query('DELETE FROM public.ordenes_tratamiento_detalles WHERE id_orden_tratamiento = $1', [ret.id]);
        
        const sqlInsertDetalle = `
          INSERT INTO public.ordenes_tratamiento_detalles (
            id_orden_tratamiento, articulo_numero, descripcion_externa, kilos, bultos, motivo
          ) VALUES ($1, $2, $3, $4, $5, $6)
        `;
        await localClient.query(sqlInsertDetalle, [
          ret.id,
          ret.articulo_numero || null,
          ret.descripcion_externa || null,
          ret.kilos ? parseFloat(ret.kilos) : null,
          ret.bultos ? parseInt(ret.bultos) : null,
          ret.motivo || null
        ]);
        
        await localClient.query('COMMIT');
        
        // 3. Confirmar a Supabase que ya se bajó localmente
        const urlPatch = `${SUPABASE_URL}/rest/v1/clientes_b2b_retiros?id=eq.${ret.id}`;
        const optionsPatch = {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            sincronizado_local: true,
            fecha_sincronizacion_local: new Date().toISOString()
          })
        };
        await fetchWithRetry(urlPatch, optionsPatch);
        
        console.log(`✅ Retiro #${ret.id} sincronizado localmente con éxito.`);
        bajadosCount++;
        
      } catch (txErr) {
        await localClient.query('ROLLBACK');
        console.error(`❌ Error transaccional en base local para retiro #${ret.id}:`, txErr.message);
      }
    }
    
    console.log(`✅ Sincronización Inversa completada. Se bajaron ${bajadosCount} check-ins.`);

  } catch (err) {
    console.error('💥 Excepción general en el Sincronizador de Retiros B2B:', err.message);
  } finally {
    if (localClient) localClient.release();
    // Cerrar el pool para que el fork child process termine y retorne código 0
    await localPool.end();
  }
}

sincronizarRetiros();
