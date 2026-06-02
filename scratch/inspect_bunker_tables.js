const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
  });

  await client.connect();
  try {
    const table_vinculos = await client.query(`
      SELECT * FROM bunker_lotes_vinculos LIMIT 10;
    `);
    console.log('bunker_lotes_vinculos sample:');
    console.table(table_vinculos.rows);

    const table_destinos = await client.query(`
      SELECT * FROM bunker_lotes_destinos LIMIT 10;
    `);
    console.log('bunker_lotes_destinos sample:');
    console.table(table_destinos.rows);

    const check_cb60 = await client.query(`
      SELECT * FROM bunker_lotes_vinculos WHERE lote_id_supabase = 'cb60cca3-26a7-4208-b684-1dc08f20ae1e' OR lote_id_supabase LIKE '%cb60cca3%';
    `);
    console.log('Checking CB60CCA3 in bunker_lotes_vinculos:');
    console.table(check_cb60.rows);

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

main();
