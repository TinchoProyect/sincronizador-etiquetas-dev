const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'sincronizador_etiquetas',
  password: process.env.DB_PASSWORD || 'mar1978',
  port: process.env.DB_PORT || 5432,
});

async function run() {
  try {
    await pool.query("ALTER TABLE presupuestos ADD COLUMN IF NOT EXISTS origen_facturacion VARCHAR(20) DEFAULT 'PENDIENTE';");
    console.log("Column 'origen_facturacion' added successfully.");
  } catch (err) {
    console.error("Error adding column:", err);
  } finally {
    pool.end();
  }
}

run();
