// DIAGNÓSTICO ESPECÍFICO DEL MAP DE DETALLES
// Verifica cómo se generan y usan los IDs en presupuestos_detalles_map

const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function diagnosticarMapDetalles() {
  console.log('🔍 [DIAG-MAP] ===== DIAGNÓSTICO DEL MAP DE DETALLES =====');
  
  try {
    // PASO 1: Estado actual del MAP
    console.log('\n📊 [DIAG-MAP] PASO 1: Estado actual del MAP');
    const mapResult = await pool.query(`
      SELECT 
        COUNT(*) as total_mapeos,
        COUNT(CASE WHEN fuente = 'Local' THEN 1 END) as mapeos_local,
        COUNT(CASE WHEN fuente = 'Sheets' THEN 1 END) as mapeos_sheets,
        MIN(fecha_asignacion) as primera_asignacion,
        MAX(fecha_asignacion) as ultima_asignacion
      FROM presupuestos_detalles_map
    `);
    
    const map = mapResult.rows[0];
    console.log('[DIAG-MAP] Estado del MAP:');
    console.log(`  - Total mapeos: ${map.total_mapeos}`);
    console.log(`  - Mapeos Local: ${map.mapeos_local}`);
    console.log(`  - Mapeos Sheets: ${map.mapeos_sheets}`);
    console.log(`  - Primera asignación: ${map.primera_asignacion}`);
    console.log(`  - Última asignación: ${map.ultima_asignacion}`);
    
    // PASO 2: Muestra de IDs generados
    console.log('\n🔍 [DIAG-MAP] PASO 2: Muestra de IDs generados');
    const muestraResult = await pool.query(`
      SELECT 
        local_detalle_id,
        id_detalle_presupuesto,
        fuente,
        fecha_asignacion
      FROM presupuestos_detalles_map
      ORDER BY fecha_asignacion DESC
      LIMIT 10
    `);
    
    console.log('[DIAG-MAP] Últimos 10 mapeos:');
    muestraResult.rows.forEach((row, i) => {
      console.log(`  ${i+1}. LOCAL_ID: ${row.local_detalle_id}`);
      console.log(`     SHEET_ID: ${row.id_detalle_presupuesto}`);
      console.log(`     FUENTE: ${row.fuente}`);
      console.log(`     FECHA: ${row.fecha_asignacion}`);
      console.log(`     FORMATO_OK: ${row.id_detalle_presupuesto.includes('-') ? '✅' : '❌'}`);
    });
    
    // PASO 3: Detalles SIN mapeo
    console.log('\n⚠️ [DIAG-MAP] PASO 3: Detalles SIN mapeo');
    const sinMapeoResult = await pool.query(`
      SELECT 
        d.id,
        d.id_presupuesto_ext,
        d.articulo,
        d.fecha_actualizacion
      FROM presupuestos_detalles d
      LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
      WHERE m.local_detalle_id IS NULL
      ORDER BY d.fecha_actualizacion DESC
      LIMIT 10
    `);
    
    console.log(`[DIAG-MAP] Detalles sin mapeo: ${sinMapeoResult.rowCount}`);
    sinMapeoResult.rows.forEach((row, i) => {
      console.log(`  ${i+1}. DETALLE_ID: ${row.id}`);
      console.log(`     PRESUPUESTO: ${row.id_presupuesto_ext}`);
      console.log(`     ARTICULO: ${row.articulo}`);
      console.log(`     FECHA: ${row.fecha_actualizacion}`);
    });
    
    // PASO 4: Verificar formato de IDs
    console.log('\n🔍 [DIAG-MAP] PASO 4: Verificar formato de IDs');
    const formatoResult = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN id_detalle_presupuesto LIKE '%-%' THEN 1 END) as con_guion,
        COUNT(CASE WHEN LENGTH(id_detalle_presupuesto) >= 8 THEN 1 END) as longitud_ok
      FROM presupuestos_detalles_map
    `);
    
    const formato = formatoResult.rows[0];
    console.log('[DIAG-MAP] Formato de IDs:');
    console.log(`  - Total IDs: ${formato.total}`);
    console.log(`  - Con guión (-): ${formato.con_guion}`);
    console.log(`  - Longitud >= 8: ${formato.longitud_ok}`);
    console.log(`  - Formato correcto: ${formato.con_guion === formato.total ? '✅' : '❌'}`);
    
    // PASO 5: Función de generación actual
    console.log('\n🔧 [DIAG-MAP] PASO 5: Función de generación actual');
    console.log('[DIAG-MAP] Función actual en el código:');
    console.log('  - Usa crypto.createHash("sha1")');
    console.log('  - Genera hash de 8 caracteres');
    console.log('  - Formato esperado: "5df8rtnh-d5fuem"');
    
    // PASO 6: Generar ID de prueba
    console.log('\n🧪 [DIAG-MAP] PASO 6: Generar ID de prueba');
    const crypto = require('crypto');
    
    // Función actual del código
    const mkId = r => crypto.createHash('sha1')
      .update(`${r.id_presupuesto_ext}|${r.articulo}|${r.cantidad}|${r.valor1}|${r.precio1}|${r.iva1}|${r.diferencia}|${r.camp1}|${r.camp2}|${r.camp3}|${r.camp4}|${r.camp5}|${r.camp6}`)
      .digest('hex').slice(0, 8);
    
    // Función corregida con guión
    const mkIdConGuion = r => {
      const hash = crypto.createHash('sha1')
        .update(`${r.id_presupuesto_ext}|${r.articulo}|${r.cantidad}|${r.valor1}|${r.precio1}|${r.iva1}|${r.diferencia}|${r.camp1}|${r.camp2}|${r.camp3}|${r.camp4}|${r.camp5}|${r.camp6}|${Date.now()}`)
        .digest('hex');
      return `${hash.slice(0, 8)}-${hash.slice(8, 14)}`;
    };
    
    const testData = {
      id_presupuesto_ext: 'test-123',
      articulo: 'ART001',
      cantidad: 1,
      valor1: 100,
      precio1: 120,
      iva1: 21,
      diferencia: 0,
      camp1: 0,
      camp2: 0,
      camp3: 0,
      camp4: 0,
      camp5: 0,
      camp6: 0
    };
    
    const idActual = mkId(testData);
    const idCorregido = mkIdConGuion(testData);
    
    console.log('[DIAG-MAP] IDs generados:');
    console.log(`  - ID actual (sin guión): ${idActual}`);
    console.log(`  - ID corregido (con guión): ${idCorregido}`);
    console.log(`  - Formato correcto: ${idCorregido.includes('-') ? '✅' : '❌'}`);
    
    console.log('\n✅ [DIAG-MAP] ===== DIAGNÓSTICO COMPLETADO =====');
    console.log('\n💡 [DIAG-MAP] CONCLUSIONES:');
    console.log('1. Verificar si los IDs tienen el formato correcto con guión');
    console.log('2. Verificar si se están creando mapeos para TODOS los detalles');
    console.log('3. Verificar si se están REUTILIZANDO los IDs existentes en modificaciones');
    
  } catch (error) {
    console.error('❌ [DIAG-MAP] Error:', error.message);
  } finally {
    await pool.end();
  }
}

// Ejecutar diagnóstico
diagnosticarMapDetalles().catch(console.error);
