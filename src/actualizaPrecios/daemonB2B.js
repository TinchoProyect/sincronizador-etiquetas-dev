// filepath: src/actualizaPrecios/daemonB2B.js
'use strict';

require('dotenv').config();
const { fork } = require('child_process');
const path = require('path');

console.log('═══════════════════════════════════════════════════════');
console.log('🛡️  [B2B-DAEMON] INICIANDO MOTOR DE COMUNICACIÓN SUPABASE');
console.log('═══════════════════════════════════════════════════════');
console.log(`⏰ Intervalo Pedidos: cada 1 minuto`);
console.log(`⏰ Intervalo Catálogo/Cuentas/Listas: cada 15 minutos`);
console.log('═══════════════════════════════════════════════════════');

const PATHS = {
  pedidos: path.join(__dirname, 'syncB2BPedidos.js'),
  retiros: path.join(__dirname, 'syncB2BRetiros.js'),
  pagosEfectivo: path.join(__dirname, 'syncB2BPagosEfectivo.js'),
  precios: path.join(__dirname, 'syncB2BPrecios.js'),
  cuentas: path.join(__dirname, 'syncB2BCuentas.js'),
  listas: path.join(__dirname, 'syncB2BClientesListas.js'),
  habituales: path.join(__dirname, 'syncB2BHabituales.js'),
  estados: path.join(__dirname, 'syncB2BEstados.js'),
  politicas: path.join(__dirname, 'syncB2BPoliticas.js'),
  ofertas: path.join(__dirname, 'syncB2BOfertas.js'),
};

const PROD_SUPABASE_ID = 'zysyxtbcvgswancxtpib';

function esModoLaboratorioB2B() {
  const daemonDisabled = String(process.env.DAEMON_B2B_DISABLED || '').trim().toLowerCase();
  if (daemonDisabled === 'true' || daemonDisabled === '1') {
    return true;
  }
  const dbName = String(process.env.DB_NAME || '').trim().toLowerCase();
  const flagLab = String(process.env.LAMDA_MODO_LABORATORIO || '').trim().toLowerCase();
  const flagNube = String(process.env.LAMDA_MODO_PRUEBA_NUBE || '').trim().toLowerCase();
  const isLab = dbName === 'etiquetas_pruebas' || flagLab === 'true' || flagLab === '1';
  const isPruebaNube = flagNube === 'true' || flagNube === '1';
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

// Helper para correr un script como fork child process (No bloqueante, tolerante a fallos)
function runScript(scriptName, scriptPath) {
  return new Promise((resolve) => {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`🚀 [${timestamp}] [B2B-DAEMON] Ejecutando: ${scriptName}...`);

    const child = fork(scriptPath, [], {
      env: { ...process.env, NODE_ENV: 'production' }
    });

    child.on('close', (code) => {
      const finishTime = new Date().toLocaleTimeString();
      if (code === 0) {
        console.log(`✅ [${finishTime}] [B2B-DAEMON] ${scriptName} finalizó exitosamente.`);
      } else {
        console.error(`❌ [${finishTime}] [B2B-DAEMON] ${scriptName} falló con código de salida ${code}.`);
      }
      resolve();
    });

    child.on('error', (err) => {
      console.error(`💥 [B2B-DAEMON] Error al lanzar ${scriptName}:`, err.message);
      resolve();
    });
  });
}

// Bandera para evitar ejecuciones concurrentes de la misma tarea
let runningJobs = {
  pedidos: false,
  catalog: false,
};

async function executePedidosJob() {
  if (runningJobs.pedidos) {
    console.log('⚠️ [B2B-DAEMON] Ignorando ejecución de Pedidos: la tarea anterior sigue activa.');
    return;
  }
  runningJobs.pedidos = true;
  await runScript('syncB2BPedidos', PATHS.pedidos);
  await runScript('syncB2BRetiros', PATHS.retiros);
  await runScript('syncB2BPagosEfectivo', PATHS.pagosEfectivo);
  await runScript('syncB2BEstados', PATHS.estados);
  runningJobs.pedidos = false;
}

async function executeCatalogJob() {
  if (runningJobs.catalog) {
    console.log('⚠️ [B2B-DAEMON] Ignorando ejecución de Catálogo/Cuentas/Listas: la tarea anterior sigue activa.');
    return;
  }
  runningJobs.catalog = true;
  // Corremos secuencialmente los actualizadores del catálogo, perfiles y favoritos
  await runScript('syncB2BPrecios', PATHS.precios);
  await runScript('syncB2BCuentas', PATHS.cuentas);
  await runScript('syncB2BClientesListas', PATHS.listas);
  await runScript('syncB2BHabituales', PATHS.habituales);
  await runScript('syncB2BPoliticas', PATHS.politicas);
  await runScript('syncB2BOfertas', PATHS.ofertas);
  runningJobs.catalog = false;
}

// Ejecución Inicial al arrancar el Daemon
async function runInitialSync() {
  if (esModoLaboratorioB2B()) {
    console.log(`🔒 [B2B-DAEMON] MODO LABORATORIO ACTIVO (BD: ${process.env.DB_NAME || 'etiquetas_pruebas'}): Sincronización automática con Supabase B2B real PAUSADA preventivamente para no contaminar Producción.`);
    setInterval(() => {}, 60 * 60 * 1000);
    return;
  }

  console.log('⚡ [B2B-DAEMON] Ejecutando sincronización de arranque inicial...');
  await executeCatalogJob();
  await executePedidosJob();
  console.log('🎉 [B2B-DAEMON] Sincronización de arranque completada. Entrando en ciclo regular.');
  
  // Programar intervalos
  setInterval(executePedidosJob, 60 * 1000); // Cada 1 minuto
  setInterval(executeCatalogJob, 15 * 60 * 1000); // Cada 15 minutos
}

runInitialSync().catch(err => {
  console.error('💥 Error crítico en el bucle principal del B2B Daemon:', err);
});
