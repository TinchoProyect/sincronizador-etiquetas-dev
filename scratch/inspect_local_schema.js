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
    console.log('--- TABLES IN DB ---');
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);
    const tables = tablesRes.rows.map(r => r.table_name);
    console.log(tables.filter(t => t.includes('cliente') || t.includes('precio') || t.includes('lista') || t.includes('bunker') || t.includes('lomasoft')));

    console.log('\n--- COLUMNS IN public.clientes ---');
    const colsClientes = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'clientes'
      ORDER BY ordinal_position;
    `);
    console.table(colsClientes.rows);

    console.log('\n--- COLUMNS IN public.bunker_clientes (if exists) ---');
    if (tables.includes('bunker_clientes')) {
      const colsBunkerClientes = await client.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'bunker_clientes'
        ORDER BY ordinal_position;
      `);
      console.table(colsBunkerClientes.rows);
    } else {
      console.log('No bunker_clientes table');
    }

    console.log('\n--- SAMPLE FROM bunker_listas_precios ---');
    if (tables.includes('bunker_listas_precios')) {
      const listsRes = await client.query(`SELECT * FROM bunker_listas_precios;`);
      console.table(listsRes.rows);
    }

    console.log('\n--- SAMPLE FROM bunker_lista_articulos (limit 3) ---');
    if (tables.includes('bunker_lista_articulos')) {
      const listArtRes = await client.query(`SELECT * FROM bunker_lista_articulos LIMIT 3;`);
      console.table(listArtRes.rows);
    }

    console.log('\n--- ANY OTHER LIST TABLES ---');
    const listTables = tables.filter(t => t.includes('list'));
    console.log('List tables:', listTables);

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

main();
