// DIAGNÓSTICO INTEGRAL DEL PROBLEMA MAP
// Análisis completo de los dos flujos: Local→Sheets y Sheets→Local

const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function diagnosticoIntegral() {
  try {
    console.log('🔍 DIAGNÓSTICO INTEGRAL DEL PROBLEMA MAP');
    console.log('='.repeat(60));
    
    // 1. ESTADO ACTUAL DE LA TABLA MAP
    console.log('\n📊 1. ESTADO ACTUAL DE LA TABLA MAP:');
    
    const mapStats = await pool.query(`
      SELECT 
        fuente,
        COUNT(*) as total,
        COUNT(DISTINCT local_detalle_id) as detalles_unicos,
        MIN(fecha_asignacion) as primera_asignacion,
        MAX(fecha_asignacion) as ultima_asignacion
      FROM presupuestos_detalles_map
      GROUP BY fuente
      ORDER BY fuente
    `);
    
    console.log('📋 Estadísticas MAP por fuente:');
    mapStats.rows.forEach(row => {
      console.log(`   ${row.fuente}: ${row.total} registros, ${row.detalles_unicos} detalles únicos`);
      console.log(`      Primera: ${row.primera_asignacion}`);
      console.log(`      Última: ${row.ultima_asignacion}`);
    });
    
    // 2. PRESUPUESTOS SIN MAP (PROBLEMA ACTUAL)
    console.log('\n📊 2. PRESUPUESTOS CON DETALLES PERO SIN MAP:');
    
    const sinMap = await pool.query(`
      SELECT p.id_presupuesto_ext, p.hoja_nombre, p.fecha_actualizacion,
             COUNT(d.id) as count_detalles,
             COUNT(m.local_detalle_id) as count_map,
             COALESCE(SUM(d.cantidad), 0) as sum_cantidad,
             COALESCE(SUM(d.valor1), 0) as sum_valor1
      FROM presupuestos p
      LEFT JOIN presupuestos_detalles d ON d.id_presupuesto_ext = p.id_presupuesto_ext
      LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
      WHERE p.activo = true 
        AND p.hoja_nombre IS NOT NULL
      GROUP BY p.id_presupuesto_ext, p.hoja_nombre, p.fecha_actualizacion
      HAVING COUNT(d.id) > 0 AND COUNT(m.local_detalle_id) = 0
      ORDER BY p.fecha_actualizacion DESC
      LIMIT 5
    `);
    
    console.log(`📋 Presupuestos SIN MAP: ${sinMap.rowCount}`);
    sinMap.rows.forEach((p, i) => {
      console.log(`   ${i+1}. ${p.id_presupuesto_ext}:`);
      console.log(`      Origen: ${p.hoja_nombre}`);
      console.log(`      Fecha: ${p.fecha_actualizacion}`);
      console.log(`      Detalles: ${p.count_detalles}, MAP: ${p.count_map}`);
      console.log(`      Totales: cantidad=${p.sum_cantidad}, valor1=${p.sum_valor1}`);
    });
    
    // 3. PRESUPUESTOS CON MAP (FUNCIONANDO BIEN)
    console.log('\n📊 3. PRESUPUESTOS CON MAP (FUNCIONANDO BIEN):');
    
    const conMap = await pool.query(`
      SELECT p.id_presupuesto_ext, p.hoja_nombre, p.fecha_actualizacion,
             COUNT(d.id) as count_detalles,
             COUNT(m.local_detalle_id) as count_map,
             m.fuente
      FROM presupuestos p
      LEFT JOIN presupuestos_detalles d ON d.id_presupuesto_ext = p.id_presupuesto_ext
      LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
      WHERE p.activo = true 
        AND p.hoja_nombre IS NOT NULL
      GROUP BY p.id_presupuesto_ext, p.hoja_nombre, p.fecha_actualizacion, m.fuente
      HAVING COUNT(d.id) > 0 AND COUNT(m.local_detalle_id) > 0
      ORDER BY p.fecha_actualizacion DESC
      LIMIT 5
    `);
    
    console.log(`📋 Presupuestos CON MAP: ${conMap.rowCount}`);
    conMap.rows.forEach((p, i) => {
      console.log(`   ${i+1}. ${p.id_presupuesto_ext}:`);
      console.log(`      Origen: ${p.hoja_nombre}, Fuente MAP: ${p.fuente}`);
      console.log(`      Fecha: ${p.fecha_actualizacion}`);
      console.log(`      Detalles: ${p.count_detalles}, MAP: ${p.count_map}`);
    });
    
    // 4. ANÁLISIS POR ORIGEN (Local vs Sheets)
    console.log('\n📊 4. ANÁLISIS POR ORIGEN:');
    
    const porOrigen = await pool.query(`
      SELECT 
        CASE 
          WHEN p.hoja_nombre = 'Presupuestos' THEN 'Sheets→Local'
          WHEN p.hoja_nombre IS NULL THEN 'Local→Sheets'
          ELSE p.hoja_nombre
        END as origen,
        COUNT(*) as total_presupuestos,
        COUNT(CASE WHEN d.id IS NOT NULL THEN 1 END) as con_detalles,
        COUNT(CASE WHEN m.local_detalle_id IS NOT NULL THEN 1 END) as con_map,
        COUNT(CASE WHEN d.id IS NOT NULL AND m.local_detalle_id IS NULL THEN 1 END) as detalles_sin_map
      FROM presupuestos p
      LEFT JOIN presupuestos_detalles d ON d.id_presupuesto_ext = p.id_presupuesto_ext
      LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
      WHERE p.activo = true
      GROUP BY 
        CASE 
          WHEN p.hoja_nombre = 'Presupuestos' THEN 'Sheets→Local'
          WHEN p.hoja_nombre IS NULL THEN 'Local→Sheets'
          ELSE p.hoja_nombre
        END
      ORDER BY origen
    `);
    
    console.log('📋 Análisis por origen:');
    porOrigen.rows.forEach(row => {
      console.log(`   ${row.origen}:`);
      console.log(`      Total presupuestos: ${row.total_presupuestos}`);
      console.log(`      Con detalles: ${row.con_detalles}`);
      console.log(`      Con MAP: ${row.con_map}`);
      console.log(`      ❌ Detalles SIN MAP: ${row.detalles_sin_map}`);
    });
    
    // 5. VERIFICAR CUTOFF_AT ACTUAL
    console.log('\n📊 5. CONFIGURACIÓN CUTOFF_AT:');
    
    const config = await pool.query(`
      SELECT cutoff_at, 
             NOW() - cutoff_at as tiempo_desde_cutoff,
             hoja_id, hoja_nombre
      FROM presupuestos_config 
      WHERE activo = true 
      ORDER BY id DESC 
      LIMIT 1
    `);
    
    if (config.rowCount > 0) {
      const c = config.rows[0];
      console.log(`📋 Configuración actual:`);
      console.log(`   cutoff_at: ${c.cutoff_at}`);
      console.log(`   Tiempo desde cutoff: ${c.tiempo_desde_cutoff}`);
      console.log(`   Hoja: ${c.hoja_id} (${c.hoja_nombre})`);
    }
    
    // 6. DIAGNÓSTICO ESPECÍFICO: ¿QUÉ PRESUPUESTOS NECESITAN MAP?
    console.log('\n📊 6. PRESUPUESTOS QUE NECESITAN MAP (POSTERIORES A CUTOFF):');
    
    const necesitanMap = await pool.query(`
      SELECT p.id_presupuesto_ext, p.hoja_nombre, p.fecha_actualizacion,
             COUNT(d.id) as count_detalles,
             COUNT(m.local_detalle_id) as count_map,
             p.fecha_actualizacion >= $1 as pasa_cutoff
      FROM presupuestos p
      LEFT JOIN presupuestos_detalles d ON d.id_presupuesto_ext = p.id_presupuesto_ext
      LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
      WHERE p.activo = true 
        AND p.hoja_nombre IS NOT NULL
        AND p.fecha_actualizacion >= $1  -- SOLO POSTERIORES A CUTOFF
      GROUP BY p.id_presupuesto_ext, p.hoja_nombre, p.fecha_actualizacion
      HAVING COUNT(d.id) > 0 AND COUNT(m.local_detalle_id) = 0
      ORDER BY p.fecha_actualizacion DESC
    `, [config.rows[0]?.cutoff_at || new Date(Date.now() - 7*24*60*60*1000)]);
    
    console.log(`📋 Presupuestos que NECESITAN MAP (posteriores a cutoff): ${necesitanMap.rowCount}`);
    necesitanMap.rows.forEach((p, i) => {
      console.log(`   ${i+1}. ${p.id_presupuesto_ext}:`);
      console.log(`      Origen: ${p.hoja_nombre}`);
      console.log(`      Fecha: ${p.fecha_actualizacion}`);
      console.log(`      Pasa cutoff: ${p.pasa_cutoff}`);
      console.log(`      Detalles: ${p.count_detalles}, MAP: ${p.count_map}`);
    });
    
    // 7. CONCLUSIÓN Y RECOMENDACIÓN
    console.log('\n🎯 7. CONCLUSIÓN:');
    
    if (necesitanMap.rowCount > 0) {
      console.log(`❌ HAY ${necesitanMap.rowCount} PRESUPUESTOS RECIENTES QUE NECESITAN MAP`);
      console.log('💡 ESTOS SON LOS QUE DEBERÍAN PROCESARSE EN LA PRÓXIMA SYNC');
      console.log('💡 EL PROBLEMA: La lógica actual NO los está detectando correctamente');
    } else {
      console.log('✅ NO HAY PRESUPUESTOS RECIENTES QUE NECESITEN MAP');
      console.log('💡 Todos los presupuestos posteriores al cutoff_at ya tienen MAP');
    }
    
    console.log('\n🔧 RECOMENDACIÓN:');
    console.log('1. Verificar por qué la query de detección no encuentra estos presupuestos');
    console.log('2. Revisar si el problema está en el filtro cutoff_at de detalles');
    console.log('3. Asegurar que la función crearMapParaDetallesExistentes() se ejecute');
    
  } catch (error) {
    console.error('❌ Error en diagnóstico:', error.message);
  } finally {
    await pool.end();
  }
}

diagnosticoIntegral().catch(console.error);
