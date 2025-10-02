const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function checkSyncConfig() {
  try {
    console.log('🔍 Verificando configuración de sincronización activa...\n');

    // Obtener configuración activa
    const configQuery = `
      SELECT id, hoja_url, hoja_id, hoja_nombre, rango, activo, usuario_id
      FROM presupuestos_config
      WHERE activo = true
      ORDER BY id DESC
      LIMIT 1
    `;

    const configResult = await pool.query(configQuery);

    if (configResult.rows.length === 0) {
      console.log('❌ No hay configuración de sincronización activa');
      return;
    }

    const config = configResult.rows[0];
    console.log('✅ Configuración encontrada:');
    console.log(`   ID: ${config.id}`);
    console.log(`   URL: ${config.hoja_url}`);
    console.log(`   Hoja ID: ${config.hoja_id}`);
    console.log(`   Nombre: ${config.hoja_nombre}`);
    console.log(`   Rango: ${config.rango}`);
    console.log(`   Usuario: ${config.usuario_id}`);
    console.log(`   Activo: ${config.activo}`);

    // Verificar si hay presupuestos recientes
    console.log('\n📅 Presupuestos con fecha reciente (últimos 7 días):');
    const recientesQuery = `
      SELECT id_presupuesto_ext, fecha, id_cliente, estado
      FROM presupuestos
      WHERE fecha >= CURRENT_DATE - INTERVAL '7 days'
      ORDER BY fecha DESC
      LIMIT 10
    `;

    const recientesResult = await pool.query(recientesQuery);
    recientesResult.rows.forEach(p => {
      console.log(`   ${p.id_presupuesto_ext}: ${p.fecha} (Cliente: ${p.id_cliente}, Estado: ${p.estado})`);
    });

    // Verificar estadísticas de detalles
    console.log('\n📊 Estadísticas de detalles:');
    const statsQuery = `
      SELECT
        COUNT(*) as total_detalles,
        COUNT(DISTINCT id_presupuesto) as presupuestos_con_detalles,
        AVG(cantidad) as cantidad_promedio,
        MAX(fecha_actualizacion) as ultima_actualizacion
      FROM presupuestos_detalles
    `;

    const statsResult = await pool.query(statsQuery);
    const stats = statsResult.rows[0];
    console.log(`   Total detalles: ${stats.total_detalles}`);
    console.log(`   Presupuestos con detalles: ${stats.presupuestos_con_detalles}`);
    console.log(`   Cantidad promedio: ${parseFloat(stats.cantidad_promedio).toFixed(2)}`);
    console.log(`   Última actualización: ${stats.ultima_actualizacion}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkSyncConfig();
