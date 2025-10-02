// DIAGNÓSTICO DEL BOTÓN SYNC MANUAL
// Identifica por qué un presupuesto nuevo no se sincroniza

const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function diagnosticarSyncManual() {
  console.log('🔍 [DIAG] Iniciando diagnóstico del sync manual...');
  
  try {
    // 1. Verificar configuración actual
    const configResult = await pool.query(`
      SELECT hoja_id, hoja_url, hoja_nombre, cutoff_at, usuario_id
      FROM presupuestos_config 
      WHERE activo = true 
      ORDER BY fecha_creacion DESC 
      LIMIT 1
    `);
    
    if (configResult.rows.length === 0) {
      console.log('❌ [DIAG] No hay configuración activa');
      return;
    }
    
    const config = configResult.rows[0];
    console.log('✅ [DIAG] Configuración encontrada:', {
      hoja_id: config.hoja_id,
      cutoff_at: config.cutoff_at,
      cutoff_iso: config.cutoff_at?.toISOString()
    });
    
    // 2. Verificar presupuestos recientes
    const presupuestosResult = await pool.query(`
      SELECT id_presupuesto_ext, fecha_actualizacion, activo,
             fecha_actualizacion >= $1 as pasa_cutoff
      FROM public.presupuestos p
      WHERE p.activo = true AND p.id_presupuesto_ext IS NOT NULL
      ORDER BY p.fecha_actualizacion DESC
      LIMIT 10
    `, [config.cutoff_at]);
    
    console.log('📊 [DIAG] Presupuestos recientes:');
    presupuestosResult.rows.forEach((r, i) => {
      console.log(`  ${i+1}. ID: ${r.id_presupuesto_ext}`);
      console.log(`     fecha_actualizacion: ${r.fecha_actualizacion}`);
      console.log(`     pasa_cutoff: ${r.pasa_cutoff}`);
      console.log(`     activo: ${r.activo}`);
    });
    
    // 3. Probar el query exacto que usa pushCambiosLocalesConTimestamp
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
          COALESCE(p.fecha_actualizacion, 'epoch'::timestamptz),
          COALESCE(MAX(d.fecha_actualizacion), 'epoch'::timestamptz)
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
        COALESCE(p.fecha_actualizacion, 'epoch'::timestamptz),
        COALESCE(MAX(d.fecha_actualizacion), 'epoch'::timestamptz)
      ) >= $1
    `;
    
    const queryResult = await pool.query(localLastEditQuery, [config.cutoff_at]);
    
    console.log('🔍 [DIAG] Query con filtro cutoff_at:');
    console.log(`     Encontrados: ${queryResult.rowCount} presupuestos`);
    console.log(`     Muestra:`, queryResult.rows.slice(0, 3).map(r => ({
      id: r.id,
      local_last_edit: r.local_last_edit,
      pasa_cutoff: new Date(r.local_last_edit) >= config.cutoff_at
    })));
    
    // 4. Probar el mismo query SIN filtro cutoff_at
    const querySinFiltro = `
      SELECT
        p.id_presupuesto_ext AS id,
        GREATEST(
          COALESCE(p.fecha_actualizacion, 'epoch'::timestamptz),
          COALESCE(MAX(d.fecha_actualizacion), 'epoch'::timestamptz)
        ) AS local_last_edit
      FROM public.presupuestos p
      LEFT JOIN public.presupuestos_detalles d
        ON d.id_presupuesto = p.id
      WHERE p.activo = true
        AND p.id_presupuesto_ext IS NOT NULL
      GROUP BY
        p.id_presupuesto_ext, p.fecha_actualizacion
      ORDER BY local_last_edit DESC
      LIMIT 10
    `;
    
    const sinFiltroResult = await pool.query(querySinFiltro);
    
    console.log('🔍 [DIAG] Query SIN filtro cutoff_at:');
    console.log(`     Encontrados: ${sinFiltroResult.rowCount} presupuestos`);
    console.log(`     Muestra:`, sinFiltroResult.rows.slice(0, 3).map(r => ({
      id: r.id,
      local_last_edit: r.local_last_edit,
      pasa_cutoff: new Date(r.local_last_edit) >= config.cutoff_at
    })));
    
    // 5. Verificar detalles para presupuestos recientes
    const detallesResult = await pool.query(`
      SELECT d.id_presupuesto_ext, COUNT(*) as count_detalles
      FROM public.presupuestos_detalles d
      INNER JOIN public.presupuestos p ON p.id_presupuesto_ext = d.id_presupuesto_ext
      WHERE p.activo = true
      GROUP BY d.id_presupuesto_ext
      ORDER BY COUNT(*) DESC
      LIMIT 5
    `);
    
    console.log('📊 [DIAG] Presupuestos con más detalles:');
    detallesResult.rows.forEach((r, i) => {
      console.log(`  ${i+1}. ID: ${r.id_presupuesto_ext} - Detalles: ${r.count_detalles}`);
    });
    
    console.log('✅ [DIAG] Diagnóstico completado');
    
  } catch (error) {
    console.error('❌ [DIAG] Error:', error.message);
  } finally {
    await pool.end();
  }
}

// Ejecutar diagnóstico
diagnosticarSyncManual().catch(console.error);
