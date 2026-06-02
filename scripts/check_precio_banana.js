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
    
    console.log("--- BÚSQUEDA PRECIO CHBx2 ---");
    const query = `SELECT * FROM public.precios_articulos WHERE articulo = 'CHBx2'`;
    const res = await client.query(query);
    console.log(JSON.stringify(res.rows, null, 2));

  } catch (err) {
    console.error('Error', err);
  } finally {
    await client.end();
  }
}

run();
