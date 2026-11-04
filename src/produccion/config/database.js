require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

// Catch pool errors to prevent process crashes on idle connection losses
pool.on('error', (err) => {
    console.error('⚠️ [DB-PRODUCCION] Unexpected error on idle client:', err.message);
});

// Log de conexión con información del entorno
console.log(`🔌 [PRODUCCION] Conectado a BD: ${process.env.DB_NAME || 'etiquetas'} (Entorno: ${process.env.NODE_ENV || 'production'})`);

module.exports = pool;
