// DIAGNÓSTICO FINAL DE DEDUPLICACIÓN
// Simula exactamente la lógica de existingHeaderIds

const { Pool } = require('pg');
const { readSheetWithHeaders } = require('./src/services/gsheets/client_with_logs');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function diagnosticarDeduplicacionFinal() {
  console.log('🔍 [DIAG-FINAL] Simulando lógica exacta de existingHeaderIds...');
  
  try {
    // 1. Obtener configuración
    const configResult = await pool.query(`
      SELECT hoja_id, hoja_nombre, cutoff_at FROM presupuestos_config 
      WHERE activo = true ORDER BY fecha_creacion DESC LIMIT 1
    `);
    
    const config = configResult.rows[0];
    
    // 2. Simular la lectura de IDs existentes (como en línea 1160)
    console.log('🔍 [DIAG-FINAL] Leyendo IDs existentes desde Sheets columna A...');
    
    // Usar el mismo método que la función real
    const { getSheets } = require('./src/google/gsheetsClient');
    const sheets = await getSheets();
    
    const headExisting = await sheets.spreadsheets.values.get({
      spreadsheetId: config.hoja_id,
      range: `${config.hoja_nombre}!A:A`
    });
    
    const existingHeaderIds = new Set((headExisting.data.values || [])
      .slice(1) // Saltar header
      .map(r => String(r[0] || '').trim())
      .filter(Boolean));
    
    console.log(`🔍 [DIAG-FINAL] IDs existentes en Sheets (columna A): ${existingHeaderIds.size}`);
    console.log(`🔍 [DIAG-FINAL] Primeros 10 IDs:`, Array.from(existingHeaderIds).slice(0, 10));
    
    // 3. Verificar específicamente mfw1cf4t-r5a3b
    const targetId = 'mfw1cf4t-r5a3b';
    const targetExists = existingHeaderIds.has(targetId);
    
    console.log(`🎯 [DIAG-FINAL] ¿${targetId} existe en Sheets columna A? ${targetExists ? 'SÍ' : 'NO'}`);
    
    if (targetExists) {
      console.log('❌ [DIAG-FINAL] PROBLEMA: El presupuesto YA EXISTE en Sheets');
      console.log('💡 [DIAG-FINAL] Debería ir a toUpdate, no a toInsert');
    } else {
      console.log('✅ [DIAG-FINAL] El presupuesto NO existe en Sheets, debería insertarse');
    }
    
    // 4. Obtener candidatos locales para verificar toInsert vs toUpdate
    const localLastEditQuery = `
      SELECT p.id_presupuesto_ext AS id,
             GREATEST(
               p.fecha_actualizacion,
               COALESCE(MAX(d.fecha_actualizacion), p.fecha_actualizacion)
             ) AS local_last_edit
      FROM public.presupuestos p
      LEFT JOIN public.presupuestos_detalles d ON d.id_presupuesto = p.id
      WHERE p.activo = true AND p.id_presupuesto_ext IS NOT NULL
      GROUP BY p.id_presupuesto_ext, p.fecha_actualizacion
      HAVING GREATEST(
        p.fecha_actualizacion,
        COALESCE(MAX(d.fecha_actualizacion), p.fecha_actualizacion)
      ) >= $1
      ORDER BY local_last_edit DESC
      LIMIT 5
    `;
    
    const rs = await pool.query(localLastEditQuery, [config.cutoff_at]);
    
    console.log('📊 [DIAG-FINAL] Simulando clasificación toInsert vs toUpdate:');
    
    let toInsertCount = 0;
    let toUpdateCount = 0;
    
    rs.rows.forEach(row => {
      const id = row.id;
      const exists = existingHeaderIds.has(id);
      const classification = exists ? 'toUpdate' : 'toInsert';
      
      if (exists) {
        toUpdateCount++;
      } else {
        toInsertCount++;
      }
      
      const marker = id === targetId ? '🎯' : '';
      console.log(`  ${id}: ${classification} ${marker}`);
    });
    
    console.log(`📊 [DIAG-FINAL] Resumen: toInsert=${toInsertCount}, toUpdate=${toUpdateCount}`);
    
    console.log('✅ [DIAG-FINAL] Diagnóstico completado');
    
  } catch (error) {
    console.error('❌ [DIAG-FINAL] Error:', error.message);
  } finally {
    await pool.end();
  }
}

// Ejecutar diagnóstico
diagnosticarDeduplicacionFinal().catch(console.error);
