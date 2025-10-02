// DIAGNÓSTICO DEL PROBLEMA DE PULL MASIVO
// Analiza por qué syncDetallesDesdeSheets procesa todos los detalles

const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function diagnosticarPullMasivo() {
  console.log('🔍 [PULL-MASIVO] === DIAGNÓSTICO DEL PROBLEMA DE PULL MASIVO ===');
  
  try {
    // 1. Verificar total de detalles en BD local
    const totalLocal = await pool.query(`
      SELECT COUNT(*) as total,
             COUNT(DISTINCT id_presupuesto_ext) as presupuestos_distintos,
             MAX(fecha_actualizacion) as ultima_actualizacion
      FROM presupuestos_detalles
    `);
    
    console.log(`📊 ESTADO ACTUAL BD LOCAL:`);
    console.log(`   Total detalles: ${totalLocal.rows[0].total}`);
    console.log(`   Presupuestos distintos: ${totalLocal.rows[0].presupuestos_distintos}`);
    console.log(`   Última actualización: ${totalLocal.rows[0].ultima_actualizacion}`);
    
    // 2. Buscar presupuestos con detalles excesivos
    const excesivos = await pool.query(`
      SELECT id_presupuesto_ext, COUNT(*) as count_detalles,
             COUNT(DISTINCT articulo) as articulos_unicos,
             MIN(fecha_actualizacion) as primera_fecha,
             MAX(fecha_actualizacion) as ultima_fecha
      FROM presupuestos_detalles
      GROUP BY id_presupuesto_ext
      HAVING COUNT(*) > 10  -- Más de 10 detalles por presupuesto
      ORDER BY COUNT(*) DESC
      LIMIT 10
    `);
    
    if (excesivos.rowCount > 0) {
      console.log(`\n⚠️ PRESUPUESTOS CON DETALLES EXCESIVOS:`);
      excesivos.rows.forEach((p, i) => {
        console.log(`   ${i+1}. ${p.id_presupuesto_ext}: ${p.count_detalles} detalles (${p.articulos_unicos} únicos)`);
        console.log(`      Rango: ${p.primera_fecha} → ${p.ultima_fecha}`);
      });
      
      // Analizar el primer caso excesivo
      const idProblematico = excesivos.rows[0].id_presupuesto_ext;
      console.log(`\n🔍 ANÁLISIS DETALLADO DE: ${idProblematico}`);
      
      const detallesProblematicos = await pool.query(`
        SELECT articulo, COUNT(*) as repeticiones,
               MIN(id) as primer_id, MAX(id) as ultimo_id,
               MIN(fecha_actualizacion) as primera_fecha,
               MAX(fecha_actualizacion) as ultima_fecha
        FROM presupuestos_detalles
        WHERE id_presupuesto_ext = $1
        GROUP BY articulo
        ORDER BY COUNT(*) DESC
        LIMIT 5
      `, [idProblematico]);
      
      console.log(`   📊 ARTÍCULOS MÁS REPETIDOS:`);
      detallesProblematicos.rows.forEach((d, i) => {
        console.log(`      ${i+1}. ${d.articulo}: ${d.repeticiones} veces`);
        console.log(`         IDs: ${d.primer_id} → ${d.ultimo_id}`);
        console.log(`         Fechas: ${d.primera_fecha} → ${d.ultima_fecha}`);
      });
      
      // Verificar MAP para este presupuesto problemático
      const mapProblematico = await pool.query(`
        SELECT d.id as local_id, d.articulo, 
               m.id_detalle_presupuesto, m.fuente, m.fecha_asignacion
        FROM presupuestos_detalles d
        LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
        WHERE d.id_presupuesto_ext = $1
        ORDER BY d.fecha_actualizacion DESC
        LIMIT 10
      `, [idProblematico]);
      
      console.log(`   📊 MAP para presupuesto problemático:`);
      mapProblematico.rows.forEach((m, i) => {
        console.log(`      ${i+1}. local_id=${m.local_id} art=${m.articulo}`);
        console.log(`         sheet_id=${m.id_detalle_presupuesto || 'SIN_MAP'}`);
        console.log(`         fuente=${m.fuente || 'N/A'}`);
      });
    }
    
    // 3. Analizar logs de sincronización recientes
    console.log('\n🔍 [PULL-MASIVO] === LOGS DE SINCRONIZACIÓN RECIENTES ===');
    
    const logsRecientes = await pool.query(`
      SELECT fecha_sync, registros_procesados, registros_nuevos, 
             registros_actualizados, detalles, tipo_sync
      FROM presupuestos_sync_log
      WHERE exitoso = true
      ORDER BY fecha_sync DESC
      LIMIT 3
    `);
    
    logsRecientes.rows.forEach((log, i) => {
      console.log(`   ${i+1}. ${log.fecha_sync} (${log.tipo_sync})`);
      console.log(`      procesados=${log.registros_procesados} nuevos=${log.registros_nuevos} actualizados=${log.registros_actualizados}`);
      
      if (log.detalles) {
        try {
          const detallesInfo = JSON.parse(log.detalles);
          console.log(`      pull_recibidos=${detallesInfo.pull_recibidos || 'N/A'}`);
          console.log(`      pull_actualizados=${detallesInfo.pull_actualizados || 'N/A'}`);
        } catch (e) {
          console.log(`      detalles_raw=${log.detalles}`);
        }
      }
    });
    
    // 4. Identificar el problema específico
    console.log('\n🔍 [PULL-MASIVO] === IDENTIFICACIÓN DEL PROBLEMA ===');
    
    console.log('🚨 PROBLEMA IDENTIFICADO:');
    console.log('   El flujo PULL está ejecutando syncDetallesDesdeSheets() para TODOS los presupuestos');
    console.log('   que tienen detalles en Sheets, no solo para los nuevos/modificados.');
    console.log('');
    console.log('🔍 UBICACIÓN DEL PROBLEMA:');
    console.log('   En pullCambiosRemotosConTimestampMejorado() hay una sección que dice:');
    console.log('   "MEJORA CRÍTICA: Siempre verificar presupuestos sin detalles locales"');
    console.log('   Esta sección está procesando TODOS los presupuestos con detalles en Sheets');
    console.log('');
    console.log('✅ SOLUCIÓN:');
    console.log('   1. Aplicar filtro cutoff_at también en esta verificación');
    console.log('   2. Solo procesar presupuestos que realmente fueron modificados en Sheets');
    console.log('   3. Evitar el procesamiento masivo de detalles existentes');
    
    console.log('\n✅ [PULL-MASIVO] Diagnóstico completado');
    
  } catch (error) {
    console.error('❌ [PULL-MASIVO] Error:', error.message);
  } finally {
    await pool.end();
  }
}

// Ejecutar diagnóstico
diagnosticarPullMasivo().catch(console.error);
