// filepath: src/actualizaPrecios/syncB2BPagosEfectivo.js
'use strict';

if (!globalThis.WebSocket) { try { globalThis.WebSocket = require('ws'); } catch (_) {} }
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { Pool } = require('pg');

const PROD_SUPABASE_ID = 'zysyxtbcvgswancxtpib';

function esModoLaboratorioOSinCredencialesPagos() {
  const dbName = String(process.env.DB_NAME || '').trim().toLowerCase();
  const flagLab = String(process.env.LAMDA_MODO_LABORATORIO || '').trim().toLowerCase();
  const modoLab = String(process.env.MODO_LABORATORIO || '').trim().toLowerCase();
  const flagNube = String(process.env.LAMDA_MODO_PRUEBA_NUBE || '').trim().toLowerCase();
  const safeRedirect = String(process.env.SAFE_DELIVERY_REDIRECT || '').trim().toLowerCase();
  const lamdaRole = String(process.env.LAMDA_ROLE || '').trim().toLowerCase();

  const isLab = dbName === 'etiquetas_pruebas' || flagLab === 'true' || flagLab === '1' || modoLab === 'true' || modoLab === '1';
  const isPruebaNube = flagNube === 'true' || flagNube === '1' || safeRedirect === 'true' || safeRedirect === '1';
  const isStandbyBridge = lamdaRole === 'galpon_bridge_only';

  const esProduccionTitularActiva = !isLab && !isPruebaNube && !isStandbyBridge && dbName === 'etiquetas' && flagNube === 'false';
  const daemonDisabled = String(process.env.DAEMON_B2B_DISABLED || '').trim().toLowerCase();
  if ((daemonDisabled === 'true' || daemonDisabled === '1') && !esProduccionTitularActiva) {
    return true;
  }
  if (isStandbyBridge) {
    return true;
  }

  const supaUrl = String(process.env.SUPABASE_B2B_URL || '').trim().toLowerCase();
  const supaKey = String(process.env.SUPABASE_B2B_SERVICE_KEY || '').trim();
  const sinSupaValido = !supaUrl || !supaKey || supaUrl.includes('127.0.0.1') || supaKey === 'modo_laboratorio_desconectado';

  // CANDADO INQUEBRANTABLE: Jamás permitir que Modo Laboratorio ni Modo Prueba Nube toquen el Supabase de Producción
  if ((isLab || isPruebaNube) && supaUrl.includes(PROD_SUPABASE_ID)) {
    return true;
  }
  const sandboxHabilitado = String(process.env.LAMDA_B2B_SANDBOX_ENABLED || '').trim().toLowerCase() === 'true';
  if (isLab && !sandboxHabilitado) {
    return true;
  }
  return sinSupaValido;
}

let standalonePool = null;
function getStandalonePool() {
  if (!standalonePool) {
    standalonePool = new Pool({
      user: process.env.DB_USER || 'postgres',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'etiquetas',
      password: process.env.DB_PASSWORD || 'ta3Mionga',
      port: parseInt(process.env.DB_PORT || '5432', 10),
    });
  }
  return standalonePool;
}

