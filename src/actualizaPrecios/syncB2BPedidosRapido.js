// filepath: src/actualizaPrecios/syncB2BPedidosRapido.js
'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { esModoLaboratorioOSinCredencialesB2B } = require('./b2bAutoSyncTrigger');
const { procesarPedidosB2B } = require('./syncB2BPedidos');
const { sincronizarEstados } = require('./syncB2BEstados');

let _activeFastSyncPromise = null;
let _lastFullEstadosCheckMs = 0;

async function hayActividadRecienteEnSupabase() {
  const SUPABASE_URL = process.env.SUPABASE_B2B_URL;
  const SUPABASE_KEY = process.env.SUPABASE_B2B_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4500);
  try {
    const hace2MinIso = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const url = `${SUPABASE_URL}/rest/v1/clientes_b2b_pedidos_cabecera?or=(sync_estado.eq.Pendiente,and(updated_at.gte.${hace2MinIso},estado.in.(CANCELLED,Cancelado,Reclamado)))&select=id&limit=1`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!res.ok) return true;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch (_) {
    clearTimeout(timeoutId);
    return false;
  }
}

/**
 * Revisa únicamente si ingresaron pedidos nuevos, pedidos en Standby, confirmaciones,
 * ediciones o anulaciones de órdenes de compra desde el Portal B2B (sin tocar catálogo/precios).
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.force=false] - Si true, ejecuta ingesta + reconciliación de órdenes de inmediato
 * @param {Object} [opts.externalPool=null] - Pool PG opcional del servidor anfitrión
 */
async function revisarPedidosB2BRapido(opts = {}) {
  if (esModoLaboratorioOSinCredencialesB2B()) {
    return {
      success: true,
      skipped: true,
      modo_laboratorio: true,
      nuevos: 0,
      actualizados: 0,
      cancelados: 0,
      cambiosEstado: 0,
      totalNovedades: 0
    };
  }

  const force = Boolean(opts.force);
  const externalPool = opts.externalPool || null;

  if (_activeFastSyncPromise) {
    return _activeFastSyncPromise;
  }

  _activeFastSyncPromise = (async () => {
    try {
      const ahora = Date.now();
      if (!force) {
        const hayActividad = await hayActividadRecienteEnSupabase();
        const pasoUnMinuto = (ahora - _lastFullEstadosCheckMs) >= 60 * 1000;
        if (!hayActividad && !pasoUnMinuto) {
          return {
            success: true,
            skipped: false,
            probeOnly: true,
            nuevos: 0,
            actualizados: 0,
            cancelados: 0,
            cambiosEstado: 0,
            totalNovedades: 0
          };
        }
      }

      const resIngesta = await procesarPedidosB2B({
        externalPool,
        silent: !force
      });

      const resEstados = await sincronizarEstados({
        externalPool,
        silent: !force
      });

      _lastFullEstadosCheckMs = Date.now();

      const nuevos = Number(resIngesta?.nuevos || 0);
      const actualizados = Number(resIngesta?.actualizados || 0);
      const cancelados = Number(resEstados?.cancelados || 0);
      const cambiosEstado = Number(resEstados?.cambiosEstado || 0);
      const totalNovedades = nuevos + actualizados + cancelados;

      return {
        success: !resIngesta?.error && !resEstados?.error,
        skipped: false,
        nuevos,
        actualizados,
        cancelados,
        cambiosEstado,
        totalNovedades,
        error: resIngesta?.error || resEstados?.error || null
      };
    } catch (err) {
      console.error('❌ [SYNC-PEDIDOS-RAPIDO] Error:', err.message);
      return {
        success: false,
        skipped: false,
        error: err.message,
        nuevos: 0,
        actualizados: 0,
        cancelados: 0,
        cambiosEstado: 0,
        totalNovedades: 0
      };
    } finally {
      _activeFastSyncPromise = null;
    }
  })();

  return _activeFastSyncPromise;
}

module.exports = { revisarPedidosB2BRapido };
