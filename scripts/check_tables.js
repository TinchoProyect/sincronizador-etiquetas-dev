const { Client } = require('pg');

async function run() {
  const client = new Client({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
  });

  try {
    await client.connect();
    
    console.log("--- BÚSQUEDA DE TABLAS RELACIONADAS A INGREDIENTES Y BÚNKER ---");
    const query = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND (table_name ILIKE '%ingrediente%' OR table_name ILIKE '%lote%' OR table_name ILIKE '%bunker%')
    `;
    const res = await client.query(query);
    console.log(JSON.stringify(res.rows, null, 2));

  } catch (err) {
    console.error('Error', err);
  } finally {
    await client.end();
  }
}

run();
