// src/estadisticas/api/db/pool.js
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.PGUSER || 'postgres',
  host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'etiquetas',
  password: process.env.PGPASSWORD || 'ta3Mionga',
  port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
  max: 10,               // conexiones en el pool
  idleTimeoutMillis: 30000
});

// Interfaz mínima que usan los services
module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
