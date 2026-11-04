const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'etiquetas',
  password: process.env.DB_PASSWORD || 'ta3Mionga',
  port: process.env.DB_PORT || 5432
});

async function checkLocalClientes() {
  const r = await pool.query(`
    SELECT *
    FROM public.clientes
    LIMIT 5;
  `);
  console.log('📋 COLUMNAS EN PUBLIC.CLIENTES:', Object.keys(r.rows[0]));
  console.log('📋 EJEMPLO DE FILAS:', r.rows);
  process.exit(0);
}

checkLocalClientes();
