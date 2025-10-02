// DIAGNÓSTICO DETALLADO DEL FILTRO CUTOFF_AT
// Verifica por qué se procesan registros cuando no debería

const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function diagnosticarFiltroCutoff() {
  console.log('🔍 [DIAG-CUTOFF] Iniciando diagnóstico detallado del filtro cutoff_at...');
  
  try {
    // 1. Obtener configuración actual con cutoff_at
    const configResult = await pool.query(`
      SELECT hoja_id, hoja_url, hoja_nombre, cutoff_at, 
             fecha_creacion, usuario_id
      FROM presupuestos_config 
      WHERE activo = true 
      ORDER BY fecha_creacion DESC 
      LIMIT 1
    `);
    
    if (configResult.rows.length === 0) {
      console.log('❌ [DIAG-CUTOFF] No hay configuración activa');
      return;
    }
    
    const config = configResult.rows[0];
    const cutoffAt = config.cutoff_at;
    
    console.log('✅ [DIAG-CUTOFF] Configuración encontrada:');
    console.log(`   hoja_id: ${config.hoja_id}`);
    console.log(`   cutoff_at: ${cutoffAt}`);
    console.log(`   cutoff_at ISO: ${cutoffAt?.toISOString()}`);
    
    // 2. Verificar presupuestos que PASARÍAN el filtro >= cutoff_at
    console.log('\n📊 [DIAG-CUTOFF] === FILTRO >= (ACTUAL PROBLEMÁTICO) ===');
    const presupuestosGTE = await pool.query(`
      SELECT p.id_presupuesto_ext, p.fecha_actualizacion, p.activo,
             p.fecha_actualizacion >= $1 as pasa_filtro_gte
      FROM public.presupuestos p
      WHERE p.activo = true 
        AND p.id_presupuesto_ext IS NOT NULL
        AND p.fecha_actualizacion >= $1
      ORDER BY p.fecha_actualizacion DESC
      LIMIT 10
    `, [cutoffAt]);
    
    console.log(`   Presupuestos que PASAN filtro >= : ${presupuestosGTE.rowCount}`);
    presupuestosGTE.rows.forEach((r, i) => {
      console.log(`   ${i+1}. ID: ${r.id_presupuesto_ext}`);
      console.log(`      fecha_actualizacion: ${r.fecha_actualizacion}`);
      console.log(`      pasa_filtro_gte: ${r.pasa_filtro_gte}`);
      console.log(`      diff_minutos: ${Math.round((new Date(r.fecha_actualizacion) - cutoffAt) / (1000 * 60))}`);
    });
    
    // 3. Verificar presupuestos que PASARÍAN el filtro > cutoff_at (ESTRICTO)
    console.log('\n📊 [DIAG-CUTOFF] === FILTRO > (NUEVO ESTRICTO) ===');
    const presupuestosGT = await pool.query(`
      SELECT p.id_presupuesto_ext, p.fecha_actualizacion, p.activo,
             p.fecha_actualizacion > $1 as pasa_filtro_gt
      FROM public.presupuestos p
      WHERE p.activo = true 
        AND p.id_presupuesto_ext IS NOT NULL
        AND p.fecha_actualizacion > $1
      ORDER BY p.fecha_actualizacion DESC
      LIMIT 10
    `, [cutoffAt]);
    
    console.log(`   Presupuestos que PASAN filtro > : ${presupuestosGT.rowCount}`);
    presupuestosGT.rows.forEach((r, i) => {
      console.log(`   ${i+1}. ID: ${r.id_presupuesto_ext}`);
      console.log(`      fecha_actualizacion: ${r.fecha_actualizacion}`);
      console.log(`      pasa_filtro_gt: ${r.pasa_filtro_gt}`);
      console.log(`      diff_minutos: ${Math.round((new Date(r.fecha_actualizacion) - cutoffAt) / (1000 * 60))}`);
    });
    
    // 4. Verificar detalles que PASARÍAN el filtro >= cutoff_at
    console.log('\n📊 [DIAG-CUTOFF] === DETALLES FILTRO >= (ACTUAL PROBLEMÁTICO) ===');
    const detallesGTE = await pool.query(`
      SELECT d.id_presupuesto_ext, d.articulo, d.fecha_actualizacion,
             d.fecha_actualizacion >= $1 as pasa_filtro_gte
      FROM public.presupuestos_detalles d
      INNER JOIN public.presupuestos p ON p.id_presupuesto_ext = d.id_presupuesto_ext
      WHERE p.activo = true 
        AND d.fecha_actualizacion >= $1
      ORDER BY d.fecha_actualizacion DESC
      LIMIT 10
    `, [cutoffAt]);
    
    console.log(`   Detalles que PASAN filtro >= : ${detallesGTE.rowCount}`);
    detallesGTE.rows.forEach((r, i) => {
      console.log(`   ${i+1}. ID: ${r.id_presupuesto_ext} - ${r.articulo}`);
      console.log(`      fecha_actualizacion: ${r.fecha_actualizacion}`);
      console.log(`      pasa_filtro_gte: ${r.pasa_filtro_gte}`);
      console.log(`      diff_minutos: ${Math.round((new Date(r.fecha_actualizacion) - cutoffAt) / (1000 * 60))}`);
    });
    
    // 5. Verificar detalles que PASARÍAN el filtro > cutoff_at (ESTRICTO)
    console.log('\n📊 [DIAG-CUTOFF] === DETALLES FILTRO > (NUEVO ESTRICTO) ===');
    const detallesGT = await pool.query(`
      SELECT d.id_presupuesto_ext, d.articulo, d.fecha_actualizacion,
             d.fecha_actualizacion > $1 as pasa_filtro_gt
      FROM public.presupuestos_detalles d
      INNER JOIN public.presupuestos p ON p.id_presupuesto_ext = d.id_presupuesto_ext
      WHERE p.activo = true 
        AND d.fecha_actualizacion > $1
      ORDER BY d.fecha_actualizacion DESC
      LIMIT 10
    `, [cutoffAt]);
    
    console.log(`   Detalles que PASAN filtro > : ${detallesGT.rowCount}`);
    detallesGT.rows.forEach((r, i) => {
      console.log(`   ${i+1}. ID: ${r.id_presupuesto_ext} - ${r.articulo}`);
      console.log(`      fecha_actualizacion: ${r.fecha_actualizacion}`);
      console.log(`      pasa_filtro_gt: ${r.pasa_filtro_gt}`);
      console.log(`      diff_minutos: ${Math.round((new Date(r.fecha_actualizacion) - cutoffAt) / (1000 * 60))}`);
    });
    
    // 6. Verificar última sincronización registrada
    console.log('\n📊 [DIAG-CUTOFF] === ÚLTIMA SINCRONIZACIÓN ===');
    const ultimaSync = await pool.query(`
      SELECT fecha_sync, exitoso, registros_procesados, tipo_sync
      FROM presupuestos_sync_log 
      ORDER BY fecha_sync DESC 
      LIMIT 3
    `);
    
    console.log('   Últimas 3 sincronizaciones:');
    ultimaSync.rows.forEach((r, i) => {
      console.log(`   ${i+1}. fecha_sync: ${r.fecha_sync}`);
      console.log(`      exitoso: ${r.exitoso}`);
      console.log(`      registros_procesados: ${r.registros_procesados}`);
      console.log(`      tipo_sync: ${r.tipo_sync}`);
      console.log(`      diff_vs_cutoff: ${Math.round((new Date(r.fecha_sync) - cutoffAt) / (1000 * 60))} min`);
    });
    
    // 7. DIAGNÓSTICO CRÍTICO: ¿Qué retornaría pushCambiosLocalesConTimestamp?
    console.log('\n🔍 [DIAG-CUTOFF] === SIMULACIÓN pushCambiosLocalesConTimestamp ===');
    
    // Simular el query exacto que usa pushCambiosLocalesConTimestamp
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
      ) > $1
    `;
    
    const simulacionResult = await pool.query(localLastEditQuery, [cutoffAt]);
    
    console.log(`   Query pushCambiosLocalesConTimestamp retornaría: ${simulacionResult.rowCount} registros`);
    
    if (simulacionResult.rowCount > 0) {
      console.log('   ⚠️ PROBLEMA DETECTADO: Hay registros que pasan el filtro cuando NO deberían');
      console.log('   Muestra de registros problemáticos:');
      simulacionResult.rows.slice(0, 5).forEach((r, i) => {
        console.log(`   ${i+1}. ID: ${r.id}`);
        console.log(`      local_last_edit: ${r.local_last_edit}`);
        console.log(`      diff_vs_cutoff: ${Math.round((new Date(r.local_last_edit) - cutoffAt) / (1000 * 60))} min`);
        console.log(`      pasa_filtro: ${new Date(r.local_last_edit) > cutoffAt}`);
      });
    } else {
      console.log('   ✅ CORRECTO: No hay registros que pasen el filtro');
    }
    
    // 8. Verificar si hay presupuestos sin ID externo
    console.log('\n📊 [DIAG-CUTOFF] === PRESUPUESTOS SIN ID EXTERNO ===');
    const sinIdExterno = await pool.query(`
      SELECT p.id, p.fecha_actualizacion, p.activo
      FROM presupuestos p
      WHERE p.activo = true 
        AND p.id_presupuesto_ext IS NULL
        AND p.fecha_actualizacion > $1
      ORDER BY p.fecha_actualizacion DESC
      LIMIT 5
    `, [cutoffAt]);
    
    console.log(`   Presupuestos sin ID externo que pasan filtro: ${sinIdExterno.rowCount}`);
    sinIdExterno.rows.forEach((r, i) => {
      console.log(`   ${i+1}. ID local: ${r.id}`);
      console.log(`      fecha_actualizacion: ${r.fecha_actualizacion}`);
      console.log(`      diff_vs_cutoff: ${Math.round((new Date(r.fecha_actualizacion) - cutoffAt) / (1000 * 60))} min`);
    });
    
    console.log('\n✅ [DIAG-CUTOFF] Diagnóstico completado');
    
  } catch (error) {
    console.error('❌ [DIAG-CUTOFF] Error:', error.message);
  } finally {
    await pool.end();
  }
}

// Ejecutar diagnóstico
diagnosticarFiltroCutoff().catch(console.error);
