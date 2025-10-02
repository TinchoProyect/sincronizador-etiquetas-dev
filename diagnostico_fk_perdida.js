// DIAGNÓSTICO: DETECTAR DÓNDE SE PIERDE LA FK id_presupuesto
// Rastrea el estado de los detalles antes, durante y después de la sincronización

const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function diagnosticarPerdidaFK() {
  console.log('🔍 [DIAG-FK] ===== INICIANDO DIAGNÓSTICO DE PÉRDIDA DE FK =====');
  
  try {
    // PASO 1: Estado ANTES de cualquier operación
    console.log('\n📊 [DIAG-FK] PASO 1: Estado ANTES de sincronización');
    await mostrarEstadoDetalles('ANTES');
    
    // PASO 2: Identificar presupuestos que se van a sincronizar
    console.log('\n🎯 [DIAG-FK] PASO 2: Presupuestos candidatos para sincronización');
    const configResult = await pool.query(`
      SELECT cutoff_at FROM presupuestos_config WHERE activo = true ORDER BY id DESC LIMIT 1
    `);
    
    const cutoffAt = configResult.rows[0]?.cutoff_at || new Date(Date.now() - 7*24*60*60*1000);
    console.log('[DIAG-FK] cutoff_at usado:', cutoffAt);
    
    const candidatosResult = await pool.query(`
      SELECT DISTINCT p.id, p.id_presupuesto_ext, p.fecha_actualizacion,
             COUNT(d.id) as total_detalles,
             COUNT(CASE WHEN d.id_presupuesto IS NOT NULL THEN 1 END) as detalles_con_fk,
             COUNT(CASE WHEN d.id_presupuesto IS NULL THEN 1 END) as detalles_sin_fk
      FROM presupuestos p
      LEFT JOIN presupuestos_detalles d ON d.id_presupuesto_ext = p.id_presupuesto_ext
      WHERE p.activo = true 
        AND p.fecha_actualizacion >= $1
      GROUP BY p.id, p.id_presupuesto_ext, p.fecha_actualizacion
      ORDER BY p.fecha_actualizacion DESC
      LIMIT 5
    `, [cutoffAt]);
    
    console.log('[DIAG-FK] Presupuestos candidatos para sincronización:');
    candidatosResult.rows.forEach((row, i) => {
      console.log(`  ${i+1}. ID_EXT: ${row.id_presupuesto_ext}`);
      console.log(`     ID_LOCAL: ${row.id}`);
      console.log(`     DETALLES: ${row.total_detalles} total, ${row.detalles_con_fk} con FK, ${row.detalles_sin_fk} sin FK`);
      console.log(`     FECHA_ACT: ${row.fecha_actualizacion}`);
    });
    
    // PASO 3: Simular las operaciones que hace la sincronización
    console.log('\n🔍 [DIAG-FK] PASO 3: Simulando operaciones de sincronización...');
    
    // Verificar si hay DELETE que afecte detalles
    console.log('\n🗑️ [DIAG-FK] Verificando operaciones DELETE...');
    
    // Buscar en el código las operaciones DELETE
    const deleteOperations = [
      'DELETE FROM presupuestos_detalles WHERE id_presupuesto_ext = ANY($1::text[])',
      'DELETE FROM presupuestos',
      'DELETE FROM public.presupuestos_detalles'
    ];
    
    console.log('[DIAG-FK] Operaciones DELETE que podrían afectar detalles:');
    deleteOperations.forEach((op, i) => {
      console.log(`  ${i+1}. ${op}`);
    });
    
    // PASO 4: Verificar integridad referencial
    console.log('\n🔗 [DIAG-FK] PASO 4: Verificando integridad referencial');
    const integridadResult = await pool.query(`
      SELECT 
        COUNT(*) as total_detalles,
        COUNT(CASE WHEN id_presupuesto IS NOT NULL THEN 1 END) as con_fk,
        COUNT(CASE WHEN id_presupuesto IS NULL THEN 1 END) as sin_fk,
        COUNT(CASE WHEN id_presupuesto IS NOT NULL AND EXISTS(
          SELECT 1 FROM presupuestos p WHERE p.id = presupuestos_detalles.id_presupuesto
        ) THEN 1 END) as fk_valida,
        COUNT(CASE WHEN id_presupuesto IS NOT NULL AND NOT EXISTS(
          SELECT 1 FROM presupuestos p WHERE p.id = presupuestos_detalles.id_presupuesto
        ) THEN 1 END) as fk_rota
      FROM presupuestos_detalles
    `);
    
    const integridad = integridadResult.rows[0];
    console.log('[DIAG-FK] Estado de integridad referencial:');
    console.log(`  - Total detalles: ${integridad.total_detalles}`);
    console.log(`  - Con FK: ${integridad.con_fk}`);
    console.log(`  - Sin FK: ${integridad.sin_fk}`);
    console.log(`  - FK válida: ${integridad.fk_valida}`);
    console.log(`  - FK rota: ${integridad.fk_rota}`);
    
    // PASO 5: Mostrar detalles huérfanos
    if (parseInt(integridad.sin_fk) > 0) {
      console.log('\n👥 [DIAG-FK] PASO 5: Detalles huérfanos (sin FK)');
      const huerfanosResult = await pool.query(`
        SELECT id, id_presupuesto_ext, articulo, fecha_actualizacion
        FROM presupuestos_detalles 
        WHERE id_presupuesto IS NULL
        ORDER BY fecha_actualizacion DESC
        LIMIT 10
      `);
      
      console.log('[DIAG-FK] Detalles sin id_presupuesto (huérfanos):');
      huerfanosResult.rows.forEach((row, i) => {
        console.log(`  ${i+1}. ID: ${row.id}, ID_EXT: ${row.id_presupuesto_ext}, ART: ${row.articulo}`);
        console.log(`     FECHA_ACT: ${row.fecha_actualizacion}`);
      });
    }
    
    console.log('\n✅ [DIAG-FK] ===== DIAGNÓSTICO COMPLETADO =====');
    console.log('\n💡 [DIAG-FK] PRÓXIMOS PASOS:');
    console.log('1. Ejecutar sincronización manual');
    console.log('2. Ejecutar este diagnóstico nuevamente');
    console.log('3. Comparar el estado ANTES vs DESPUÉS');
    
  } catch (error) {
    console.error('❌ [DIAG-FK] Error:', error.message);
  } finally {
    await pool.end();
  }
}

async function mostrarEstadoDetalles(momento) {
  const estadoResult = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN id_presupuesto IS NOT NULL THEN 1 END) as con_fk,
      COUNT(CASE WHEN id_presupuesto IS NULL THEN 1 END) as sin_fk,
      MIN(fecha_actualizacion) as fecha_min,
      MAX(fecha_actualizacion) as fecha_max
    FROM presupuestos_detalles
  `);
  
  const estado = estadoResult.rows[0];
  console.log(`[DIAG-FK] Estado ${momento}:`);
  console.log(`  - Total detalles: ${estado.total}`);
  console.log(`  - Con id_presupuesto: ${estado.con_fk}`);
  console.log(`  - Sin id_presupuesto: ${estado.sin_fk}`);
  console.log(`  - Fecha min: ${estado.fecha_min}`);
  console.log(`  - Fecha max: ${estado.fecha_max}`);
}

// Ejecutar diagnóstico
diagnosticarPerdidaFK().catch(console.error);
