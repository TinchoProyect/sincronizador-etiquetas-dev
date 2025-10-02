// DIAGNÓSTICO COMPLETO DEL FLUJO DE DETALLES
// Analiza paso a paso qué sucede con los detalles durante la sincronización

const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function diagnosticarFlujoDetallesCompleto() {
  console.log('🔍 [FLUJO-DETALLES] === DIAGNÓSTICO COMPLETO DEL FLUJO DE DETALLES ===');
  
  try {
    // 1. Obtener configuración actual
    const config = await pool.query(`
      SELECT cutoff_at, hoja_id
      FROM presupuestos_config 
      WHERE activo = true 
      ORDER BY fecha_creacion DESC 
      LIMIT 1
    `);
    
    const cutoffAt = config.rows[0].cutoff_at;
    const hojaId = config.rows[0].hoja_id;
    
    console.log(`📅 cutoff_at: ${cutoffAt.toISOString()}`);
    
    // 2. Analizar el presupuesto problemático específico
    const presupuestoProblema = 'mfxxrngm-7l3ha';
    console.log(`\n🎯 [FLUJO-DETALLES] === ANÁLISIS DEL PRESUPUESTO ${presupuestoProblema} ===`);
    
    // 2A. Estado del presupuesto en local
    const presupuestoLocal = await pool.query(`
      SELECT id, id_presupuesto_ext, fecha_actualizacion, activo
      FROM presupuestos 
      WHERE id_presupuesto_ext = $1
    `, [presupuestoProblema]);
    
    if (presupuestoLocal.rowCount > 0) {
      const p = presupuestoLocal.rows[0];
      console.log(`📋 Presupuesto local:`, {
        id: p.id,
        id_presupuesto_ext: p.id_presupuesto_ext,
        fecha_actualizacion: p.fecha_actualizacion,
        activo: p.activo,
        pasaCutoff: new Date(p.fecha_actualizacion) > cutoffAt
      });
    }
    
    // 2B. Detalles del presupuesto en local
    const detallesLocales = await pool.query(`
      SELECT d.id, d.articulo, d.cantidad, d.precio1, d.fecha_actualizacion,
             m.id_detalle_presupuesto, m.fuente, m.fecha_asignacion
      FROM presupuestos_detalles d
      LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
      WHERE d.id_presupuesto_ext = $1
      ORDER BY d.id
    `, [presupuestoProblema]);
    
    console.log(`📊 Detalles locales: ${detallesLocales.rowCount}`);
    detallesLocales.rows.forEach((d, i) => {
      console.log(`   ${i+1}. local_id=${d.id} art=${d.articulo} cant=${d.cantidad}`);
      console.log(`      sheet_id=${d.id_detalle_presupuesto || 'SIN_MAP'} fuente=${d.fuente || 'N/A'}`);
      console.log(`      fecha_act=${d.fecha_actualizacion} pasaCutoff=${new Date(d.fecha_actualizacion) > cutoffAt}`);
    });
    
    // 3. Analizar qué detalles se procesarían con filtro cutoff_at
    console.log(`\n🔍 [FLUJO-DETALLES] === DETALLES QUE SE PROCESARÍAN CON CUTOFF_AT ===`);
    
    const detallesConFiltro = await pool.query(`
      SELECT d.id, d.articulo, d.cantidad, d.fecha_actualizacion,
             EXTRACT(EPOCH FROM (d.fecha_actualizacion - $2)) as diff_segundos
      FROM presupuestos_detalles d
      WHERE d.id_presupuesto_ext = $1
        AND d.fecha_actualizacion > $2
      ORDER BY d.fecha_actualizacion DESC
    `, [presupuestoProblema, cutoffAt]);
    
    console.log(`📊 Detalles con filtro cutoff_at: ${detallesConFiltro.rowCount}`);
    detallesConFiltro.rows.forEach((d, i) => {
      console.log(`   ${i+1}. id=${d.id} art=${d.articulo} diff=${Math.round(d.diff_segundos)}s`);
    });
    
    // 4. Analizar el problema del MAP
    console.log(`\n🔍 [FLUJO-DETALLES] === ANÁLISIS DEL PROBLEMA DEL MAP ===`);
    
    const mapProblema = await pool.query(`
      SELECT m.local_detalle_id, m.id_detalle_presupuesto, m.fuente, m.fecha_asignacion,
             d.articulo, d.cantidad
      FROM presupuestos_detalles_map m
      INNER JOIN presupuestos_detalles d ON d.id = m.local_detalle_id
      WHERE d.id_presupuesto_ext = $1
      ORDER BY m.fecha_asignacion DESC
    `, [presupuestoProblema]);
    
    console.log(`📊 Entradas en MAP para ${presupuestoProblema}: ${mapProblema.rowCount}`);
    mapProblema.rows.forEach((m, i) => {
      console.log(`   ${i+1}. local=${m.local_detalle_id} sheet=${m.id_detalle_presupuesto}`);
      console.log(`      art=${m.articulo} fuente=${m.fuente} fecha=${m.fecha_asignacion}`);
    });
    
    // 5. Identificar el problema raíz
    console.log(`\n💡 [FLUJO-DETALLES] === IDENTIFICACIÓN DEL PROBLEMA ===`);
    
    // Contar cuántos IDs de Sheets diferentes hay para el mismo presupuesto
    const idsUnicos = new Set(mapProblema.rows.map(m => m.id_detalle_presupuesto));
    const detallesUnicos = new Set(mapProblema.rows.map(m => m.articulo));
    
    console.log(`🔍 IDs únicos en Sheets: ${idsUnicos.size}`);
    console.log(`🔍 Artículos únicos: ${detallesUnicos.size}`);
    console.log(`🔍 Entradas en MAP: ${mapProblema.rowCount}`);
    
    if (idsUnicos.size > detallesUnicos.size) {
      console.log('❌ PROBLEMA DETECTADO: Hay más IDs de Sheets que artículos únicos');
      console.log('   Esto significa que se están creando múltiples IDs para el mismo artículo');
      console.log('   CAUSA: No se eliminan detalles antiguos antes de insertar nuevos');
    }
    
    // 6. Proponer solución
    console.log(`\n💡 [FLUJO-DETALLES] === SOLUCIÓN PROPUESTA ===`);
    console.log('1. ANTES de insertar detalles nuevos:');
    console.log('   - Leer detalles existentes en Sheets para el presupuesto');
    console.log('   - Eliminar TODAS las filas de ese presupuesto en Sheets');
    console.log('   - Limpiar entradas del MAP para ese presupuesto');
    console.log('2. DESPUÉS:');
    console.log('   - Insertar TODOS los detalles actuales de local');
    console.log('   - Crear nuevas entradas en MAP');
    
    // 7. Verificar si hay otros presupuestos con el mismo problema
    console.log(`\n🔍 [FLUJO-DETALLES] === VERIFICANDO OTROS PRESUPUESTOS CON PROBLEMA ===`);
    
    const otrosProblemas = await pool.query(`
      SELECT d.id_presupuesto_ext, COUNT(DISTINCT m.id_detalle_presupuesto) as ids_sheets,
             COUNT(DISTINCT d.articulo) as articulos_unicos,
             COUNT(m.local_detalle_id) as entradas_map
      FROM presupuestos_detalles d
      INNER JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
      INNER JOIN presupuestos p ON p.id_presupuesto_ext = d.id_presupuesto_ext
      WHERE p.activo = true
      GROUP BY d.id_presupuesto_ext
      HAVING COUNT(DISTINCT m.id_detalle_presupuesto) > COUNT(DISTINCT d.articulo)
      ORDER BY COUNT(DISTINCT m.id_detalle_presupuesto) DESC
      LIMIT 10
    `);
    
    console.log(`📊 Otros presupuestos con problema similar: ${otrosProblemas.rowCount}`);
    otrosProblemas.rows.forEach((p, i) => {
      console.log(`   ${i+1}. ${p.id_presupuesto_ext}: ${p.ids_sheets} IDs Sheets vs ${p.articulos_unicos} artículos`);
    });
    
    console.log('\n✅ [FLUJO-DETALLES] Diagnóstico completado');
    
  } catch (error) {
    console.error('❌ [FLUJO-DETALLES] Error:', error.message);
  } finally {
    await pool.end();
  }
}

// Ejecutar diagnóstico
diagnosticarFlujoDetallesCompleto().catch(console.error);
