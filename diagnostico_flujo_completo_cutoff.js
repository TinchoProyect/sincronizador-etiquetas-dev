// DIAGNÓSTICO COMPLETO DEL FLUJO CUTOFF_AT
// Rastrea EXACTAMENTE qué está pasando en cada paso

const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function diagnosticarFlujoCompleto() {
  console.log('🔍 [FLUJO-CUTOFF] === DIAGNÓSTICO COMPLETO DEL FLUJO ===');
  
  try {
    // 1. Estado actual de configuración
    console.log('\n📊 [FLUJO-CUTOFF] === PASO 1: CONFIGURACIÓN ACTUAL ===');
    const config = await pool.query(`
      SELECT id, hoja_id, cutoff_at, fecha_creacion, activo
      FROM presupuestos_config 
      WHERE activo = true 
      ORDER BY fecha_creacion DESC 
      LIMIT 1
    `);
    
    if (config.rows.length === 0) {
      console.log('❌ No hay configuración activa');
      return;
    }
    
    const cfg = config.rows[0];
    const cutoffAt = cfg.cutoff_at;
    console.log(`   Config ID: ${cfg.id}`);
    console.log(`   cutoff_at: ${cutoffAt}`);
    console.log(`   cutoff_at ISO: ${cutoffAt?.toISOString()}`);
    
    // 2. Última sincronización registrada
    console.log('\n📊 [FLUJO-CUTOFF] === PASO 2: ÚLTIMA SINCRONIZACIÓN ===');
    const ultimaSync = await pool.query(`
      SELECT id, fecha_sync, exitoso, registros_procesados, tipo_sync
      FROM presupuestos_sync_log 
      WHERE exitoso = true
      ORDER BY fecha_sync DESC 
      LIMIT 1
    `);
    
    if (ultimaSync.rows.length > 0) {
      const sync = ultimaSync.rows[0];
      console.log(`   Última sync exitosa: ${sync.fecha_sync}`);
      console.log(`   Tipo: ${sync.tipo_sync}`);
      console.log(`   Registros procesados: ${sync.registros_procesados}`);
      console.log(`   Diff vs cutoff_at: ${Math.round((new Date(sync.fecha_sync) - cutoffAt) / (1000 * 60))} min`);
    } else {
      console.log('   No hay sincronizaciones exitosas registradas');
    }
    
    // 3. SIMULAR EXACTAMENTE EL QUERY DE pushCambiosLocalesConTimestamp
    console.log('\n🔍 [FLUJO-CUTOFF] === PASO 3: SIMULACIÓN pushCambiosLocalesConTimestamp ===');
    
    // Query EXACTO del controlador
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
    
    const simulacion = await pool.query(localLastEditQuery, [cutoffAt]);
    console.log(`   Query retornaría: ${simulacion.rowCount} registros`);
    
    if (simulacion.rowCount > 0) {
      console.log('   ⚠️ PROBLEMA: Hay registros que pasan el filtro');
      console.log('   Muestra de registros problemáticos:');
      simulacion.rows.slice(0, 5).forEach((r, i) => {
        const diffMin = Math.round((new Date(r.local_last_edit) - cutoffAt) / (1000 * 60));
        console.log(`   ${i+1}. ID: ${r.id}`);
        console.log(`      local_last_edit: ${r.local_last_edit}`);
        console.log(`      diff_vs_cutoff: ${diffMin} min`);
        console.log(`      pasa_filtro: ${new Date(r.local_last_edit) > cutoffAt}`);
      });
    } else {
      console.log('   ✅ CORRECTO: No hay registros que pasen el filtro');
    }
    
    // 4. SIMULAR EXACTAMENTE EL QUERY DE pushCambiosLocalesConTimestamp DEL SERVICIO
    console.log('\n🔍 [FLUJO-CUTOFF] === PASO 4: SIMULACIÓN pushCambiosLocalesConTimestamp SERVICIO ===');
    
    // Query del SERVICIO (sync_fechas_fix.js)
    const servicioQuery = `
      SELECT DISTINCT p.id_presupuesto_ext, p.id_cliente, p.agente, p.fecha, p.fecha_entrega, 
             p.tipo_comprobante, p.nota, p.estado, p.informe_generado, p.cliente_nuevo_id, 
             p.punto_entrega, p.descuento, p.activo, p.fecha_actualizacion
      FROM presupuestos p
      LEFT JOIN presupuestos_detalles d ON d.id_presupuesto_ext = p.id_presupuesto_ext
      WHERE p.activo = true 
        AND (
          p.fecha_actualizacion > $1
          OR d.fecha_actualizacion > $1
        )
    `;
    
    const simulacionServicio = await pool.query(servicioQuery, [cutoffAt]);
    console.log(`   Query SERVICIO retornaría: ${simulacionServicio.rowCount} registros`);
    
    if (simulacionServicio.rowCount > 0) {
      console.log('   ⚠️ PROBLEMA EN SERVICIO: Hay registros que pasan el filtro');
      console.log('   Muestra de registros problemáticos:');
      simulacionServicio.rows.slice(0, 5).forEach((r, i) => {
        const diffMin = Math.round((new Date(r.fecha_actualizacion) - cutoffAt) / (1000 * 60));
        console.log(`   ${i+1}. ID: ${r.id_presupuesto_ext}`);
        console.log(`      fecha_actualizacion: ${r.fecha_actualizacion}`);
        console.log(`      diff_vs_cutoff: ${diffMin} min`);
        console.log(`      pasa_filtro: ${new Date(r.fecha_actualizacion) > cutoffAt}`);
      });
    } else {
      console.log('   ✅ CORRECTO: No hay registros que pasen el filtro en SERVICIO');
    }
    
    // 5. Verificar si hay presupuestos sin ID externo
    console.log('\n🔍 [FLUJO-CUTOFF] === PASO 5: PRESUPUESTOS SIN ID EXTERNO ===');
    const sinIdExterno = await pool.query(`
      SELECT p.id, p.fecha_actualizacion, p.activo
      FROM presupuestos p
      WHERE p.activo = true 
        AND p.id_presupuesto_ext IS NULL
        AND p.fecha_actualizacion > $1
      ORDER BY p.fecha_actualizacion DESC
      LIMIT 5
    `, [cutoffAt]);
    
    console.log(`   Presupuestos sin ID externo > cutoff_at: ${sinIdExterno.rowCount}`);
    if (sinIdExterno.rowCount > 0) {
      console.log('   ⚠️ ESTOS GENERARÍAN IDs EXTERNOS Y SE PROCESARÍAN:');
      sinIdExterno.rows.forEach((r, i) => {
        console.log(`   ${i+1}. ID local: ${r.id}, fecha: ${r.fecha_actualizacion}`);
      });
    }
    
    // 6. Verificar detalles que pasarían el filtro
    console.log('\n🔍 [FLUJO-CUTOFF] === PASO 6: DETALLES QUE PASARÍAN FILTRO ===');
    const detallesProblematicos = await pool.query(`
      SELECT d.id_presupuesto_ext, d.articulo, d.fecha_actualizacion,
             COUNT(*) OVER (PARTITION BY d.id_presupuesto_ext) as detalles_por_presupuesto
      FROM public.presupuestos_detalles d
      INNER JOIN public.presupuestos p ON p.id_presupuesto_ext = d.id_presupuesto_ext
      WHERE p.activo = true 
        AND d.fecha_actualizacion > $1
      ORDER BY d.fecha_actualizacion DESC
      LIMIT 10
    `, [cutoffAt]);
    
    console.log(`   Detalles > cutoff_at: ${detallesProblematicos.rowCount}`);
    if (detallesProblematicos.rowCount > 0) {
      console.log('   ⚠️ ESTOS DETALLES SE PROCESARÍAN:');
      detallesProblematicos.rows.forEach((r, i) => {
        const diffMin = Math.round((new Date(r.fecha_actualizacion) - cutoffAt) / (1000 * 60));
        console.log(`   ${i+1}. ${r.id_presupuesto_ext} - ${r.articulo}`);
        console.log(`      fecha: ${r.fecha_actualizacion} (${diffMin} min después)`);
        console.log(`      detalles_total_presupuesto: ${r.detalles_por_presupuesto}`);
      });
    }
    
    // 7. DIAGNÓSTICO CRÍTICO: ¿Cuál debería ser el cutoff_at correcto?
    console.log('\n💡 [FLUJO-CUTOFF] === PASO 7: CUTOFF_AT CORRECTO ===');
    if (ultimaSync.rows.length > 0) {
      const fechaCorrecta = ultimaSync.rows[0].fecha_sync;
      console.log(`   cutoff_at DEBERÍA SER: ${fechaCorrecta}`);
      console.log(`   cutoff_at ACTUAL ES: ${cutoffAt}`);
      console.log(`   DIFERENCIA: ${Math.round((cutoffAt - new Date(fechaCorrecta)) / (1000 * 60))} min`);
      
      // Simular con cutoff_at correcto
      const testCorrecto = await pool.query(localLastEditQuery, [fechaCorrecta]);
      console.log(`   Con cutoff_at CORRECTO, se procesarían: ${testCorrecto.rowCount} registros`);
    }
    
    console.log('\n✅ [FLUJO-CUTOFF] Diagnóstico completado');
    
  } catch (error) {
    console.error('❌ [FLUJO-CUTOFF] Error:', error.message);
  } finally {
    await pool.end();
  }
}

// Ejecutar diagnóstico
diagnosticarFlujoCompleto().catch(console.error);
