require('dotenv').config({ path: './.env' });
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'etiquetas',
  password: process.env.DB_PASSWORD || 'ta3Mionga',
  port: process.env.DB_PORT || 5432
});

async function main() {
  console.log('🧹 Vaciando completamente registros de prueba o mock de telemetria_accesos...');

  await pool.query(`DELETE FROM public.telemetria_accesos;`);

  console.log('✅ Tabla public.telemetria_accesos vaciada. Cero registros ficticios.');
  await pool.end();
}

main().catch(console.error);
