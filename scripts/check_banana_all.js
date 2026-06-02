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
    
    console.log("--- BÚSQUEDA EN BUNKER_ARTICULOS ---");
    const queryBunker = `SELECT * FROM public.bunker_articulos WHERE descripcion ILIKE '%banana%' OR descripcion_generada ILIKE '%banana%' OR descripcion ILIKE '%chip%' OR descripcion_generada ILIKE '%chip%'`;
    const resB = await client.query(queryBunker);
    console.log(JSON.stringify(resB.rows, null, 2));

    console.log("--- BÚSQUEDA EN STOCK_REAL_CONSOLIDADO ---");
    const queryStock = `SELECT * FROM public.stock_real_consolidado WHERE descripcion ILIKE '%banana%' OR descripcion ILIKE '%chip%'`;
    const resS = await client.query(queryStock);
    console.log(JSON.stringify(resS.rows, null, 2));

    console.log("--- BÚSQUEDA EN ARTICULOS (LEGACY) ---");
    const queryArt = `SELECT numero, nombre FROM public.articulos WHERE nombre ILIKE '%banana%' OR nombre ILIKE '%chip%'`;
    const resA = await client.query(queryArt);
    console.log(JSON.stringify(resA.rows, null, 2));

  } catch (err) {
    console.error('Error', err);
  } finally {
    await client.end();
  }
}

run();
