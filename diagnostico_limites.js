// DIAGNÓSTICO DE LÍMITES EN PUSH
// Verifica si mfw1cf4t-r5a3b está siendo limitado por los slice()

const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function diagnosticarLimites() {
  console.log('🔍 [DIAG-LIMITS] Diagnosticando límites en push...');
  
  try {
    // 1. Obtener configuración
    const configResult = await pool.query(`
      SELECT hoja_id, cutoff_at FROM presupuestos_config 
      WHERE activo = true ORDER BY fecha_creacion DESC LIMIT 1
    `);
    
    const config = configResult.rows[0];
    const cutoffAt = config.cutoff_at;
    
    // 2. Ejecutar el MISMO query que usa pushCambiosLocalesConTimestamp
    const localLastEditQuery = `
      SELECT
        p.id_presupuesto_ext AS id,
        p.id_cliente,
        p.fecha,
        p.fecha_entrega,
        p.agente,
        p.tipo_comprobante,
        p.nota,
        p.estado,
        p.informe_generado,
        p.cliente_nuevo_id,
        p.punto_entrega,
        p.descuento,
        p.activo,
        GREATEST(
          p.fecha_actualizacion,
          COALESCE(MAX(d.fecha_actualizacion), p.fecha_actualizacion)
        ) AS local_last_edit
      FROM public.presupuestos p
      LEFT JOIN public.presupuestos_detalles d
        ON d.id_presupuesto = p.id
      WHERE p.activo = true
        AND p.id_presupuesto_ext IS NOT NULL
      GROUP BY
        p.id_presupuesto_ext, p.id_cliente, p.fecha, p.fecha_entrega,
        p.agente, p.tipo_comprobante, p.nota, p.estado, p.informe_generado,
        p.cliente_nuevo_id, p.punto_entrega, p.descuento, p.activo, p.fecha_actualizacion
      HAVING GREATEST(
        p.fecha_actualizacion,
        COALESCE(MAX(d.fecha_actualizacion), p.fecha_actualizacion)
      ) >= $1
      ORDER BY local_last_edit DESC
    `;
    
    const rs = await pool.query(localLastEditQuery, [cutoffAt]);
    
    console.log(`🔍 [DIAG-LIMITS] Query completo: ${rs.rowCount} candidatos`);
    
    // 3. Mostrar TODOS los candidatos ordenados
    console.log('📊 [DIAG-LIMITS] TODOS los candidatos (ordenados por local_last_edit DESC):');
    rs.rows.forEach((r, i) => {
      const isTarget = r.id === 'mfw1cf4t-r5a3b';
      const marker = isTarget ? '🎯 TARGET' : '';
      console.log(`  ${i+1}. ${r.id} - ${r.local_last_edit} ${marker}`);
    });
    
    // 4. Verificar posición de mfw1cf4t-r5a3b
    const targetIndex = rs.rows.findIndex(r => r.id === 'mfw1cf4t-r5a3b');
    
    if (targetIndex !== -1) {
      console.log(`🎯 [DIAG-LIMITS] mfw1cf4t-r5a3b está en posición: ${targetIndex + 1}`);
      
      // 5. Verificar si está dentro de los límites
      const dentroLimiteInsert = targetIndex < 10;  // slice(0, 10)
      const dentroLimiteUpdate = targetIndex < 20;  // slice(0, 20)
      
      console.log(`📏 [DIAG-LIMITS] Límites de procesamiento:`);
      console.log(`     INSERT (slice 0-10): ${dentroLimiteInsert ? 'SÍ' : 'NO'}`);
      console.log(`     UPDATE (slice 0-20): ${dentroLimiteUpdate ? 'SÍ' : 'NO'}`);
      
      if (!dentroLimiteInsert && !dentroLimiteUpdate) {
        console.log('❌ [DIAG-LIMITS] PROBLEMA ENCONTRADO: mfw1cf4t-r5a3b está FUERA de ambos límites');
        console.log('💡 [DIAG-LIMITS] SOLUCIÓN: Aumentar los límites o quitar slice()');
      } else {
        console.log('✅ [DIAG-LIMITS] mfw1cf4t-r5a3b está dentro de los límites');
      }
      
    } else {
      console.log('❌ [DIAG-LIMITS] mfw1cf4t-r5a3b NO encontrado en candidatos');
    }
    
    console.log('✅ [DIAG-LIMITS] Diagnóstico completado');
    
  } catch (error) {
    console.error('❌ [DIAG-LIMITS] Error:', error.message);
  } finally {
    await pool.end();
  }
}

// Ejecutar diagnóstico
diagnosticarLimites().catch(console.error);
