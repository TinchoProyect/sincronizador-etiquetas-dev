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
    const resBunker = await client.query('SELECT count(*) FROM bunker_articulos');
    const resIng = await client.query('SELECT count(*) FROM ingredientes');
    console.log('Bunker articles count:', resBunker.rows[0].count);
    console.log('Ingredients count:', resIng.rows[0].count);
  } catch(e) {
    console.error(e);
  } finally {
    await client.end();
  }
}

main();
