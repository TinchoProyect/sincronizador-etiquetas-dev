// DIAGNÓSTICO ESPECÍFICO DE pushDetallesLocalesASheets
// Verificar por qué no se está creando el MAP correctamente

const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function diagnosticoPushDetalles() {
  try {
    console.log('🔍 DIAGNÓSTICO ESPECÍFICO DE pushDetallesLocalesASheets');
    console.log('='.repeat(60));
    
    // 1. Verificar el presupuesto problemático
    const presupuestoProblema = 'mg0pvssq-s4yqj';
    
    console.log(`\n📊 1. ANÁLISIS DEL PRESUPUESTO PROBLEMÁTICO: ${presupuestoProblema}`);
    
    const presupuesto = await pool.query(`
      SELECT id_presupuesto_ext, hoja_nombre, fecha_actualizacion, activo
      FROM presupuestos 
      WHERE id_presupuesto_ext = $1
    `, [presupuestoProblema]);
    
    if (presupuesto.rowCount === 0) {
      console.log('❌ Presupuesto no encontrado en BD local');
      return;
    }
    
    const p = presupuesto.rows[0];
    console.log('📋 Datos del presupuesto:');
    console.log(`   id_presupuesto_ext: ${p.id_presupuesto_ext}`);
    console.log(`   hoja_nombre: ${p.hoja_nombre}`);
    console.log(`   fecha_actualizacion: ${p.fecha_actualizacion}`);
    console.log(`   activo: ${p.activo}`);
    
    // 2. Verificar detalles del presupuesto
    console.log(`\n📊 2. DETALLES DEL PRESUPUESTO ${presupuestoProblema}:`);
    
    const detalles = await pool.query(`
      SELECT d.id, d.articulo, d.cantidad, d.valor1, d.precio1, d.fecha_actualizacion,
             m.id_detalle_presupuesto, m.fuente, m.fecha_asignacion
      FROM presupuestos_detalles d
      LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
      WHERE d.id_presupuesto_ext = $1
      ORDER BY d.id
    `, [presupuestoProblema]);
    
    console.log(`📋 Detalles encontrados: ${detalles.rowCount}`);
    detalles.rows.forEach((d, i) => {
      console.log(`   ${i+1}. Detalle ID ${d.id}:`);
      console.log(`      Artículo: ${d.articulo}`);
      console.log(`      Cantidad: ${d.cantidad}, Valor1: ${d.valor1}, Precio1: ${d.precio1}`);
      console.log(`      Fecha actualización: ${d.fecha_actualizacion}`);
      console.log(`      MAP: ${d.id_detalle_presupuesto ? `✅ ${d.id_detalle_presupuesto} (${d.fuente})` : '❌ SIN MAP'}`);
    });
    
    // 3. Simular la lógica de detección de fuente
    console.log(`\n📊 3. SIMULACIÓN DE DETECCIÓN DE FUENTE:`);
    
    const fuenteResult = await pool.query(`
      SELECT hoja_nombre FROM public.presupuestos 
      WHERE id_presupuesto_ext = $1
    `, [presupuestoProblema]);
    
    console.log(`📋 Query de fuente:`);
    console.log(`   rowCount: ${fuenteResult.rowCount}`);
    if (fuenteResult.rowCount > 0) {
      const hoja_nombre = fuenteResult.rows[0].hoja_nombre;
      console.log(`   hoja_nombre: "${hoja_nombre}"`);
      console.log(`   hoja_nombre truthy: ${!!hoja_nombre}`);
      
      const fuente = (fuenteResult.rowCount > 0 && hoja_nombre) ? 'Sheets' : 'Local';
      console.log(`   🎯 FUENTE DETECTADA: "${fuente}"`);
      
      if (fuente === 'Sheets') {
        console.log('✅ CORRECTO: Debería usar fuente="Sheets"');
      } else {
        console.log('❌ PROBLEMA: Debería detectar fuente="Sheets" pero detecta "Local"');
      }
    }
    
    // 4. Verificar si pushDetallesLocalesASheets se está llamando
    console.log(`\n📊 4. VERIFICACIÓN DE LLAMADAS A pushDetallesLocalesASheets:`);
    
    // Verificar cutoff_at actual
    const config = await pool.query(`
      SELECT cutoff_at FROM presupuestos_config WHERE activo = true ORDER BY id DESC LIMIT 1
    `);
    
    const cutoffAt = config.rows[0]?.cutoff_at;
    console.log(`📋 cutoff_at actual: ${cutoffAt}`);
    
    // Verificar si el presupuesto pasaría el filtro para ser incluido en confirmedIds
    const pasaCutoff = new Date(p.fecha_actualizacion) >= new Date(cutoffAt);
    console.log(`📋 ¿Pasa filtro cutoff_at? ${pasaCutoff}`);
    
    if (!pasaCutoff) {
      console.log('❌ PROBLEMA: El presupuesto NO pasa el filtro cutoff_at');
      console.log('💡 Por eso pushDetallesLocalesASheets NO se ejecuta para este presupuesto');
      console.log('💡 SOLUCIÓN: Necesitamos que se ejecute independientemente del cutoff_at');
    } else {
      console.log('✅ El presupuesto SÍ pasa el filtro cutoff_at');
      console.log('💡 pushDetallesLocalesASheets DEBERÍA ejecutarse');
    }
    
    // 5. Verificar logs de sincronización recientes
    console.log(`\n📊 5. LOGS DE SINCRONIZACIÓN RECIENTES:`);
    
    const logs = await pool.query(`
      SELECT fecha_sync, exitoso, registros_procesados, tipo_sync, detalles
      FROM presupuestos_sync_log
      ORDER BY fecha_sync DESC
      LIMIT 3
    `);
    
    console.log(`📋 Últimas sincronizaciones:`);
    logs.rows.forEach((log, i) => {
      console.log(`   ${i+1}. ${log.fecha_sync}:`);
      console.log(`      Exitoso: ${log.exitoso}`);
      console.log(`      Procesados: ${log.registros_procesados}`);
      console.log(`      Tipo: ${log.tipo_sync}`);
      console.log(`      Detalles: ${log.detalles ? JSON.stringify(JSON.parse(log.detalles), null, 2) : 'N/A'}`);
    });
    
    console.log('\n🎯 CONCLUSIÓN:');
    console.log('1. Verificar si pushDetallesLocalesASheets se está ejecutando');
    console.log('2. Si se ejecuta, verificar por qué no crea el MAP');
    console.log('3. Si no se ejecuta, verificar por qué no se incluye en confirmedIds');
    
  } catch (error) {
    console.error('❌ Error en diagnóstico:', error.message);
  } finally {
    await pool.end();
  }
}

diagnosticoPushDetalles().catch(console.error);
