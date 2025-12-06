require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'etiquetas',
  password: process.env.DB_PASSWORD || 'ta3Mionga',
  port: parseInt(process.env.DB_PORT || '5432'),
});

// Log de conexión con información del entorno
console.log(`🔌 [DB-USUARIOS] Conectado a BD: ${process.env.DB_NAME || 'etiquetas'} (Entorno: ${process.env.NODE_ENV || 'production'})`);

module.exports = pool;
