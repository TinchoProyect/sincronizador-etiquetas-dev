const { Pool } = require('pg');
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'etiquetas',
  password: process.env.DB_PASSWORD || 'ta3Mionga',
  port: process.env.DB_PORT || 5432
});

async function checkIngestedOrder() {
  const rDet = await pool.query('SELECT * FROM public.presupuestos_detalles WHERE id_presupuesto = 8234652;');
  console.log('📦 DETALLES PARA PRESUPUESTO 8234652:\n', JSON.stringify(rDet.rows, null, 2));
  process.exit(0);
}

checkIngestedOrder();
