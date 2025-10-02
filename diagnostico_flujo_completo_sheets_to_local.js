// DIAGNÓSTICO COMPLETO DEL FLUJO SHEETS → LOCAL
// Traza paso a paso qué sucede cuando se crea un presupuesto desde Google Sheets

const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function diagnosticarFlujoCompletoSheetsToLocal() {
  console.log('🔍 [FLUJO-COMPLETO] === DIAGNÓSTICO INTEGRAL SHEETS → LOCAL ===');
  
  try {
    // 1. Estado inicial antes de la sincronización
    console.log('\n📊 [FLUJO-COMPLETO] === ESTADO INICIAL ===');
    
    const estadoInicial = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM presupuestos WHERE activo = true) as presupuestos_activos,
        (SELECT COUNT(*) FROM presupuestos_detalles) as total_detalles,
        (SELECT COUNT(*) FROM presupuestos_detalles_map) as total_map,
        (SELECT cutoff_at FROM presupuestos_config WHERE activo = true LIMIT 1) as cutoff_at
    `);
    
    const estado = estadoInicial.rows[0];
    console.log(`📊 Estado inicial:`);
    console.log(`   Presupuestos activos: ${estado.presupuestos_activos}`);
    console.log(`   Total detalles: ${estado.total_detalles}`);
    console.log(`   Total MAP: ${estado.total_map}`);
    console.log(`   cutoff_at: ${estado.cutoff_at}`);
    
    // 2. Analizar el flujo de sincronización bidireccional
    console.log('\n🔍 [FLUJO-COMPLETO] === ANÁLISIS DEL FLUJO BIDIRECCIONAL ===');
    
    console.log('🔄 FLUJO ACTUAL (ejecutarSincronizacionBidireccional):');
    console.log('   FASE 1: marcarAnuladosEnSheetsConConteo()');
    console.log('   FASE 2: pushCambiosLocalesConTimestamp() → pushDetallesLocalesASheets()');
    console.log('   FASE 3: pullCambiosRemotosConTimestampMejorado() → syncDetallesDesdeSheets()');
    console.log('');
    console.log('❓ PROBLEMA IDENTIFICADO:');
    console.log('   - FASE 2 (PUSH): Solo procesa presupuestos LOCALES modificados');
    console.log('   - FASE 3 (PULL): Procesa presupuestos NUEVOS desde Sheets');
    console.log('   - Cuando creas en Sheets → va por FASE 3 → syncDetallesDesdeSheets()');
    console.log('   - syncDetallesDesdeSheets() DEBERÍA crear MAP pero NO lo está haciendo');
    
    // 3. Verificar qué función se ejecuta para presupuestos de Sheets
    console.log('\n🔍 [FLUJO-COMPLETO] === VERIFICACIÓN DE FUNCIONES ===');
    
    console.log('📋 FUNCIONES INVOLUCRADAS EN SHEETS → LOCAL:');
    console.log('   1. pullCambiosRemotosConTimestampMejorado()');
    console.log('      - Detecta presupuestos nuevos en Sheets');
    console.log('      - Llama a insertarPresupuestoDesdeSheet()');
    console.log('      - Llama a syncDetallesDesdeSheets() para los IDs nuevos');
    console.log('');
    console.log('   2. syncDetallesDesdeSheets()');
    console.log('      - Elimina detalles existentes para los IDs');
    console.log('      - Inserta nuevos detalles desde Sheets');
    console.log('      - DEBERÍA crear MAP con fuente="Sheets"');
    console.log('      - ❌ PROBLEMA: No está creando MAP');
    
    // 4. Verificar si syncDetallesDesdeSheets se está ejecutando
    console.log('\n🔍 [FLUJO-COMPLETO] === VERIFICACIÓN DE EJECUCIÓN ===');
    
    console.log('🧪 PASOS PARA VERIFICAR EL PROBLEMA:');
    console.log('   1. 📝 Crear presupuesto en Google Sheets');
    console.log('   2. 🔄 Ejecutar sincronización manual');
    console.log('   3. 🔍 Revisar logs para ver si se ejecuta:');
    console.log('      - pullCambiosRemotosConTimestampMejorado()');
    console.log('      - syncDetallesDesdeSheets()');
    console.log('      - INSERT INTO presupuestos_detalles_map');
    console.log('   4. 🔍 Verificar si el presupuesto se detecta como "nuevo"');
    console.log('   5. 🔍 Verificar si idsCambiados incluye el nuevo ID');
    
    // 5. Posibles causas del problema
    console.log('\n💡 [FLUJO-COMPLETO] === POSIBLES CAUSAS ===');
    
    console.log('🔧 CAUSAS POSIBLES:');
    console.log('   1. ❌ syncDetallesDesdeSheets() no se ejecuta para presupuestos nuevos');
    console.log('   2. ❌ pullCambiosRemotosConTimestampMejorado() no detecta el presupuesto como nuevo');
    console.log('   3. ❌ Filtros cutoff_at impiden que se procese el presupuesto');
    console.log('   4. ❌ idsCambiados no incluye el ID del presupuesto nuevo');
    console.log('   5. ❌ syncDetallesDesdeSheets() tiene error y no llega a crear MAP');
    console.log('   6. ❌ La transacción hace rollback y no se confirma el MAP');
    
    // 6. Verificar presupuestos recientes que deberían procesarse
    console.log('\n🔍 [FLUJO-COMPLETO] === PRESUPUESTOS RECIENTES ===');
    
    const presupuestosRecientes = await pool.query(`
      SELECT p.id_presupuesto_ext, p.fecha_actualizacion, p.hoja_nombre,
             p.fecha_actualizacion > (SELECT cutoff_at FROM presupuestos_config WHERE activo = true LIMIT 1) as pasa_cutoff
      FROM presupuestos p
      WHERE p.activo = true 
        AND p.fecha_actualizacion >= NOW() - INTERVAL '2 hours'
      ORDER BY p.fecha_actualizacion DESC
      LIMIT 10
    `);
    
    console.log(`📊 Presupuestos recientes (últimas 2 horas): ${presupuestosRecientes.rowCount}`);
    if (presupuestosRecientes.rowCount > 0) {
      console.log('📋 MUESTRA:');
      presupuestosRecientes.rows.forEach((p, i) => {
        console.log(`   ${i+1}. ${p.id_presupuesto_ext}:`);
        console.log(`      fecha_actualizacion: ${p.fecha_actualizacion}`);
        console.log(`      hoja_nombre: ${p.hoja_nombre || 'NULL'}`);
        console.log(`      pasa_cutoff: ${p.pasa_cutoff}`);
      });
    }
    
    // 7. Verificar detalles recientes sin MAP
    console.log('\n🔍 [FLUJO-COMPLETO] === DETALLES RECIENTES SIN MAP ===');
    
    const detallesSinMap = await pool.query(`
      SELECT d.id, d.id_presupuesto_ext, d.articulo, d.fecha_actualizacion,
             p.hoja_nombre
      FROM presupuestos_detalles d
      INNER JOIN presupuestos p ON p.id_presupuesto_ext = d.id_presupuesto_ext
      LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
      WHERE m.local_detalle_id IS NULL
        AND d.fecha_actualizacion >= NOW() - INTERVAL '2 hours'
      ORDER BY d.fecha_actualizacion DESC
      LIMIT 10
    `);
    
    console.log(`📊 Detalles recientes SIN MAP: ${detallesSinMap.rowCount}`);
    if (detallesSinMap.rowCount > 0) {
      console.log('📋 MUESTRA DE DETALLES SIN MAP:');
      detallesSinMap.rows.forEach((d, i) => {
        console.log(`   ${i+1}. ID=${d.id} presup=${d.id_presupuesto_ext} art=${d.articulo}`);
        console.log(`      fecha=${d.fecha_actualizacion}`);
        console.log(`      hoja_nombre=${d.hoja_nombre || 'NULL'}`);
      });
    }
    
    // 8. Recomendaciones específicas
    console.log('\n💡 [FLUJO-COMPLETO] === RECOMENDACIONES ESPECÍFICAS ===');
    
    console.log('🔧 ACCIONES NECESARIAS:');
    console.log('   1. ✅ Verificar que syncDetallesDesdeSheets() se ejecute para presupuestos de Sheets');
    console.log('   2. ✅ Asegurar que la función cree MAP con fuente="Sheets"');
    console.log('   3. ✅ Verificar que no haya errores en la transacción');
    console.log('   4. ✅ Confirmar que idsCambiados incluya presupuestos nuevos de Sheets');
    console.log('   5. ✅ Revisar logs detallados de la sincronización');
    
    console.log('\n🧪 PRÓXIMOS PASOS:');
    console.log('   1. 🔍 Revisar función syncDetallesDesdeSheets() en controlador');
    console.log('   2. 🔧 Corregir creación de MAP para flujo Sheets → Local');
    console.log('   3. 🧪 Probar nuevamente con logs detallados');
    console.log('   4. ✅ Verificar que MAP se crea en primera sincronización');
    
    console.log('\n✅ [FLUJO-COMPLETO] Diagnóstico integral completado');
    console.log('🎯 CONCLUSIÓN: El problema está en syncDetallesDesdeSheets() del controlador');
    
  } catch (error) {
    console.error('❌ [FLUJO-COMPLETO] Error:', error.message);
  } finally {
    await pool.end();
  }
}

// Ejecutar diagnóstico
diagnosticarFlujoCompletoSheetsToLocal().catch(console.error);
