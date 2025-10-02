const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function checkDetails() {
  try {
    console.log('🔍 Verificando detalles en base de datos...\n');

    // Contar total de detalles
    const totalResult = await pool.query('SELECT COUNT(*) as total FROM presupuestos_detalles');
    console.log('📊 Total detalles en BD:', totalResult.rows[0].total);

    // Ver detalles recientes
    const recentQuery = `SELECT pd.id, pd.id_presupuesto, pd.id_presupuesto_ext, pd.articulo, pd.cantidad, pd.fecha_actualizacion, p.id_presupuesto_ext as presupuesto_ext FROM presupuestos_detalles pd JOIN presupuestos p ON pd.id_presupuesto = p.id ORDER BY pd.fecha_actualizacion DESC LIMIT 10`;
    const recentResult = await pool.query(recentQuery);
    console.log('\n📋 Últimos 10 detalles:');
    recentResult.rows.forEach((row, i) => {
      console.log(`${i+1}. ID: ${row.id}, Presupuesto: ${row.presupuesto_ext}, Artículo: ${row.articulo}, Cantidad: ${row.cantidad}, Fecha: ${row.fecha_actualizacion}`);
    });

    // Verificar si hay detalles de presupuestos sincronizados
    const syncResult = await pool.query('SELECT COUNT(*) as sync_details FROM presupuestos_detalles pd JOIN presupuestos p ON pd.id_presupuesto = p.id WHERE p.id_presupuesto_ext IS NOT NULL');
    console.log('\n🔄 Detalles de presupuestos sincronizados:', syncResult.rows[0].sync_details);

    // Verificar presupuestos sin detalles
    const orphanQuery = `SELECT COUNT(*) as presupuestos_sin_detalles FROM presupuestos p LEFT JOIN presupuestos_detalles pd ON p.id = pd.id_presupuesto WHERE pd.id IS NULL AND p.activo = true`;
    const orphanResult = await pool.query(orphanQuery);
    console.log('⚠️ Presupuestos sin detalles:', orphanResult.rows[0].presupuestos_sin_detalles);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkDetails();
