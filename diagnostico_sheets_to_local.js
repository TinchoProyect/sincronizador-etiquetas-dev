// DIAGNÓSTICO DEL FLUJO SHEETS → LOCAL
// Analiza qué sucede cuando se crea un presupuesto en Google Sheets

const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function diagnosticarSheetsToLocal() {
  console.log('🔍 [SHEETS-TO-LOCAL] === DIAGNÓSTICO DEL FLUJO SHEETS → LOCAL ===');
  
  try {
    // 1. Obtener configuración actual
    const config = await pool.query(`
      SELECT cutoff_at, hoja_id, hoja_url
      FROM presupuestos_config 
      WHERE activo = true 
      ORDER BY fecha_creacion DESC 
      LIMIT 1
    `);
    
    if (config.rows.length === 0) {
      console.log('❌ No hay configuración activa');
      return;
    }
    
    const cutoffAt = config.rows[0].cutoff_at;
    const hojaId = config.rows[0].hoja_id;
    
    console.log(`📅 cutoff_at: ${cutoffAt.toISOString()}`);
    console.log(`📋 hoja_id: ${hojaId}`);
    
    // 2. Buscar presupuestos recientes en local (últimos 10)
    console.log('\n🔍 [SHEETS-TO-LOCAL] === PRESUPUESTOS RECIENTES EN LOCAL ===');
    
    const presupuestosRecientes = await pool.query(`
      SELECT id, id_presupuesto_ext, id_cliente, agente, fecha_actualizacion, activo,
             EXTRACT(EPOCH FROM (fecha_actualizacion - $1)) as diff_segundos
      FROM presupuestos 
      WHERE activo = true
      ORDER BY fecha_actualizacion DESC
      LIMIT 10
    `, [cutoffAt]);
    
    console.log(`📊 Presupuestos recientes en local: ${presupuestosRecientes.rowCount}`);
    presupuestosRecientes.rows.forEach((p, i) => {
      console.log(`   ${i+1}. ${p.id_presupuesto_ext} (cliente: ${p.id_cliente})`);
      console.log(`      fecha_act: ${p.fecha_actualizacion}`);
      console.log(`      diff_cutoff: ${Math.round(p.diff_segundos)}s`);
      console.log(`      activo: ${p.activo}`);
    });
    
    // 3. Verificar detalles para presupuestos recientes
    console.log('\n🔍 [SHEETS-TO-LOCAL] === DETALLES DE PRESUPUESTOS RECIENTES ===');
    
    const idsRecientes = presupuestosRecientes.rows.map(p => p.id_presupuesto_ext);
    
    if (idsRecientes.length > 0) {
      const detallesRecientes = await pool.query(`
        SELECT d.id_presupuesto_ext, COUNT(*) as count_detalles,
               SUM(d.cantidad) as total_cantidad,
               SUM(d.precio1) as total_precio,
               MAX(d.fecha_actualizacion) as ultima_fecha_detalle
        FROM presupuestos_detalles d
        WHERE d.id_presupuesto_ext = ANY($1)
        GROUP BY d.id_presupuesto_ext
        ORDER BY MAX(d.fecha_actualizacion) DESC
      `, [idsRecientes]);
      
      console.log(`📊 Presupuestos con detalles: ${detallesRecientes.rowCount}`);
      detallesRecientes.rows.forEach((d, i) => {
        console.log(`   ${i+1}. ${d.id_presupuesto_ext}: ${d.count_detalles} detalles`);
        console.log(`      total_cantidad: ${d.total_cantidad}, total_precio: ${d.total_precio}`);
        console.log(`      ultima_fecha_detalle: ${d.ultima_fecha_detalle}`);
      });
      
      // Identificar presupuestos SIN detalles
      const idsSinDetalles = idsRecientes.filter(id => 
        !detallesRecientes.rows.some(d => d.id_presupuesto_ext === id)
      );
      
      if (idsSinDetalles.length > 0) {
        console.log(`⚠️ Presupuestos SIN detalles: ${idsSinDetalles.length}`);
        idsSinDetalles.forEach(id => console.log(`   - ${id}`));
      }
    }
    
    // 4. Verificar MAP para presupuestos recientes
    console.log('\n🔍 [SHEETS-TO-LOCAL] === MAP PARA PRESUPUESTOS RECIENTES ===');
    
    if (idsRecientes.length > 0) {
      const mapRecientes = await pool.query(`
        SELECT d.id_presupuesto_ext, COUNT(m.local_detalle_id) as count_map,
               COUNT(DISTINCT m.id_detalle_presupuesto) as count_sheet_ids,
               m.fuente, MAX(m.fecha_asignacion) as ultima_asignacion
        FROM presupuestos_detalles d
        LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
        WHERE d.id_presupuesto_ext = ANY($1)
        GROUP BY d.id_presupuesto_ext, m.fuente
        ORDER BY MAX(m.fecha_asignacion) DESC NULLS LAST
      `, [idsRecientes]);
      
      console.log(`📊 Entradas en MAP: ${mapRecientes.rowCount}`);
      mapRecientes.rows.forEach((m, i) => {
        console.log(`   ${i+1}. ${m.id_presupuesto_ext}: ${m.count_map} entradas MAP`);
        console.log(`      sheet_ids: ${m.count_sheet_ids}, fuente: ${m.fuente || 'SIN_MAP'}`);
        console.log(`      ultima_asignacion: ${m.ultima_asignacion || 'N/A'}`);
      });
      
      // Identificar presupuestos SIN MAP
      const idsSinMap = idsRecientes.filter(id => 
        !mapRecientes.rows.some(m => m.id_presupuesto_ext === id && m.count_map > 0)
      );
      
      if (idsSinMap.length > 0) {
        console.log(`⚠️ Presupuestos SIN MAP: ${idsSinMap.length}`);
        idsSinMap.forEach(id => console.log(`   - ${id}`));
      }
    }
    
    // 5. Analizar el flujo PULL específico
    console.log('\n🔍 [SHEETS-TO-LOCAL] === ANÁLISIS DEL FLUJO PULL ===');
    
    console.log('📋 FLUJO ACTUAL PULL (pullCambiosRemotosConTimestampMejorado):');
    console.log('   1. Lee presupuestos desde Sheets');
    console.log('   2. Compara timestamps Local vs Sheets');
    console.log('   3. Si Sheet > Local → UPDATE local');
    console.log('   4. Si no existe local → INSERT local');
    console.log('   5. Llama syncDetallesDesdeSheets() para detalles');
    
    console.log('\n🔍 POSIBLES PROBLEMAS EN PULL:');
    console.log('   ❌ syncDetallesDesdeSheets() puede no crear MAP correctamente');
    console.log('   ❌ Filtros cutoff_at pueden omitir presupuestos nuevos de Sheets');
    console.log('   ❌ Mapeo de campos puede estar incorrecto');
    
    // 6. Verificar último log de sincronización
    console.log('\n🔍 [SHEETS-TO-LOCAL] === ÚLTIMO LOG DE SINCRONIZACIÓN ===');
    
    const ultimoLog = await pool.query(`
      SELECT fecha_sync, exitoso, registros_procesados, registros_nuevos,
             registros_actualizados, detalles, tipo_sync
      FROM presupuestos_sync_log 
      WHERE exitoso = true
      ORDER BY fecha_sync DESC 
      LIMIT 1
    `);
    
    if (ultimoLog.rowCount > 0) {
      const log = ultimoLog.rows[0];
      console.log(`📊 Última sincronización exitosa:`);
      console.log(`   fecha_sync: ${log.fecha_sync}`);
      console.log(`   registros_procesados: ${log.registros_procesados}`);
      console.log(`   registros_nuevos: ${log.registros_nuevos}`);
      console.log(`   registros_actualizados: ${log.registros_actualizados}`);
      console.log(`   tipo_sync: ${log.tipo_sync}`);
      
      if (log.detalles) {
        try {
          const detallesInfo = JSON.parse(log.detalles);
          console.log(`   detalles_info:`, detallesInfo);
        } catch (e) {
          console.log(`   detalles_raw: ${log.detalles}`);
        }
      }
    }
    
    console.log('\n✅ [SHEETS-TO-LOCAL] Diagnóstico completado');
    console.log('\n💡 [SHEETS-TO-LOCAL] PRÓXIMOS PASOS:');
    console.log('   1. Revisar función syncDetallesDesdeSheets()');
    console.log('   2. Verificar creación de MAP en PULL');
    console.log('   3. Probar creación de presupuesto en Sheets');
    
  } catch (error) {
    console.error('❌ [SHEETS-TO-LOCAL] Error:', error.message);
  } finally {
    await pool.end();
  }
}

// Ejecutar diagnóstico
diagnosticarSheetsToLocal().catch(console.error);
