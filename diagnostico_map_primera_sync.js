// DIAGNÓSTICO: ¿Por qué el MAP no se carga en la primera sincronización?
// Identifica el problema en el flujo de creación del MAP

const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function diagnosticarMapPrimeraSync() {
  console.log('🔍 [MAP-PRIMERA-SYNC] === DIAGNÓSTICO DEL MAP EN PRIMERA SYNC ===');
  
  try {
    // 1. Verificar estado actual del MAP
    console.log('\n📊 [MAP-PRIMERA-SYNC] === ESTADO ACTUAL DEL MAP ===');
    
    const estadoMap = await pool.query(`
      SELECT 
        m.fuente,
        COUNT(*) as count_entradas,
        MAX(m.fecha_asignacion) as ultima_asignacion
      FROM presupuestos_detalles_map m
      GROUP BY m.fuente
      ORDER BY COUNT(*) DESC
    `);
    
    console.log('📊 MAP por fuente:');
    estadoMap.rows.forEach(m => {
      console.log(`   ${m.fuente}: ${m.count_entradas} entradas (última: ${m.ultima_asignacion})`);
    });
    
    // 2. Verificar detalles recientes SIN MAP
    console.log('\n🔍 [MAP-PRIMERA-SYNC] === DETALLES RECIENTES SIN MAP ===');
    
    const detallesSinMap = await pool.query(`
      SELECT d.id, d.id_presupuesto_ext, d.articulo, d.fecha_actualizacion
      FROM presupuestos_detalles d
      LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
      WHERE m.local_detalle_id IS NULL
        AND d.fecha_actualizacion >= NOW() - INTERVAL '1 hour'
      ORDER BY d.fecha_actualizacion DESC
      LIMIT 10
    `);
    
    console.log(`📊 Detalles recientes SIN MAP: ${detallesSinMap.rowCount}`);
    if (detallesSinMap.rowCount > 0) {
      console.log('📋 MUESTRA DE DETALLES SIN MAP:');
      detallesSinMap.rows.forEach((d, i) => {
        console.log(`   ${i+1}. ID=${d.id} presup=${d.id_presupuesto_ext} art=${d.articulo}`);
        console.log(`      fecha=${d.fecha_actualizacion}`);
      });
    }
    
    // 3. Verificar configuración cutoff_at
    console.log('\n📅 [MAP-PRIMERA-SYNC] === CONFIGURACIÓN CUTOFF_AT ===');
    
    const config = await pool.query(`
      SELECT cutoff_at, hoja_id
      FROM presupuestos_config 
      WHERE activo = true 
      ORDER BY fecha_creacion DESC 
      LIMIT 1
    `);
    
    const cutoffAt = config.rows[0].cutoff_at;
    console.log(`📅 cutoff_at actual: ${cutoffAt.toISOString()}`);
    
    // 4. Verificar presupuestos que deberían procesarse
    console.log('\n🔍 [MAP-PRIMERA-SYNC] === PRESUPUESTOS QUE DEBERÍAN PROCESARSE ===');
    
    const presupuestosAProcesar = await pool.query(`
      SELECT p.id_presupuesto_ext, p.fecha_actualizacion,
             p.fecha_actualizacion > $1 as pasa_cutoff
      FROM presupuestos p
      WHERE p.activo = true 
        AND p.id_presupuesto_ext IS NOT NULL
        AND p.fecha_actualizacion > $1
      ORDER BY p.fecha_actualizacion DESC
      LIMIT 5
    `, [cutoffAt]);
    
    console.log(`📊 Presupuestos que pasan cutoff_at: ${presupuestosAProcesar.rowCount}`);
    if (presupuestosAProcesar.rowCount > 0) {
      console.log('📋 MUESTRA:');
      presupuestosAProcesar.rows.forEach((p, i) => {
        console.log(`   ${i+1}. ${p.id_presupuesto_ext}: ${p.fecha_actualizacion} (pasa: ${p.pasa_cutoff})`);
      });
    }
    
    // 5. Analizar el flujo de sincronización
    console.log('\n🔍 [MAP-PRIMERA-SYNC] === ANÁLISIS DEL FLUJO ===');
    
    console.log('🔄 FLUJO ACTUAL DE SINCRONIZACIÓN BIDIRECCIONAL:');
    console.log('   1. FASE 1: PUSH anulaciones → Sheets');
    console.log('   2. FASE 2: PUSH altas/updates → Sheets');
    console.log('   3. FASE 3: PULL cambios remotos → Local');
    console.log('');
    console.log('❓ PROBLEMA IDENTIFICADO:');
    console.log('   - En FASE 2: pushDetallesLocalesASheets() crea MAP con fuente="Local"');
    console.log('   - En FASE 3: syncDetallesDesdeSheets() debería crear MAP con fuente="Sheets"');
    console.log('   - Pero FASE 3 solo se ejecuta para presupuestos NUEVOS desde Sheets');
    console.log('   - Si el presupuesto ya existe local, NO se ejecuta syncDetallesDesdeSheets()');
    
    // 6. Verificar si hay presupuestos nuevos desde Sheets
    console.log('\n🔍 [MAP-PRIMERA-SYNC] === VERIFICAR PRESUPUESTOS NUEVOS DESDE SHEETS ===');
    
    console.log('💡 POSIBLES CAUSAS:');
    console.log('   1. ❌ syncDetallesDesdeSheets() solo se ejecuta para presupuestos NUEVOS');
    console.log('   2. ❌ No se ejecuta para presupuestos que ya existen en local');
    console.log('   3. ❌ El MAP solo se crea cuando se procesa desde Sheets');
    console.log('   4. ❌ Falta ejecutar syncDetallesDesdeSheets() para presupuestos locales');
    
    // 7. Recomendaciones
    console.log('\n💡 [MAP-PRIMERA-SYNC] === RECOMENDACIONES ===');
    
    console.log('🔧 SOLUCIONES POSIBLES:');
    console.log('   1. ✅ Ejecutar syncDetallesDesdeSheets() también para presupuestos MODIFICADOS');
    console.log('   2. ✅ Crear MAP en pushDetallesLocalesASheets() cuando se envía a Sheets');
    console.log('   3. ✅ Verificar que pullCambiosRemotosConTimestampMejorado() ejecute sync de detalles');
    console.log('   4. ✅ Asegurar que idsCambiados incluya presupuestos modificados');
    
    console.log('\n🧪 PASOS PARA VERIFICAR:');
    console.log('   1. 📝 Crear presupuesto en Sheets');
    console.log('   2. 🔄 Primera sync → verificar si se crea MAP');
    console.log('   3. 📝 Modificar presupuesto en local');
    console.log('   4. 🔄 Sync → verificar si se actualiza MAP');
    console.log('   5. 🔍 Revisar logs para ver qué funciones se ejecutan');
    
    console.log('\n✅ [MAP-PRIMERA-SYNC] Diagnóstico completado');
    console.log('🎯 PRÓXIMO PASO: Corregir el flujo para que MAP se cree en primera sync');
    
  } catch (error) {
    console.error('❌ [MAP-PRIMERA-SYNC] Error:', error.message);
  } finally {
    await pool.end();
  }
}

// Ejecutar diagnóstico
diagnosticarMapPrimeraSync().catch(console.error);
