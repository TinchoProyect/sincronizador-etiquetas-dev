require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

client.connect()
  .then(async () => {
    // Padded to 4 characters
    const paddedId = '387'.padStart(4, '0');
    console.log('Searching for padded:', paddedId);
    const bcRes = await client.query("SELECT * FROM public.bunker_clientes WHERE lomas_soft_id = $1", [paddedId]);
    console.log('Bunker Client Nicolás:', bcRes.rows);

    if (bcRes.rows.length > 0) {
      const bcId = bcRes.rows[0].id;
      // 2. Get price lists for this client
      const listsRes = await client.query("SELECT * FROM public.bunker_cliente_listas_precios WHERE bunker_cliente_id = $1", [bcId]);
      console.log('Listas Precios Nicolás:', listsRes.rows);

      if (listsRes.rows.length > 0) {
        const listId = listsRes.rows[0].bunker_lista_precio_id;
        console.log('Lista ID:', listId);
        // 3. Get articles and prices in this list
        const artPrices = await client.query(`
          SELECT bla.articulo_numero, bla.precio_final, bla.iva, ba.descripcion, ba.descripcion_generada
          FROM public.bunker_lista_articulos bla
          LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = bla.articulo_numero
          WHERE bla.lista_id = $1
          LIMIT 10
        `, [listId]);
        console.log('Artículos y precios en lista:', artPrices.rows);
      }
    }
    client.end();
  })
  .catch(err => {
    console.error(err);
  });
