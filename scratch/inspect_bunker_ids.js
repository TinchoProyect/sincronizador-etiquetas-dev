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
    console.log('--- INSPECTING BUNKER ARTICLES ---');
    const res = await client.query('SELECT articulo_id, descripcion, pack_hijo_codigo FROM public.bunker_articulos LIMIT 10;');
    console.log(res.rows);

    console.log('--- INSPECTING MAPEO TABLE ---');
    const resMapeo = await client.query('SELECT * FROM public.bunker_articulos_reposicion_mapeo LIMIT 10;');
    console.log(resMapeo.rows);

    console.log('--- INSPECTING INGREDIENTES CODES ---');
    const resIng = await client.query('SELECT id, codigo, nombre FROM public.ingredientes LIMIT 10;');
    console.log(resIng.rows);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

main();
