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
    
    const query = `
      SELECT 
          b.articulo_id, 
          b.descripcion, 
          b.descripcion_generada, 
          b.costo_base, 
          b.porcentaje_iva,
          (
              SELECT json_agg(json_build_object('lista_id', m.lista_id, 'margen_porcentaje', m.margen_porcentaje))
              FROM public.bunker_margenes m 
              WHERE m.articulo_id = b.articulo_id
          ) as margenes
      FROM public.bunker_articulos b
      WHERE b.descripcion ILIKE '%banana%' 
         OR b.descripcion ILIKE '%chip%' 
         OR b.descripcion_generada ILIKE '%banana%' 
         OR b.descripcion_generada ILIKE '%chip%'
    `;
    
    const res = await client.query(query);
    console.log("RESULTADOS BANANA/CHIP:");
    console.log(JSON.stringify(res.rows, null, 2));

  } catch (err) {
    console.error('Error', err);
  } finally {
    await client.end();
  }
}

run();
