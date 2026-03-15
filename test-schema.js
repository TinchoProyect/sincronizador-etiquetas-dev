const { Client } = require('pg');
const fs = require('fs');
const client = new Client({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas_pruebas',
  password: 'ta3Mionga',
  port: 5432,
});

async function main() {
  try {
    await client.connect();
    const res = await client.query(`
      SELECT table_name, column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name IN ('mantenimiento_movimientos', 'stock_real_consolidado', 'ingredientes', 'ingredientes_movimientos')
    `);
    const tables = {};
    res.rows.forEach(r => {
      if(!tables[r.table_name]) tables[r.table_name] = [];
      tables[r.table_name].push(`${r.column_name} (${r.data_type})`);
    });
    fs.writeFileSync('./schemas.json', JSON.stringify(tables, null, 2));
    console.log('Schemas written to schemas.json');
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
main();
