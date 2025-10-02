// DIAGNÓSTICO: ¿Por qué mg0pvssq-s4yqj no se detecta como UPDATE?

const { Pool } = require('pg');
const { readSheetWithHeaders } = require('./src/services/gsheets/client_with_logs');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function diagnosticoTimestamp() {
  try {
    console.log('🔍 DIAGNÓSTICO: ¿Por qué mg0pvssq-s4yqj no se detecta como UPDATE?');
    console.log('='.repeat(60));
    
    const presupuestoProblema = 'mg0pvssq-s4yqj';
    
    // 1. Obtener configuración
    const config = await pool.query(`
      SELECT hoja_id, cutoff_at FROM presupuestos_config WHERE activo = true ORDER BY id DESC LIMIT 1
    `);
    
    const hojaId = config.rows[0]?.hoja_id;
    const cutoffAt = config.rows[0]?.cutoff_at;
    
    console.log(`📊 Configuración:`);
    console.log(`   hoja_id: ${hojaId}`);
    console.log(`   cutoff_at: ${cutoffAt}`);
    
    // 2. Leer datos de Sheets
    console.log(`\n📊 LEYENDO DATOS DE SHEETS...`);
    const presupuestosSheets = await readSheetWithHeaders(hojaId, 'A:O', 'Presupuestos');
    
    // 3. Buscar el presupuesto en Sheets
    const idCol = presupuestosSheets.headers[0]; // "IDPresupuesto"
    const lmCol = presupuestosSheets.headers[13]; // "LastModified"
    
    const presupuestoEnSheets = presupuestosSheets.rows.find(row => 
      (row[idCol] || '').toString().trim() === presupuestoProblema
    );
    
    if (!presupuestoEnSheets) {
      console.log('❌ PROBLEMA: Presupuesto NO encontrado en Sheets');
      console.log('💡 Por eso se detectaría como INSERT, no UPDATE');
      return;
    }
    
    const lastModifiedSheets = presupuestoEnSheets[lmCol];
    console.log(`📊 Presupuesto encontrado en Sheets:`);
    console.log(`   LastModified en Sheets: "${lastModifiedSheets}"`);
    console.log(`   Tipo: ${typeof lastModifiedSheets}`);
    
    // 4. Obtener timestamp local
    const local = await pool.query(`
      SELECT
        p.id_presupuesto_ext AS id,
        GREATEST(
          p.fecha_actualizacion,
          COALESCE(MAX(d.fecha_actualizacion), p.fecha_actualizacion)
        ) AS local_last_edit
      FROM public.presupuestos p
      LEFT JOIN public.presupuestos_detalles d ON d.id_presupuesto = p.id
      WHERE p.id_presupuesto_ext = $1
      GROUP BY p.id_presupuesto_ext, p.fecha_actualizacion
    `, [presupuestoProblema]);
    
    if (local.rowCount === 0) {
      console.log('❌ Presupuesto no encontrado en BD local');
      return;
    }
    
    const localLastEdit = new Date(local.rows[0].local_last_edit);
    console.log(`📊 Timestamp local:`);
    console.log(`   local_last_edit: ${localLastEdit.toISOString()}`);
    
    // 5. Simular parseLastModified (función exacta del código)
    const parseLastModified = (val) => {
      if (!val) return new Date(0);
      
      // Si es número (Excel serial date)
      if (typeof val === 'number') {
        const excelEpoch = new Date(1900, 0, 1);
        const days = val - 2; // Excel cuenta desde 1900-01-01 pero tiene bug del año bisiesto
        return new Date(excelEpoch.getTime() + days * 24 * 60 * 60 * 1000);
      }
      
      // Si es string, intentar parsear
      try {
        // Formato dd/mm/yyyy hh:mm:ss
        const ddmmyyyyRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/;
        const match = String(val).match(ddmmyyyyRegex);
        if (match) {
          const [, day, month, year, hour, minute, second] = match;
          return new Date(year, month - 1, day, hour, minute, second);
        }
        return new Date(val);
      } catch (e) {
        return new Date(0);
      }
    };
    
    const remoteLastModified = parseLastModified(lastModifiedSheets);
    console.log(`📊 Timestamp remoto parseado:`);
    console.log(`   remoteLastModified: ${remoteLastModified.toISOString()}`);
    
    // 6. Comparar timestamps (lógica exacta del código)
    console.log(`\n📊 COMPARACIÓN DE TIMESTAMPS:`);
    console.log(`   Local:  ${localLastEdit.toISOString()}`);
    console.log(`   Remote: ${remoteLastModified.toISOString()}`);
    console.log(`   Local > Remote: ${localLastEdit > remoteLastModified}`);
    console.log(`   Diferencia (minutos): ${Math.round((localLastEdit - remoteLastModified) / (1000 * 60))}`);
    
    if (localLastEdit > remoteLastModified) {
      console.log('✅ DEBERÍA detectarse como UPDATE');
      console.log('💡 DEBERÍA estar en confirmedIds');
    } else {
      console.log('❌ NO se detecta como UPDATE');
      console.log('💡 Local NO es más nuevo que Remote');
      console.log('💡 POR ESO no está en confirmedIds');
      console.log('💡 POR ESO pushDetallesLocalesASheets NO se ejecuta');
    }
    
    // 7. Verificar si existe en Sheets (para detectar INSERT vs UPDATE)
    console.log(`\n📊 VERIFICACIÓN DE EXISTENCIA EN SHEETS:`);
    console.log(`   ¿Existe en Sheets? ${!!presupuestoEnSheets}`);
    
    if (presupuestoEnSheets && !(localLastEdit > remoteLastModified)) {
      console.log('🎯 PROBLEMA IDENTIFICADO:');
      console.log('   - El presupuesto EXISTE en Sheets');
      console.log('   - Pero Local NO es más nuevo que Remote');
      console.log('   - Por eso NO se detecta como UPDATE');
      console.log('   - Por eso NO se incluye en confirmedIds');
      console.log('   - Por eso pushDetallesLocalesASheets NO se ejecuta');
      console.log('   - Por eso el MAP NO se crea');
    }
    
  } catch (error) {
    console.error('❌ Error en diagnóstico:', error.message);
  } finally {
    await pool.end();
  }
}

diagnosticoTimestamp().catch(console.error);
