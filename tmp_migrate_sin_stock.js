require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME_TEST || 'etiquetas_pruebas',
  password: process.env.DB_PASSWORD || '1234',
  port: process.env.DB_PORT || 5432,
});

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS presupuestos_articulos_sin_stock (
          id SERIAL PRIMARY KEY,
          id_presupuesto INTEGER REFERENCES presupuestos(id) ON DELETE CASCADE,
          articulo VARCHAR(100) NOT NULL,
          descripcion VARCHAR(255),
          cantidad NUMERIC(10,2) DEFAULT 0,
          motivo_falta VARCHAR(100) DEFAULT 'Sin Stock',
          fecha_registro TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_pres_sin_stock_presupuesto ON presupuestos_articulos_sin_stock(id_presupuesto);
    `);
    await client.query('COMMIT');
    console.log("Migración exitosa.");
  } catch (e) {
    await client.query('ROLLBACK');
    console.error("Error en migración:", e);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
