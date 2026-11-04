const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
  });

  await client.connect();
  try {
    console.log('--- COLUMNS IN public.factura_cuentas_corrientes ---');
    const colsCC = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'factura_cuentas_corrientes'
      ORDER BY ordinal_position;
    `);
    console.table(colsCC.rows);

    const countCC = await client.query('SELECT COUNT(*) FROM factura_cuentas_corrientes;');
    console.log('Row count:', countCC.rows[0].count);

    console.log('\n--- SAMPLE DATA FROM factura_cuentas_corrientes ---');
    const sampleCC = await client.query('SELECT * FROM factura_cuentas_corrientes LIMIT 3;');
    console.table(sampleCC.rows);

    console.log('\n--- COLUMNS IN public.factura_cuenta_corriente_movimientos ---');
    const colsMov = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'factura_cuenta_corriente_movimientos'
      ORDER BY ordinal_position;
    `);
    console.table(colsMov.rows);

    const countMov = await client.query('SELECT COUNT(*) FROM factura_cuenta_corriente_movimientos;');
    console.log('Row count:', countMov.rows[0].count);

    console.log('\n--- SAMPLE DATA FROM factura_cuenta_corriente_movimientos ---');
    const sampleMov = await client.query('SELECT * FROM factura_cuenta_corriente_movimientos LIMIT 3;');
    console.table(sampleMov.rows);

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

main();
