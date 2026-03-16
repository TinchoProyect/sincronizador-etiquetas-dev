require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'sincronizador_etiquetas',
  password: process.env.DB_PASSWORD || 'mar1978',
  port: process.env.DB_PORT || 5432,
});

async function run() {
  try {
    const res = await pool.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN ('mantenimiento_conciliaciones', 'mantenimiento_conciliacion_items') ORDER BY table_name, column_name;");
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error("Error:", err);
  } finally {
    pool.end();
  }
}

run();
