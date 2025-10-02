// FIX: CORREGIR NOMBRE DE HOJA EN BASE DE DATOS

const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function corregirNombreHoja() {
  console.log('🔧 [FIX-SHEET] Corrigiendo nombre de hoja en base de datos...');
  
  try {
    // 1. Mostrar configuración actual
    const configActual = await pool.query(`
      SELECT id, hoja_id, hoja_nombre, hoja_url, activo 
      FROM presupuestos_config 
      WHERE activo = true 
      ORDER BY fecha_creacion DESC 
      LIMIT 1
    `);
    
    console.log('📋 [FIX-SHEET] Configuración ANTES:', configActual.rows[0]);
    
    // 2. Actualizar nombre de hoja
    const updateResult = await pool.query(`
      UPDATE presupuestos_config 
      SET hoja_nombre = 'Presupuestos'
      WHERE activo = true
      RETURNING id, hoja_id, hoja_nombre, hoja_url
    `);
    
    console.log('✅ [FIX-SHEET] Configuración DESPUÉS:', updateResult.rows[0]);
    console.log(`🔧 [FIX-SHEET] Actualizado ${updateResult.rowCount} registro(s)`);
    
    // 3. Verificar que el cambio funciona
    console.log('🔍 [FIX-SHEET] Verificando que el cambio funciona...');
    
    const { getSheets } = require('./src/google/gsheetsClient');
    const sheets = await getSheets();
    
    const testResult = await sheets.spreadsheets.values.get({
      spreadsheetId: updateResult.rows[0].hoja_id,
      range: `${updateResult.rows[0].hoja_nombre}!A1:A3`
    });
    
    console.log('✅ [FIX-SHEET] VERIFICACIÓN EXITOSA - Primeras filas:', testResult.data.values);
    
    console.log('🎉 [FIX-SHEET] ¡PROBLEMA SOLUCIONADO!');
    console.log('💡 [FIX-SHEET] Ahora el botón de sincronización debería funcionar correctamente');
    
  } catch (error) {
    console.error('❌ [FIX-SHEET] Error:', error.message);
  } finally {
    await pool.end();
  }
}

// Ejecutar fix
corregirNombreHoja().catch(console.error);
