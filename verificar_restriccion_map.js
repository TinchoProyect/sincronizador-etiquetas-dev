// VERIFICAR RESTRICCIÓN CHECK DE LA TABLA MAP

const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function verificarRestriccionMap() {
  try {
    console.log('🔍 VERIFICANDO RESTRICCIÓN CHECK DE presupuestos_detalles_map');
    console.log('='.repeat(60));
    
    // 1. Obtener la restricción CHECK
    const restriccion = await pool.query(`
      SELECT conname, consrc 
      FROM pg_constraint 
      WHERE conname = 'presupuestos_detalles_map_fuente_check'
    `);
    
    if (restriccion.rowCount > 0) {
      console.log('📋 RESTRICCIÓN ENCONTRADA:');
      console.log(`   Nombre: ${restriccion.rows[0].conname}`);
      console.log(`   Condición: ${restriccion.rows[0].consrc}`);
    } else {
      console.log('❌ No se encontró la restricción específica');
    }
    
    // 2. Obtener TODAS las restricciones de la tabla
    const todasRestricciones = await pool.query(`
      SELECT conname, consrc, contype
      FROM pg_constraint c
      INNER JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'presupuestos_detalles_map'
        AND contype = 'c'  -- Solo CHECK constraints
    `);
    
    console.log('\n📋 TODAS LAS RESTRICCIONES CHECK:');
    if (todasRestricciones.rowCount > 0) {
      todasRestricciones.rows.forEach((r, i) => {
        console.log(`   ${i+1}. ${r.conname}: ${r.consrc}`);
      });
    } else {
      console.log('   No hay restricciones CHECK');
    }
    
    // 3. Verificar estructura de la tabla
    console.log('\n📋 ESTRUCTURA DE LA TABLA:');
    const estructura = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'presupuestos_detalles_map'
      ORDER BY ordinal_position
    `);
    
    estructura.rows.forEach((col, i) => {
      console.log(`   ${i+1}. ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    });
    
    // 4. Verificar valores existentes en la columna fuente
    console.log('\n📋 VALORES EXISTENTES EN COLUMNA FUENTE:');
    const valoresFuente = await pool.query(`
      SELECT fuente, COUNT(*) as count
      FROM presupuestos_detalles_map
      GROUP BY fuente
      ORDER BY count DESC
    `);
    
    if (valoresFuente.rowCount > 0) {
      valoresFuente.rows.forEach((v, i) => {
        console.log(`   ${i+1}. '${v.fuente}': ${v.count} registros`);
      });
    } else {
      console.log('   No hay registros en la tabla');
    }
    
    // 5. Probar inserción manual para ver el error exacto
    console.log('\n🧪 PROBANDO INSERCIÓN MANUAL:');
    
    try {
      await pool.query('BEGIN');
      
      // Probar con 'Local'
      console.log("   Probando fuente='Local'...");
      await pool.query(`
        INSERT INTO presupuestos_detalles_map
        (local_detalle_id, id_detalle_presupuesto, fuente, fecha_asignacion)
        VALUES (99999, 'test-1234', 'Local', NOW())
      `);
      console.log("   ✅ 'Local' funciona");
      
      await pool.query('ROLLBACK');
      
    } catch (error1) {
      await pool.query('ROLLBACK');
      console.log(`   ❌ 'Local' falla: ${error1.message}`);
    }
    
    try {
      await pool.query('BEGIN');
      
      // Probar con 'Sheets'
      console.log("   Probando fuente='Sheets'...");
      await pool.query(`
        INSERT INTO presupuestos_detalles_map
        (local_detalle_id, id_detalle_presupuesto, fuente, fecha_asignacion)
        VALUES (99999, 'test-1234', 'Sheets', NOW())
      `);
      console.log("   ✅ 'Sheets' funciona");
      
      await pool.query('ROLLBACK');
      
    } catch (error2) {
      await pool.query('ROLLBACK');
      console.log(`   ❌ 'Sheets' falla: ${error2.message}`);
    }
    
    // 6. Probar otros valores comunes
    const valoresProbar = ['local', 'sheets', 'LOCAL', 'SHEETS', 'Manual', 'Auto'];
    
    for (const valor of valoresProbar) {
      try {
        await pool.query('BEGIN');
        console.log(`   Probando fuente='${valor}'...`);
        await pool.query(`
          INSERT INTO presupuestos_detalles_map
          (local_detalle_id, id_detalle_presupuesto, fuente, fecha_asignacion)
          VALUES (99999, 'test-1234', $1, NOW())
        `, [valor]);
        console.log(`   ✅ '${valor}' funciona`);
        await pool.query('ROLLBACK');
        break; // Si encuentra uno que funciona, parar
      } catch (error) {
        await pool.query('ROLLBACK');
        console.log(`   ❌ '${valor}' falla`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error verificando restricción:', error.message);
  } finally {
    await pool.end();
  }
}

verificarRestriccionMap().catch(console.error);
