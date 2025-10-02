// HERRAMIENTAS DE TESTING DE CAMPO Y CORRECCIONES QUIRÚRGICAS
// Para mantener integridad y funcionalidad de la sincronización

const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

/**
 * HERRAMIENTA 1: DIAGNÓSTICO RÁPIDO DE INTEGRIDAD
 * Verifica el estado general de la sincronización
 */
async function diagnosticoIntegridad() {
  console.log('🔍 DIAGNÓSTICO RÁPIDO DE INTEGRIDAD');
  console.log('='.repeat(60));
  
  try {
    // 1. Estado general de presupuestos
    const estadoPresupuestos = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN activo = true THEN 1 END) as activos,
        COUNT(CASE WHEN activo = false THEN 1 END) as inactivos,
        COUNT(CASE WHEN id_presupuesto_ext IS NULL THEN 1 END) as sin_id_externo,
        COUNT(CASE WHEN hoja_nombre IS NOT NULL THEN 1 END) as con_hoja_nombre
      FROM presupuestos
    `);
    
    const ep = estadoPresupuestos.rows[0];
    console.log('\n📊 ESTADO PRESUPUESTOS:');
    console.log(`   Total: ${ep.total}`);
    console.log(`   Activos: ${ep.activos}`);
    console.log(`   Inactivos: ${ep.inactivos}`);
    console.log(`   Sin ID externo: ${ep.sin_id_externo}`);
    console.log(`   Con hoja_nombre: ${ep.con_hoja_nombre}`);
    
    // 2. Estado de detalles y MAP
    const estadoDetalles = await pool.query(`
      SELECT 
        COUNT(d.id) as total_detalles,
        COUNT(m.local_detalle_id) as con_map,
        COUNT(CASE WHEN m.fuente = 'Local' THEN 1 END) as map_local,
        COUNT(CASE WHEN m.fuente = 'AppSheet' THEN 1 END) as map_appsheet
      FROM presupuestos_detalles d
      LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
      INNER JOIN presupuestos p ON p.id_presupuesto_ext = d.id_presupuesto_ext
      WHERE p.activo = true
    `);
    
    const ed = estadoDetalles.rows[0];
    console.log('\n📊 ESTADO DETALLES Y MAP:');
    console.log(`   Total detalles: ${ed.total_detalles}`);
    console.log(`   Con MAP: ${ed.con_map}`);
    console.log(`   Sin MAP: ${ed.total_detalles - ed.con_map}`);
    console.log(`   MAP fuente Local: ${ed.map_local}`);
    console.log(`   MAP fuente AppSheet: ${ed.map_appsheet}`);
    
    // 3. Presupuestos sin detalles o con problemas
    const problemasIntegridad = await pool.query(`
      SELECT 
        p.id_presupuesto_ext,
        COUNT(d.id) as count_detalles,
        COUNT(m.local_detalle_id) as count_map,
        p.fecha_actualizacion
      FROM presupuestos p
      LEFT JOIN presupuestos_detalles d ON d.id_presupuesto_ext = p.id_presupuesto_ext
      LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
      WHERE p.activo = true
      GROUP BY p.id_presupuesto_ext, p.fecha_actualizacion
      HAVING COUNT(d.id) = 0 OR (COUNT(d.id) > 0 AND COUNT(m.local_detalle_id) = 0)
      ORDER BY p.fecha_actualizacion DESC
      LIMIT 10
    `);
    
    console.log('\n⚠️ PRESUPUESTOS CON PROBLEMAS (últimos 10):');
    if (problemasIntegridad.rowCount > 0) {
      problemasIntegridad.rows.forEach((p, i) => {
        const problema = p.count_detalles === 0 ? 'SIN DETALLES' : 'SIN MAP';
        console.log(`   ${i+1}. ${p.id_presupuesto_ext}: ${problema} (detalles=${p.count_detalles}, map=${p.count_map})`);
      });
    } else {
      console.log('   ✅ No hay problemas de integridad detectados');
    }
    
    // 4. Configuración actual
    const config = await pool.query(`
      SELECT hoja_id, cutoff_at, activo
      FROM presupuestos_config 
      WHERE activo = true 
      ORDER BY id DESC 
      LIMIT 1
    `);
    
    console.log('\n⚙️ CONFIGURACIÓN ACTUAL:');
    if (config.rowCount > 0) {
      const c = config.rows[0];
      console.log(`   Hoja ID: ${c.hoja_id}`);
      console.log(`   Cutoff AT: ${c.cutoff_at}`);
      console.log(`   Activo: ${c.activo}`);
    } else {
      console.log('   ❌ No hay configuración activa');
    }
    
    return {
      presupuestos: ep,
      detalles: ed,
      problemas: problemasIntegridad.rowCount,
      configuracion: config.rowCount > 0
    };
    
  } catch (error) {
    console.error('❌ Error en diagnóstico:', error.message);
    return null;
  }
}

/**
 * HERRAMIENTA 2: VERIFICAR PRESUPUESTO ESPECÍFICO
 * Análisis detallado de un presupuesto particular
 */
async function verificarPresupuestoEspecifico(idPresupuesto) {
  console.log(`🔍 VERIFICACIÓN ESPECÍFICA: ${idPresupuesto}`);
  console.log('='.repeat(60));
  
  try {
    // 1. Datos del presupuesto
    const presupuesto = await pool.query(`
      SELECT id, id_presupuesto_ext, id_cliente, fecha_actualizacion, activo, hoja_nombre
      FROM presupuestos 
      WHERE id_presupuesto_ext = $1
    `, [idPresupuesto]);
    
    if (presupuesto.rowCount === 0) {
      console.log('❌ Presupuesto no encontrado');
      return null;
    }
    
    const p = presupuesto.rows[0];
    console.log('\n📊 DATOS DEL PRESUPUESTO:');
    console.log(`   ID interno: ${p.id}`);
    console.log(`   ID externo: ${p.id_presupuesto_ext}`);
    console.log(`   Cliente: ${p.id_cliente}`);
    console.log(`   Fecha actualización: ${p.fecha_actualizacion}`);
    console.log(`   Activo: ${p.activo}`);
    console.log(`   Hoja nombre: ${p.hoja_nombre || 'NULL'}`);
    
    // 2. Detalles y MAP
    const detallesMap = await pool.query(`
      SELECT 
        d.id as detalle_id,
        d.articulo,
        d.cantidad,
        d.precio1,
        d.fecha_actualizacion as detalle_fecha,
        m.id_detalle_presupuesto,
        m.fuente,
        m.fecha_asignacion
      FROM presupuestos_detalles d
      LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
      WHERE d.id_presupuesto_ext = $1
      ORDER BY d.id
    `, [idPresupuesto]);
    
    console.log(`\n📊 DETALLES Y MAP (${detallesMap.rowCount} detalles):`);
    detallesMap.rows.forEach((d, i) => {
      const mapStatus = d.id_detalle_presupuesto ? `MAP: ${d.id_detalle_presupuesto} (${d.fuente})` : 'SIN MAP';
      console.log(`   ${i+1}. ID=${d.detalle_id}, Art=${d.articulo}, ${mapStatus}`);
    });
    
    // 3. Verificar cutoff_at
    const config = await pool.query(`
      SELECT cutoff_at FROM presupuestos_config WHERE activo = true ORDER BY id DESC LIMIT 1
    `);
    
    const cutoffAt = config.rows[0]?.cutoff_at;
    const pasaCutoff = new Date(p.fecha_actualizacion) > cutoffAt;
    
    console.log('\n🔍 ANÁLISIS CUTOFF_AT:');
    console.log(`   Cutoff AT: ${cutoffAt}`);
    console.log(`   Presupuesto fecha: ${p.fecha_actualizacion}`);
    console.log(`   Pasa filtro: ${pasaCutoff}`);
    
    return {
      presupuesto: p,
      detalles: detallesMap.rows,
      pasaCutoff: pasaCutoff,
      problemas: detallesMap.rows.filter(d => !d.id_detalle_presupuesto).length
    };
    
  } catch (error) {
    console.error('❌ Error verificando presupuesto:', error.message);
    return null;
  }
}

/**
 * HERRAMIENTA 3: CORRECCIÓN QUIRÚRGICA DE MAP
 * Crea MAP faltante para presupuestos específicos
 */
async function correccionQuirurgicaMap(idsPresupuestos) {
  console.log('🔧 CORRECCIÓN QUIRÚRGICA DE MAP');
  console.log('='.repeat(60));
  
  if (!Array.isArray(idsPresupuestos)) {
    idsPresupuestos = [idsPresupuestos];
  }
  
  try {
    await pool.query('BEGIN');
    
    let totalCorregidos = 0;
    
    for (const idPresupuesto of idsPresupuestos) {
      console.log(`\n🔧 Procesando: ${idPresupuesto}`);
      
      // Obtener detalles sin MAP
      const detallesSinMap = await pool.query(`
        SELECT d.id, d.id_presupuesto_ext, d.articulo, d.cantidad, d.valor1, d.precio1,
               d.iva1, d.diferencia, d.camp1, d.camp2, d.camp3, d.camp4, d.camp5, d.camp6
        FROM presupuestos_detalles d
        LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
        WHERE d.id_presupuesto_ext = $1 AND m.local_detalle_id IS NULL
        ORDER BY d.id
      `, [idPresupuesto]);
      
      console.log(`   Detalles sin MAP: ${detallesSinMap.rowCount}`);
      
      if (detallesSinMap.rowCount === 0) {
        console.log('   ✅ Ya tiene MAP completo');
        continue;
      }
      
      // Crear MAP para cada detalle
      for (const detalle of detallesSinMap.rows) {
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
          console.warn(`   ⚠️ ID duplicado: ${idDetallePresupuesto}, regenerando...`);
          continue;
        }
        
        // Crear MAP
        await pool.query(`
          INSERT INTO presupuestos_detalles_map
          (local_detalle_id, id_detalle_presupuesto, fuente, fecha_asignacion)
          VALUES ($1, $2, 'Local', CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires')
        `, [detalle.id, idDetallePresupuesto]);
        
        totalCorregidos++;
        console.log(`   ✅ MAP creado: local=${detalle.id} → sheet=${idDetallePresupuesto}`);
      }
    }
    
    await pool.query('COMMIT');
    console.log(`\n✅ CORRECCIÓN COMPLETADA: ${totalCorregidos} MAP creados`);
    
    return totalCorregidos;
    
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('❌ Error en corrección quirúrgica:', error.message);
    return 0;
  }
}

/**
 * HERRAMIENTA 4: VERIFICAR SINCRONIZACIÓN RECIENTE
 * Analiza presupuestos modificados después de una fecha específica
 */
async function verificarSincronizacionReciente(fechaDesde = null) {
  console.log('🔍 VERIFICACIÓN DE SINCRONIZACIÓN RECIENTE');
  console.log('='.repeat(60));
  
  try {
    // Si no se proporciona fecha, usar cutoff_at
    if (!fechaDesde) {
      const config = await pool.query(`
        SELECT cutoff_at FROM presupuestos_config WHERE activo = true ORDER BY id DESC LIMIT 1
      `);
      fechaDesde = config.rows[0]?.cutoff_at || new Date(Date.now() - 24*60*60*1000);
    }
    
    console.log(`📅 Analizando cambios desde: ${fechaDesde}`);
    
    // Presupuestos modificados recientemente
    const presupuestosRecientes = await pool.query(`
      SELECT 
        p.id_presupuesto_ext,
        p.fecha_actualizacion,
        COUNT(d.id) as detalles,
        COUNT(m.local_detalle_id) as map_entries,
        CASE 
          WHEN COUNT(d.id) = 0 THEN 'SIN_DETALLES'
          WHEN COUNT(m.local_detalle_id) = 0 THEN 'SIN_MAP'
          WHEN COUNT(d.id) = COUNT(m.local_detalle_id) THEN 'OK'
          ELSE 'MAP_PARCIAL'
        END as estado
      FROM presupuestos p
      LEFT JOIN presupuestos_detalles d ON d.id_presupuesto_ext = p.id_presupuesto_ext
      LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
      WHERE p.activo = true 
        AND p.fecha_actualizacion > $1
      GROUP BY p.id_presupuesto_ext, p.fecha_actualizacion
      ORDER BY p.fecha_actualizacion DESC
      LIMIT 20
    `, [fechaDesde]);
    
    console.log(`\n📊 PRESUPUESTOS RECIENTES (${presupuestosRecientes.rowCount}):`);
    
    const estadisticas = {
      ok: 0,
      sin_detalles: 0,
      sin_map: 0,
      map_parcial: 0
    };
    
    presupuestosRecientes.rows.forEach((p, i) => {
      console.log(`   ${i+1}. ${p.id_presupuesto_ext}: ${p.estado} (det=${p.detalles}, map=${p.map_entries})`);
      
      switch(p.estado) {
        case 'OK': estadisticas.ok++; break;
        case 'SIN_DETALLES': estadisticas.sin_detalles++; break;
        case 'SIN_MAP': estadisticas.sin_map++; break;
        case 'MAP_PARCIAL': estadisticas.map_parcial++; break;
      }
    });
    
    console.log('\n📈 ESTADÍSTICAS:');
    console.log(`   ✅ OK: ${estadisticas.ok}`);
    console.log(`   ⚠️ Sin detalles: ${estadisticas.sin_detalles}`);
    console.log(`   ❌ Sin MAP: ${estadisticas.sin_map}`);
    console.log(`   🔶 MAP parcial: ${estadisticas.map_parcial}`);
    
    return {
      total: presupuestosRecientes.rowCount,
      estadisticas: estadisticas,
      problemas: estadisticas.sin_detalles + estadisticas.sin_map + estadisticas.map_parcial
    };
    
  } catch (error) {
    console.error('❌ Error verificando sincronización reciente:', error.message);
    return null;
  }
}

/**
 * HERRAMIENTA 5: LIMPIAR DUPLICADOS EN MAP
 * Elimina entradas duplicadas o inconsistentes en MAP
 */
async function limpiarDuplicadosMap() {
  console.log('🧹 LIMPIEZA DE DUPLICADOS EN MAP');
  console.log('='.repeat(60));
  
  try {
    await pool.query('BEGIN');
    
    // 1. Buscar duplicados por id_detalle_presupuesto
    const duplicadosId = await pool.query(`
      SELECT id_detalle_presupuesto, COUNT(*) as count
      FROM presupuestos_detalles_map
      GROUP BY id_detalle_presupuesto
      HAVING COUNT(*) > 1
      ORDER BY count DESC
    `);
    
    console.log(`\n🔍 DUPLICADOS POR ID_DETALLE_PRESUPUESTO: ${duplicadosId.rowCount}`);
    
    if (duplicadosId.rowCount > 0) {
      for (const dup of duplicadosId.rows) {
        console.log(`   ID ${dup.id_detalle_presupuesto}: ${dup.count} duplicados`);
        
        // Mantener solo el más reciente
        await pool.query(`
          DELETE FROM presupuestos_detalles_map 
          WHERE id_detalle_presupuesto = $1 
            AND local_detalle_id NOT IN (
              SELECT local_detalle_id 
              FROM presupuestos_detalles_map 
              WHERE id_detalle_presupuesto = $1 
              ORDER BY fecha_asignacion DESC 
              LIMIT 1
            )
        `, [dup.id_detalle_presupuesto]);
        
        console.log(`   ✅ Limpiado: mantenido el más reciente`);
      }
    }
    
    // 2. Buscar MAP huérfanos (detalles que ya no existen)
    const mapHuerfanos = await pool.query(`
      SELECT m.local_detalle_id, m.id_detalle_presupuesto
      FROM presupuestos_detalles_map m
      LEFT JOIN presupuestos_detalles d ON d.id = m.local_detalle_id
      WHERE d.id IS NULL
    `);
    
    console.log(`\n🔍 MAP HUÉRFANOS: ${mapHuerfanos.rowCount}`);
    
    if (mapHuerfanos.rowCount > 0) {
      await pool.query(`
        DELETE FROM presupuestos_detalles_map 
        WHERE local_detalle_id NOT IN (
          SELECT id FROM presupuestos_detalles
        )
      `);
      console.log(`   ✅ Eliminados ${mapHuerfanos.rowCount} MAP huérfanos`);
    }
    
    await pool.query('COMMIT');
    console.log('\n✅ LIMPIEZA COMPLETADA');
    
    return {
      duplicados_eliminados: duplicadosId.rowCount,
      huerfanos_eliminados: mapHuerfanos.rowCount
    };
    
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('❌ Error en limpieza:', error.message);
    return null;
  }
}

/**
 * HERRAMIENTA 6: SIMULAR SINCRONIZACIÓN
 * Prueba qué haría la sincronización sin ejecutarla realmente
 */
async function simularSincronizacion() {
  console.log('🎭 SIMULACIÓN DE SINCRONIZACIÓN');
  console.log('='.repeat(60));
  
  try {
    // Obtener configuración
    const config = await pool.query(`
      SELECT hoja_id, cutoff_at FROM presupuestos_config WHERE activo = true ORDER BY id DESC LIMIT 1
    `);
    
    if (config.rowCount === 0) {
      console.log('❌ No hay configuración activa');
      return null;
    }
    
    const cutoffAt = config.rows[0].cutoff_at;
    console.log(`📅 Usando cutoff_at: ${cutoffAt}`);
    
    // Simular query del servicio
    const candidatos = await pool.query(`
      SELECT DISTINCT p.id_presupuesto_ext, p.fecha_actualizacion,
             COUNT(d.id) as detalles,
             COUNT(m.local_detalle_id) as map_entries
      FROM presupuestos p
      LEFT JOIN presupuestos_detalles d ON d.id_presupuesto_ext = p.id_presupuesto_ext
      LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
      WHERE p.activo = true 
        AND (
          p.fecha_actualizacion > $1
          OR d.fecha_actualizacion > $1
        )
      GROUP BY p.id_presupuesto_ext, p.fecha_actualizacion
      ORDER BY p.fecha_actualizacion DESC
    `, [cutoffAt]);
    
    console.log(`\n📊 CANDIDATOS PARA SINCRONIZACIÓN: ${candidatos.rowCount}`);
    
    const acciones = {
      nuevos: [],
      modificados: [],
      necesitan_map: []
    };
    
    candidatos.rows.forEach((c, i) => {
      console.log(`   ${i+1}. ${c.id_presupuesto_ext}:`);
      console.log(`      Detalles: ${c.detalles}, MAP: ${c.map_entries}`);
      
      if (c.detalles === 0) {
        console.log(`      🔶 SIN DETALLES - necesita verificación`);
      } else if (c.map_entries === 0) {
        console.log(`      ❌ SIN MAP - necesita corrección`);
        acciones.necesitan_map.push(c.id_presupuesto_ext);
      } else if (c.detalles === c.map_entries) {
        console.log(`      ✅ MAP COMPLETO`);
      } else {
        console.log(`      🔶 MAP PARCIAL - necesita revisión`);
        acciones.necesitan_map.push(c.id_presupuesto_ext);
      }
    });
    
    console.log('\n📋 RESUMEN DE ACCIONES NECESARIAS:');
    console.log(`   Presupuestos que necesitan MAP: ${acciones.necesitan_map.length}`);
    
    if (acciones.necesitan_map.length > 0) {
      console.log('   IDs que necesitan MAP:', acciones.necesitan_map.join(', '));
    }
    
    return acciones;
    
  } catch (error) {
    console.error('❌ Error en simulación:', error.message);
    return null;
  }
}

// FUNCIÓN PRINCIPAL PARA EJECUTAR HERRAMIENTAS
async function ejecutarHerramienta(herramienta, ...args) {
  try {
    switch(herramienta) {
      case 'integridad':
        return await diagnosticoIntegridad();
      
      case 'verificar':
        if (!args[0]) {
          console.log('❌ Uso: verificar <id_presupuesto>');
          return null;
        }
        return await verificarPresupuestoEspecifico(args[0]);
      
      case 'corregir-map':
        if (!args[0]) {
          console.log('❌ Uso: corregir-map <id_presupuesto> [id2, id3, ...]');
          return null;
        }
        return await correccionQuirurgicaMap(args);
      
      case 'limpiar':
        return await limpiarDuplicadosMap();
      
      case 'simular':
        return await simularSincronizacion();
      
      default:
        console.log('❌ Herramienta no reconocida');
        console.log('📋 Herramientas disponibles:');
        console.log('   - integridad: Diagnóstico general');
        console.log('   - verificar <id>: Verificar presupuesto específico');
        console.log('   - corregir-map <id>: Crear MAP faltante');
        console.log('   - limpiar: Limpiar duplicados en MAP');
        console.log('   - simular: Simular próxima sincronización');
        return null;
    }
  } catch (error) {
    console.error('❌ Error ejecutando herramienta:', error.message);
    return null;
  } finally {
    await pool.end();
  }
}

// Ejecutar herramienta desde línea de comandos
const herramienta = process.argv[2];
const args = process.argv.slice(3);

if (!herramienta) {
  console.log('🛠️ HERRAMIENTAS DE TESTING DE CAMPO');
  console.log('='.repeat(60));
  console.log('📋 Uso: node herramientas_testing_campo.js <herramienta> [args]');
  console.log('');
  console.log('📋 Herramientas disponibles:');
  console.log('   - integridad: Diagnóstico general del sistema');
  console.log('   - verificar <id>: Verificar presupuesto específico');
  console.log('   - corregir-map <id>: Crear MAP faltante para presupuesto');
  console.log('   - limpiar: Limpiar duplicados y huérfanos en MAP');
  console.log('   - simular: Simular próxima sincronización');
  console.log('');
  console.log('📋 Ejemplos:');
  console.log('   node herramientas_testing_campo.js integridad');
  console.log('   node herramientas_testing_campo.js verificar mg0sctql-y1zae');
  console.log('   node herramientas_testing_campo.js corregir-map mg0sctql-y1zae');
  console.log('   node herramientas_testing_campo.js simular');
  process.exit(0);
}

ejecutarHerramienta(herramienta, ...args).catch(console.error);
