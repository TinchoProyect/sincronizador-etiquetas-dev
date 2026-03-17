const { Pool } = require('pg');
require('dotenv').config({ path: '../.env.test' });

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: 'etiquetas_pruebas', // Hardcoded to ensure it hits the test DB
  password: process.env.DB_PASSWORD || 'ta3Mionga',
  port: process.env.DB_PORT || 5432,
});

async function run() {
  try {
    await pool.query("ALTER TABLE presupuestos ADD COLUMN IF NOT EXISTS origen_punto_venta VARCHAR(20) DEFAULT '';");
    console.log("Column 'origen_punto_venta' added to TEST DB successfully.");
    await pool.query("ALTER TABLE presupuestos ADD COLUMN IF NOT EXISTS origen_numero_factura VARCHAR(20) DEFAULT '';");
    console.log("Column 'origen_numero_factura' added to TEST DB successfully.");
  } catch (err) {
    console.error("Error adding columns to TEST DB:", err);
  } finally {
    pool.end();
  }
}

run();
