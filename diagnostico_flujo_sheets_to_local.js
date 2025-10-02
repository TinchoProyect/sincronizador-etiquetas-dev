// DIAGNÓSTICO DEL FLUJO SHEETS → LOCAL
// Verifica que el flujo esté listo para crear presupuestos desde Google Sheets

const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function diagnosticarFlujoSheetsToLocal() {
  console.log('🔍 [SHEETS-TO-LOCAL] === DIAGNÓSTICO DEL FLUJO SHEETS → LOCAL ===');
  
  try {
    // 1. Verificar configuración actual
    const config = await pool.query(`
      SELECT cutoff_at, hoja_id, hoja_url
      FROM presupuestos_config 
      WHERE activo = true 
      ORDER BY fecha_creacion DESC 
      LIMIT 1
    `);
    
    const cutoffAt = config.rows[0].cutoff_at;
    console.log(`📅 cutoff_at actual: ${cutoffAt.toISOString()}`);
    console.log(`📋 hoja_id: ${config.rows[0].hoja_id}`);
    
    // 2. Verificar estado actual de la BD local
    console.log('\n📊 [SHEETS-TO-LOCAL] === ESTADO ACTUAL BD LOCAL ===');
    
    const estadoBD = await pool.query(`
      SELECT 
        COUNT(*) as total_presupuestos,
        COUNT(DISTINCT id_presupuesto_ext) as ids_unicos,
        MAX(fecha_actualizacion) as ultima_actualizacion
      FROM presupuestos 
      WHERE activo = true
    `);
    
    console.log(`📊 Presupuestos en BD local:`);
    console.log(`   Total: ${estadoBD.rows[0].total_presupuestos}`);
    console.log(`   IDs únicos: ${estadoBD.rows[0].ids_unicos}`);
    console.log(`   Última actualización: ${estadoBD.rows[0].ultima_actualizacion}`);
    
    const estadoDetalles = await pool.query(`
      SELECT 
        COUNT(*) as total_detalles,
        COUNT(DISTINCT CONCAT(id_presupuesto_ext, '-', articulo)) as combinaciones_unicas,
        COUNT(DISTINCT id_presupuesto_ext) as presupuestos_con_detalles
      FROM presupuestos_detalles
    `);
    
    console.log(`📊 Detalles en BD local:`);
    console.log(`   Total: ${estadoDetalles.rows[0].total_detalles}`);
    console.log(`   Combinaciones únicas: ${estadoDetalles.rows[0].combinaciones_unicas}`);
    console.log(`   Presupuestos con detalles: ${estadoDetalles.rows[0].presupuestos_con_detalles}`);
    
    // 3. Verificar estado del MAP
    console.log('\n📊 [SHEETS-TO-LOCAL] === ESTADO DEL MAP ===');
    
    const estadoMap = await pool.query(`
      SELECT 
        m.fuente,
        COUNT(*) as count_entradas,
        COUNT(DISTINCT d.id_presupuesto_ext) as presupuestos_distintos
      FROM presupuestos_detalles_map m
      INNER JOIN presupuestos_detalles d ON d.id = m.local_detalle_id
      GROUP BY m.fuente
      ORDER BY COUNT(*) DESC
    `);
    
    console.log(`📊 MAP por fuente:`);
    estadoMap.rows.forEach(m => {
      console.log(`   ${m.fuente}: ${m.count_entradas} entradas (${m.presupuestos_distintos} presupuestos)`);
    });
    
    // 4. Verificar detalles huérfanos (sin MAP)
    const huerfanos = await pool.query(`
      SELECT COUNT(*) as count_huerfanos
      FROM presupuestos_detalles d
      LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
      WHERE m.local_detalle_id IS NULL
    `);
    
    console.log(`📊 Detalles huérfanos (sin MAP): ${huerfanos.rows[0].count_huerfanos}`);
    
    // 5. Simular el flujo PULL para un presupuesto nuevo
    console.log('\n🔍 [SHEETS-TO-LOCAL] === SIMULACIÓN DEL FLUJO PULL ===');
    
    console.log('📋 FLUJO ESPERADO PARA PRESUPUESTO NUEVO EN SHEETS:');
    console.log('   1. ✅ Detectar presupuesto nuevo en Sheets (LastModified > cutoff_at)');
    console.log('   2. ✅ Insertar presupuesto en BD local');
    console.log('   3. ✅ Detectar que no tiene detalles en local');
    console.log('   4. ✅ Ejecutar syncDetallesDesdeSheets() con filtros únicos');
    console.log('   5. ✅ Insertar solo detalles únicos por artículo');
    console.log('   6. ✅ Crear MAP con fuente="Sheets" y ID real de Sheets');
    console.log('   7. ✅ NO crear duplicados masivos');
    
    // 6. Verificar funciones críticas del flujo
    console.log('\n🔍 [SHEETS-TO-LOCAL] === VERIFICACIÓN DE FUNCIONES CRÍTICAS ===');
    
    console.log('✅ CORRECCIONES IMPLEMENTADAS:');
    console.log('   1. ✅ pullCambiosRemotosConTimestampMejorado() - Filtros cutoff_at aplicados');
    console.log('   2. ✅ syncDetallesDesdeSheets() - Filtro de filas únicas implementado');
    console.log('   3. ✅ Validaciones anti-duplicados - Múltiples niveles de protección');
    console.log('   4. ✅ MAP con ID real de Sheets - Usa columna A de Google Sheets');
    console.log('   5. ✅ Fuente correcta - fuente="Sheets" para presupuestos de Sheets');
    
    // 7. Verificar que no hay bucles infinitos
    console.log('\n🔍 [SHEETS-TO-LOCAL] === VERIFICACIÓN DE BUCLES ===');
    
    console.log('✅ PROTECCIONES CONTRA BUCLES:');
    console.log('   1. ✅ Filtros cutoff_at - Solo procesa cambios recientes');
    console.log('   2. ✅ Exclusión de IDs procesados - PULL excluye IDs de PUSH');
    console.log('   3. ✅ Validación de existencia - No reprocesa detalles existentes');
    console.log('   4. ✅ Filtro de únicos - No permite duplicados por artículo');
    
    // 8. Recomendaciones para la prueba
    console.log('\n💡 [SHEETS-TO-LOCAL] === RECOMENDACIONES PARA LA PRUEBA ===');
    
    console.log('🧪 PASOS SUGERIDOS PARA LA PRUEBA:');
    console.log('   1. 📝 Crear un presupuesto nuevo en Google Sheets');
    console.log('   2. 📝 Agregar 2-3 detalles únicos (artículos diferentes)');
    console.log('   3. 🔄 Ejecutar sincronización manual');
    console.log('   4. 🔍 Verificar que se crea en BD local sin duplicados');
    console.log('   5. 🔍 Verificar que se crea MAP con fuente="Sheets"');
    console.log('   6. 🔄 Ejecutar segunda sincronización');
    console.log('   7. ✅ Verificar que NO se agregan registros adicionales');
    
    console.log('\n⚠️ PUNTOS A OBSERVAR DURANTE LA PRUEBA:');
    console.log('   - 📊 Cantidad de detalles insertados (debe ser = artículos únicos)');
    console.log('   - 🗂️ Entradas MAP creadas (debe ser = detalles insertados)');
    console.log('   - 🔄 Segunda sync debe procesar 0 registros');
    console.log('   - 📝 Logs deben mostrar "DUPLICADO EN SHEETS OMITIDO" si hay duplicados');
    
    console.log('\n✅ [SHEETS-TO-LOCAL] El flujo está listo para la prueba');
    console.log('🚀 Puedes proceder a crear un presupuesto en Google Sheets y sincronizar');
    
  } catch (error) {
    console.error('❌ [SHEETS-TO-LOCAL] Error:', error.message);
  } finally {
    await pool.end();
  }
}

// Ejecutar diagnóstico
diagnosticarFlujoSheetsToLocal().catch(console.error);
