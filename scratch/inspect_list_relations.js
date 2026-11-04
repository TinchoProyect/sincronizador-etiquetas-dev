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
    console.log('--- COLUMNS IN public.bunker_cliente_listas_precios ---');
    const colsJunction = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'bunker_cliente_listas_precios'
      ORDER BY ordinal_position;
    `);
    console.table(colsJunction.rows);

    console.log('\n--- SAMPLE DATA FROM bunker_cliente_listas_precios ---');
    const dataJunction = await client.query(`SELECT * FROM bunker_cliente_listas_precios LIMIT 10;`);
    console.table(dataJunction.rows);

    console.log('\n--- TABLE DDL / SCHEMA OF bunker_cliente_listas_precios ---');
    const ddl = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) 
      FROM pg_constraint 
      WHERE conrelid = 'public.bunker_cliente_listas_precios'::regclass;
    `);
    console.table(ddl.rows);

    console.log('\n--- COLUMNS IN public.clientes (LOMASOFT) ---');
    const colsClientes = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'clientes'
      ORDER BY ordinal_position;
    `);
    console.table(colsClientes.rows);

    console.log('\n--- SAMPLE DATA FROM public.clientes (LOMASOFT) LIMIT 2 ---');
    const dataClientes = await client.query(`SELECT cliente_id, nombre, lista_precios FROM public.clientes LIMIT 2;`);
    console.table(dataClientes.rows);

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

main();
