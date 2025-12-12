// filepath: src/actualizaPrecios/check-existing-data.js
'use strict';

/**
 * Script para verificar datos existentes en la tabla precios_articulos
 * Revisa si ya hay registros con rubro y sub_rubro de sincronizaciones previas
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'etiquetas',
  password: process.env.DB_PASSWORD || 'ta3Mionga',
  port: parseInt(process.env.DB_PORT || '5432'),
});

console.log('═══════════════════════════════════════════════════════');
console.log('🔍 [CHECK-DATA] VERIFICACIÓN DE DATOS EXISTENTES');
console.log('═══════════════════════════════════════════════════════');
console.log(`🔌 Conectado a BD: ${process.env.DB_NAME || 'etiquetas'}`);
console.log('═══════════════════════════════════════════════════════\n');

async function checkExistingData() {
  let client;

  try {
    client = await pool.connect();

    // 1. Verificar estructura de la tabla
    console.log('🔍 Verificando estructura de la tabla...\n');
    
    const columnsQuery = `
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' 
        AND table_name = 'precios_articulos'
      ORDER BY ordinal_position
    `;
    
    const columnsResult = await client.query(columnsQuery);
    
    console.log('📋 Columnas de la tabla precios_articulos:');
    console.table(columnsResult.rows);

    // Verificar si existen las columnas rubro y sub_rubro
    const tieneRubro = columnsResult.rows.some(col => col.column_name === 'rubro');
    const tieneSubRubro = columnsResult.rows.some(col => col.column_name === 'sub_rubro');

    if (!tieneRubro || !tieneSubRubro) {
      console.log('\n❌ ADVERTENCIA: Las columnas rubro y/o sub_rubro NO EXISTEN');
      console.log('   Necesitas ejecutar:');
      console.log('   ALTER TABLE precios_articulos ADD COLUMN rubro TEXT;');
      console.log('   ALTER TABLE precios_articulos ADD COLUMN sub_rubro TEXT;');
      return;
    }

    console.log('\n✅ Las columnas rubro y sub_rubro existen\n');

    // 2. Contar registros totales
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 ESTADÍSTICAS GENERALES:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const statsQuery = `
      SELECT 
        COUNT(*) as total_registros,
        COUNT(rubro) as registros_con_rubro,
        COUNT(sub_rubro) as registros_con_subrubro,
        COUNT(CASE WHEN rubro IS NOT NULL AND sub_rubro IS NOT NULL THEN 1 END) as registros_completos
      FROM precios_articulos
    `;

    const statsResult = await client.query(statsQuery);
    const stats = statsResult.rows[0];

    console.log(`📦 Total de registros: ${stats.total_registros}`);
    console.log(`✅ Registros con rubro: ${stats.registros_con_rubro} (${((stats.registros_con_rubro / stats.total_registros) * 100).toFixed(1)}%)`);
    console.log(`✅ Registros con sub_rubro: ${stats.registros_con_subrubro} (${((stats.registros_con_subrubro / stats.total_registros) * 100).toFixed(1)}%)`);
    console.log(`✅ Registros completos (ambos campos): ${stats.registros_completos} (${((stats.registros_completos / stats.total_registros) * 100).toFixed(1)}%)`);

    // 3. Mostrar rubros únicos
    if (parseInt(stats.registros_con_rubro) > 0) {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🏷️  RUBROS ÚNICOS ENCONTRADOS:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      const rubrosQuery = `
        SELECT 
          rubro,
          COUNT(*) as cantidad_articulos
        FROM precios_articulos
        WHERE rubro IS NOT NULL
        GROUP BY rubro
        ORDER BY cantidad_articulos DESC
        LIMIT 20
      `;

      const rubrosResult = await client.query(rubrosQuery);
      console.table(rubrosResult.rows);
    }

    // 4. Mostrar sub-rubros únicos
    if (parseInt(stats.registros_con_subrubro) > 0) {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🏷️  SUB-RUBROS ÚNICOS ENCONTRADOS (Top 20):');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      const subRubrosQuery = `
        SELECT 
          sub_rubro,
          COUNT(*) as cantidad_articulos
        FROM precios_articulos
        WHERE sub_rubro IS NOT NULL
        GROUP BY sub_rubro
        ORDER BY cantidad_articulos DESC
        LIMIT 20
      `;

      const subRubrosResult = await client.query(subRubrosQuery);
      console.table(subRubrosResult.rows);
    }

    // 5. Mostrar ejemplos de artículos con rubro y sub_rubro
    if (parseInt(stats.registros_completos) > 0) {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📦 EJEMPLOS DE ARTÍCULOS CON RUBRO Y SUB-RUBRO:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      const ejemplosQuery = `
        SELECT 
          articulo,
          descripcion,
          rubro,
          sub_rubro,
          precio_neg
        FROM precios_articulos
        WHERE rubro IS NOT NULL AND sub_rubro IS NOT NULL
        ORDER BY RANDOM()
        LIMIT 10
      `;

      const ejemplosResult = await client.query(ejemplosQuery);
      console.table(ejemplosResult.rows);
    } else {
      console.log('\n⚠️ No hay registros con rubro y sub_rubro en la base de datos');
      console.log('   Esto significa que:');
      console.log('   1. Nunca se ha ejecutado una sincronización exitosa, O');
      console.log('   2. La API no está enviando estos campos, O');
      console.log('   3. Las columnas se agregaron después de la última sincronización');
    }

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('✅ VERIFICACIÓN COMPLETADA');
    console.log('═══════════════════════════════════════════════════════\n');

    // Conclusión
    if (parseInt(stats.registros_completos) > 0) {
      console.log('✅ CONCLUSIÓN: Los datos de rubro y sub_rubro SÍ están llegando');
      console.log('   La API está enviando estos campos correctamente.');
      console.log('   El script de sincronización modificado funcionará correctamente.\n');
    } else {
      console.log('⚠️ CONCLUSIÓN: No hay datos de rubro y sub_rubro en la BD');
      console.log('   Necesitas ejecutar una sincronización cuando la API esté disponible');
      console.log('   para verificar que los campos lleguen correctamente.\n');
    }

  } catch (error) {
    console.error('\n❌ Error al verificar datos:', error.message);
    console.error('Stack:', error.stack);
    process.exitCode = 1;
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

// Ejecutar verificación
checkExistingData();
