const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const localClient = new Client({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
  });

  try {
    await localClient.connect();
    const res = await localClient.query(
      "SELECT codigo_bunker_cliente, lomas_soft_id, email_portal, cliente_nombre FROM public.bunker_clientes WHERE codigo_bunker_cliente = 'CB-0006' OR lomas_soft_id = '0006'"
    );
    console.log('Local client search result:', res.rows);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await localClient.end();
  }
}

run();
