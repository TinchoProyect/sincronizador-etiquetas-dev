// filepath: src/actualizaPrecios/syncB2BPrecios.js
'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const lockFilePath = path.join(__dirname, 'syncB2BPrecios.lock');


// ===== 1) Conexión a la Base de Datos Local =====
const localPool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'etiquetas',
  password: process.env.DB_PASSWORD || 'ta3Mionga',
  port: parseInt(process.env.DB_PORT || '5432'),
});

console.log('═══════════════════════════════════════════════════════');
console.log('📡 [SYNC-B2B-PRECIOS] CANAL DE SINCRONIZACIÓN DE CATÁLOGO');
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
      console.warn(`⚠️ [Supabase POST] Intento ${attempt}/${retries} falló: HTTP ${response.status} - ${errorText}`);
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

async function sincronizarB2BPrecios() {
  if (fs.existsSync(lockFilePath)) {
    const stats = fs.statSync(lockFilePath);
    const mtime = new Date(stats.mtime);
    const now = new Date();
    const diffMinutes = (now - mtime) / (1000 * 60);
    
    if (diffMinutes < 10) {
      console.warn('⚠️ [SYNC-B2B-PRECIOS] Ya hay otra sincronización activa (archivo lock detectado). Saliendo.');
      process.exit(0);
    } else {
      console.warn('⚠️ [SYNC-B2B-PRECIOS] Archivo lock obsoleto detectado (>10 min). Sobreescribiendo.');
    }
  }
  fs.writeFileSync(lockFilePath, new Date().toISOString());

  let localClient;
  const syncStart = new Date().toISOString(); // Timestamp único para esta sesión de sincronización

  try {
    // 1. Obtener datos activos de la base de datos local
    localClient = await localPool.connect();
    console.log('🔍 Consultando catálogo activo en base de datos local...');
    
    const localQuery = `
      SELECT 
          la.lista_id,
          la.articulo_numero as producto_codigo,
          COALESCE(ba.descripcion_generada, ba.descripcion, sc.descripcion, la.articulo_numero) as producto_descripcion,
          la.precio_final,
          COALESCE(sc.stock_consolidado, 0) as stock_disponible,
          ba.rubro,
          ba.sub_rubro,
          ba.propiedades_dinamicas
      FROM public.bunker_lista_articulos la
      LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = la.articulo_numero
      LEFT JOIN public.stock_real_consolidado sc ON sc.articulo_numero = la.articulo_numero
      WHERE la.disponible = true AND la.precio_final > 0;
    `;
    
    const resLocal = await localClient.query(localQuery);
    const totalArticulos = resLocal.rows.length;
    console.log(`📊 Artículos activos encontrados localmente: ${totalArticulos}`);
    
    if (totalArticulos === 0) {
      console.log('ℹ️ No hay artículos activos para sincronizar.');
      return;
    }

    // Preparar payloads con el timestamp único para identificar registros vigentes
    const payloads = resLocal.rows.map(row => {
      let props = row.propiedades_dinamicas;
      if (props && typeof props === 'string') {
        try {
          props = JSON.parse(props);
        } catch (e) {
          props = null;
        }
      }
      
      const dynamicVals = [];
      if (props && typeof props === 'object') {
        for (const key in props) {
          if (Object.prototype.hasOwnProperty.call(props, key)) {
            const propVal = props[key];
            if (propVal !== null && propVal !== undefined) {
              let val = '';
              if (typeof propVal === 'object') {
                val = propVal.valor !== undefined && propVal.valor !== null ? String(propVal.valor).trim() : '';
              } else {
                val = String(propVal).trim();
              }
              if (val) {
                dynamicVals.push(val);
              }
            }
          }
        }
      }

      const parts = [];
      if (row.producto_descripcion) parts.push(String(row.producto_descripcion).trim());
      if (row.rubro) parts.push(String(row.rubro).trim());
      if (row.sub_rubro) parts.push(String(row.sub_rubro).trim());
      dynamicVals.forEach(val => parts.push(val));

      const busqueda_metadata = parts.join(' ').replace(/\s+/g, ' ').trim();

      return {
        lista_id: parseInt(row.lista_id),
        producto_codigo: String(row.producto_codigo).trim(),
        producto_descripcion: String(row.producto_descripcion).trim(),
        precio_final: parseFloat(row.precio_final),
        stock_disponible: parseFloat(row.stock_disponible),
        rubro: row.rubro ? String(row.rubro).trim() : null,
        sub_rubro: row.sub_rubro ? String(row.sub_rubro).trim() : null,
        busqueda_metadata: busqueda_metadata || null,
        updated_at: syncStart // Marca temporal para limpieza posterior
      };
    });

    // 2. Enviar datos a Supabase en lotes (batching de 100 registros)
    const batchSize = 1000;
    let upsertados = 0;
    
    console.log('🚀 Iniciando subida de lotes a Supabase (Upsert)...');
    
    for (let i = 0; i < payloads.length; i += batchSize) {
      const batch = payloads.slice(i, i + batchSize);
      
      // PostgREST upsert
      const url = `${SUPABASE_URL}/rest/v1/clientes_b2b_catalogo_precios?on_conflict=lista_id,producto_codigo`;
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
      console.log(`🔄 Sincronizados ${upsertados}/${totalArticulos} artículos...`);
    }

    // 3. Limpieza de registros obsoletos (Soft Delete / Hard Delete)
    // Borramos de Supabase cualquier registro que no haya sido actualizado en esta corrida
    console.log(`🧹 Iniciando limpieza de artículos obsoletos (anteriores a ${syncStart})...`);
    
    const cleanUrl = `${SUPABASE_URL}/rest/v1/clientes_b2b_catalogo_precios?updated_at=lt.${encodeURIComponent(syncStart)}`;
    const cleanOptions = {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    };
    
    const cleanResponse = await fetchWithRetry(cleanUrl, cleanOptions);
    console.log('✅ Sincronización y limpieza completada exitosamente.');
    
  } catch (error) {
    console.error('❌ Error durante la sincronización de precios B2B:', error.message);
    process.exitCode = 1;
  } finally {
    if (localClient) {
      localClient.release();
    }
    try {
      if (fs.existsSync(lockFilePath)) {
        fs.unlinkSync(lockFilePath);
      }
    } catch (e) {
      console.error('Error al remover lock file:', e.message);
    }
  }
}

sincronizarB2BPrecios()
  .catch(error => {
    console.error('💥 Error fatal en sincronización de precios B2B:', error);
    process.exitCode = 1;
  });
