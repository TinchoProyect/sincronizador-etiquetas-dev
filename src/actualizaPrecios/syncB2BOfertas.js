// filepath: src/actualizaPrecios/syncB2BOfertas.js
'use strict';

if (!globalThis.WebSocket) { try { globalThis.WebSocket = require('ws'); } catch (_) {} }
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { Pool } = require('pg');
const OfertasDinamicasService = require('../presupuestos/services/ofertasDinamicasService');

const localPool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'etiquetas',
  password: process.env.DB_PASSWORD || 'ta3Mionga',
  port: parseInt(process.env.DB_PORT || '5432'),
});

console.log('═══════════════════════════════════════════════════════');
console.log('📡 [SYNC-B2B-OFERTAS] SINCRONIZACIÓN DE OFERTAS DINÁMICAS');
console.log('═══════════════════════════════════════════════════════');
console.log(`🔌 Conectado a BD Local: ${process.env.DB_NAME || 'etiquetas'}`);
console.log(`🌍 Entorno: ${process.env.NODE_ENV || 'production'}`);
console.log(`☁️  Supabase URL: ${process.env.SUPABASE_B2B_URL}`);
console.log('═══════════════════════════════════════════════════════');

const SUPABASE_URL = process.env.SUPABASE_B2B_URL;
const SUPABASE_KEY = process.env.SUPABASE_B2B_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('💥 ERROR CRÍTICO: Variables de Supabase B2B faltantes en .env');
  process.exit(1);
}

// Helper para llamadas con reintentos
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

async function sincronizarOfertasDinamicas() {
  let localClient;
  const syncStart = new Date().toISOString();

  try {
    localClient = await localPool.connect();

    console.log('🔍 Consultando ofertas dinámicas en BD local...');
    const ofertas = await OfertasDinamicasService.obtenerOfertas(localClient, false);
    console.log(`📊 Ofertas locales encontradas: ${ofertas.length}`);

    if (ofertas.length === 0) {
      console.log('ℹ️ No hay ofertas dinámicas para sincronizar.');
      return;
    }

    // Mapear clientes para excepciones
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

    // Preparar payloads
    const payloads = ofertas.map(o => {
      const excepcionesEnriquecidas = (o.excepciones || []).map(exc => ({
        ...exc,
        codigo_bunker_cliente: clienteMap.get(String(exc.cliente_id)) || null
      }));

      const listasIds = (o.listas || []).map(l => l.bunker_lista_precio_id);

      return {
        oferta_id: o.id,
        titulo: o.titulo,
        descripcion: o.descripcion,
        unidad_cuota: o.unidad_cuota || 'KILOS',
        cuota_total: parseFloat(o.cuota_total) || 0,
        cuota_consumida: parseFloat(o.cuota_consumida) || 0,
        cuota_disponible: parseFloat(o.cuota_disponible) || 0,
        condicion_cierre: o.condicion_cierre || 'HASTA_AGOTAR_STOCK',
        fecha_inicio: o.fecha_inicio,
        fecha_fin: o.fecha_fin,
        tipo_beneficio: o.tipo_beneficio || 'PORCENTAJE',
        descuento_porcentaje: parseFloat(o.descuento_porcentaje) || 5.00,
        no_acumulable_con_politica: Boolean(o.no_acumulable_con_politica),
        activo: Boolean(o.activo),
        estado: o.estado || 'ACTIVA',
        articulos: o.articulos || [],
        listas_ids: listasIds,
        excepciones: excepcionesEnriquecidas,
        updated_at: syncStart
      };
    });

    // Enviar a Supabase
    console.log(`🚀 Enviando ${payloads.length} ofertas dinámicas a Supabase Cloud...`);
    const url = `${SUPABASE_URL}/rest/v1/clientes_b2b_ofertas_activas?on_conflict=oferta_id`;
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
    console.log('✅ Ofertas dinámicas sincronizadas exitosamente en Supabase Cloud.');

    // Limpiar obsoletas
    const activeIds = ofertas.map(o => o.id);
    if (activeIds.length > 0) {
      const cleanUrl = `${SUPABASE_URL}/rest/v1/clientes_b2b_ofertas_activas?oferta_id=not.in.(${activeIds.join(',')})`;
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
      console.warn('⚠️ [SYNC-B2B-OFERTAS] La tabla clientes_b2b_ofertas_activas aún no existe en Supabase.');
      console.warn('👉 Ejecute la migración supabase_migration/37_b2b_ofertas_dinamicas.sql en el panel de Supabase.');
    } else {
      console.error('❌ Error al sincronizar ofertas dinámicas:', err.message);
    }
  } finally {
    if (localClient) localClient.release();
  }
}

if (require.main === module) {
  sincronizarOfertasDinamicas()
    .then(() => {
      console.log('🎉 Finalizado script syncB2BOfertas.');
      process.exit(0);
    })
    .catch(err => {
      console.error('💥 Error no controlado:', err);
      process.exit(1);
    });
}

module.exports = { sincronizarOfertasDinamicas };
