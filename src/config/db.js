/**
 * Adaptador compartido de Pool PostgreSQL para servicios generales (`src/services/*`)
 * Reutiliza la conexión central configurada en `src/usuarios/pool.js` (que lee `.env`).
 */
const pool = require('../usuarios/pool');

module.exports = pool;
