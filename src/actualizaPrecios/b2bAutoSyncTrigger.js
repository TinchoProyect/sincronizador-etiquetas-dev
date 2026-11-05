// filepath: src/actualizaPrecios/b2bAutoSyncTrigger.js
'use strict';

require('dotenv').config();
const { fork } = require('child_process');
const path = require('path');

const SCRIPTS = {
  precios: { name: 'Catálogo y Precios', path: path.join(__dirname, 'syncB2BPrecios.js') },
  listas: { name: 'Clientes y Listas', path: path.join(__dirname, 'syncB2BClientesListas.js') },
  cuentas: { name: 'Cuentas Corrientes', path: path.join(__dirname, 'syncB2BCuentas.js') },
  politicas: { name: 'Políticas Comerciales', path: path.join(__dirname, 'syncB2BPoliticas.js') },
  ofertas: { name: 'Ofertas Dinámicas', path: path.join(__dirname, 'syncB2BOfertas.js') },
  estados: { name: 'Estados Logísticos', path: path.join(__dirname, 'syncB2BEstados.js') },
  pedidos: { name: 'Pedidos B2B', path: path.join(__dirname, 'syncB2BPedidos.js') },
  colaboradores: { name: 'Servicios Colaborador', path: path.join(__dirname, 'syncB2BColaboradores.js') }
};

const timers = new Map();
const running = new Set();
const pendingReRun = new Map();

const PROD_SUPABASE_ID = 'zysyxtbcvgswancxtpib';

function esModoLaboratorioOSinCredencialesB2B() {
  const dbName = String(process.env.DB_NAME || '').trim().toLowerCase();
  const flagLab = String(process.env.LAMDA_MODO_LABORATORIO || '').trim().toLowerCase();
  const isLab = dbName === 'etiquetas_pruebas' || flagLab === 'true' || flagLab === '1';
  const supaUrl = String(process.env.SUPABASE_B2B_URL || '').trim().toLowerCase();
  const supaKey = String(process.env.SUPABASE_B2B_SERVICE_KEY || '').trim();
  const sinSupaValido = !supaUrl || !supaKey || supaUrl.includes('127.0.0.1') || supaKey === 'modo_laboratorio_desconectado';

  // CANDADO INQUEBRANTABLE: Jamás permitir que Modo Laboratorio toque el Supabase de Producción
  if (isLab && supaUrl.includes(PROD_SUPABASE_ID)) {
    return true;
  }
  const sandboxHabilitado = String(process.env.LAMDA_B2B_SANDBOX_ENABLED || '').trim().toLowerCase() === 'true';
  if (isLab && !sandboxHabilitado) {
    return true;
  }
  return sinSupaValido;
}

/**
 * Dispara en segundo plano (no bloqueante, con debounce y cola de re-ejecución)
 * la sincronización hacia Supabase Cloud cuando ocurre un cambio relevante en local.
 *
 * En Modo Laboratorio (o cuando las credenciales B2B están desconectadas),
 * bloquea el disparo para jamás contaminar el Supabase B2B real de Producción.
 *
 * @param {'precios'|'listas'|'cuentas'|'politicas'|'ofertas'|'estados'|'pedidos'} tipo
 * @param {string} [motivo='Cambio local'] - Descripción breve para trazabilidad en consola
 * @param {number} [debounceMs=2500] - Ventana de amortiguación en milisegundos
 */
function triggerB2BSync(tipo, motivo = 'Cambio local', debounceMs = 2500) {
  if (esModoLaboratorioOSinCredencialesB2B()) {
    return;
  }

  const scriptInfo = SCRIPTS[tipo];
  if (!scriptInfo) {
    console.warn(`⚠️ [B2B-AUTO-SYNC] Tipo de sincronización desconocido: "${tipo}"`);
    return;
  }

  // Si ya hay un timer esperando para este tipo, reiniciarlo (debounce)
  if (timers.has(tipo)) {
    clearTimeout(timers.get(tipo));
  }

  const timerId = setTimeout(() => {
    timers.delete(tipo);
    ejecutarSyncEnBackground(tipo, motivo);
  }, debounceMs);

  timers.set(tipo, timerId);
}

