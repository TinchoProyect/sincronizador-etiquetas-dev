const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function checkLogs() {
  try {
    console.log('📝 Verificando logs de sincronización recientes...\n');

    const logsQuery = 'SELECT id, fecha_sync, registros_procesados, registros_nuevos, registros_actualizados, exitoso, errores FROM presupuestos_sync_log ORDER BY fecha_sync DESC LIMIT 5';
    const logsResult = await pool.query(logsQuery);

    console.log('📋 Últimas 5 sincronizaciones:');
    logsResult.rows.forEach((log, i) => {
      console.log(`${i+1}. ID: ${log.id}, Fecha: ${log.fecha_sync}, Procesados: ${log.registros_procesados}, Nuevos: ${log.registros_nuevos}, Exitoso: ${log.exitoso}`);
      if (log.errores) {
        console.log(`   ❌ Errores: ${String(log.errores).substring(0, 100)}...`);
      }
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkLogs();
