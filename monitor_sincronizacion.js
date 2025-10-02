// MONITOR DE SINCRONIZACIÓN EN TIEMPO REAL
// Herramienta para monitoreo continuo y alertas automáticas

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

/**
 * CONFIGURACIÓN DEL MONITOR
 */
const CONFIG_MONITOR = {
  intervalo_segundos: 30,
  max_presupuestos_sin_map: 5,
  max_detalles_huerfanos: 10,
  max_tiempo_sin_sync_minutos: 60,
  archivo_log: 'monitor_sync.log',
  alertas_activas: true
};

/**
 * FUNCIÓN DE LOGGING
 */
function log(mensaje, nivel = 'INFO') {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [${nivel}] ${mensaje}`;
  
  console.log(logLine);
  
  // Escribir a archivo
  try {
    fs.appendFileSync(CONFIG_MONITOR.archivo_log, logLine + '\n');
  } catch (error) {
    console.error('Error escribiendo log:', error.message);
  }
}

/**
 * VERIFICAR ESTADO GENERAL
 */
async function verificarEstadoGeneral() {
  try {
    const estado = {
      timestamp: new Date(),
      presupuestos_sin_map: 0,
      detalles_huerfanos: 0,
      ultima_sync: null,
      problemas: [],
      alertas: []
    };
    
    // 1. Presupuestos sin MAP
    const sinMap = await pool.query(`
      SELECT COUNT(*) as count
      FROM presupuestos p
      INNER JOIN presupuestos_detalles d ON d.id_presupuesto_ext = p.id_presupuesto_ext
      LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
      WHERE p.activo = true AND m.local_detalle_id IS NULL
    `);
    
    estado.presupuestos_sin_map = parseInt(sinMap.rows[0].count);
    
    // 2. Detalles huérfanos en MAP
    const huerfanos = await pool.query(`
      SELECT COUNT(*) as count
      FROM presupuestos_detalles_map m
      LEFT JOIN presupuestos_detalles d ON d.id = m.local_detalle_id
      WHERE d.id IS NULL
    `);
    
    estado.detalles_huerfanos = parseInt(huerfanos.rows[0].count);
    
    // 3. Última sincronización
    const ultimaSync = await pool.query(`
      SELECT fecha_sync, exitoso, registros_procesados
      FROM presupuestos_sync_log
      ORDER BY fecha_sync DESC
      LIMIT 1
    `);
    
    if (ultimaSync.rowCount > 0) {
      estado.ultima_sync = {
        fecha: ultimaSync.rows[0].fecha_sync,
        exitoso: ultimaSync.rows[0].exitoso,
        registros: ultimaSync.rows[0].registros_procesados,
        minutos_transcurridos: Math.floor((Date.now() - new Date(ultimaSync.rows[0].fecha_sync)) / (1000 * 60))
      };
    }
    
    // 4. Generar alertas
    if (estado.presupuestos_sin_map > CONFIG_MONITOR.max_presupuestos_sin_map) {
      estado.alertas.push(`CRÍTICO: ${estado.presupuestos_sin_map} presupuestos sin MAP (límite: ${CONFIG_MONITOR.max_presupuestos_sin_map})`);
    }
    
    if (estado.detalles_huerfanos > CONFIG_MONITOR.max_detalles_huerfanos) {
      estado.alertas.push(`ADVERTENCIA: ${estado.detalles_huerfanos} detalles huérfanos en MAP (límite: ${CONFIG_MONITOR.max_detalles_huerfanos})`);
    }
    
    if (estado.ultima_sync && estado.ultima_sync.minutos_transcurridos > CONFIG_MONITOR.max_tiempo_sin_sync_minutos) {
      estado.alertas.push(`ADVERTENCIA: ${estado.ultima_sync.minutos_transcurridos} minutos sin sincronización (límite: ${CONFIG_MONITOR.max_tiempo_sin_sync_minutos})`);
    }
    
    if (estado.ultima_sync && !estado.ultima_sync.exitoso) {
      estado.alertas.push(`ERROR: Última sincronización falló`);
    }
    
    return estado;
    
  } catch (error) {
    log(`Error verificando estado: ${error.message}`, 'ERROR');
    return null;
  }
}

/**
 * DETECTAR CAMBIOS RECIENTES
 */
async function detectarCambiosRecientes() {
  try {
    const hace5min = new Date(Date.now() - 5 * 60 * 1000);
    
    // Presupuestos modificados en últimos 5 minutos
    const cambiosRecientes = await pool.query(`
      SELECT 
        p.id_presupuesto_ext,
        p.fecha_actualizacion,
        COUNT(d.id) as detalles,
        COUNT(m.local_detalle_id) as map_entries
      FROM presupuestos p
      LEFT JOIN presupuestos_detalles d ON d.id_presupuesto_ext = p.id_presupuesto_ext
      LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
      WHERE p.activo = true 
        AND p.fecha_actualizacion > $1
      GROUP BY p.id_presupuesto_ext, p.fecha_actualizacion
      ORDER BY p.fecha_actualizacion DESC
    `, [hace5min]);
    
    const cambios = {
      total: cambiosRecientes.rowCount,
      con_problemas: 0,
      detalles: []
    };
    
    cambiosRecientes.rows.forEach(c => {
      const tieneProblemas = c.detalles > 0 && c.map_entries === 0;
      if (tieneProblemas) {
        cambios.con_problemas++;
        cambios.detalles.push({
          id: c.id_presupuesto_ext,
          problema: 'SIN_MAP',
          detalles: c.detalles
        });
      }
    });
    
    return cambios;
    
  } catch (error) {
    log(`Error detectando cambios: ${error.message}`, 'ERROR');
    return null;
  }
}

/**
 * GENERAR REPORTE DE ESTADO
 */
function generarReporte(estado, cambios) {
  const reporte = [];
  
  reporte.push('📊 ESTADO DE SINCRONIZACIÓN');
  reporte.push('='.repeat(50));
  reporte.push(`⏰ Timestamp: ${estado.timestamp.toISOString()}`);
  reporte.push('');
  
  // Estado general
  reporte.push('📈 MÉTRICAS GENERALES:');
  reporte.push(`   Presupuestos sin MAP: ${estado.presupuestos_sin_map}`);
  reporte.push(`   Detalles huérfanos: ${estado.detalles_huerfanos}`);
  
  if (estado.ultima_sync) {
    reporte.push(`   Última sync: ${estado.ultima_sync.fecha} (${estado.ultima_sync.minutos_transcurridos} min ago)`);
    reporte.push(`   Última sync exitosa: ${estado.ultima_sync.exitoso ? 'SÍ' : 'NO'}`);
    reporte.push(`   Registros procesados: ${estado.ultima_sync.registros}`);
  } else {
    reporte.push(`   Última sync: NO ENCONTRADA`);
  }
  
  reporte.push('');
  
  // Cambios recientes
  if (cambios) {
    reporte.push('🔄 CAMBIOS RECIENTES (últimos 5 min):');
    reporte.push(`   Total modificados: ${cambios.total}`);
    reporte.push(`   Con problemas: ${cambios.con_problemas}`);
    
    if (cambios.con_problemas > 0) {
      reporte.push('   Detalles de problemas:');
      cambios.detalles.forEach(d => {
        reporte.push(`     - ${d.id}: ${d.problema} (${d.detalles} detalles)`);
      });
    }
    reporte.push('');
  }
  
  // Alertas
  if (estado.alertas.length > 0) {
    reporte.push('🚨 ALERTAS:');
    estado.alertas.forEach(alerta => {
      reporte.push(`   ${alerta}`);
    });
    reporte.push('');
  } else {
    reporte.push('✅ Sin alertas activas');
    reporte.push('');
  }
  
  return reporte.join('\n');
}

/**
 * CICLO PRINCIPAL DEL MONITOR
 */
async function cicloMonitor() {
  log('🚀 Iniciando ciclo de monitoreo');
  
  try {
    // Verificar estado
    const estado = await verificarEstadoGeneral();
    if (!estado) {
      log('❌ No se pudo obtener estado general', 'ERROR');
      return;
    }
    
    // Detectar cambios
    const cambios = await detectarCambiosRecientes();
    
    // Generar reporte
    const reporte = generarReporte(estado, cambios);
    
    // Mostrar reporte si hay alertas o cambios
    if (estado.alertas.length > 0 || (cambios && cambios.con_problemas > 0)) {
      console.clear();
      console.log(reporte);
      
      if (CONFIG_MONITOR.alertas_activas) {
        estado.alertas.forEach(alerta => {
          log(alerta, 'ALERT');
        });
      }
    } else {
      // Solo log silencioso si todo está bien
      log(`✅ Estado OK - MAP:${estado.presupuestos_sin_map} Huérfanos:${estado.detalles_huerfanos} Cambios:${cambios?.total || 0}`);
    }
    
  } catch (error) {
    log(`❌ Error en ciclo de monitoreo: ${error.message}`, 'ERROR');
  }
}

/**
 * FUNCIÓN PRINCIPAL
 */
async function iniciarMonitor() {
  log('🔍 INICIANDO MONITOR DE SINCRONIZACIÓN');
  log(`📊 Configuración: intervalo=${CONFIG_MONITOR.intervalo_segundos}s, alertas=${CONFIG_MONITOR.alertas_activas}`);
  
  // Ejecutar primer ciclo inmediatamente
  await cicloMonitor();
  
  // Programar ciclos regulares
  const intervalo = setInterval(async () => {
    await cicloMonitor();
  }, CONFIG_MONITOR.intervalo_segundos * 1000);
  
  // Manejar cierre limpio
  process.on('SIGINT', () => {
    log('🛑 Deteniendo monitor...');
    clearInterval(intervalo);
    pool.end().then(() => {
      log('✅ Monitor detenido');
      process.exit(0);
    });
  });
  
  log('✅ Monitor iniciado. Presiona Ctrl+C para detener.');
}

/**
 * MODO DE EJECUCIÓN ÚNICA (SNAPSHOT)
 */
async function ejecutarSnapshot() {
  log('📸 EJECUTANDO SNAPSHOT DE ESTADO');
  
  try {
    const estado = await verificarEstadoGeneral();
    const cambios = await detectarCambiosRecientes();
    
    if (estado) {
      const reporte = generarReporte(estado, cambios);
      console.log(reporte);
      
      // Guardar snapshot en archivo
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const archivoSnapshot = `snapshot_${timestamp}.txt`;
      fs.writeFileSync(archivoSnapshot, reporte);
      log(`📄 Snapshot guardado en: ${archivoSnapshot}`);
    }
    
  } catch (error) {
    log(`❌ Error en snapshot: ${error.message}`, 'ERROR');
  } finally {
    await pool.end();
  }
}

// EJECUCIÓN DESDE LÍNEA DE COMANDOS
const modo = process.argv[2];

if (modo === 'snapshot') {
  ejecutarSnapshot().catch(console.error);
} else if (modo === 'monitor' || !modo) {
  iniciarMonitor().catch(console.error);
} else {
  console.log('🔍 MONITOR DE SINCRONIZACIÓN');
  console.log('='.repeat(50));
  console.log('📋 Uso:');
  console.log('   node monitor_sincronizacion.js [modo]');
  console.log('');
  console.log('📋 Modos disponibles:');
  console.log('   monitor  - Monitoreo continuo (por defecto)');
  console.log('   snapshot - Ejecutar una sola verificación');
  console.log('');
  console.log('📋 Ejemplos:');
  console.log('   node monitor_sincronizacion.js');
  console.log('   node monitor_sincronizacion.js monitor');
  console.log('   node monitor_sincronizacion.js snapshot');
}
