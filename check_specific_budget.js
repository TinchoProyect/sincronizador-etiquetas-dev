const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function checkSpecificBudget() {
  try {
    console.log('🔍 Verificando presupuesto específico: e835b45d\n');

    // 1. Verificar si el presupuesto existe
    console.log('1️⃣ Buscando presupuesto e835b45d...');
    const presupuestoQuery = `
      SELECT p.id, p.id_presupuesto_ext, p.id_cliente, p.fecha, p.estado, p.activo,
             c.nombre, c.apellido
      FROM presupuestos p
      LEFT JOIN clientes c ON CAST(p.id_cliente AS integer) = c.cliente_id
      WHERE p.id_presupuesto_ext = 'e835b45d'
    `;

    const presupuestoResult = await pool.query(presupuestoQuery);

    if (presupuestoResult.rows.length === 0) {
      console.log('❌ Presupuesto e835b45d NO encontrado en base de datos local');
      console.log('   Esto significa que NO se sincronizó desde Google Sheets');

      // Verificar si hay algún presupuesto con fecha reciente
      console.log('\n🔍 Buscando presupuestos recientes...');
      const recientesQuery = `
        SELECT id_presupuesto_ext, fecha, id_cliente, estado
        FROM presupuestos
        WHERE fecha >= CURRENT_DATE - INTERVAL '7 days'
        ORDER BY fecha DESC
        LIMIT 5
      `;
      const recientesResult = await pool.query(recientesQuery);
      console.log('Presupuestos recientes:');
      recientesResult.rows.forEach(p => {
        console.log(`  - ${p.id_presupuesto_ext}: ${p.fecha} (Cliente: ${p.id_cliente}, Estado: ${p.estado})`);
      });

      return;
    }

    const presupuesto = presupuestoResult.rows[0];
    console.log('✅ Presupuesto encontrado:');
    console.log(`   ID local: ${presupuesto.id}`);
    console.log(`   ID externo: ${presupuesto.id_presupuesto_ext}`);
    console.log(`   Cliente: ${presupuesto.id_cliente} (${presupuesto.nombre} ${presupuesto.apellido || ''})`);
    console.log(`   Fecha: ${presupuesto.fecha}`);
    console.log(`   Estado: ${presupuesto.estado}`);
    console.log(`   Activo: ${presupuesto.activo}`);

    // 2. Verificar detalles del presupuesto
    console.log('\n2️⃣ Buscando detalles del presupuesto...');
    const detallesQuery = `
      SELECT pd.id, pd.id_presupuesto, pd.id_presupuesto_ext, pd.articulo,
             pd.cantidad, pd.valor1, pd.precio1, pd.iva1, pd.diferencia,
             pd.camp1, pd.camp2, pd.camp3, pd.camp4, pd.camp5, pd.camp6,
             pd.fecha_actualizacion
      FROM presupuestos_detalles pd
      WHERE pd.id_presupuesto_ext = 'e835b45d'
      ORDER BY pd.articulo
    `;

    const detallesResult = await pool.query(detallesQuery);
    console.log(`📊 Detalles encontrados: ${detallesResult.rows.length}`);

    if (detallesResult.rows.length > 0) {
      console.log('\n📋 Detalles del presupuesto:');
      detallesResult.rows.forEach((detalle, i) => {
        console.log(`${i+1}. Artículo: ${detalle.articulo}`);
        console.log(`   Cantidad: ${detalle.cantidad}`);
        console.log(`   Valor1: ${detalle.valor1}, Precio1: ${detalle.precio1}`);
        console.log(`   Fecha actualización: ${detalle.fecha_actualizacion}`);
        console.log('');
      });
    } else {
      console.log('❌ No se encontraron detalles para este presupuesto');

      // Verificar si hay detalles con el ID local
      const detallesLocalQuery = `
        SELECT COUNT(*) as total_detalles
        FROM presupuestos_detalles
        WHERE id_presupuesto = ${presupuesto.id}
      `;

      const detallesLocalResult = await pool.query(detallesLocalQuery);
      console.log(`   Detalles con ID local (${presupuesto.id}): ${detallesLocalResult.rows[0].total_detalles}`);
    }

    // 3. Verificar si el cliente existe
    console.log('\n3️⃣ Verificando cliente 583...');
    const clienteQuery = `
      SELECT cliente_id, nombre, apellido
      FROM clientes
      WHERE cliente_id = 583
    `;

    const clienteResult = await pool.query(clienteQuery);

    if (clienteResult.rows.length === 0) {
      console.log('❌ Cliente 583 NO encontrado en tabla clientes');
      console.log('   Esto podría impedir la sincronización del presupuesto');
    } else {
      console.log('✅ Cliente encontrado:', clienteResult.rows[0]);
    }

    // 4. Verificar logs de sincronización recientes
    console.log('\n4️⃣ Últimos logs de sincronización...');
    const logsQuery = `
      SELECT fecha_sync, registros_procesados, registros_nuevos, exitoso, errores
      FROM presupuestos_sync_log
      ORDER BY fecha_sync DESC
      LIMIT 3
    `;

    const logsResult = await pool.query(logsQuery);
    logsResult.rows.forEach((log, i) => {
      console.log(`${i+1}. ${log.fecha_sync}: Procesados ${log.registros_procesados}, Nuevos ${log.registros_nuevos}, Éxito: ${log.exitoso}`);
      if (log.errores) {
        console.log(`   Errores: ${String(log.errores).substring(0, 100)}...`);
      }
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkSpecificBudget();
