require('dotenv').config();
const { getSharedPool } = require('../../shared/pgPoolFactory');

const pool = getSharedPool({ defaultMax: 15 });

// Log de conexión con información del entorno
console.log(`🔌 [PRODUCCION] Conectado a BD: ${process.env.DB_NAME || 'etiquetas'} (Entorno: ${process.env.NODE_ENV || 'production'}, Pool max: ${pool.options.max})`);

module.exports = pool;
