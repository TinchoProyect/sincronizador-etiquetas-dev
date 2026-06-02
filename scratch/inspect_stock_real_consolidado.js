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
      WHERE table_schema = 'public' AND table_name = 'stock_real_consolidado';
    `);
    console.log('stock_real_consolidado COLUMNS:');
    console.table(resCol.rows);

    const resRows = await client.query(`
      SELECT articulo_numero, descripcion, codigo_barras 
      FROM public.stock_real_consolidado 
      WHERE codigo_barras IS NOT NULL AND codigo_barras != '' 
      LIMIT 10;
    `);
    console.log('stock_real_consolidado SAMPLE ROWS:');
    console.log(JSON.stringify(resRows.rows, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

main();
