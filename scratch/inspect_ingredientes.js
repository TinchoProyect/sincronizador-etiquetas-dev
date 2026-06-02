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
      WHERE table_schema = 'public' AND table_name = 'ingredientes';
    `);
    console.log('ingredientes COLUMNS:');
    console.table(resCol.rows);

    const resRows = await client.query(`
      SELECT * FROM public.ingredientes LIMIT 10;
    `);
    console.log('ingredientes SAMPLE ROWS:');
    console.log(JSON.stringify(resRows.rows, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

main();
