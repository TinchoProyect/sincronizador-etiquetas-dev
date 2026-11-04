const { Pool } = require('pg');
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'etiquetas',
  password: process.env.DB_PASSWORD || 'ta3Mionga',
  port: process.env.DB_PORT || 5432
});

async function findMartin() {
  console.log('🔍 Buscando "Martin Ignacio Serrano" en PostgreSQL local...');
  try {
    const r1 = await pool.query(`SELECT * FROM public.entregas_eventos WHERE receptor_nombre LIKE '%Martin%' OR receptor_nombre LIKE '%Serrano%';`);
    console.log('1. entregas_eventos Martin:', r1.rows);
  } catch (e) { console.error(e.message); }

  try {
    const r2 = await pool.query(`SELECT * FROM public.telemetria_accesos WHERE cliente_nombre LIKE '%Martin%' OR cliente_nombre LIKE '%Serrano%';`);
    console.log('2. telemetria_accesos Martin:', r2.rows);
  } catch (e) { console.error(e.message); }

  process.exit(0);
}

findMartin();
