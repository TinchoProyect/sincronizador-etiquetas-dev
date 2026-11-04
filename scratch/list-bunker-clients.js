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
    const res = await client.query("SELECT id, codigo_bunker_cliente, cliente_nombre, lomas_soft_id, cuit_cuil FROM public.bunker_clientes LIMIT 10");
    console.log('Bunker Clientes:', res.rows);
    client.end();
  })
  .catch(err => {
    console.error(err);
  });
