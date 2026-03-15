const { Client } = require('pg');

const client = new Client({
  user: 'postgres',
  database: 'etiquetas_pruebas',
  password: 'ta3Mionga'
});

async function run() {
  await client.connect();
  
  const cols = await client.query(`
    SELECT table_name, column_name 
    FROM information_schema.columns 
    WHERE table_name LIKE '%historico%' OR table_name LIKE '%stock%'
  `);
  
  require('fs').writeFileSync('debug_schema.json', JSON.stringify(cols.rows, null, 2));
  console.log('Saved to debug_schema.json');
  
  await client.end();
}

run().catch(console.error);
