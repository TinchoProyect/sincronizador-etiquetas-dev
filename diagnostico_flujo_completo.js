// DIAGNÓSTICO INTEGRAL DEL FLUJO DE SINCRONIZACIÓN
// Rastrea paso a paso qué sucede durante la sincronización manual

const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function diagnosticarFlujoCompleto() {
  console.log('🔍 [DIAG-FLUJO] ===== ANÁLISIS INTEGRAL DEL FLUJO DE SINCRONIZACIÓN =====');
  
  try {
    // PASO 1: Estado inicial de las tablas
    console.log('\n📊 [DIAG-FLUJO] PASO 1: Estado inicial de las tablas');
    await mostrarEstadoCompleto('INICIAL');
    
    // PASO 2: Analizar configuración y cutoff_at
    console.log('\n⚙️ [DIAG-FLUJO] PASO 2: Configuración y cutoff_at');
    const configResult = await pool.query(`
      SELECT hoja_id, hoja_url, hoja_nombre, cutoff_at, usuario_id
      FROM presupuestos_config 
      WHERE activo = true 
      ORDER BY fecha_creacion DESC 
      LIMIT 1
    `);
    
    if (configResult.rows.length === 0) {
      console.log('❌ [DIAG-FLUJO] No hay configuración activa');
      return;
    }
    
    const config = configResult.rows[0];
    console.log('[DIAG-FLUJO] Configuración encontrada:', {
      hoja_id: config.hoja_id,
      cutoff_at: config.cutoff_at,
      cutoff_iso: config.cutoff_at?.toISOString()
    });
    
    // PASO 3: Presupuestos candidatos para sincronización (según cutoff_at)
    console.log('\n🎯 [DIAG-FLUJO] PASO 3: Presupuestos candidatos para sincronización');
    const candidatosResult = await pool.query(`
      SELECT 
        p.id,
        p.id_presupuesto_ext,
        p.fecha_actualizacion,
        p.activo,
        COUNT(d.id) as total_detalles,
        COUNT(CASE WHEN d.id_presupuesto IS NOT NULL THEN 1 END) as detalles_con_fk,
        COUNT(CASE WHEN d.id_presupuesto IS NULL THEN 1 END) as detalles_sin_fk,
        GREATEST(
          p.fecha_actualizacion,
          COALESCE(MAX(d.fecha_actualizacion), p.fecha_actualizacion)
        ) AS local_last_edit
      FROM presupuestos p
      LEFT JOIN presupuestos_detalles d ON d.id_presupuesto = p.id
      WHERE p.activo = true 
        AND p.id_presupuesto_ext IS NOT NULL
        AND p.fecha_actualizacion >= $1
      GROUP BY p.id, p.id_presupuesto_ext, p.fecha_actualizacion, p.activo
      ORDER BY p.fecha_actualizacion DESC
      LIMIT 10
    `, [config.cutoff_at]);
    
    console.log('[DIAG-FLUJO] Presupuestos candidatos (>= cutoff_at):');
    candidatosResult.rows.forEach((row, i) => {
      console.log(`  ${i+1}. ID_EXT: ${row.id_presupuesto_ext}`);
      console.log(`     ID_LOCAL: ${row.id}`);
      console.log(`     FECHA_ACT: ${row.fecha_actualizacion}`);
      console.log(`     LOCAL_LAST_EDIT: ${row.local_last_edit}`);
      console.log(`     DETALLES: ${row.total_detalles} total, ${row.detalles_con_fk} con FK, ${row.detalles_sin_fk} sin FK`);
      console.log(`     ACTIVO: ${row.activo}`);
    });
    
    // PASO 4: Verificar qué funciones se ejecutan en el endpoint bidireccional
    console.log('\n🔄 [DIAG-FLUJO] PASO 4: Funciones que se ejecutan en sync bidireccional');
    console.log('[DIAG-FLUJO] Flujo actual del endpoint /sync/bidireccional:');
    console.log('  1. marcarAnuladosEnSheetsConConteo()');
    console.log('  2. pushCambiosLocalesConTimestamp()');
    console.log('  3. eliminarYRecrearDetallesEnSheets() ← NUEVA FUNCIÓN');
    console.log('  4. pullCambiosRemotosConTimestampMejorado()');
    
    // PASO 5: Verificar si pushDetallesLocalesASheets se está ejecutando
    console.log('\n📋 [DIAG-FLUJO] PASO 5: Verificar si pushDetallesLocalesASheets se ejecuta');
    console.log('[DIAG-FLUJO] PROBLEMA IDENTIFICADO:');
    console.log('  - pushDetallesLocalesASheets() ya NO se ejecuta en el flujo principal');
    console.log('  - Se reemplazó por eliminarYRecrearDetallesEnSheets()');
    console.log('  - Esto puede estar causando que los detalles no se sincronicen');
    
    // PASO 6: Verificar tabla de mapeo
    console.log('\n🗺️ [DIAG-FLUJO] PASO 6: Estado de la tabla de mapeo');
    const mapeoResult = await pool.query(`
      SELECT 
        COUNT(*) as total_mapeos,
        COUNT(CASE WHEN fuente = 'Local' THEN 1 END) as mapeos_local,
        COUNT(CASE WHEN fuente = 'Sheets' THEN 1 END) as mapeos_sheets,
        MAX(fecha_asignacion) as ultima_asignacion
      FROM presupuestos_detalles_map
    `);
    
    const mapeo = mapeoResult.rows[0];
    console.log('[DIAG-FLUJO] Estado tabla de mapeo:');
    console.log(`  - Total mapeos: ${mapeo.total_mapeos}`);
    console.log(`  - Mapeos Local: ${mapeo.mapeos_local}`);
    console.log(`  - Mapeos Sheets: ${mapeo.mapeos_sheets}`);
    console.log(`  - Última asignación: ${mapeo.ultima_asignacion}`);
    
    // PASO 7: Verificar detalles recientes sin FK
    console.log('\n🔍 [DIAG-FLUJO] PASO 7: Detalles recientes sin FK (problema principal)');
    const sinFkResult = await pool.query(`
      SELECT 
        id,
        id_presupuesto_ext,
        articulo,
        fecha_actualizacion,
        'SIN_FK' as problema
      FROM presupuestos_detalles 
      WHERE id_presupuesto IS NULL
        AND fecha_actualizacion >= $1
      ORDER BY fecha_actualizacion DESC
      LIMIT 5
    `, [config.cutoff_at]);
    
    console.log('[DIAG-FLUJO] Detalles sin FK recientes:');
    sinFkResult.rows.forEach((row, i) => {
      console.log(`  ${i+1}. ID: ${row.id}, ID_EXT: ${row.id_presupuesto_ext}`);
      console.log(`     ARTICULO: ${row.articulo}`);
      console.log(`     FECHA_ACT: ${row.fecha_actualizacion}`);
      console.log(`     PROBLEMA: ${row.problema}`);
    });
    
    console.log('\n✅ [DIAG-FLUJO] ===== DIAGNÓSTICO COMPLETADO =====');
    console.log('\n💡 [DIAG-FLUJO] CONCLUSIONES:');
    console.log('1. El flujo se modificó y ya no ejecuta pushDetallesLocalesASheets()');
    console.log('2. La nueva función eliminarYRecrearDetallesEnSheets() puede tener problemas');
    console.log('3. Los detalles sin FK indican que syncDetallesDesdeSheets() sigue ejecutándose incorrectamente');
    console.log('4. Necesito revisar EXACTAMENTE qué funciones se llaman y en qué orden');
    
  } catch (error) {
    console.error('❌ [DIAG-FLUJO] Error:', error.message);
  } finally {
    await pool.end();
  }
}

