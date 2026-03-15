const { Client } = require('pg');

const client = new Client({
  user: 'postgres',
  database: 'etiquetas_pruebas',
  password: 'ta3Mionga'
});

async function run() {
  await client.connect();
  
  const cols = await client.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'mantenimiento_movimientos'
  `);
  
  const constr = await client.query(`
    SELECT pg_get_constraintdef(c.oid) AS definicion
    FROM pg_constraint c 
    WHERE c.conname = 'ingredientes_movimientos_tipo_check'
  `);

  const result = {
    columns: cols.rows.map(r => r.column_name),
    constraint: constr.rows.length > 0 ? constr.rows[0].definicion : 'none'
  };

  require('fs').writeFileSync('debug_schema.json', JSON.stringify(result, null, 2));
  console.log('Saved to debug_schema.json');
  
  await client.end();
}

run().catch(console.error);
