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
    console.log('--- FINDING CHB10x1 in bunker_articulos ---');
    const resBunker = await client.query("SELECT * FROM public.bunker_articulos WHERE articulo_id = 'CHB10x1';");
    console.log(resBunker.rows);

    console.log('--- FINDING CHB10x1 in public.ingredientes ---');
    const resIng = await client.query("SELECT * FROM public.ingredientes WHERE id::text = 'CHB10x1' OR codigo::text = 'CHB10x1' OR LOWER(nombre) LIKE '%banana%';");
    console.log(resIng.rows);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

main();
