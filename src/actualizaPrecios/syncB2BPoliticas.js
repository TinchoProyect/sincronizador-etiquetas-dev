// filepath: src/actualizaPrecios/syncB2BPoliticas.js
'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const PoliticasDescuentoService = require('../presupuestos/services/politicasDescuentoService');

// ===== 1) Conexión a la Base de Datos Local =====
const localPool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'etiquetas',
  password: process.env.DB_PASSWORD || 'ta3Mionga',
  port: parseInt(process.env.DB_PORT || '5432'),
});

console.log('═══════════════════════════════════════════════════════');
console.log('📡 [SYNC-B2B-POLITICAS] SINCRONIZACIÓN DE POLÍTICAS COMERCIALES');
console.log('═══════════════════════════════════════════════════════');
console.log(`🔌 Conectado a BD Local: ${process.env.DB_NAME || 'etiquetas'}`);
console.log(`☁️  Supabase URL: ${process.env.SUPABASE_B2B_URL}`);
console.log('═══════════════════════════════════════════════════════');

const SUPABASE_URL = process.env.SUPABASE_B2B_URL;
const SUPABASE_KEY = process.env.SUPABASE_B2B_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('💥 ERROR CRÍTICO: Variables de Supabase B2B faltantes en .env');
  process.exit(1);
}

// Helper fetch con reintentos
async function fetchWithRetry(url, options = {}, retries = 3, delay = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

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
      if (response.status === 404 && errorText.includes('PGRST205')) {
        throw new Error('TABLA_NO_EXISTE');
      }
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.message === 'TABLA_NO_EXISTE') throw err;
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

async function sincronizarPoliticasComerciales() {
  let localClient;
  const syncStart = new Date().toISOString();

  try {
    localClient = await localPool.connect();

    // 1. Obtener todas las políticas de la base local
    console.log('🔍 Consultando políticas comerciales en BD local...');
    const politicas = await PoliticasDescuentoService.obtenerPoliticas(localClient);
    console.log(`📊 Políticas locales encontradas: ${politicas.length}`);

    if (politicas.length === 0) {
      console.log('ℹ️ No hay políticas comerciales para sincronizar.');
      return;
    }

    // 2. Mapear códigos B2B para excepciones
    const resBunkerClientes = await localClient.query(`
      SELECT id, codigo_bunker_cliente, lomas_soft_id FROM public.bunker_clientes
    `);
    const clienteMap = new Map();
    for (const bc of resBunkerClientes.rows) {
      if (bc.id) clienteMap.set(String(bc.id), bc.codigo_bunker_cliente);
      if (bc.lomas_soft_id) {
        clienteMap.set(String(bc.lomas_soft_id).trim(), bc.codigo_bunker_cliente);
        const intId = parseInt(bc.lomas_soft_id, 10);
        if (!isNaN(intId)) clienteMap.set(String(intId), bc.codigo_bunker_cliente);
      }
    }

    // 3. Preparar payloads para Supabase
    const payloads = politicas.map(p => {
      const excepcionesEnriquecidas = (p.excepciones || []).map(exc => ({
        ...exc,
        codigo_bunker_cliente: clienteMap.get(String(exc.cliente_id)) || null
      }));

      return {
        politica_id: p.id,
        lista_id: p.bunker_lista_precio_id,
        lista_nombre: p.bunker_lista_nombre,
        nombre: p.nombre,
        descripcion: p.descripcion,
        tipo_calculo: p.tipo_calculo || 'ESCALA_DIRECTA',
        aplica_sobre: p.aplica_sobre || 'NETO',
        activo: Boolean(p.activo),
        tramos: p.tramos || [],
        excepciones: excepcionesEnriquecidas,
        updated_at: syncStart
      };
    });

    // 4. Enviar Upsert a Supabase
    console.log(`🚀 Enviando ${payloads.length} políticas comerciales a Supabase Cloud...`);
    const url = `${SUPABASE_URL}/rest/v1/clientes_b2b_politicas_comerciales?on_conflict=politica_id`;
    const options = {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(payloads)
    };

    await fetchWithRetry(url, options);
    console.log('✅ Políticas comerciales sincronizadas exitosamente en Supabase Cloud.');

    // 5. Limpiar políticas obsoletas que ya no existen localmente
    const activeIds = politicas.map(p => p.id);
    if (activeIds.length > 0) {
      const cleanUrl = `${SUPABASE_URL}/rest/v1/clientes_b2b_politicas_comerciales?politica_id=not.in.(${activeIds.join(',')})`;
      const cleanOptions = {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      };
      await fetchWithRetry(cleanUrl, cleanOptions);
    }

  } catch (err) {
    if (err.message === 'TABLA_NO_EXISTE') {
      console.warn('⚠️ [SYNC-B2B-POLITICAS] La tabla clientes_b2b_politicas_comerciales aún no existe en Supabase.');
      console.warn('👉 Ejecute la migración supabase_migration/35_b2b_politicas_comerciales.sql en el panel de Supabase.');
    } else {
      console.error('❌ Error al sincronizar políticas comerciales:', err.message);
    }
  } finally {
    if (localClient) localClient.release();
  }
}

// Ejecución directa si se invoca como script principal
if (require.main === module) {
  sincronizarPoliticasComerciales()
    .then(() => {
      console.log('🎉 Finalizado script syncB2BPoliticas.');
      process.exit(0);
    })
    .catch(err => {
      console.error('💥 Error no controlado:', err);
      process.exit(1);
    });
}

module.exports = { sincronizarPoliticasComerciales };