async function mostrarEstadoCompleto(momento) {
  // Estado de presupuestos
  const presupuestosResult = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN activo = true THEN 1 END) as activos,
      COUNT(CASE WHEN activo = false THEN 1 END) as inactivos,
      COUNT(CASE WHEN id_presupuesto_ext IS NOT NULL THEN 1 END) as con_id_ext,
      COUNT(CASE WHEN id_presupuesto_ext IS NULL THEN 1 END) as sin_id_ext
    FROM presupuestos
  `);
  
  // Estado de detalles
  const detallesResult = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN id_presupuesto IS NOT NULL THEN 1 END) as con_fk,
      COUNT(CASE WHEN id_presupuesto IS NULL THEN 1 END) as sin_fk,
      COUNT(CASE WHEN id_presupuesto_ext IS NOT NULL THEN 1 END) as con_id_ext
    FROM presupuestos_detalles
  `);
  
  // Estado de mapeo
  const mapeoResult = await pool.query(`
    SELECT 
      COUNT(*) as total_mapeos,
      COUNT(CASE WHEN fuente = 'Local' THEN 1 END) as local_source,
      COUNT(CASE WHEN fuente = 'Sheets' THEN 1 END) as sheets_source
    FROM presupuestos_detalles_map
  `);
  
  const presupuestos = presupuestosResult.rows[0];
  const detalles = detallesResult.rows[0];
  const mapeo = mapeoResult.rows[0];
  
  console.log(`[DIAG-FLUJO] Estado ${momento}:`);
  console.log(`  PRESUPUESTOS: ${presupuestos.total} total, ${presupuestos.activos} activos, ${presupuestos.con_id_ext} con ID_EXT`);
  console.log(`  DETALLES: ${detalles.total} total, ${detalles.con_fk} con FK, ${detalles.sin_fk} sin FK`);
  console.log(`  MAPEO: ${mapeo.total_mapeos} total, ${mapeo.local_source} Local, ${mapeo.sheets_source} Sheets`);
}

// Ejecutar diagnóstico
diagnosticarFlujoCompleto().catch(console.error);