// Helper para llamadas HTTP con reintentos y timeout
async function fetchWithRetry(url, options = {}, retries = 3, delay = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout

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

async function sincronizarPagosEfectivo(opts = {}) {
  if (esModoLaboratorioOSinCredencialesPagos()) {
    return {
      success: true,
      skipped: true,
      reason: 'modo_laboratorio_o_standby',
      subidos: 0,
      bajados: 0
    };
  }

  const SUPABASE_URL = process.env.SUPABASE_B2B_URL;
  const SUPABASE_KEY = process.env.SUPABASE_B2B_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return {
      success: false,
      skipped: true,
      reason: 'credenciales_supabase_faltantes',
      subidos: 0,
      bajados: 0
    };
  }

  const activePool = opts.externalPool || getStandalonePool();
  const silent = Boolean(opts.silent);
  let localClient;

  try {
    localClient = await activePool.connect();

    // =================================================================
    // PASO 1: Sincronización Directa (Local ➔ Supabase)
    // Subir PRIMERO acreditaciones, anulaciones, recibos y cambios de auditoría
    // realizados en local para que nunca sean pisados por estados viejos en la nube.
    // =================================================================
    if (!silent) {
      console.log('🔄 [SYNC-PAGOS-EFECTIVO] Paso 1: Sincronizando cambios locales hacia Supabase...');
    }

    const queryLocalesPendientes = `
      SELECT id, codigo_sobre, cliente_id, estado, modalidad_entrega, local_movimiento_id,
             recibo_url, observaciones_admin, monto_auditado, fecha_auditoria
      FROM public.factura_pagos_efectivo
      WHERE sincronizado_supabase = false;
    `;

    const resLocales = await localClient.query(queryLocalesPendientes);
    let subidosCount = 0;

    for (const sobLoc of resLocales.rows) {
      try {
        const urlPatch = `${SUPABASE_URL}/rest/v1/clientes_b2b_pagos_efectivo?codigo_sobre=eq.${encodeURIComponent(sobLoc.codigo_sobre)}`;
        const payload = {
          estado: sobLoc.estado,
          modalidad_entrega: sobLoc.modalidad_entrega || 'CHOFER',
          local_movimiento_id: sobLoc.local_movimiento_id || null,
          recibo_url: sobLoc.recibo_url || null,
          observaciones_admin: sobLoc.observaciones_admin || null,
          sincronizado_local: true,
          updated_at: new Date().toISOString()
        };

        await fetchWithRetry(urlPatch, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify(payload)
        });

        await localClient.query(
          'UPDATE public.factura_pagos_efectivo SET sincronizado_supabase = true, fecha_actualizacion = NOW() WHERE id = $1',
          [sobLoc.id]
        );

        subidosCount++;
        console.log(`✅ [SYNC-PAGOS-EFECTIVO] Sobre ${sobLoc.codigo_sobre} [${sobLoc.estado}] subido a Supabase.`);
      } catch (errSub) {
        console.error(`❌ [SYNC-PAGOS-EFECTIVO] Error subiendo sobre local ${sobLoc.codigo_sobre}:`, errSub.message);
      }
    }

    // =================================================================
    // PASO 2: Sincronización Inversa + Recuperación Anti-Huérfanos (Supabase ➔ Local)
    // Trae tanto los sobres con sincronizado_local = false como cualquier sobre activo
    // reciente en Supabase que pudiera faltar en la BD local tras conmutación de nodos,
    // sin inflar la secuencia SERIAL cuando el registro ya existe y no cambió.
    // =================================================================
    const urlQuery = `${SUPABASE_URL}/rest/v1/clientes_b2b_pagos_efectivo?or=(sincronizado_local.eq.false,estado.in.(PREPARADO,PENDIENTE_ENSOBRADO,EN_TRANSITO,RECIBIDO_LOCAL))&order=created_at.desc&limit=80`;
    const resSupa = await fetchWithRetry(urlQuery, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    const sobresSupa = await resSupa.json();

    let bajadosCount = 0;

    if (Array.isArray(sobresSupa) && sobresSupa.length > 0) {
      const codigosSupa = sobresSupa.map(s => s.codigo_sobre).filter(Boolean);
      const existentesRes = codigosSupa.length > 0
        ? await localClient.query(
            `SELECT codigo_sobre, estado, sincronizado_supabase
             FROM public.factura_pagos_efectivo
             WHERE codigo_sobre = ANY($1::text[])`,
            [codigosSupa]
          )
        : { rows: [] };

      const mapaLocal = new Map(existentesRes.rows.map(r => [r.codigo_sobre, r]));

      for (const sob of sobresSupa) {
        if (!sob || !sob.codigo_sobre) continue;
        const localRow = mapaLocal.get(sob.codigo_sobre);
        const pendienteMarcarSupa = sob.sincronizado_local === false;

        // Si ya existe localmente y en Supabase ya estaba sincronizado, no hacer escrituras innecesarias
        if (localRow && !pendienteMarcarSupa) {
          continue;
        }

        try {
          await localClient.query('BEGIN');

          if (!localRow) {
            // Nuevo sobre (o sobre huérfano recuperado desde Supabase) -> INSERT limpio
            const queryInsert = `
              INSERT INTO public.factura_pagos_efectivo (
                codigo_sobre, cliente_id, monto_declarado, desglose_billetes,
                foto_frente_url, foto_dorso_url, modalidad_entrega, estado,
                observaciones_cliente, token_publico, colaborador_nombre,
                colaborador_telefono, colaborador_email, derivado_por, fecha_derivacion,
                sincronizado_supabase, fecha_creacion, fecha_actualizacion
              ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8,
                $9, $10, $11, $12, $13, $14, $15,
                true, COALESCE($16::timestamp, NOW()), NOW()
              )
              ON CONFLICT (codigo_sobre) DO NOTHING;
            `;
            await localClient.query(queryInsert, [
              sob.codigo_sobre,
              sob.cliente_id,
              sob.monto_declarado || 0,
              JSON.stringify(sob.desglose_billetes || {}),
              sob.foto_frente_url || null,
              sob.foto_dorso_url || null,
              sob.modalidad_entrega || 'CHOFER',
              sob.estado || 'PREPARADO',
              sob.observaciones_cliente || null,
              sob.token_publico || null,
              sob.colaborador_nombre || null,
              sob.colaborador_telefono || null,
              sob.colaborador_email || null,
              sob.derivado_por || null,
              sob.fecha_derivacion || null,
              sob.created_at || null
            ]);
            bajadosCount++;
            console.log(`📥 [SYNC-PAGOS-EFECTIVO] Sobre ${sob.codigo_sobre} (${sob.cliente_id} • $${sob.monto_declarado} • ${sob.modalidad_entrega}) incorporado en BD local.`);
          } else if (pendienteMarcarSupa) {
            // Ya existe localmente pero el cliente lo actualizó en el Portal -> UPDATE sin inflar SERIAL
            const queryUpdate = `
              UPDATE public.factura_pagos_efectivo
              SET
                monto_declarado = $2,
                desglose_billetes = $3,
                foto_frente_url = $4,
                foto_dorso_url = $5,
                modalidad_entrega = $6,
                estado = $7,
                observaciones_cliente = $8,
                token_publico = $9,
                colaborador_nombre = $10,
                colaborador_telefono = $11,
                colaborador_email = $12,
                derivado_por = $13,
                fecha_derivacion = $14,
                fecha_actualizacion = NOW()
              WHERE codigo_sobre = $1
                AND estado != 'ACREDITADO'
                AND sincronizado_supabase = true;
            `;
            await localClient.query(queryUpdate, [
              sob.codigo_sobre,
              sob.monto_declarado || 0,
              JSON.stringify(sob.desglose_billetes || {}),
              sob.foto_frente_url || null,
              sob.foto_dorso_url || null,
              sob.modalidad_entrega || 'CHOFER',
              sob.estado || 'PREPARADO',
              sob.observaciones_cliente || null,
              sob.token_publico || null,
              sob.colaborador_nombre || null,
              sob.colaborador_telefono || null,
              sob.colaborador_email || null,
              sob.derivado_por || null,
              sob.fecha_derivacion || null
            ]);
            bajadosCount++;
            console.log(`🔄 [SYNC-PAGOS-EFECTIVO] Sobre ${sob.codigo_sobre} actualizado desde Portal B2B.`);
          }

          if (pendienteMarcarSupa && sob.id) {
            const urlPatch = `${SUPABASE_URL}/rest/v1/clientes_b2b_pagos_efectivo?id=eq.${sob.id}`;
            await fetchWithRetry(urlPatch, {
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
            });
          }

          await localClient.query('COMMIT');
        } catch (errSob) {
          await localClient.query('ROLLBACK');
          console.error(`❌ [SYNC-PAGOS-EFECTIVO] Error sincronizando sobre ${sob.codigo_sobre}:`, errSob.message);
        }
      }
    }

    if (!silent || subidosCount > 0 || bajadosCount > 0) {
      console.log(`🎉 [SYNC-PAGOS-EFECTIVO] Resumen -> Subidos: ${subidosCount} | Bajados/Recuperados: ${bajadosCount}`);
    }

    return {
      success: true,
      skipped: false,
      subidos: subidosCount,
      bajados: bajadosCount
    };
  } catch (errGeneral) {
    console.error('💥 [SYNC-PAGOS-EFECTIVO] Error general:', errGeneral.message);
    return {
      success: false,
      skipped: false,
      error: errGeneral.message,
      subidos: 0,
      bajados: 0
    };
  } finally {
    if (localClient) localClient.release();
  }
}

// Ejecución directa si se invoca desde CLI o Daemon fork
if (require.main === module) {
  console.log('═══════════════════════════════════════════════════════');
  console.log('📡 [SYNC-B2B-PAGOS-EFECTIVO] SINCRONIZADOR DE SOBRES DE EFECTIVO');
  console.log(`🔌 Conectado a BD Local: ${process.env.DB_NAME || 'etiquetas'}`);
  console.log('═══════════════════════════════════════════════════════');

  sincronizarPagosEfectivo()
    .then(async () => {
      if (standalonePool) await standalonePool.end();
      process.exit(0);
    })
    .catch(async (e) => {
      console.error('💥 Fallo de proceso:', e);
      if (standalonePool) await standalonePool.end();
      process.exit(1);
    });
}

module.exports = { sincronizarPagosEfectivo, esModoLaboratorioOSinCredencialesPagos };
