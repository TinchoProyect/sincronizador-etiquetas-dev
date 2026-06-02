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
    console.log('--- FINDING ZAPALLO IN receta_ingredientes ---');
    const resRI = await client.query(`
      SELECT * FROM public.receta_ingredientes 
      WHERE LOWER(nombre_ingrediente) LIKE '%zapallo%' 
         OR ingrediente_id IN (42, 110)
         OR ingrediente_id::text IN ('42', '110');
    `);
    console.log(resRI.rows);

    if (resRI.rows.length > 0) {
      const recetaIds = resRI.rows.map(r => r.receta_id);
      console.log('--- FINDING RECETAS ---');
      const resRecetas = await client.query("SELECT * FROM public.recetas WHERE id = ANY($1);", [recetaIds]);
      console.log(resRecetas.rows);

      if (resRecetas.rows.length > 0) {
        const articuloNumeros = resRecetas.rows.map(r => r.articulo_numero);
        console.log('--- FINDING BUNKER ARTICLES ---');
        const resBunker = await client.query("SELECT articulo_id, descripcion, descripcion_generada, pack_hijo_codigo FROM public.bunker_articulos WHERE articulo_id = ANY($1);", [articuloNumeros]);
        console.log(resBunker.rows);
      }
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

main();
