// AUTO-REPARACIÓN DE PROBLEMAS COMUNES
// Herramienta para correcciones automáticas y mantenimiento preventivo

const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

/**
 * CONFIGURACIÓN DE AUTO-REPARACIÓN
 */
const CONFIG_REPARACION = {
  max_presupuestos_por_lote: 50,
  backup_antes_reparacion: true,
  log_detallado: true,
  modo_seguro: true // Si es true, solo reporta, no ejecuta cambios
};

/**
 * FUNCIÓN DE LOGGING
 */
function log(mensaje, nivel = 'INFO') {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [${nivel}] ${mensaje}`;
  console.log(logLine);
  
  // Escribir a archivo de log
  try {
    fs.appendFileSync('auto_reparacion.log', logLine + '\n');
  } catch (error) {
    console.error('Error escribiendo log:', error.message);
  }
}

/**
 * CREAR BACKUP DE SEGURIDAD
 */
async function crearBackup() {
  if (!CONFIG_REPARACION.backup_antes_reparacion) {
    return true;
  }
  
  log('💾 Creando backup de seguridad...');
  
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archivoBackup = `backup_map_${timestamp}.sql`;
    
    // Exportar tabla MAP
    const mapData = await pool.query('SELECT * FROM presupuestos_detalles_map ORDER BY local_detalle_id');
    
    let sqlBackup = `-- BACKUP presupuestos_detalles_map - ${timestamp}\n`;
    sqlBackup += `-- Total registros: ${mapData.rowCount}\n\n`;
    sqlBackup += `DELETE FROM presupuestos_detalles_map;\n\n`;
    
    mapData.rows.forEach(row => {
      sqlBackup += `INSERT INTO presupuestos_detalles_map (local_detalle_id, id_detalle_presupuesto, fuente, fecha_asignacion) VALUES (${row.local_detalle_id}, '${row.id_detalle_presupuesto}', '${row.fuente}', '${row.fecha_asignacion}');\n`;
    });
    
    fs.writeFileSync(archivoBackup, sqlBackup);
    log(`✅ Backup creado: ${archivoBackup} (${mapData.rowCount} registros)`);
    
    return true;
    
  } catch (error) {
    log(`❌ Error creando backup: ${error.message}`, 'ERROR');
    return false;
  }
}

/**
 * REPARACIÓN 1: CREAR MAP FALTANTE
 */
async function repararMapFaltante() {
  log('🔧 REPARACIÓN 1: Creando MAP faltante');
  
  try {
    // Encontrar detalles sin MAP
    const detallesSinMap = await pool.query(`
      SELECT 
        d.id,
        d.id_presupuesto_ext,
        d.articulo,
        d.cantidad,
        d.valor1,
        d.precio1,
        d.iva1,
        d.diferencia,
        d.camp1,
        d.camp2,
        d.camp3,
        d.camp4,
        d.camp5,
        d.camp6,
        p.hoja_nombre
      FROM presupuestos_detalles d
      INNER JOIN presupuestos p ON p.id_presupuesto_ext = d.id_presupuesto_ext
      LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
      WHERE p.activo = true 
        AND m.local_detalle_id IS NULL
      ORDER BY d.id
      LIMIT $1
    `, [CONFIG_REPARACION.max_presupuestos_por_lote]);
    
    log(`📊 Encontrados ${detallesSinMap.rowCount} detalles sin MAP`);
    
    if (detallesSinMap.rowCount === 0) {
      log('✅ No hay detalles sin MAP');
      return { reparados: 0, errores: 0 };
    }
    
    let reparados = 0;
    let errores = 0;
    
    if (!CONFIG_REPARACION.modo_seguro) {
      await pool.query('BEGIN');
    }
    
    for (const detalle of detallesSinMap.rows) {
      try {
        // Generar ID único para Sheets
        const crypto = require('crypto');
        const timestamp = Date.now() + Math.random() * 1000;
        const hash = crypto.createHash('sha1')
          .update(`${detalle.id_presupuesto_ext}|${detalle.articulo}|${detalle.cantidad}|${detalle.valor1}|${detalle.precio1}|${detalle.iva1}|${detalle.diferencia}|${detalle.camp1}|${detalle.camp2}|${detalle.camp3}|${detalle.camp4}|${detalle.camp5}|${detalle.camp6}|${timestamp}`)
          .digest('hex');
        
        const idDetallePresupuesto = `${hash.slice(0, 8)}-${hash.slice(8, 12)}`;
        
        // Verificar unicidad
        const existeId = await pool.query(`
          SELECT 1 FROM presupuestos_detalles_map 
          WHERE id_detalle_presupuesto = $1
        `, [idDetallePresupuesto]);
        
        if (existeId.rowCount > 0) {
          log(`⚠️ ID duplicado generado: ${idDetallePresupuesto}`, 'WARN');
          errores++;
          continue;
        }
        
        // Determinar fuente
        const fuente = detalle.hoja_nombre ? 'AppSheet' : 'Local';
        
        if (CONFIG_REPARACION.modo_seguro) {
          log(`[MODO SEGURO] Crearía MAP: local=${detalle.id} → sheet=${idDetallePresupuesto} (${fuente})`);
        } else {
          // Crear MAP
          await pool.query(`
            INSERT INTO presupuestos_detalles_map
            (local_detalle_id, id_detalle_presupuesto, fuente, fecha_asignacion)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires')
          `, [detalle.id, idDetallePresupuesto, fuente]);
          
          if (CONFIG_REPARACION.log_detallado) {
            log(`✅ MAP creado: local=${detalle.id} → sheet=${idDetallePresupuesto} (${fuente})`);
          }
        }
        
        reparados++;
        
      } catch (error) {
        log(`❌ Error procesando detalle ${detalle.id}: ${error.message}`, 'ERROR');
        errores++;
      }
    }
    
    if (!CONFIG_REPARACION.modo_seguro) {
      await pool.query('COMMIT');
      log(`✅ Transacción confirmada: ${reparados} MAP creados`);
    } else {
      log(`[MODO SEGURO] Se crearían ${reparados} MAP`);
    }
    
    return { reparados, errores };
    
  } catch (error) {
    if (!CONFIG_REPARACION.modo_seguro) {
      await pool.query('ROLLBACK');
    }
    log(`❌ Error en reparación MAP: ${error.message}`, 'ERROR');
    return { reparados: 0, errores: 1 };
  }
}

/**
 * REPARACIÓN 2: LIMPIAR MAP HUÉRFANOS
 */
async function repararMapHuerfanos() {
  log('🔧 REPARACIÓN 2: Limpiando MAP huérfanos');
  
  try {
    // Encontrar MAP huérfanos
    const mapHuerfanos = await pool.query(`
      SELECT m.local_detalle_id, m.id_detalle_presupuesto
      FROM presupuestos_detalles_map m
      LEFT JOIN presupuestos_detalles d ON d.id = m.local_detalle_id
      WHERE d.id IS NULL
    `);
    
    log(`📊 Encontrados ${mapHuerfanos.rowCount} MAP huérfanos`);
    
    if (mapHuerfanos.rowCount === 0) {
      log('✅ No hay MAP huérfanos');
      return { eliminados: 0 };
    }
    
    if (CONFIG_REPARACION.modo_seguro) {
      log(`[MODO SEGURO] Se eliminarían ${mapHuerfanos.rowCount} MAP huérfanos`);
      mapHuerfanos.rows.forEach((m, i) => {
        if (i < 5) { // Mostrar solo primeros 5
          log(`[MODO SEGURO] Eliminaría: local=${m.local_detalle_id} sheet=${m.id_detalle_presupuesto}`);
        }
      });
      return { eliminados: mapHuerfanos.rowCount };
    }
    
    // Eliminar MAP huérfanos
    const resultado = await pool.query(`
      DELETE FROM presupuestos_detalles_map 
      WHERE local_detalle_id NOT IN (
        SELECT id FROM presupuestos_detalles
      )
    `);
    
    log(`✅ Eliminados ${resultado.rowCount} MAP huérfanos`);
    
    return { eliminados: resultado.rowCount };
    
  } catch (error) {
    log(`❌ Error limpiando MAP huérfanos: ${error.message}`, 'ERROR');
    return { eliminados: 0 };
  }
}

/**
 * REPARACIÓN 3: CORREGIR DUPLICADOS EN MAP
 */
async function repararDuplicadosMap() {
  log('🔧 REPARACIÓN 3: Corrigiendo duplicados en MAP');
  
  try {
    // Encontrar duplicados por id_detalle_presupuesto
    const duplicados = await pool.query(`
      SELECT id_detalle_presupuesto, COUNT(*) as count, 
             array_agg(local_detalle_id ORDER BY fecha_asignacion DESC) as detalle_ids
      FROM presupuestos_detalles_map
      GROUP BY id_detalle_presupuesto
      HAVING COUNT(*) > 1
      ORDER BY count DESC
    `);
    
    log(`📊 Encontrados ${duplicados.rowCount} IDs duplicados en MAP`);
    
    if (duplicados.rowCount === 0) {
      log('✅ No hay duplicados en MAP');
      return { corregidos: 0 };
    }
    
    let corregidos = 0;
    
    if (!CONFIG_REPARACION.modo_seguro) {
      await pool.query('BEGIN');
    }
    
    for (const dup of duplicados.rows) {
      try {
        const detalleIds = dup.detalle_ids;
        const mantener = detalleIds[0]; // El más reciente
        const eliminar = detalleIds.slice(1); // Los demás
        
        if (CONFIG_REPARACION.modo_seguro) {
          log(`[MODO SEGURO] Mantendría local=${mantener}, eliminaría: ${eliminar.join(', ')}`);
        } else {
          // Eliminar duplicados, mantener el más reciente
          await pool.query(`
            DELETE FROM presupuestos_detalles_map 
            WHERE id_detalle_presupuesto = $1 
              AND local_detalle_id = ANY($2)
          `, [dup.id_detalle_presupuesto, eliminar]);
          
          if (CONFIG_REPARACION.log_detallado) {
            log(`✅ Duplicado corregido: ${dup.id_detalle_presupuesto} (eliminados: ${eliminar.length})`);
          }
        }
        
        corregidos++;
        
      } catch (error) {
        log(`❌ Error corrigiendo duplicado ${dup.id_detalle_presupuesto}: ${error.message}`, 'ERROR');
      }
    }
    
    if (!CONFIG_REPARACION.modo_seguro) {
      await pool.query('COMMIT');
      log(`✅ Duplicados corregidos: ${corregidos}`);
    } else {
      log(`[MODO SEGURO] Se corregirían ${corregidos} duplicados`);
    }
    
    return { corregidos };
    
  } catch (error) {
    if (!CONFIG_REPARACION.modo_seguro) {
      await pool.query('ROLLBACK');
    }
    log(`❌ Error corrigiendo duplicados: ${error.message}`, 'ERROR');
    return { corregidos: 0 };
  }
}

/**
 * REPARACIÓN 4: VERIFICAR INTEGRIDAD REFERENCIAL
 */
async function verificarIntegridadReferencial() {
  log('🔧 REPARACIÓN 4: Verificando integridad referencial');
  
  try {
    const problemas = [];
    
    // 1. Detalles sin presupuesto padre
    const detallesHuerfanos = await pool.query(`
      SELECT d.id, d.id_presupuesto_ext
      FROM presupuestos_detalles d
      LEFT JOIN presupuestos p ON p.id_presupuesto_ext = d.id_presupuesto_ext
      WHERE p.id_presupuesto_ext IS NULL
    `);
    
    if (detallesHuerfanos.rowCount > 0) {
      problemas.push(`${detallesHuerfanos.rowCount} detalles sin presupuesto padre`);
      log(`⚠️ ${detallesHuerfanos.rowCount} detalles huérfanos encontrados`, 'WARN');
    }
    
    // 2. Presupuestos sin ID externo
    const presupuestosSinId = await pool.query(`
      SELECT COUNT(*) as count
      FROM presupuestos
      WHERE id_presupuesto_ext IS NULL AND activo = true
    `);
    
    if (parseInt(presupuestosSinId.rows[0].count) > 0) {
      problemas.push(`${presupuestosSinId.rows[0].count} presupuestos sin ID externo`);
      log(`⚠️ ${presupuestosSinId.rows[0].count} presupuestos sin ID externo`, 'WARN');
    }
    
    // 3. Inconsistencias en fuente MAP
    const fuentesInconsistentes = await pool.query(`
      SELECT m.fuente, COUNT(*) as count
      FROM presupuestos_detalles_map m
      INNER JOIN presupuestos_detalles d ON d.id = m.local_detalle_id
      INNER JOIN presupuestos p ON p.id_presupuesto_ext = d.id_presupuesto_ext
      WHERE (m.fuente = 'AppSheet' AND p.hoja_nombre IS NULL)
         OR (m.fuente = 'Local' AND p.hoja_nombre IS NOT NULL)
      GROUP BY m.fuente
    `);
    
    if (fuentesInconsistentes.rowCount > 0) {
      fuentesInconsistentes.rows.forEach(f => {
        problemas.push(`${f.count} MAP con fuente inconsistente: ${f.fuente}`);
        log(`⚠️ ${f.count} MAP con fuente inconsistente: ${f.fuente}`, 'WARN');
      });
    }
    
    if (problemas.length === 0) {
      log('✅ Integridad referencial correcta');
    } else {
      log(`⚠️ Encontrados ${problemas.length} tipos de problemas de integridad`, 'WARN');
    }
    
    return { problemas };
    
  } catch (error) {
    log(`❌ Error verificando integridad: ${error.message}`, 'ERROR');
    return { problemas: ['Error en verificación'] };
  }
}

/**
 * EJECUTAR TODAS LAS REPARACIONES
 */
async function ejecutarReparacionCompleta() {
  log('🚀 INICIANDO AUTO-REPARACIÓN COMPLETA');
  log(`⚙️ Configuración: modo_seguro=${CONFIG_REPARACION.modo_seguro}, max_lote=${CONFIG_REPARACION.max_presupuestos_por_lote}`);
  
  const resultados = {
    backup_exitoso: false,
    map_faltante: { reparados: 0, errores: 0 },
    map_huerfanos: { eliminados: 0 },
    duplicados: { corregidos: 0 },
    integridad: { problemas: [] },
    tiempo_total: 0
  };
  
  const inicioTiempo = Date.now();
  
  try {
    // 1. Crear backup
    resultados.backup_exitoso = await crearBackup();
    if (!resultados.backup_exitoso && CONFIG_REPARACION.backup_antes_reparacion) {
      log('❌ Backup falló, abortando reparación', 'ERROR');
      return resultados;
    }
    
    // 2. Reparar MAP faltante
    resultados.map_faltante = await repararMapFaltante();
    
    // 3. Limpiar MAP huérfanos
    resultados.map_huerfanos = await repararMapHuerfanos();
    
    // 4. Corregir duplicados
    resultados.duplicados = await repararDuplicadosMap();
    
    // 5. Verificar integridad
    resultados.integridad = await verificarIntegridadReferencial();
    
    resultados.tiempo_total = Date.now() - inicioTiempo;
    
    // Resumen final
    log('📊 RESUMEN DE REPARACIÓN:');
    log(`   MAP creados: ${resultados.map_faltante.reparados}`);
    log(`   MAP huérfanos eliminados: ${resultados.map_huerfanos.eliminados}`);
    log(`   Duplicados corregidos: ${resultados.duplicados.corregidos}`);
    log(`   Problemas de integridad: ${resultados.integridad.problemas.length}`);
    log(`   Tiempo total: ${Math.round(resultados.tiempo_total / 1000)}s`);
    
    if (CONFIG_REPARACION.modo_seguro) {
      log('ℹ️ MODO SEGURO ACTIVO - No se realizaron cambios reales');
    } else {
      log('✅ REPARACIÓN COMPLETADA');
    }
    
    return resultados;
    
  } catch (error) {
    log(`❌ Error en reparación completa: ${error.message}`, 'ERROR');
    return resultados;
  } finally {
    await pool.end();
  }
}

// EJECUCIÓN DESDE LÍNEA DE COMANDOS
const modo = process.argv[2];
const parametro = process.argv[3];

if (modo === 'seguro') {
  CONFIG_REPARACION.modo_seguro = true;
  ejecutarReparacionCompleta().catch(console.error);
} else if (modo === 'ejecutar') {
  CONFIG_REPARACION.modo_seguro = false;
  ejecutarReparacionCompleta().catch(console.error);
} else if (modo === 'map') {
  CONFIG_REPARACION.modo_seguro = parametro !== 'ejecutar';
  repararMapFaltante().then(() => pool.end()).catch(console.error);
} else if (modo === 'limpiar') {
  CONFIG_REPARACION.modo_seguro = parametro !== 'ejecutar';
  repararMapHuerfanos().then(() => pool.end()).catch(console.error);
} else {
  console.log('🔧 AUTO-REPARACIÓN DE PROBLEMAS COMUNES');
  console.log('='.repeat(50));
  console.log('📋 Uso:');
  console.log('   node auto_reparacion.js <modo> [parametro]');
  console.log('');
  console.log('📋 Modos disponibles:');
  console.log('   seguro   - Ejecutar en modo seguro (solo reporta)');
  console.log('   ejecutar - Ejecutar reparaciones reales');
  console.log('   map      - Solo reparar MAP faltante');
  console.log('   limpiar  - Solo limpiar MAP huérfanos');
  console.log('');
  console.log('📋 Ejemplos:');
  console.log('   node auto_reparacion.js seguro');
  console.log('   node auto_reparacion.js ejecutar');
  console.log('   node auto_reparacion.js map ejecutar');
  console.log('   node auto_reparacion.js limpiar ejecutar');
  console.log('');
  console.log('⚠️ IMPORTANTE: Siempre ejecuta primero en modo seguro');
}
