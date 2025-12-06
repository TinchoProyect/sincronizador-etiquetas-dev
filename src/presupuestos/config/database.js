require('dotenv').config();
const { Pool } = require('pg');

console.log('🔍 [PRESUPUESTOS] Configurando conexión a base de datos...');

// Configuración de la base de datos (misma que el sistema principal)
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

// Log de conexión con información del entorno
console.log(`🔌 [PRESUPUESTOS] Conectado a BD: ${process.env.DB_NAME || 'etiquetas'} (Entorno: ${process.env.NODE_ENV || 'production'})`);

// Verificar conexión
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('❌ [PRESUPUESTOS] Error al conectar con la base de datos:', err);
    } else {
        console.log('✅ [PRESUPUESTOS] Conexión a la base de datos establecida exitosamente');
        console.log('🕒 [PRESUPUESTOS] Timestamp de conexión:', res.rows[0].now);
    }
});

// Middleware para inyectar la conexión en las requests
const dbMiddleware = (req, res, next) => {
    req.db = pool;
    next();
};

module.exports = {
    pool,
    dbMiddleware
};
