const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  user: process.env.DB_USER || "postgres",
  host: process.env.DB_HOST || "localhost",
  database: process.env.DB_NAME || "etiquetas",
  password: process.env.DB_PASSWORD || "ta3Mionga",
  port: parseInt(process.env.DB_PORT || "5432"),
});

async function main() {
  const client = await pool.connect();
  try {
    console.log("=== Articulo MFSx5 en bunker_articulos ===");
    const resB = await client.query("SELECT * FROM bunker_articulos WHERE articulo_id = \x27MFSx5\x27");
    console.log(JSON.stringify(resB.rows, null, 2));

    console.log("=== Precios de MFSx5 en bunker_lista_articulos ===");
    const resBL = await client.query("SELECT la.*, lp.nombre as lista_nombre FROM bunker_lista_articulos la JOIN bunker_listas_precios lp ON lp.id = la.lista_id WHERE la.articulo_numero = \x27MFSx5\x27");
    console.log(JSON.stringify(resBL.rows, null, 2));

    console.log("=== Articulo MFSx5 en precios_articulos (Legacy) ===");
    const resL = await client.query("SELECT * FROM public.precios_articulos WHERE articulo = \x27MFSx5\x27");
    console.log(JSON.stringify(resL.rows, null, 2));

    console.log("=== Listas del cliente Nicolas (387) ===");
    const resCli = await client.query("SELECT bc.id, bc.razon_social, clp.bunker_lista_precio_id, lp.nombre as bunker_lista_nombre FROM public.bunker_clientes bc LEFT JOIN public.bunker_cliente_listas_precios clp ON clp.bunker_cliente_id = bc.id LEFT JOIN public.bunker_listas_precios lp ON lp.id = clp.bunker_lista_precio_id WHERE bc.lomas_soft_id = \x270387\x27");
    console.log(JSON.stringify(resCli.rows, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
