// filepath: src/actualizaPrecios/syncB2BPagosEfectivo.js
'use strict';

if (!globalThis.WebSocket) { try { globalThis.WebSocket = require('ws'); } catch (_) {} }
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
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
console.log('📡 [SYNC-B2B-PAGOS-EFECTIVO] SINCRONIZADOR DE SOBRES DE EFECTIVO');
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

async function sincronizarPagosEfectivo() {
  let localClient;
  
  try {
    localClient = await localPool.connect();

    // =================================================================
    // PASO 1: Sincronización Directa (Local ➔ Supabase)
    // Subir PRIMERO acreditaciones, anulaciones, recibos y cambios de auditoría
    // realizados en local para que nunca sean pisados por estados viejos en la nube.
    // =================================================================
    console.log('🔄 Paso 1: Buscando cambios locales para actualizar Supabase (Local ➔ Supabase)...');
    
    const queryLocalesPendientes = `
      SELECT id, codigo_sobre, cliente_id, estado, modalidad_entrega, local_movimiento_id,
             recibo_url, observaciones_admin, monto_auditado, fecha_auditoria
      FROM public.factura_pagos_efectivo
      WHERE sincronizado_supabase = false;
    `;

    const resLocales = await localClient.query(queryLocalesPendientes);
    console.log(`📊 Sobres locales pendientes de actualizar en Supabase: ${resLocales.rows.length}`);

    let subidosCount = 0;

    for (const sobLoc of resLocales.rows) {
      console.log(`📤 Subiendo actualización local del Sobre ${sobLoc.codigo_sobre} [${sobLoc.estado}]...`);
      
      try {
        const urlPatch = `${SUPABASE_URL}/rest/v1/clientes_b2b_pagos_efectivo?codigo_sobre=eq.${sobLoc.codigo_sobre}`;
        const payload = {
          estado: sobLoc.estado,
          modalidad_entrega: sobLoc.modalidad_entrega || 'CHOFER',
          local_movimiento_id: sobLoc.local_movimiento_id || null,
          recibo_url: sobLoc.recibo_url || null,
          observaciones_admin: sobLoc.observaciones_admin || null,
          sincronizado_local: true,
          updated_at: new Date().toISOString()
        };

        const optionsPatch = {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify(payload)
        };

        await fetchWithRetry(urlPatch, optionsPatch);

        // Marcar sincronizado_supabase en BD local
        await localClient.query(
          'UPDATE public.factura_pagos_efectivo SET sincronizado_supabase = true, fecha_actualizacion = NOW() WHERE id = $1',
          [sobLoc.id]
        );

        subidosCount++;
        console.log(`✅ Sobre ${sobLoc.codigo_sobre} actualizado en Supabase.`);

      } catch (errSub) {
        console.error(`❌ Error actualizando sobre local ${sobLoc.codigo_sobre} en Supabase:`, errSub.message);
      }
    }

    // =================================================================
    // PASO 2: Sincronización Inversa (Supabase ➔ Local)
    // Traer sobres nuevos o modificados por el cliente (sincronizado_local = false)
    // =================================================================
    console.log('🔄 Paso 2: Buscando sobres nuevos o modificados en Supabase (Supabase ➔ Local)...');
    
    const urlQuery = `${SUPABASE_URL}/rest/v1/clientes_b2b_pagos_efectivo?sincronizado_local=eq.false&order=created_at.desc&limit=50`;
    const optionsQuery = {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    };
    
    const resSupa = await fetchWithRetry(urlQuery, optionsQuery);
    const sobresSupa = await resSupa.json();
    console.log(`📊 Sobres pendientes de bajar desde Supabase: ${sobresSupa.length}`);
    
    let bajadosCount = 0;
    
    for (const sob of sobresSupa) {
      try {
        await localClient.query('BEGIN');
        
        // Upsert en PostgreSQL local por codigo_sobre (respetando cambios locales o acreditados)
        const queryUpsert = `
          INSERT INTO public.factura_pagos_efectivo (
            codigo_sobre, cliente_id, monto_declarado, desglose_billetes,
            foto_frente_url, foto_dorso_url, modalidad_entrega, estado,
            observaciones_cliente, token_publico, colaborador_nombre,
            colaborador_telefono, colaborador_email, derivado_por, fecha_derivacion,
            sincronizado_supabase, fecha_creacion, fecha_actualizacion
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, true, COALESCE($16::timestamp, NOW()), NOW())
          ON CONFLICT (codigo_sobre) DO UPDATE SET
            monto_declarado = EXCLUDED.monto_declarado,
            desglose_billetes = EXCLUDED.desglose_billetes,
            foto_frente_url = EXCLUDED.foto_frente_url,
            foto_dorso_url = EXCLUDED.foto_dorso_url,
            modalidad_entrega = EXCLUDED.modalidad_entrega,
            estado = EXCLUDED.estado,
            observaciones_cliente = EXCLUDED.observaciones_cliente,
            token_publico = EXCLUDED.token_publico,
            colaborador_nombre = EXCLUDED.colaborador_nombre,
            colaborador_telefono = EXCLUDED.colaborador_telefono,
            colaborador_email = EXCLUDED.colaborador_email,
            derivado_por = EXCLUDED.derivado_por,
            fecha_derivacion = EXCLUDED.fecha_derivacion,
            fecha_actualizacion = NOW()
          WHERE factura_pagos_efectivo.estado != 'ACREDITADO'
            AND factura_pagos_efectivo.sincronizado_supabase = true;
        `;

        await localClient.query(queryUpsert, [
          sob.codigo_sobre,
          sob.cliente_id,
          sob.monto_declarado || 0,
          JSON.stringify(sob.desglose_billetes || {}),
          sob.foto_frente_url || null,
          sob.foto_dorso_url || null,
          sob.modalidad_entrega || 'CHOFER',
          sob.estado,
          sob.observaciones_cliente || null,
          sob.token_publico || null,
          sob.colaborador_nombre || null,
          sob.colaborador_telefono || null,
          sob.colaborador_email || null,
          sob.derivado_por || null,
          sob.fecha_derivacion || null,
          sob.created_at || null
        ]);

        // Marcar sincronizado_local en Supabase
        const urlPatch = `${SUPABASE_URL}/rest/v1/clientes_b2b_pagos_efectivo?id=eq.${sob.id}`;
        const optionsPatch = {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            sincronizado_local: true,
            fecha_sincronizacion_local: new Date().toISOString()
          })
        };

        await fetchWithRetry(urlPatch, optionsPatch);
        await localClient.query('COMMIT');
        bajadosCount++;
        console.log(`✅ Sobre ${sob.codigo_sobre} sincronizado exitosamente en BD local.`);

      } catch (errSob) {
        await localClient.query('ROLLBACK');
        console.error(`❌ Error sincronizando sobre ${sob.codigo_sobre}:`, errSob.message);
      }
    }

    console.log('═══════════════════════════════════════════════════════');
    console.log(`🎉 [SYNC-B2B-PAGOS-EFECTIVO] RESUMEN:`);
    console.log(`   - Sobres actualizados en Supabase: ${subidosCount}/${resLocales.rows.length}`);
    console.log(`   - Sobres bajados desde Supabase: ${bajadosCount}/${sobresSupa.length}`);
    console.log('═══════════════════════════════════════════════════════');

  } catch (errGeneral) {
    console.error('💥 Error general en sincronización de pagos en efectivo:', errGeneral.message);
  } finally {
    if (localClient) localClient.release();
  }
}

// Ejecución directa si se invoca desde CLI o Daemon fork
if (require.main === module) {
  sincronizarPagosEfectivo()
    .then(async () => {
      await localPool.end();
      process.exit(0);
    })
    .catch(async (e) => {
      console.error('💥 Fallo de proceso:', e);
      await localPool.end();
      process.exit(1);
    });
}

module.exports = { sincronizarPagosEfectivo };
