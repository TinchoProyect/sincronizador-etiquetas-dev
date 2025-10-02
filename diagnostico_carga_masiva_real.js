// DIAGNÓSTICO ESPECÍFICO DE CARGA MASIVA EN DETALLES LOCAL
// Rastrea exactamente dónde y cuándo se cargan registros masivos

const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function diagnosticarCargaMasivaReal() {
  console.log('🔍 [CARGA-MASIVA] === DIAGNÓSTICO ESPECÍFICO DE CARGA MASIVA ===');
  
  try {
    // 1. Contar detalles ANTES de cualquier operación
    const antesTotal = await pool.query(`
      SELECT COUNT(*) as total,
             COUNT(DISTINCT id_presupuesto_ext) as presupuestos_distintos,
             MAX(fecha_actualizacion) as ultima_fecha
      FROM presupuestos_detalles
    `);
    
    console.log(`📊 ESTADO INICIAL BD LOCAL:`);
    console.log(`   Total detalles: ${antesTotal.rows[0].total}`);
    console.log(`   Presupuestos distintos: ${antesTotal.rows[0].presupuestos_distintos}`);
    console.log(`   Última fecha: ${antesTotal.rows[0].ultima_fecha}`);
    
    // 2. Identificar presupuestos con más detalles (posibles problemáticos)
    const problemáticos = await pool.query(`
      SELECT id_presupuesto_ext, COUNT(*) as count_detalles,
             COUNT(DISTINCT articulo) as articulos_unicos,
             MIN(fecha_actualizacion) as primera_fecha,
             MAX(fecha_actualizacion) as ultima_fecha,
             EXTRACT(EPOCH FROM (MAX(fecha_actualizacion) - MIN(fecha_actualizacion))) as rango_segundos
      FROM presupuestos_detalles
      GROUP BY id_presupuesto_ext
      HAVING COUNT(*) > 5  -- Más de 5 detalles
      ORDER BY COUNT(*) DESC
      LIMIT 10
    `);
    
    console.log(`\n⚠️ PRESUPUESTOS CON MÁS DETALLES (posibles problemáticos):`);
    problemáticos.rows.forEach((p, i) => {
      console.log(`   ${i+1}. ${p.id_presupuesto_ext}: ${p.count_detalles} detalles (${p.articulos_unicos} únicos)`);
      console.log(`      Rango temporal: ${Math.round(p.rango_segundos)}s`);
      console.log(`      Fechas: ${p.primera_fecha} → ${p.ultima_fecha}`);
    });
    
    // 3. Buscar duplicados por artículo en presupuestos específicos
    if (problemáticos.rowCount > 0) {
      const idProblematico = problemáticos.rows[0].id_presupuesto_ext;
      console.log(`\n🔍 ANÁLISIS DETALLADO DE: ${idProblematico}`);
      
      const duplicados = await pool.query(`
        SELECT articulo, COUNT(*) as repeticiones,
               ARRAY_AGG(id ORDER BY fecha_actualizacion) as ids,
               MIN(fecha_actualizacion) as primera_fecha,
               MAX(fecha_actualizacion) as ultima_fecha
        FROM presupuestos_detalles
        WHERE id_presupuesto_ext = $1
        GROUP BY articulo
        ORDER BY COUNT(*) DESC
        LIMIT 5
      `, [idProblematico]);
      
      console.log(`   📊 ARTÍCULOS Y SUS REPETICIONES:`);
      duplicados.rows.forEach((d, i) => {
        console.log(`      ${i+1}. ${d.articulo}: ${d.repeticiones} veces`);
        console.log(`         IDs: ${d.ids.join(', ')}`);
        console.log(`         Rango: ${d.primera_fecha} → ${d.ultima_fecha}`);
      });
    }
    
    // 4. Analizar el MAP para identificar patrones
    console.log(`\n🔍 [CARGA-MASIVA] === ANÁLISIS DEL MAP ===`);
    
    const mapStats = await pool.query(`
      SELECT m.fuente, COUNT(*) as count_entradas,
             COUNT(DISTINCT d.id_presupuesto_ext) as presupuestos_distintos,
             MIN(m.fecha_asignacion) as primera_asignacion,
             MAX(m.fecha_asignacion) as ultima_asignacion
      FROM presupuestos_detalles_map m
      INNER JOIN presupuestos_detalles d ON d.id = m.local_detalle_id
      GROUP BY m.fuente
      ORDER BY COUNT(*) DESC
    `);
    
    console.log(`📊 ESTADÍSTICAS DEL MAP:`);
    mapStats.rows.forEach((m, i) => {
      console.log(`   ${i+1}. Fuente ${m.fuente}: ${m.count_entradas} entradas`);
      console.log(`      Presupuestos: ${m.presupuestos_distintos}`);
      console.log(`      Rango: ${m.primera_asignacion} → ${m.ultima_asignacion}`);
    });
    
    // 5. Buscar detalles SIN MAP (huérfanos)
    const sinMap = await pool.query(`
      SELECT COUNT(*) as count_sin_map,
             COUNT(DISTINCT id_presupuesto_ext) as presupuestos_sin_map
      FROM presupuestos_detalles d
      LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
      WHERE m.local_detalle_id IS NULL
    `);
    
    console.log(`\n📊 DETALLES SIN MAP (huérfanos):`);
    console.log(`   Total sin MAP: ${sinMap.rows[0].count_sin_map}`);
    console.log(`   Presupuestos afectados: ${sinMap.rows[0].presupuestos_sin_map}`);
    
    if (sinMap.rows[0].count_sin_map > 0) {
      const muestraSinMap = await pool.query(`
        SELECT d.id, d.id_presupuesto_ext, d.articulo, d.fecha_actualizacion
        FROM presupuestos_detalles d
        LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
        WHERE m.local_detalle_id IS NULL
        ORDER BY d.fecha_actualizacion DESC
        LIMIT 5
      `);
      
      console.log(`   📋 MUESTRA DE DETALLES SIN MAP:`);
      muestraSinMap.rows.forEach((d, i) => {
        console.log(`      ${i+1}. ID=${d.id} presup=${d.id_presupuesto_ext} art=${d.articulo}`);
        console.log(`         fecha=${d.fecha_actualizacion}`);
      });
    }
    
    // 6. Verificar configuración actual
    const config = await pool.query(`
      SELECT cutoff_at, hoja_id
      FROM presupuestos_config 
      WHERE activo = true 
      ORDER BY fecha_creacion DESC 
      LIMIT 1
    `);
    
    const cutoffAt = config.rows[0].cutoff_at;
    console.log(`\n📅 CONFIGURACIÓN ACTUAL:`);
    console.log(`   cutoff_at: ${cutoffAt.toISOString()}`);
    
    // 7. Verificar qué presupuestos deberían procesarse según cutoff_at
    const deberianProcesarse = await pool.query(`
      SELECT p.id_presupuesto_ext, p.fecha_actualizacion,
             EXTRACT(EPOCH FROM (p.fecha_actualizacion - $1)) as diff_segundos
      FROM presupuestos p
      WHERE p.activo = true 
        AND p.fecha_actualizacion > $1
      ORDER BY p.fecha_actualizacion DESC
      LIMIT 5
    `, [cutoffAt]);
    
    console.log(`\n📊 PRESUPUESTOS QUE DEBERÍAN PROCESARSE (> cutoff_at):`);
    console.log(`   Total: ${deberianProcesarse.rowCount}`);
    deberianProcesarse.rows.forEach((p, i) => {
      console.log(`   ${i+1}. ${p.id_presupuesto_ext}: +${Math.round(p.diff_segundos)}s`);
    });
    
    // 8. IDENTIFICAR EL PROBLEMA ESPECÍFICO
    console.log(`\n🚨 [CARGA-MASIVA] === IDENTIFICACIÓN DEL PROBLEMA ===`);
    
    if (deberianProcesarse.rowCount === 0) {
      console.log('✅ CORRECTO: No hay presupuestos que deberían procesarse');
      console.log('❌ PROBLEMA: Pero aún se están procesando detalles masivos');
      console.log('🔍 CAUSA: La función syncDetallesDesdeSheets() se está ejecutando incorrectamente');
    } else {
      console.log(`⚠️ HAY ${deberianProcesarse.rowCount} presupuestos que deberían procesarse`);
      console.log('🔍 VERIFICAR: Si estos presupuestos justifican la carga masiva');
    }
    
    console.log('\n💡 [CARGA-MASIVA] PRÓXIMOS PASOS:');
    console.log('   1. Verificar que syncDetallesDesdeSheets() solo procese IDs específicos');
    console.log('   2. Asegurar que no se ejecute múltiples veces');
    console.log('   3. Confirmar que los filtros cutoff_at funcionen correctamente');
    console.log('   4. Revisar si hay bucles infinitos en la sincronización');
    
    console.log('\n✅ [CARGA-MASIVA] Diagnóstico completado');
    
  } catch (error) {
    console.error('❌ [CARGA-MASIVA] Error:', error.message);
  } finally {
    await pool.end();
  }
}

// Ejecutar diagnóstico
diagnosticarCargaMasivaReal().catch(console.error);
