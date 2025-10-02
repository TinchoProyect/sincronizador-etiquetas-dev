// DIAGNÓSTICO DE DETALLES MASIVOS EN LOCAL
// Identifica por qué se cargan registros excesivos en detalles local

const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function diagnosticarDetallesMasivos() {
  console.log('🔍 [DETALLES-MASIVOS] === DIAGNÓSTICO DE DETALLES EXCESIVOS ===');
  
  try {
    // 1. Obtener configuración y cutoff_at actual
    const config = await pool.query(`
      SELECT cutoff_at, hoja_id
      FROM presupuestos_config 
      WHERE activo = true 
      ORDER BY fecha_creacion DESC 
      LIMIT 1
    `);
    
    const cutoffAt = config.rows[0].cutoff_at;
    console.log(`📅 cutoff_at actual: ${cutoffAt.toISOString()}`);
    
    // 2. Analizar presupuestos recientes creados en local
    console.log('\n🔍 [DETALLES-MASIVOS] === PRESUPUESTOS RECIENTES EN LOCAL ===');
    
    const presupuestosRecientes = await pool.query(`
      SELECT id, id_presupuesto_ext, fecha_actualizacion,
             EXTRACT(EPOCH FROM (fecha_actualizacion - $1)) as diff_cutoff_segundos
      FROM presupuestos 
      WHERE activo = true
        AND fecha_actualizacion > $1  -- Solo posteriores a cutoff_at
      ORDER BY fecha_actualizacion DESC
      LIMIT 5
    `, [cutoffAt]);
    
    console.log(`📊 Presupuestos recientes (> cutoff_at): ${presupuestosRecientes.rowCount}`);
    
    if (presupuestosRecientes.rowCount === 0) {
      console.log('✅ No hay presupuestos recientes que deberían sincronizarse');
      return;
    }
    
    const idsRecientes = presupuestosRecientes.rows.map(p => p.id_presupuesto_ext);
    console.log(`📋 IDs recientes: ${idsRecientes.join(', ')}`);
    
    // 3. Analizar detalles de estos presupuestos
    console.log('\n🔍 [DETALLES-MASIVOS] === ANÁLISIS DE DETALLES POR PRESUPUESTO ===');
    
    for (const presupuesto of presupuestosRecientes.rows) {
      const id = presupuesto.id_presupuesto_ext;
      
      console.log(`\n📊 PRESUPUESTO: ${id}`);
      console.log(`   fecha_actualizacion: ${presupuesto.fecha_actualizacion}`);
      console.log(`   diff_cutoff: ${Math.round(presupuesto.diff_cutoff_segundos)}s`);
      
      // Contar detalles
      const detalles = await pool.query(`
        SELECT COUNT(*) as count, 
               COUNT(DISTINCT articulo) as articulos_unicos,
               SUM(cantidad) as total_cantidad,
               MIN(fecha_actualizacion) as primera_fecha,
               MAX(fecha_actualizacion) as ultima_fecha
        FROM presupuestos_detalles 
        WHERE id_presupuesto_ext = $1
      `, [id]);
      
      const det = detalles.rows[0];
      console.log(`   📊 DETALLES: ${det.count} filas (${det.articulos_unicos} artículos únicos)`);
      console.log(`   📊 CANTIDAD TOTAL: ${det.total_cantidad}`);
      console.log(`   📅 RANGO FECHAS: ${det.primera_fecha} → ${det.ultima_fecha}`);
      
      // Verificar duplicados por artículo
      const duplicados = await pool.query(`
        SELECT articulo, COUNT(*) as count
        FROM presupuestos_detalles 
        WHERE id_presupuesto_ext = $1
        GROUP BY articulo
        HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC
      `, [id]);
      
      if (duplicados.rowCount > 0) {
        console.log(`   ⚠️ DUPLICADOS: ${duplicados.rowCount} artículos duplicados`);
        duplicados.rows.slice(0, 3).forEach(d => {
          console.log(`      - ${d.articulo}: ${d.count} veces`);
        });
      } else {
        console.log(`   ✅ Sin duplicados por artículo`);
      }
      
      // Verificar MAP para este presupuesto
      const map = await pool.query(`
        SELECT COUNT(*) as count_map, 
               COUNT(DISTINCT m.fuente) as fuentes_distintas,
               m.fuente
        FROM presupuestos_detalles d
        LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
        WHERE d.id_presupuesto_ext = $1
        GROUP BY m.fuente
      `, [id]);
      
      console.log(`   📊 MAP: ${map.rowCount} grupos por fuente`);
      map.rows.forEach(m => {
        console.log(`      - fuente=${m.fuente || 'SIN_MAP'}: ${m.count_map} entradas`);
      });
    }
    
    // 4. Analizar el problema específico: ¿Por qué se cargan detalles masivos?
    console.log('\n🔍 [DETALLES-MASIVOS] === ANÁLISIS DEL PROBLEMA ===');
    
    // Verificar si hay presupuestos que se están procesando múltiples veces
    const ultimaSync = await pool.query(`
      SELECT fecha_sync, detalles
      FROM presupuestos_sync_log 
      WHERE exitoso = true
      ORDER BY fecha_sync DESC 
      LIMIT 1
    `);
    
    if (ultimaSync.rowCount > 0) {
      console.log(`📊 Última sincronización: ${ultimaSync.rows[0].fecha_sync}`);
      try {
        const detallesInfo = JSON.parse(ultimaSync.rows[0].detalles);
        console.log(`📊 Info de última sync:`, detallesInfo);
      } catch (e) {
        console.log(`📊 Detalles raw: ${ultimaSync.rows[0].detalles}`);
      }
    }
    
    // 5. Verificar si hay un bucle en syncDetallesDesdeSheets
    console.log('\n🔍 [DETALLES-MASIVOS] === POSIBLES CAUSAS ===');
    console.log('❌ CAUSA 1: syncDetallesDesdeSheets() se ejecuta múltiples veces');
    console.log('❌ CAUSA 2: No se filtran correctamente los IDs en PULL');
    console.log('❌ CAUSA 3: Se procesan todos los detalles de Sheets en lugar de solo los nuevos');
    console.log('❌ CAUSA 4: cutoff_at no funciona correctamente en el flujo PULL');
    
    // 6. Verificar total de detalles en BD
    const totalDetalles = await pool.query(`
      SELECT COUNT(*) as total,
             COUNT(DISTINCT id_presupuesto_ext) as presupuestos_con_detalles,
             AVG(cantidad) as promedio_cantidad
      FROM presupuestos_detalles
    `);
    
    console.log(`\n📊 TOTALES EN BD LOCAL:`);
    console.log(`   Total detalles: ${totalDetalles.rows[0].total}`);
    console.log(`   Presupuestos con detalles: ${totalDetalles.rows[0].presupuestos_con_detalles}`);
    console.log(`   Promedio cantidad por detalle: ${Math.round(totalDetalles.rows[0].promedio_cantidad * 100) / 100}`);
    
    // 7. Buscar patrones anómalos
    const patronesAnomalos = await pool.query(`
      SELECT id_presupuesto_ext, COUNT(*) as count_detalles
      FROM presupuestos_detalles
      GROUP BY id_presupuesto_ext
      HAVING COUNT(*) > 20  -- Presupuestos con más de 20 detalles (anómalo)
      ORDER BY COUNT(*) DESC
      LIMIT 10
    `);
    
    if (patronesAnomalos.rowCount > 0) {
      console.log(`\n⚠️ PRESUPUESTOS CON DETALLES EXCESIVOS (>20):`);
      patronesAnomalos.rows.forEach(p => {
        console.log(`   - ${p.id_presupuesto_ext}: ${p.count_detalles} detalles`);
      });
    } else {
      console.log(`\n✅ No se encontraron presupuestos con detalles excesivos`);
    }
    
    console.log('\n✅ [DETALLES-MASIVOS] Diagnóstico completado');
    console.log('\n💡 [DETALLES-MASIVOS] RECOMENDACIONES:');
    console.log('   1. Verificar que syncDetallesDesdeSheets() no se ejecute múltiples veces');
    console.log('   2. Asegurar que solo se procesen IDs específicos, no todos los detalles');
    console.log('   3. Implementar filtros cutoff_at en el flujo PULL');
    console.log('   4. Verificar que no haya bucles infinitos en la sincronización');
    
  } catch (error) {
    console.error('❌ [DETALLES-MASIVOS] Error:', error.message);
  } finally {
    await pool.end();
  }
}

// Ejecutar diagnóstico
diagnosticarDetallesMasivos().catch(console.error);
