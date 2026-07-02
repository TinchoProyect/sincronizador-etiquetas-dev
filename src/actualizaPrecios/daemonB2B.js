// filepath: src/actualizaPrecios/daemonB2B.js
'use strict';

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
  precios: path.join(__dirname, 'syncB2BPrecios.js'),
  cuentas: path.join(__dirname, 'syncB2BCuentas.js'),
  listas: path.join(__dirname, 'syncB2BClientesListas.js'),
  estados: path.join(__dirname, 'syncB2BEstados.js'),
};

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
  await runScript('syncB2BEstados', PATHS.estados);
  runningJobs.pedidos = false;
}

async function executeCatalogJob() {
  if (runningJobs.catalog) {
    console.log('⚠️ [B2B-DAEMON] Ignorando ejecución de Catálogo/Cuentas/Listas: la tarea anterior sigue activa.');
    return;
  }
  runningJobs.catalog = true;
  // Corremos secuencialmente los tres actualizadores del catálogo y perfiles
  await runScript('syncB2BPrecios', PATHS.precios);
  await runScript('syncB2BCuentas', PATHS.cuentas);
  await runScript('syncB2BClientesListas', PATHS.listas);
  runningJobs.catalog = false;
}

// Ejecución Inicial al arrancar el Daemon
async function runInitialSync() {
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
