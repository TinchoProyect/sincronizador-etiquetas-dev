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
    console.log('--- SCANNING FOR MATCHES ---');
    const res = await client.query(`
      SELECT ba.articulo_id, i.id, i.codigo, i.nombre 
      FROM public.bunker_articulos ba
      JOIN public.ingredientes i ON ba.articulo_id = i.codigo::text OR ba.articulo_id = i.id::text OR LOWER(ba.descripcion) = LOWER(i.nombre)
      LIMIT 20;
    `);
    console.log(res.rows);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

main();
