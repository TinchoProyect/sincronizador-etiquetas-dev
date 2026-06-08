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
      SELECT articulo_numero, descripcion, stock_lomasoft, stock_movimientos, stock_ajustes, stock_consolidado 
      FROM public.stock_real_consolidado 
      WHERE articulo_numero IN ('APC27/30x10', 'APN27/30X5', 'AGPX2', 'AATGX5', 'CHBx2')
      ORDER BY articulo_numero;
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

