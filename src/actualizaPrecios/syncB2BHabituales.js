// filepath: src/actualizaPrecios/syncB2BHabituales.js
'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const ClientesBunkerModel = require('../logistica/models/clientesBunkerModel');

// ===== 1) Conexión a la Base de Datos Local =====
const localPool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'etiquetas',
  password: process.env.DB_PASSWORD || 'ta3Mionga',
  port: parseInt(process.env.DB_PORT || '5432'),
});

console.log('═══════════════════════════════════════════════════════');
console.log('⭐ [SYNC-B2B-HABITUALES] SINCRONIZACIÓN DE ARTÍCULOS FAVORITOS');
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

// Helper para llamadas HTTP con reintentos y timeout
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
      console.warn(`⚠️ [Supabase POST/GET] Intento ${attempt}/${retries} falló: HTTP ${response.status} - ${errorText}`);
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

async function sincronizarB2BHabituales() {
  const syncStart = new Date().toISOString();

  try {
    // 1. Obtener perfiles de clientes registrados en Supabase
    console.log('🔍 Consultando perfiles registrados en Supabase...');
    const getProfilesUrl = `${SUPABASE_URL}/rest/v1/clientes_b2b_perfiles?select=id,cliente_id,nombre_empresa,email`;
    const getOptions = {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    };
    
    const resProfiles = await fetchWithRetry(getProfilesUrl, getOptions);
    const profiles = await resProfiles.json();
    console.log(`📊 Perfiles encontrados en Supabase: ${profiles.length}`);

    if (!Array.isArray(profiles) || profiles.length === 0) {
      console.log('⚠️ No hay perfiles en Supabase para sincronizar favoritos.');
      return;
    }

    const allPayloads = [];
    let clientesProcesados = 0;
    let totalArticulosHabituales = 0;

    for (const profile of profiles) {
      const clienteId = (profile.cliente_id || '').trim();
      if (!clienteId) continue;

      try {
        const articulosComprados = await ClientesBunkerModel.obtenerArticulosComprados(clienteId);
        if (Array.isArray(articulosComprados) && articulosComprados.length > 0) {
          clientesProcesados++;
          for (const item of articulosComprados) {
            const cleanCod = String(item.articulo_id || '').trim();
            if (!cleanCod) continue;

            allPayloads.push({
              cliente_id: clienteId,
              producto_codigo: cleanCod,
              frecuencia_compra: parseInt(item.frecuencia_compra, 10) || 1,
              ultima_compra: item.ultima_compra ? new Date(item.ultima_compra).toISOString() : null,
              updated_at: syncStart
            });
            totalArticulosHabituales++;
          }
        }
      } catch (clientErr) {
        console.warn(`⚠️ Error al calcular habituales para cliente ${clienteId}:`, clientErr.message);
      }
    }

    console.log(`📈 Calculados: ${totalArticulosHabituales} artículos habituales para ${clientesProcesados} clientes.`);

    // 2. Subir en lotes (batch de 250 registros)
    if (allPayloads.length > 0) {
      const batchSize = 250;
      let upsertados = 0;
      console.log('🚀 Iniciando subida de lotes de favoritos a Supabase (Upsert)...');

      for (let i = 0; i < allPayloads.length; i += batchSize) {
        const batch = allPayloads.slice(i, i + batchSize);
        const url = `${SUPABASE_URL}/rest/v1/clientes_b2b_articulos_habituales?on_conflict=cliente_id,producto_codigo`;
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
        console.log(`🔄 Subidos ${upsertados}/${allPayloads.length} favoritos...`);
      }
    }

    // 3. Higiene: Limpieza de registros obsoletos
    console.log(`\n🧹 Limpiando favoritos obsoletos (anteriores a ${syncStart})...`);
    const cleanUrl = `${SUPABASE_URL}/rest/v1/clientes_b2b_articulos_habituales?updated_at=lt.${encodeURIComponent(syncStart)}`;
    const cleanOptions = {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    };
    await fetchWithRetry(cleanUrl, cleanOptions);

    console.log('═══════════════════════════════════════════════════════');
    console.log('🎉 [SYNC-B2B-HABITUALES] Sincronización completada exitosamente.');
    console.log('═══════════════════════════════════════════════════════');

  } catch (err) {
    console.error('💥 Error crítico en sincronización de habituales B2B:', err.message);
  } finally {
    await localPool.end();
  }
}

// Ejecutar directamente si es invocado como script principal
if (require.main === module) {
  sincronizarB2BHabituales().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = sincronizarB2BHabituales;
