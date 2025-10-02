// DIAGNÓSTICO ESPECÍFICO: ¿Por qué no se carga el MAP?
// Simula exactamente el flujo de sincronización para entender el problema

const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function diagnosticarLogicaMap() {
  console.log('🔍 [DIAG-MAP] === DIAGNÓSTICO DE LÓGICA DE MAP ===');
  
  try {
    // 1. Verificar presupuesto específico a11756ae
    console.log('\n📊 [DIAG-MAP] === ANÁLISIS DEL PRESUPUESTO a11756ae ===');
    
    const presupuestoEspecifico = await pool.query(`
      SELECT p.id_presupuesto_ext, p.hoja_nombre, p.fecha_actualizacion,
             COUNT(d.id) as count_detalles,
             COUNT(m.local_detalle_id) as count_map,
             COALESCE(SUM(d.cantidad),0) as sum_cantidad,
             COALESCE(SUM(d.valor1),0) as sum_valor1,
             COALESCE(SUM(d.precio1),0) as sum_precio1,
             COALESCE(SUM(d.iva1),0) as sum_iva1
      FROM presupuestos p
      LEFT JOIN presupuestos_detalles d ON d.id_presupuesto_ext = p.id_presupuesto_ext
      LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
      WHERE p.id_presupuesto_ext = 'a11756ae'
      GROUP BY p.id_presupuesto_ext, p.hoja_nombre, p.fecha_actualizacion
    `);
    
    if (presupuestoEspecifico.rowCount === 0) {
      console.log('❌ Presupuesto a11756ae no encontrado');
      return;
    }
    
    const p = presupuestoEspecifico.rows[0];
    console.log('📊 DATOS DEL PRESUPUESTO:');
    console.log(`   ID: ${p.id_presupuesto_ext}`);
    console.log(`   hoja_nombre: ${p.hoja_nombre}`);
    console.log(`   fecha_actualizacion: ${p.fecha_actualizacion}`);
    console.log(`   count_detalles: ${p.count_detalles}`);
    console.log(`   count_map: ${p.count_map}`);
    console.log(`   sum_cantidad: ${p.sum_cantidad}`);
    console.log(`   sum_valor1: ${p.sum_valor1}`);
    console.log(`   sum_precio1: ${p.sum_precio1}`);
    console.log(`   sum_iva1: ${p.sum_iva1}`);
    
    // 2. Verificar condiciones HAVING de la query corregida
    console.log('\n🔍 [DIAG-MAP] === VERIFICACIÓN DE CONDICIONES HAVING ===');
    
    const sinDetalles = p.count_detalles == 0;
    const detallesVacios = (p.count_detalles > 0 && 
                           p.sum_cantidad == 0 && 
                           p.sum_valor1 == 0 && 
                           p.sum_precio1 == 0 && 
                           p.sum_iva1 == 0);
    const sinMap = (p.count_detalles > 0 && p.count_map == 0);
    
    console.log('🔍 CONDICIONES:');
    console.log(`   1. sin_detalles (COUNT(d.id) = 0): ${sinDetalles}`);
    console.log(`   2. detalles_vacios: ${detallesVacios}`);
    console.log(`      - count_detalles > 0: ${p.count_detalles > 0}`);
    console.log(`      - sum_cantidad = 0: ${p.sum_cantidad == 0}`);
    console.log(`      - sum_valor1 = 0: ${p.sum_valor1 == 0}`);
    console.log(`      - sum_precio1 = 0: ${p.sum_precio1 == 0}`);
    console.log(`      - sum_iva1 = 0: ${p.sum_iva1 == 0}`);
    console.log(`   3. sin_map (COUNT(d.id) > 0 AND COUNT(m.local_detalle_id) = 0): ${sinMap}`);
    console.log(`      - count_detalles > 0: ${p.count_detalles > 0}`);
    console.log(`      - count_map = 0: ${p.count_map == 0}`);
    
    const deberiaDetectarse = sinDetalles || detallesVacios || sinMap;
    console.log(`\n✅ RESULTADO: DEBERÍA DETECTARSE = ${deberiaDetectarse}`);
    
    if (!deberiaDetectarse) {
      console.log('❌ PROBLEMA: El presupuesto NO cumple ninguna condición HAVING');
      console.log('💡 Esto explica por qué no se ejecuta syncDetallesDesdeSheets()');
    }
    
    // 3. Simular la query exacta que usa el código
    console.log('\n🧪 [DIAG-MAP] === SIMULANDO QUERY EXACTA DEL CÓDIGO ===');
    
    // Simular que tenemos idsConDetallesRecientes = ['a11756ae']
    const queryExacta = await pool.query(`
      SELECT p.id_presupuesto_ext
      FROM public.presupuestos p
      LEFT JOIN public.presupuestos_detalles d
      ON d.id_presupuesto_ext = p.id_presupuesto_ext
      LEFT JOIN public.presupuestos_detalles_map m
      ON m.local_detalle_id = d.id
      WHERE p.activo = true
      AND p.id_presupuesto_ext = ANY($1::text[])
      GROUP BY p.id_presupuesto_ext
      HAVING COUNT(d.id) = 0
          OR (
                  COUNT(d.id) > 0
              AND COALESCE(SUM(d.cantidad),0) = 0
              AND COALESCE(SUM(d.valor1),0)   = 0
              AND COALESCE(SUM(d.precio1),0)  = 0
              AND COALESCE(SUM(d.iva1),0)     = 0
          )
          OR (
                  COUNT(d.id) > 0
              AND COUNT(m.local_detalle_id) = 0
          )
    `, [['a11756ae']]);
    
    console.log(`📊 RESULTADO DE QUERY EXACTA: ${queryExacta.rowCount} filas`);
    
    if (queryExacta.rowCount > 0) {
      console.log('✅ ÉXITO: La query SÍ detecta el presupuesto a11756ae');
      console.log('💡 El problema debe estar en otra parte del flujo');
    } else {
      console.log('❌ PROBLEMA: La query NO detecta el presupuesto a11756ae');
      console.log('💡 Hay un error en la lógica de la query');
    }
    
    // 4. Verificar detalles específicos del presupuesto
    console.log('\n📋 [DIAG-MAP] === DETALLES ESPECÍFICOS DEL PRESUPUESTO ===');
    
    const detallesEspecificos = await pool.query(`
      SELECT d.id, d.articulo, d.cantidad, d.valor1, d.precio1, d.iva1,
             m.local_detalle_id, m.id_detalle_presupuesto, m.fuente
      FROM presupuestos_detalles d
      LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
      WHERE d.id_presupuesto_ext = 'a11756ae'
      ORDER BY d.id
    `);
    
    console.log(`📊 Detalles encontrados: ${detallesEspecificos.rowCount}`);
    detallesEspecificos.rows.forEach((d, i) => {
      console.log(`   ${i+1}. ID=${d.id} art=${d.articulo}`);
      console.log(`      cantidad=${d.cantidad} valor1=${d.valor1} precio1=${d.precio1} iva1=${d.iva1}`);
      console.log(`      MAP: local_detalle_id=${d.local_detalle_id} id_detalle_presupuesto=${d.id_detalle_presupuesto} fuente=${d.fuente}`);
    });
    
    // 5. Verificar si el presupuesto está en idsCambiados
    console.log('\n🔍 [DIAG-MAP] === ¿ESTÁ EN idsCambiados? ===');
    
    console.log('💡 LÓGICA DE idsCambiados:');
    console.log('   - Se agrega cuando se crea un presupuesto nuevo desde Sheets');
    console.log('   - Se agrega cuando se actualiza un presupuesto desde Sheets');
    console.log('   - Si el presupuesto ya existía y no se modificó, NO está en idsCambiados');
    
    console.log('\n🎯 [DIAG-MAP] === CONCLUSIÓN PRELIMINAR ===');
    console.log('   Si a11756ae tiene detalles pero no MAP, significa que:');
    console.log('   1. ✅ Se creó el presupuesto en local (primera sync)');
    console.log('   2. ✅ Se crearon los detalles en local (primera sync)');
    console.log('   3. ❌ NO se creó el MAP (falla en primera sync)');
    console.log('   4. ❌ En syncs posteriores, NO se detecta porque no está en idsCambiados');
    console.log('   5. ❌ Tampoco se detecta en idsSinDetallesLocal porque SÍ tiene detalles');
    
    console.log('\n💡 [DIAG-MAP] === SOLUCIÓN NECESARIA ===');
    console.log('   La query corregida DEBERÍA detectar presupuestos con detalles pero sin MAP');
    console.log('   Si no funciona, hay que revisar por qué no se ejecuta syncDetallesDesdeSheets()');
    
  } catch (error) {
    console.error('❌ [DIAG-MAP] Error:', error.message);
  } finally {
    await pool.end();
  }
}

// Ejecutar diagnóstico
diagnosticarLogicaMap().catch(console.error);
