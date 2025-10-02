// REPARACIÓN DIRECTA DEL MAP FALTANTE
// Procesa presupuestos que necesitan MAP sin depender del flujo de sincronización

const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function repararMapFaltante() {
  try {
    console.log('🔧 REPARACIÓN DIRECTA DEL MAP FALTANTE');
    console.log('='.repeat(60));
    
    // 1. Obtener cutoff_at para procesar solo presupuestos recientes
    const config = await pool.query(`
      SELECT cutoff_at FROM presupuestos_config WHERE activo = true ORDER BY id DESC LIMIT 1
    `);
    
    const cutoffAt = config.rows[0]?.cutoff_at;
    console.log(`📊 cutoff_at: ${cutoffAt}`);
    
    // 2. Buscar presupuestos que necesitan MAP (posteriores a cutoff_at)
    console.log(`\n📊 BUSCANDO PRESUPUESTOS QUE NECESITAN MAP...`);
    
    const presupuestosSinMap = await pool.query(`
      SELECT p.id_presupuesto_ext, p.hoja_nombre, p.fecha_actualizacion,
             COUNT(d.id) as count_detalles,
             COUNT(m.local_detalle_id) as count_map
      FROM presupuestos p
      LEFT JOIN presupuestos_detalles d ON d.id_presupuesto_ext = p.id_presupuesto_ext
      LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
      WHERE p.activo = true 
        AND p.hoja_nombre IS NOT NULL
        AND p.fecha_actualizacion >= $1  -- SOLO POSTERIORES A CUTOFF
      GROUP BY p.id_presupuesto_ext, p.hoja_nombre, p.fecha_actualizacion
      HAVING COUNT(d.id) > 0 AND COUNT(m.local_detalle_id) = 0
      ORDER BY p.fecha_actualizacion DESC
    `, [cutoffAt]);
    
    console.log(`📋 Presupuestos que necesitan MAP: ${presupuestosSinMap.rowCount}`);
    
    if (presupuestosSinMap.rowCount === 0) {
      console.log('✅ No hay presupuestos que necesiten MAP');
      return;
    }
    
    presupuestosSinMap.rows.forEach((p, i) => {
      console.log(`   ${i+1}. ${p.id_presupuesto_ext}:`);
      console.log(`      Origen: ${p.hoja_nombre}`);
      console.log(`      Fecha: ${p.fecha_actualizacion}`);
      console.log(`      Detalles: ${p.count_detalles}, MAP: ${p.count_map}`);
    });
    
    // 3. Reparar MAP para cada presupuesto
    console.log(`\n🔧 REPARANDO MAP...`);
    
    await pool.query('BEGIN');
    
    let totalMapCreados = 0;
    
    for (const presupuesto of presupuestosSinMap.rows) {
      const idPresupuesto = presupuesto.id_presupuesto_ext;
      
      console.log(`\n🔧 Reparando MAP para: ${idPresupuesto}`);
      
      // Obtener detalles sin MAP
      const detalles = await pool.query(`
        SELECT d.id, d.id_presupuesto_ext, d.articulo, d.cantidad, d.valor1, d.precio1,
               d.iva1, d.diferencia, d.camp1, d.camp2, d.camp3, d.camp4, d.camp5, d.camp6
        FROM presupuestos_detalles d
        LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
        WHERE d.id_presupuesto_ext = $1
          AND m.local_detalle_id IS NULL
        ORDER BY d.id
      `, [idPresupuesto]);
      
      console.log(`   Detalles sin MAP: ${detalles.rowCount}`);
      
      for (const detalle of detalles.rows) {
        try {
          // Generar ID único para Sheets
          const timestamp = Date.now() + Math.random() * 1000;
          const hash = crypto.createHash('sha1')
            .update(`${detalle.id_presupuesto_ext}|${detalle.articulo}|${detalle.cantidad}|${detalle.valor1}|${detalle.precio1}|${detalle.iva1}|${detalle.diferencia}|${detalle.camp1}|${detalle.camp2}|${detalle.camp3}|${detalle.camp4}|${detalle.camp5}|${detalle.camp6}|${timestamp}`)
            .digest('hex');
          
          const idDetallePresupuesto = `${hash.slice(0, 8)}-${hash.slice(8, 12)}`;
          
          // Verificar unicidad
          const existeId = await pool.query(`
            SELECT 1 FROM presupuestos_detalles_map 
            WHERE id_detalle_presupuesto = $1
          `, [idDetallePresupuesto]);
          
          if (existeId.rowCount > 0) {
            console.warn(`   ⚠️ ID duplicado: ${idDetallePresupuesto}, saltando`);
            continue;
          }
          
          // Detectar fuente correcta
          const fuente = presupuesto.hoja_nombre === 'Presupuestos' ? 'Sheets' : 'Local';
          
          // Crear MAP
          await pool.query(`
            INSERT INTO presupuestos_detalles_map
            (local_detalle_id, id_detalle_presupuesto, fuente, fecha_asignacion)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires')
          `, [detalle.id, idDetallePresupuesto, fuente]);
          
          totalMapCreados++;
          console.log(`   ✅ MAP creado: local=${detalle.id} sheet=${idDetallePresupuesto} fuente=${fuente}`);
          
        } catch (error) {
          console.error(`   ❌ Error creando MAP para detalle ${detalle.id}:`, error.message);
        }
      }
    }
    
    await pool.query('COMMIT');
    
    console.log(`\n✅ REPARACIÓN COMPLETADA:`);
    console.log(`   Presupuestos procesados: ${presupuestosSinMap.rowCount}`);
    console.log(`   MAP creados: ${totalMapCreados}`);
    
    // 4. Verificación final
    console.log(`\n📊 VERIFICACIÓN FINAL:`);
    
    const verificacion = await pool.query(`
      SELECT p.id_presupuesto_ext,
             COUNT(d.id) as count_detalles,
             COUNT(m.local_detalle_id) as count_map
      FROM presupuestos p
      LEFT JOIN presupuestos_detalles d ON d.id_presupuesto_ext = p.id_presupuesto_ext
      LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
      WHERE p.id_presupuesto_ext = ANY($1::text[])
      GROUP BY p.id_presupuesto_ext
    `, [presupuestosSinMap.rows.map(r => r.id_presupuesto_ext)]);
    
    verificacion.rows.forEach((v, i) => {
      const estado = v.count_detalles > 0 && v.count_map > 0 ? '✅ REPARADO' : '❌ AÚN FALTA';
      console.log(`   ${i+1}. ${v.id_presupuesto_ext}: detalles=${v.count_detalles}, map=${v.count_map} ${estado}`);
    });
    
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('❌ Error en reparación:', error.message);
  } finally {
    await pool.end();
  }
}

repararMapFaltante().catch(console.error);
