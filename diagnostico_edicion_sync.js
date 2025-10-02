// Diagnóstico de edición y sincronización
const { Pool } = require('pg');

// Configuración de BD (ajustar según tu configuración)
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost', 
  database: process.env.DB_NAME || 'presupuestos_db',
  password: process.env.DB_PASSWORD || 'admin',
  port: process.env.DB_PORT || 5432,
});

async function diagnosticoCompleto() {
  try {
    console.log('🔍 [DIAGNÓSTICO] Iniciando diagnóstico de edición y sincronización...');
    
    // 1. Verificar presupuestos editados recientemente
    console.log('\n📊 1. PRESUPUESTOS EDITADOS RECIENTEMENTE:');
    const recentEdits = await pool.query(`
      SELECT 
        id_presupuesto_ext,
        fecha_actualizacion,
        agente,
        nota,
        estado,
        activo,
        EXTRACT(EPOCH FROM (NOW() - fecha_actualizacion)) / 60 as minutos_desde_edit
      FROM presupuestos 
      WHERE fecha_actualizacion > NOW() - INTERVAL '2 hours'
      AND activo = true
      ORDER BY fecha_actualizacion DESC
      LIMIT 10
    `);
    
    if (recentEdits.rowCount > 0) {
      recentEdits.rows.forEach(row => {
        console.log(`   📋 ID: ${row.id_presupuesto_ext}, Editado hace: ${Math.round(row.minutos_desde_edit)} min`);
        console.log(`      Agente: ${row.agente}, Estado: ${row.estado}, Nota: ${row.nota || 'Sin nota'}`);
      });
    } else {
      console.log('   ❌ No hay presupuestos editados en las últimas 2 horas');
    }
    
    // 2. Verificar los 20 presupuestos que se están enviando en la sincronización
    console.log('\n📤 2. PRESUPUESTOS QUE SE ENVÍAN EN SYNC (últimos 20):');
    const syncCandidates = await pool.query(`
      SELECT 
        id_presupuesto_ext,
        fecha_actualizacion,
        agente,
        estado,
        activo
      FROM presupuestos
      WHERE activo = true
      ORDER BY fecha_actualizacion DESC NULLS FIRST
      LIMIT 20
    `);
    
    syncCandidates.rows.forEach((row, i) => {
      console.log(`   ${i+1}. ID: ${row.id_presupuesto_ext}, Fecha: ${row.fecha_actualizacion}, Estado: ${row.estado}`);
    });
    
    // 3. Verificar si hay diferencia entre timestamps locales y remotos
    console.log('\n🔄 3. COMPARACIÓN CON SHEETS (simulada):');
    console.log('   Los logs muestran que se envían 20 presupuestos pero no hay ediciones detectadas.');
    console.log('   Esto sugiere que los timestamps locales NO son más recientes que los remotos.');
    
    // 4. Verificar estructura de tabla
    console.log('\n🏗️ 4. ESTRUCTURA DE TABLA PRESUPUESTOS:');
    const tableInfo = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'presupuestos' 
      AND column_name IN ('fecha_actualizacion', 'id_presupuesto_ext', 'activo')
      ORDER BY column_name
    `);
    
    tableInfo.rows.forEach(row => {
      console.log(`   📋 ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
    });
    
  } catch (error) {
    console.error('❌ [DIAGNÓSTICO] Error:', error.message);
  } finally {
    await pool.end();
  }
}

diagnosticoCompleto();
