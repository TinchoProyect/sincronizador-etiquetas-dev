// VERIFICAR POR QUÉ NO SE EJECUTA LA NUEVA LÓGICA
const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function verificarFlujo() {
  try {
    console.log('🔍 VERIFICANDO POR QUÉ NO SE EJECUTA LA NUEVA LÓGICA:');
    
    // 1. Verificar cutoff_at actual
    const config = await pool.query(`
      SELECT cutoff_at FROM presupuestos_config WHERE activo = true ORDER BY id DESC LIMIT 1
    `);
    
    const cutoffAt = config.rows[0]?.cutoff_at;
    console.log('📊 cutoff_at actual:', cutoffAt);
    
    // 2. Verificar si a11756ae pasaría el filtro cutoff_at en detalles
    const detallesFecha = await pool.query(`
      SELECT d.id_presupuesto_ext, d.fecha_actualizacion,
             d.fecha_actualizacion >= $1 as pasa_cutoff
      FROM presupuestos_detalles d
      WHERE d.id_presupuesto_ext = 'a11756ae'
      ORDER BY d.fecha_actualizacion DESC
      LIMIT 1
    `, [cutoffAt]);
    
    if (detallesFecha.rowCount > 0) {
      const d = detallesFecha.rows[0];
      console.log('📊 Detalle más reciente de a11756ae:');
      console.log(`   fecha_actualizacion: ${d.fecha_actualizacion}`);
      console.log(`   pasa_cutoff: ${d.pasa_cutoff}`);
      
      if (!d.pasa_cutoff) {
        console.log('❌ PROBLEMA: Los detalles de a11756ae NO pasan el filtro cutoff_at');
        console.log('💡 Por eso no se incluye en idsConDetallesRecientes');
        console.log('💡 SOLUCIÓN: Necesitamos incluir TODOS los presupuestos con detalles pero sin MAP');
      } else {
        console.log('✅ Los detalles SÍ pasan el filtro cutoff_at');
        console.log('💡 El problema debe estar en otra parte');
      }
    } else {
      console.log('❌ No se encontraron detalles para a11756ae');
    }
    
    // 3. Verificar si hay presupuestos con detalles pero sin MAP (independiente de cutoff_at)
    console.log('\n🔍 VERIFICANDO PRESUPUESTOS CON DETALLES PERO SIN MAP:');
    
    const presupuestosSinMap = await pool.query(`
      SELECT p.id_presupuesto_ext, p.hoja_nombre,
             COUNT(d.id) as count_detalles,
             COUNT(m.local_detalle_id) as count_map
      FROM presupuestos p
      LEFT JOIN presupuestos_detalles d ON d.id_presupuesto_ext = p.id_presupuesto_ext
      LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
      WHERE p.activo = true 
        AND p.hoja_nombre IS NOT NULL
      GROUP BY p.id_presupuesto_ext, p.hoja_nombre
      HAVING COUNT(d.id) > 0 AND COUNT(m.local_detalle_id) = 0
      ORDER BY p.id_presupuesto_ext
      LIMIT 10
    `);
    
    console.log(`📊 Presupuestos con detalles pero sin MAP: ${presupuestosSinMap.rowCount}`);
    if (presupuestosSinMap.rowCount > 0) {
      console.log('📋 LISTA:');
      presupuestosSinMap.rows.forEach((p, i) => {
        console.log(`   ${i+1}. ${p.id_presupuesto_ext} (hoja: ${p.hoja_nombre}, detalles: ${p.count_detalles}, map: ${p.count_map})`);
      });
      
      console.log('\n💡 ESTOS PRESUPUESTOS NECESITAN MAP SIN ELIMINAR DETALLES');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

verificarFlujo().catch(console.error);
