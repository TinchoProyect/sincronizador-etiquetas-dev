const { Client } = require('pg');
const client = new Client({
  user: 'postgres',
  password: 'ta3Mionga',
  host: 'localhost',
  database: 'etiquetas',
  port: 5432
});

async function run() {
  await client.connect();
  const headerRes = await client.query("SELECT * FROM public.presupuestos WHERE id = 8234456;");
  console.log('--- Ingested budget header ---');
  console.log(headerRes.rows);

  const detailsRes = await client.query("SELECT * FROM public.presupuestos_detalles WHERE id_presupuesto = 8234456;");
  console.log('--- Ingested budget details ---');
  console.log(detailsRes.rows);
  
  await client.end();
}

run();
