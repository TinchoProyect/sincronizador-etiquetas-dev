const { Client } = require('pg');

const client = new Client({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function main() {
  await client.connect();
  try {
    const resCol = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'bunker_articulos';
    `);
    console.log('bunker_articulos COLUMNS:');
    console.table(resCol.rows);

    const resRows = await client.query(`
      SELECT * FROM public.bunker_articulos LIMIT 5;
    `);
    console.log('bunker_articulos SAMPLE ROWS:');
    console.log(JSON.stringify(resRows.rows, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

main();
