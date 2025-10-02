// DIAGNÓSTICO DE PRECISIÓN DE TIMESTAMPS
// Verifica diferencias en minutos y segundos entre cutoff_at y registros

const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function diagnosticarPrecisionTimestamps() {
  console.log('🔍 [TIMESTAMP-PRECISION] === DIAGNÓSTICO DE PRECISIÓN DE TIMESTAMPS ===');
  
  try {
    // 1. Obtener cutoff_at actual
    const config = await pool.query(`
      SELECT cutoff_at, fecha_creacion
      FROM presupuestos_config 
      WHERE activo = true 
      ORDER BY fecha_creacion DESC 
      LIMIT 1
    `);
    
    if (config.rows.length === 0) {
      console.log('❌ No hay configuración activa');
      return;
    }
    
    const cutoffAt = config.rows[0].cutoff_at;
    console.log(`📅 cutoff_at actual: ${cutoffAt}`);
    console.log(`📅 cutoff_at ISO: ${cutoffAt.toISOString()}`);
    
    // 2. Obtener última sincronización
    const ultimaSync = await pool.query(`
      SELECT fecha_sync, registros_procesados
      FROM presupuestos_sync_log 
      WHERE exitoso = true
      ORDER BY fecha_sync DESC 
      LIMIT 1
    `);
    
    if (ultimaSync.rows.length > 0) {
      const fechaSync = ultimaSync.rows[0].fecha_sync;
      console.log(`📅 Última sync: ${fechaSync}`);
      console.log(`📅 Diff cutoff vs sync: ${Math.round((cutoffAt - new Date(fechaSync)) / 1000)} segundos`);
    }
    
    // 3. Buscar registros CERCANOS al cutoff_at (±5 minutos)
    console.log('\n🔍 [TIMESTAMP-PRECISION] === REGISTROS CERCANOS AL CUTOFF_AT ===');
    
    const registrosCercanos = await pool.query(`
      SELECT 
        p.id_presupuesto_ext,
        p.fecha_actualizacion,
        EXTRACT(EPOCH FROM (p.fecha_actualizacion - $1)) as diff_segundos,
        CASE 
          WHEN p.fecha_actualizacion > $1 THEN 'POSTERIOR'
          WHEN p.fecha_actualizacion = $1 THEN 'IGUAL'
          ELSE 'ANTERIOR'
        END as relacion_cutoff
      FROM presupuestos p
      WHERE p.activo = true 
        AND p.id_presupuesto_ext IS NOT NULL
        AND ABS(EXTRACT(EPOCH FROM (p.fecha_actualizacion - $1))) <= 300  -- ±5 minutos
      ORDER BY p.fecha_actualizacion DESC
      LIMIT 10
    `, [cutoffAt]);
    
    console.log(`   Registros cercanos (±5 min): ${registrosCercanos.rowCount}`);
    registrosCercanos.rows.forEach((r, i) => {
      console.log(`   ${i+1}. ID: ${r.id_presupuesto_ext}`);
      console.log(`      fecha_actualizacion: ${r.fecha_actualizacion}`);
      console.log(`      diff_segundos: ${r.diff_segundos}`);
      console.log(`      relacion_cutoff: ${r.relacion_cutoff}`);
      console.log(`      pasaría_filtro_>: ${r.relacion_cutoff === 'POSTERIOR'}`);
    });
    
    // 4. Buscar detalles CERCANOS al cutoff_at
    console.log('\n🔍 [TIMESTAMP-PRECISION] === DETALLES CERCANOS AL CUTOFF_AT ===');
    
    const detallesCercanos = await pool.query(`
      SELECT 
        d.id_presupuesto_ext,
        d.articulo,
        d.fecha_actualizacion,
        EXTRACT(EPOCH FROM (d.fecha_actualizacion - $1)) as diff_segundos,
        CASE 
          WHEN d.fecha_actualizacion > $1 THEN 'POSTERIOR'
          WHEN d.fecha_actualizacion = $1 THEN 'IGUAL'
          ELSE 'ANTERIOR'
        END as relacion_cutoff
      FROM presupuestos_detalles d
      INNER JOIN presupuestos p ON p.id_presupuesto_ext = d.id_presupuesto_ext
      WHERE p.activo = true 
        AND ABS(EXTRACT(EPOCH FROM (d.fecha_actualizacion - $1))) <= 300  -- ±5 minutos
      ORDER BY d.fecha_actualizacion DESC
      LIMIT 10
    `, [cutoffAt]);
    
    console.log(`   Detalles cercanos (±5 min): ${detallesCercanos.rowCount}`);
    detallesCercanos.rows.forEach((r, i) => {
      console.log(`   ${i+1}. ID: ${r.id_presupuesto_ext} - ${r.articulo}`);
      console.log(`      fecha_actualizacion: ${r.fecha_actualizacion}`);
      console.log(`      diff_segundos: ${r.diff_segundos}`);
      console.log(`      relacion_cutoff: ${r.relacion_cutoff}`);
      console.log(`      pasaría_filtro_>: ${r.relacion_cutoff === 'POSTERIOR'}`);
    });
    
    // 5. Sugerir cutoff_at ajustado (restar 1 minuto para incluir registros recientes)
    console.log('\n💡 [TIMESTAMP-PRECISION] === SUGERENCIA DE AJUSTE ===');
    const cutoffAjustado = new Date(cutoffAt.getTime() - 60 * 1000); // -1 minuto
    console.log(`   cutoff_at ACTUAL: ${cutoffAt.toISOString()}`);
    console.log(`   cutoff_at SUGERIDO: ${cutoffAjustado.toISOString()} (-1 minuto)`);
    
    // Simular con cutoff ajustado
    const testAjustado = await pool.query(`
      SELECT COUNT(*) as count
      FROM presupuestos p
      WHERE p.activo = true 
        AND p.id_presupuesto_ext IS NOT NULL
        AND p.fecha_actualizacion > $1
    `, [cutoffAjustado]);
    
    console.log(`   Con cutoff_at -1min, se procesarían: ${testAjustado.rows[0].count} presupuestos`);
    
    if (testAjustado.rows[0].count > 0) {
      const muestraAjustado = await pool.query(`
        SELECT p.id_presupuesto_ext, p.fecha_actualizacion,
               EXTRACT(EPOCH FROM (p.fecha_actualizacion - $1)) as diff_segundos
        FROM presupuestos p
        WHERE p.activo = true 
          AND p.id_presupuesto_ext IS NOT NULL
          AND p.fecha_actualizacion > $1
        ORDER BY p.fecha_actualizacion DESC
        LIMIT 5
      `, [cutoffAjustado]);
      
      console.log('   Muestra de registros que se procesarían:');
      muestraAjustado.rows.forEach((r, i) => {
        console.log(`   ${i+1}. ${r.id_presupuesto_ext}: ${r.fecha_actualizacion} (+${Math.round(r.diff_segundos)}s)`);
      });
    }
    
    console.log('\n✅ [TIMESTAMP-PRECISION] Diagnóstico completado');
    
  } catch (error) {
    console.error('❌ [TIMESTAMP-PRECISION] Error:', error.message);
  } finally {
    await pool.end();
  }
}

// Ejecutar diagnóstico
diagnosticarPrecisionTimestamps().catch(console.error);
