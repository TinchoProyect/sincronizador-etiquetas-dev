// VERIFICAR NOMBRE CORRECTO DE LA HOJA

const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function verificarNombreHoja() {
  console.log('🔍 [VERIFY-SHEET] Verificando nombre correcto de la hoja...');
  
  try {
    // 1. Ver qué nombre está configurado en BD
    const configResult = await pool.query(`
      SELECT hoja_id, hoja_nombre, hoja_url FROM presupuestos_config 
      WHERE activo = true ORDER BY fecha_creacion DESC LIMIT 1
    `);
    
    const config = configResult.rows[0];
    console.log('📋 [VERIFY-SHEET] Configuración en BD:', {
      hoja_id: config.hoja_id,
      hoja_nombre: config.hoja_nombre,
      hoja_url: config.hoja_url
    });
    
    // 2. Probar diferentes nombres de hoja
    const { getSheets } = require('./src/google/gsheetsClient');
    const sheets = await getSheets();
    
    const nombresAProbrar = ['Presupuestos', 'PresupuestosCopia', 'Sheet1', 'Hoja1'];
    
    for (const nombre of nombresAProbrar) {
      try {
        console.log(`🔍 [VERIFY-SHEET] Probando nombre: "${nombre}"`);
        
        const result = await sheets.spreadsheets.values.get({
          spreadsheetId: config.hoja_id,
          range: `${nombre}!A1:A5`
        });
        
        const filas = result.data.values?.length || 0;
        console.log(`✅ [VERIFY-SHEET] "${nombre}" FUNCIONA - ${filas} filas encontradas`);
        
        if (filas > 0) {
          console.log(`📊 [VERIFY-SHEET] Primeras filas:`, result.data.values);
        }
        
      } catch (error) {
        console.log(`❌ [VERIFY-SHEET] "${nombre}" FALLA: ${error.message}`);
      }
    }
    
    console.log('✅ [VERIFY-SHEET] Verificación completada');
    
  } catch (error) {
    console.error('❌ [VERIFY-SHEET] Error:', error.message);
  } finally {
    await pool.end();
  }
}

// Ejecutar verificación
verificarNombreHoja().catch(console.error);
