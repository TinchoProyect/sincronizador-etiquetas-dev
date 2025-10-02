/**
 * DIAGNÓSTICO PROFUNDO - FLUJO DE SINCRONIZACIÓN
 * Analiza paso a paso el flujo de sincronización bidireccional
 */

const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost', 
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function diagnosticoSyncProfundo() {
  try {
    console.log('🔍 [DIAG-SYNC] ===== ANÁLISIS PROFUNDO DEL FLUJO =====');
    
    // 1. Obtener configuración exacta que usa la sincronización
    console.log('\n📋 [DIAG-SYNC] PASO 1: Configuración exacta...');
    
    const configQuery = `
      SELECT hoja_id, hoja_url, hoja_nombre, cutoff_at, usuario_id
      FROM presupuestos_config 
      WHERE activo = true 
      ORDER BY fecha_creacion DESC 
      LIMIT 1
    `;
    
    const configResult = await pool.query(configQuery);
    const config = configResult.rows[0];
    
    console.log('📋 [DIAG-SYNC] Configuración que usará la sincronización:');
    console.log('  - hoja_id:', config.hoja_id);
    console.log('  - hoja_nombre:', config.hoja_nombre);
    console.log('  - cutoff_at:', config.cutoff_at.toISOString());
    
    // 2. Simular el query exacto de detección de presupuestos modificados
    console.log('\n📋 [DIAG-SYNC] PASO 2: Simulando detección de presupuestos modificados...');
    
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
      LIMIT 10
    `;
    
    const rs = await pool.query(localLastEditQuery, [config.cutoff_at]);
    
    console.log('📋 [DIAG-SYNC] Presupuestos detectados por query de sincronización:', rs.rowCount);
    
    if (rs.rowCount === 0) {
      console.log('❌ [DIAG-SYNC] PROBLEMA CRÍTICO: Query de sincronización no detecta presupuestos');
      console.log('💡 [DIAG-SYNC] Verificando cutoff_at vs fechas reales...');
      
      // Verificar diferencia de fechas
      const allPresupuestos = await pool.query(`
        SELECT 
          id_presupuesto_ext,
          fecha_actualizacion,
          fecha_actualizacion >= $1 as pasa_cutoff,
          EXTRACT(EPOCH FROM (fecha_actualizacion - $1))/3600 as horas_diferencia
        FROM presupuestos 
        WHERE activo = true AND id_presupuesto_ext IS NOT NULL
        ORDER BY fecha_actualizacion DESC
        LIMIT 5
      `, [config.cutoff_at]);
      
      console.log('📋 [DIAG-SYNC] Análisis de fechas:');
      allPresupuestos.rows.forEach((p, i) => {
        console.log(`  ${i+1}. ID: ${p.id_presupuesto_ext}`);
        console.log(`     Fecha: ${p.fecha_actualizacion}`);
        console.log(`     Pasa cutoff: ${p.pasa_cutoff}`);
        console.log(`     Diferencia: ${p.horas_diferencia} horas`);
      });
      
      return;
    }
    
    console.log('✅ [DIAG-SYNC] Presupuestos detectados correctamente:');
    rs.rows.forEach((p, i) => {
      console.log(`  ${i+1}. ID: ${p.id}, local_last_edit: ${p.local_last_edit}`);
      console.log(`     Cliente: ${p.id_cliente}, Estado: ${p.estado}`);
    });
    
    // 3. Verificar acceso a Google Sheets
    console.log('\n📋 [DIAG-SYNC] PASO 3: Verificando acceso a Google Sheets...');
    
    try {
      const { validateSheetAccess } = require('./src/services/gsheets/client_with_logs');
      const acceso = await validateSheetAccess(config.hoja_id);
      
      console.log('📋 [DIAG-SYNC] Acceso a Google Sheets:', acceso.hasAccess);
      
      if (!acceso.hasAccess) {
        console.log('❌ [DIAG-SYNC] PROBLEMA CRÍTICO: No hay acceso a Google Sheets');
        console.log('❌ [DIAG-SYNC] Error:', acceso.error);
        return;
      }
      
      console.log('✅ [DIAG-SYNC] Acceso a Google Sheets verificado');
      
    } catch (gsheetsError) {
      console.log('❌ [DIAG-SYNC] Error verificando Google Sheets:', gsheetsError.message);
    }
    
    // 4. Verificar función problemática: eliminarDetallesModificadosEnSheets
    console.log('\n📋 [DIAG-SYNC] PASO 4: Analizando función eliminarDetallesModificadosEnSheets...');
    
    console.log('⚠️ [DIAG-SYNC] POSIBLE PROBLEMA DETECTADO:');
    console.log('  - La función eliminarDetallesModificadosEnSheets usa sheetId: 0');
    console.log('  - Esto asume que DetallesPresupuestos es la primera hoja');
    console.log('  - Si DetallesPresupuestos NO es la primera hoja, fallará');
    
    // 5. Verificar orden de hojas en el spreadsheet
    console.log('\n📋 [DIAG-SYNC] PASO 5: Verificando orden de hojas...');
    
    try {
      const { getSheets } = require('./src/google/gsheetsClient');
      const sheets = await getSheets();
      
      const spreadsheetInfo = await sheets.spreadsheets.get({
        spreadsheetId: config.hoja_id
      });
      
      console.log('📋 [DIAG-SYNC] Hojas en el spreadsheet:');
      spreadsheetInfo.data.sheets.forEach((sheet, i) => {
        console.log(`  ${i}. ${sheet.properties.title} (sheetId: ${sheet.properties.sheetId})`);
      });
      
      // Buscar sheetId de DetallesPresupuestos
      const detallesSheet = spreadsheetInfo.data.sheets.find(s => 
        s.properties.title.toLowerCase().includes('detalles')
      );
      
      if (detallesSheet) {
        console.log('✅ [DIAG-SYNC] Hoja DetallesPresupuestos encontrada:');
        console.log('  - Nombre:', detallesSheet.properties.title);
        console.log('  - sheetId:', detallesSheet.properties.sheetId);
        console.log('  - Posición:', spreadsheetInfo.data.sheets.findIndex(s => s.properties.sheetId === detallesSheet.properties.sheetId));
        
        if (detallesSheet.properties.sheetId !== 0) {
          console.log('❌ [DIAG-SYNC] PROBLEMA CRÍTICO ENCONTRADO:');
          console.log('  - eliminarDetallesModificadosEnSheets usa sheetId: 0');
          console.log(`  - Pero DetallesPresupuestos tiene sheetId: ${detallesSheet.properties.sheetId}`);
          console.log('  - Esto causa que la eliminación falle silenciosamente');
        }
      } else {
        console.log('❌ [DIAG-SYNC] No se encontró hoja de detalles');
      }
      
    } catch (sheetsError) {
      console.log('❌ [DIAG-SYNC] Error accediendo a Google Sheets:', sheetsError.message);
    }
    
    // 6. Verificar si hay otros problemas en el flujo
    console.log('\n📋 [DIAG-SYNC] PASO 6: Verificando otros problemas potenciales...');
    
    console.log('🔍 [DIAG-SYNC] Problemas potenciales identificados:');
    console.log('  1. sheetId hardcodeado en eliminarDetallesModificadosEnSheets');
    console.log('  2. Posible timeout en eliminación de filas (muchas operaciones)');
    console.log('  3. Rate limiting de Google Sheets API');
    console.log('  4. Orden incorrecto de operaciones');
    
    console.log('\n🔍 [DIAG-SYNC] ===== ANÁLISIS COMPLETADO =====');
    
  } catch (error) {
    console.error('❌ [DIAG-SYNC] Error crítico:', error.message);
  } finally {
    await pool.end();
  }
}

// Ejecutar diagnóstico
diagnosticoSyncProfundo().catch(console.error);