function ejecutarSyncEnBackground(tipo, motivo) {
  if (esModoLaboratorioOSinCredencialesB2B()) {
    return;
  }

  const scriptInfo = SCRIPTS[tipo];
  if (!scriptInfo) return;

  // Si ya está corriendo este mismo script, encolar 1 re-ejecución al terminar
  // para garantizar que el último cambio hecho por el usuario nunca se pierda.
  if (running.has(tipo)) {
    pendingReRun.set(tipo, motivo);
    console.log(`⏳ [B2B-AUTO-SYNC] ${scriptInfo.name} ya está en ejecución. Se encoló re-sincronización por: "${motivo}".`);
    return;
  }

  running.add(tipo);
  const startMs = Date.now();
  console.log(`⚡ [B2B-AUTO-SYNC] Disparando "${scriptInfo.name}" en 2do plano (Motivo: ${motivo})...`);

  try {
    const child = fork(scriptInfo.path, [], {
      env: { ...process.env, NODE_ENV: 'production' },
      stdio: 'ignore' // Silencioso para no saturar consola del servidor principal
    });

    child.on('close', (code) => {
      running.delete(tipo);
      const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
      if (code === 0) {
        console.log(`✅ [B2B-AUTO-SYNC] "${scriptInfo.name}" actualizado en Supabase en ${elapsed}s (Motivo: ${motivo}).`);
      } else {
        console.warn(`⚠️ [B2B-AUTO-SYNC] "${scriptInfo.name}" finalizó con código ${code} (${elapsed}s).`);
      }

      // Si entró otro cambio mientras corría, ejecutar una vez más
      if (pendingReRun.has(tipo)) {
        const nextMotivo = pendingReRun.get(tipo);
        pendingReRun.delete(tipo);
        setTimeout(() => ejecutarSyncEnBackground(tipo, nextMotivo), 500);
      }
    });

    child.on('error', (err) => {
      running.delete(tipo);
      console.error(`❌ [B2B-AUTO-SYNC] Error al lanzar "${scriptInfo.name}":`, err.message);
    });
  } catch (err) {
    running.delete(tipo);
    console.error(`❌ [B2B-AUTO-SYNC] Excepción al lanzar "${scriptInfo.name}":`, err.message);
  }
}

/**
 * Middleware Express no bloqueante que detecta operaciones locales de escritura (HTTP 2xx)
 * y dispara automáticamente la sincronización correspondiente del Portal B2B en segundo plano.
 */
function createB2BAutoSyncMiddleware(moduleName = 'app') {
  return function b2bAutoSyncMiddleware(req, res, next) {
    if (esModoLaboratorioOSinCredencialesB2B()) {
      return next();
    }

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      res.on('finish', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const url = String(req.originalUrl || req.url || '').toLowerCase();

          // Ignorar endpoints de solo lectura/impresión/reportes que usan POST
          if (/imprimir|exportar-pdf|\/pdf|\/sync-b2b|lotes_vinculos\/estados|\/login|\/auth|\/telemetria|\/whatsapp|\/email|generar-vinculo/i.test(url)) {
            return;
          }

          const motivo = `[${moduleName}] ${req.method} ${req.originalUrl || req.url}`;

          if (url.includes('/bunker/clientes') || url.includes('/clientes') || url.includes('b2b-onboarding/invitar') || url.includes('completar-onboarding')) {
            triggerB2BSync('listas', motivo);
          } else if (url.includes('cuentas-corrientes') || url.includes('pagos-efectivo') || url.includes('/facturacion/facturas')) {
            triggerB2BSync('cuentas', motivo);
          } else if (url.includes('/jornadas') || url.includes('/tarifas')) {
            triggerB2BSync('colaboradores', motivo);
            triggerB2BSync('cuentas', motivo);
          } else if (url.includes('ofertas-dinamicas') || url.includes('/ofertas')) {
            triggerB2BSync('ofertas', motivo);
          } else if (url.includes('politicas')) {
            triggerB2BSync('politicas', motivo);
          } else if (url.includes('b2b-jerarquia') || url.includes('portal-b2b-jerarquia')) {
            triggerB2BSync('precios', motivo);
            triggerB2BSync('listas', motivo);
          } else if (url.includes('/bunker') || url.includes('/articulos') || url.includes('/produccion') || url.includes('b2b-fotos-lotes')) {
            triggerB2BSync('precios', motivo);
            if (url.includes('/listas')) {
              triggerB2BSync('listas', motivo);
            }
          } else if (url.includes('/presupuestos') || url.includes('/rutas') || url.includes('/auditorias')) {
            triggerB2BSync('precios', motivo);
            triggerB2BSync('estados', motivo);
          }
        }
      });
    }
    next();
  };
}

module.exports = { triggerB2BSync, createB2BAutoSyncMiddleware };
