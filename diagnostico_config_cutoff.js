/**
 * DIAGNÓSTICO CRÍTICO - CONFIGURACIÓN Y CUTOFF_AT
 * Verifica por qué la sincronización manual está fallando
 */

const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost', 
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function diagnosticoCompleto() {
  try {
    console.log('🔍 [DIAG-CRÍTICO] ===== INICIANDO DIAGNÓSTICO COMPLETO =====');
    
    // 1. Verificar si existe la tabla presupuestos_config
    console.log('\n📋 [DIAG] PASO 1: Verificando tabla presupuestos_config...');
    
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'presupuestos_config'
      );
    `);
    
    console.log('📋 [DIAG] Tabla presupuestos_config existe:', tableExists.rows[0].exists);
    
    if (!tableExists.rows[0].exists) {
      console.log('❌ [DIAG] PROBLEMA CRÍTICO: Tabla presupuestos_config NO EXISTE');
      console.log('💡 [DIAG] SOLUCIÓN: Crear tabla presupuestos_config con cutoff_at');
      return;
    }
    
    // 2. Verificar estructura de la tabla
    console.log('\n📋 [DIAG] PASO 2: Verificando estructura de presupuestos_config...');
    
    const columns = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'presupuestos_config' 
      ORDER BY ordinal_position;
    `);
    
    console.log('📋 [DIAG] Columnas encontradas:');
    columns.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    });
    
    // 3. Verificar si existe cutoff_at
    const hasCutoffAt = columns.rows.some(col => col.column_name === 'cutoff_at');
    console.log('\n📋 [DIAG] Campo cutoff_at existe:', hasCutoffAt);
    
    if (!hasCutoffAt) {
      console.log('❌ [DIAG] PROBLEMA CRÍTICO: Campo cutoff_at NO EXISTE');
      console.log('💡 [DIAG] SOLUCIÓN: Agregar columna cutoff_at a presupuestos_config');
      return;
    }
    
    // 4. Verificar configuración activa
    console.log('\n📋 [DIAG] PASO 3: Verificando configuración activa...');
    
    const activeConfig = await pool.query(`
      SELECT * FROM presupuestos_config WHERE activo = true ORDER BY id DESC LIMIT 1;
    `);
    
    console.log('📋 [DIAG] Configuraciones activas encontradas:', activeConfig.rowCount);
    
    if (activeConfig.rowCount === 0) {
      console.log('❌ [DIAG] PROBLEMA CRÍTICO: NO HAY CONFIGURACIÓN ACTIVA');
      console.log('💡 [DIAG] SOLUCIÓN: Crear configuración activa con cutoff_at');
      return;
    }
    
    const config = activeConfig.rows[0];
    console.log('📋 [DIAG] Configuración activa encontrada:');
    console.log('  - ID:', config.id);
    console.log('  - hoja_id:', config.hoja_id);
    console.log('  - hoja_nombre:', config.hoja_nombre);
    console.log('  - cutoff_at:', config.cutoff_at);
    console.log('  - usuario_id:', config.usuario_id);
    console.log('  - activo:', config.activo);
    
    // 5. Verificar si cutoff_at está configurado
    if (!config.cutoff_at) {
      console.log('❌ [DIAG] PROBLEMA CRÍTICO: cutoff_at es NULL');
      console.log('💡 [DIAG] SOLUCIÓN: Configurar cutoff_at con fecha válida');
      
      // Sugerir fecha cutoff_at (7 días atrás)
      const cutoffSugerido = new Date(Date.now() - 7*24*60*60*1000);
      console.log('💡 [DIAG] Fecha cutoff_at sugerida:', cutoffSugerido.toISOString());
      return;
    }
    
    console.log('✅ [DIAG] cutoff_at configurado:', config.cutoff_at.toISOString());
    
    // 6. Verificar presupuestos modificados después del cutoff_at
    console.log('\n📋 [DIAG] PASO 4: Verificando presupuestos modificados...');
    
    const presupuestosModificados = await pool.query(`
      SELECT 
        p.id_presupuesto_ext,
        p.fecha_actualizacion,
        p.fecha_actualizacion >= $1 as pasa_cutoff,
        COUNT(d.id) as total_detalles
      FROM public.presupuestos p
      LEFT JOIN public.presupuestos_detalles d ON d.id_presupuesto = p.id
      WHERE p.activo = true 
        AND p.id_presupuesto_ext IS NOT NULL
      GROUP BY p.id_presupuesto_ext, p.fecha_actualizacion
      ORDER BY p.fecha_actualizacion DESC
      LIMIT 10
    `, [config.cutoff_at]);
    
    console.log('📋 [DIAG] Total presupuestos activos:', presupuestosModificados.rowCount);
    
    const presupuestosQuePasanCutoff = presupuestosModificados.rows.filter(p => p.pasa_cutoff);
    console.log('📋 [DIAG] Presupuestos que pasan cutoff_at:', presupuestosQuePasanCutoff.length);
    
    if (presupuestosQuePasanCutoff.length === 0) {
      console.log('⚠️ [DIAG] PROBLEMA: No hay presupuestos modificados después del cutoff_at');
      console.log('💡 [DIAG] POSIBLES CAUSAS:');
      console.log('  1. cutoff_at está muy reciente (no hay cambios)');
      console.log('  2. Los triggers de fecha_actualizacion no están funcionando');
      console.log('  3. No se han hecho modificaciones recientes');
      
      // Mostrar los más recientes
      console.log('\n📋 [DIAG] Presupuestos más recientes (independiente del cutoff):');
      presupuestosModificados.rows.slice(0, 5).forEach((p, i) => {
        console.log(`  ${i+1}. ID: ${p.id_presupuesto_ext}`);
        console.log(`     Fecha: ${p.fecha_actualizacion}`);
        console.log(`     Pasa cutoff: ${p.pasa_cutoff}`);
        console.log(`     Detalles: ${p.total_detalles}`);
      });
      
      return;
    }
    
    console.log('✅ [DIAG] Presupuestos modificados encontrados:');
    presupuestosQuePasanCutoff.slice(0, 5).forEach((p, i) => {
      console.log(`  ${i+1}. ID: ${p.id_presupuesto_ext}`);
      console.log(`     Fecha: ${p.fecha_actualizacion}`);
      console.log(`     Detalles: ${p.total_detalles}`);
    });
    
    // 7. Verificar query exacto que usa la sincronización
    console.log('\n📋 [DIAG] PASO 5: Probando query exacto de sincronización...');
    
    const querySync = `
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
      LIMIT 5
    `;
    
    const syncResult = await pool.query(querySync, [config.cutoff_at]);
    
    console.log('📋 [DIAG] Query de sincronización encontró:', syncResult.rowCount, 'presupuestos');
    
    if (syncResult.rowCount === 0) {
      console.log('❌ [DIAG] PROBLEMA CRÍTICO: Query de sincronización no encuentra presupuestos');
      console.log('💡 [DIAG] POSIBLE CAUSA: Problema en el query HAVING o en los JOINs');
    } else {
      console.log('✅ [DIAG] Query de sincronización funciona correctamente:');
      syncResult.rows.forEach((p, i) => {
        console.log(`  ${i+1}. ID: ${p.id}, local_last_edit: ${p.local_last_edit}`);
      });
    }
    
    // 8. Verificar triggers de fecha_actualizacion
    console.log('\n📋 [DIAG] PASO 6: Verificando triggers de fecha_actualizacion...');
    
    const triggers = await pool.query(`
      SELECT 
        trigger_name, 
        event_manipulation, 
        action_timing,
        action_statement
      FROM information_schema.triggers 
      WHERE event_object_table IN ('presupuestos', 'presupuestos_detalles')
        AND trigger_name LIKE '%fecha_actualizacion%'
      ORDER BY event_object_table, trigger_name;
    `);
    
    console.log('📋 [DIAG] Triggers de fecha_actualizacion encontrados:', triggers.rowCount);
    
    if (triggers.rowCount === 0) {
      console.log('❌ [DIAG] PROBLEMA CRÍTICO: No hay triggers de fecha_actualizacion');
      console.log('💡 [DIAG] SOLUCIÓN: Crear triggers para actualizar fecha_actualizacion automáticamente');
    } else {
      console.log('✅ [DIAG] Triggers encontrados:');
      triggers.rows.forEach((t, i) => {
        console.log(`  ${i+1}. ${t.trigger_name} (${t.event_manipulation} ${t.action_timing})`);
      });
    }
    
    console.log('\n🔍 [DIAG-CRÍTICO] ===== DIAGNÓSTICO COMPLETADO =====');
    
  } catch (error) {
    console.error('❌ [DIAG] Error crítico:', error.message);
    console.error('❌ [DIAG] Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

// Ejecutar diagnóstico
diagnosticoCompleto().catch(console.error);
