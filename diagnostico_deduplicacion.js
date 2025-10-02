// DIAGNÓSTICO DE DEDUPLICACIÓN
// Verifica por qué pushCambiosLocalesConTimestamp no encuentra candidatos para insertar

const { Pool } = require('pg');
const { readSheetWithHeaders } = require('./src/services/gsheets/client_with_logs');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function diagnosticarDeduplicacion() {
  console.log('🔍 [DIAG-DEDUP] Diagnosticando deduplicación contra Google Sheets...');
  
  try {
    // 1. Obtener configuración
    const configResult = await pool.query(`
      SELECT hoja_id, cutoff_at FROM presupuestos_config 
      WHERE activo = true ORDER BY fecha_creacion DESC LIMIT 1
    `);
    
    const config = configResult.rows[0];
    const cutoffAt = config.cutoff_at;
    
    console.log('✅ [DIAG-DEDUP] Config:', {
      hoja_id: config.hoja_id,
      cutoff_at: cutoffAt.toISOString()
    });
    
    // 2. Obtener candidatos locales (query corregido)
    const localQuery = `
      SELECT
        p.id_presupuesto_ext AS id,
        p.id_cliente,
        p.agente,
        p.estado,
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
        p.id_presupuesto_ext, p.id_cliente, p.agente, p.estado, p.fecha_actualizacion
      HAVING GREATEST(
        p.fecha_actualizacion,
        COALESCE(MAX(d.fecha_actualizacion), p.fecha_actualizacion)
      ) >= $1
      ORDER BY local_last_edit DESC
      LIMIT 10
    `;
    
    const locales = await pool.query(localQuery, [cutoffAt]);
    console.log(`🔍 [DIAG-DEDUP] Candidatos locales: ${locales.rowCount}`);
    
    // 3. Leer IDs remotos desde Google Sheets
    console.log('🔍 [DIAG-DEDUP] Leyendo IDs desde Google Sheets...');
    const presupuestosData = await readSheetWithHeaders(config.hoja_id, 'A:O', 'Presupuestos');
    
    const idCol = presupuestosData.headers[0]; // "IDPresupuesto"
    const remoteIds = new Set(presupuestosData.rows.map(r => r[idCol]).filter(Boolean));
    
    console.log(`🔍 [DIAG-DEDUP] IDs remotos en Sheets: ${remoteIds.size}`);
    console.log(`🔍 [DIAG-DEDUP] Primeros 10 IDs remotos:`, Array.from(remoteIds).slice(0, 10));
    
    // 4. Verificar deduplicación específica para mfw1cf4t-r5a3b
    const targetId = 'mfw1cf4t-r5a3b';
    const targetLocal = locales.rows.find(r => r.id === targetId);
    const targetRemote = remoteIds.has(targetId);
    
    console.log('🎯 [DIAG-DEDUP] Análisis específico para mfw1cf4t-r5a3b:');
    console.log(`     En candidatos locales: ${targetLocal ? 'SÍ' : 'NO'}`);
    console.log(`     En Google Sheets: ${targetRemote ? 'SÍ' : 'NO'}`);
    
    if (targetLocal) {
      console.log('     Datos locales:', {
        id: targetLocal.id,
        id_cliente: targetLocal.id_cliente,
        agente: targetLocal.agente,
        estado: targetLocal.estado,
        local_last_edit: targetLocal.local_last_edit
      });
    }
    
    // 5. Simular filtro toInsert
    const toInsert = locales.rows.filter(p => !remoteIds.has(p.id));
    console.log(`🔍 [DIAG-DEDUP] Después del filtro toInsert: ${toInsert.length} presupuestos`);
    
    if (toInsert.length > 0) {
      console.log('✅ [DIAG-DEDUP] Candidatos para insertar:');
      toInsert.slice(0, 5).forEach((p, i) => {
        console.log(`  ${i+1}. ${p.id} - ${p.agente} - ${p.estado}`);
      });
    } else {
      console.log('❌ [DIAG-DEDUP] NO HAY candidatos para insertar');
      console.log('🔍 [DIAG-DEDUP] Todos los presupuestos locales ya existen en Sheets');
    }
    
    // 6. Verificar si mfw1cf4t-r5a3b estaría en toInsert
    const targetInToInsert = toInsert.find(p => p.id === targetId);
    console.log(`🎯 [DIAG-DEDUP] mfw1cf4t-r5a3b en toInsert: ${targetInToInsert ? 'SÍ' : 'NO'}`);
    
    console.log('✅ [DIAG-DEDUP] Diagnóstico completado');
    
  } catch (error) {
    console.error('❌ [DIAG-DEDUP] Error:', error.message);
  } finally {
    await pool.end();
  }
}

// Ejecutar diagnóstico
diagnosticarDeduplicacion().catch(console.error);
