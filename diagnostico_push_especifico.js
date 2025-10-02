// DIAGNÓSTICO ESPECÍFICO DEL PUSH
// Simula exactamente lo que hace pushCambiosLocalesConTimestamp

const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function diagnosticarPushEspecifico() {
  console.log('🔍 [DIAG-PUSH] Simulando pushCambiosLocalesConTimestamp...');
  
  try {
    // 1. Obtener configuración
    const configResult = await pool.query(`
      SELECT hoja_id, cutoff_at FROM presupuestos_config 
      WHERE activo = true ORDER BY fecha_creacion DESC LIMIT 1
    `);
    
    const config = configResult.rows[0];
    const cutoffAt = config.cutoff_at;
    
    console.log('✅ [DIAG-PUSH] Config:', {
      hoja_id: config.hoja_id,
      cutoff_at: cutoffAt.toISOString()
    });
    
    // 2. Simular el query CORREGIDO que usa pushCambiosLocalesConTimestamp
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
    
    console.log('🔍 [DIAG-PUSH] Query pushCambiosLocalesConTimestamp:');
    console.log(`     Encontrados: ${rs.rowCount} presupuestos`);
    
    // 3. Verificar específicamente mfw1cf4t-r5a3b
    const targetId = 'mfw1cf4t-r5a3b';
    const target = rs.rows.find(r => r.id === targetId);
    
    if (target) {
      console.log('✅ [DIAG-PUSH] ENCONTRADO mfw1cf4t-r5a3b en candidatos para push');
      console.log('     Datos completos:', {
        id: target.id,
        id_cliente: target.id_cliente,
        agente: target.agente,
        estado: target.estado,
        local_last_edit: target.local_last_edit,
        activo: target.activo
      });
      
      // 4. Verificar si tiene detalles
      const detallesResult = await pool.query(`
        SELECT COUNT(*) as count, 
               STRING_AGG(articulo, ', ') as articulos
        FROM public.presupuestos_detalles 
        WHERE id_presupuesto_ext = $1
      `, [targetId]);
      
      console.log('📊 [DIAG-PUSH] Detalles del presupuesto:', {
        count: detallesResult.rows[0].count,
        articulos: detallesResult.rows[0].articulos
      });
      
    } else {
      console.log('❌ [DIAG-PUSH] mfw1cf4t-r5a3b NO encontrado en candidatos para push');
      console.log('📊 [DIAG-PUSH] Candidatos encontrados:');
      rs.rows.slice(0, 5).forEach((r, i) => {
        console.log(`  ${i+1}. ${r.id} - ${r.local_last_edit}`);
      });
    }
    
    console.log('✅ [DIAG-PUSH] Diagnóstico completado');
    
  } catch (error) {
    console.error('❌ [DIAG-PUSH] Error:', error.message);
  } finally {
    await pool.end();
  }
}

// Ejecutar diagnóstico
diagnosticarPushEspecifico().catch(console.error);
