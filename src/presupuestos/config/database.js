const { Pool } = require('pg');

console.log('🔍 [PRESUPUESTOS] Configurando conexión a base de datos...');

// Configuración de la base de datos (misma que el sistema principal)
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
});

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
