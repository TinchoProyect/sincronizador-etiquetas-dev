// DIAGNÓSTICO: ¿Por qué mg0pvssq-s4yqj no está en confirmedIds?

const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function diagnosticoConfirmedIds() {
  try {
    console.log('🔍 DIAGNÓSTICO: ¿Por qué mg0pvssq-s4yqj no está en confirmedIds?');
    console.log('='.repeat(60));
    
    const presupuestoProblema = 'mg0pvssq-s4yqj';
    
    // 1. Verificar cutoff_at
    const config = await pool.query(`
      SELECT cutoff_at FROM presupuestos_config WHERE activo = true ORDER BY id DESC LIMIT 1
    `);
    
    const cutoffAt = config.rows[0]?.cutoff_at;
    console.log(`📊 cutoff_at: ${cutoffAt}`);
    
    // 2. Simular la query exacta de pushCambiosLocalesConTimestamp
    console.log(`\n📊 SIMULANDO QUERY DE pushCambiosLocalesConTimestamp:`);
    
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
        AND p.id_presupuesto_ext = $2  -- FILTRO ESPECÍFICO PARA EL PROBLEMA
      GROUP BY
        p.id_presupuesto_ext, p.id_cliente, p.fecha, p.fecha_entrega,
        p.agente, p.tipo_comprobante, p.nota, p.estado, p.informe_generado,
        p.cliente_nuevo_id, p.punto_entrega, p.descuento, p.activo, p.fecha_actualizacion
      HAVING GREATEST(
        p.fecha_actualizacion,
        COALESCE(MAX(d.fecha_actualizacion), p.fecha_actualizacion)
      ) > $1  -- ESTRICTO: solo posteriores a última sync
    `;
    
    const rs = await pool.query(localLastEditQuery, [cutoffAt, presupuestoProblema]);
    
    console.log(`📋 Resultado de query pushCambiosLocalesConTimestamp:`);
    console.log(`   rowCount: ${rs.rowCount}`);
    
    if (rs.rowCount > 0) {
      const r = rs.rows[0];
      console.log(`   ✅ ENCONTRADO: ${r.id}`);
      console.log(`   local_last_edit: ${r.local_last_edit}`);
      console.log(`   pasa_cutoff: ${new Date(r.local_last_edit) > new Date(cutoffAt)}`);
      console.log('💡 DEBERÍA estar en confirmedIds');
    } else {
      console.log(`   ❌ NO ENCONTRADO en query`);
      console.log('💡 POR ESO no está en confirmedIds');
      console.log('💡 POR ESO pushDetallesLocalesASheets NO se ejecuta');
      
      // Verificar por qué no pasa el filtro
      console.log('\n🔍 VERIFICANDO POR QUÉ NO PASA EL FILTRO:');
      
      const debug = await pool.query(`
        SELECT
          p.id_presupuesto_ext AS id,
          p.fecha_actualizacion as p_fecha,
          MAX(d.fecha_actualizacion) as d_fecha_max,
          GREATEST(
            p.fecha_actualizacion,
            COALESCE(MAX(d.fecha_actualizacion), p.fecha_actualizacion)
          ) AS local_last_edit,
          GREATEST(
            p.fecha_actualizacion,
            COALESCE(MAX(d.fecha_actualizacion), p.fecha_actualizacion)
          ) > $1 as pasa_filtro
        FROM public.presupuestos p
        LEFT JOIN public.presupuestos_detalles d ON d.id_presupuesto = p.id
        WHERE p.id_presupuesto_ext = $2
        GROUP BY p.id_presupuesto_ext, p.fecha_actualizacion
      `, [cutoffAt, presupuestoProblema]);
      
      if (debug.rowCount > 0) {
        const d = debug.rows[0];
        console.log(`   Presupuesto fecha: ${d.p_fecha}`);
        console.log(`   Detalles fecha max: ${d.d_fecha_max}`);
        console.log(`   local_last_edit: ${d.local_last_edit}`);
        console.log(`   cutoff_at: ${cutoffAt}`);
        console.log(`   pasa_filtro: ${d.pasa_filtro}`);
        
        if (!d.pasa_filtro) {
          console.log('❌ PROBLEMA: local_last_edit <= cutoff_at');
          console.log('💡 El presupuesto fue creado ANTES de la última sincronización');
          console.log('💡 Por eso no se procesa en la sincronización actual');
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error en diagnóstico:', error.message);
  } finally {
    await pool.end();
  }
}

diagnosticoConfirmedIds().catch(console.error);
