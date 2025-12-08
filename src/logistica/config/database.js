require('dotenv').config();
const { Pool } = require('pg');

console.log('🔍 [LOGISTICA] Configurando conexión a base de datos...');

/**
 * Configuración de conexión a PostgreSQL
 * Base de datos compartida con el resto del sistema LAMDA
 * Respeta la lógica de switch entre producción (etiquetas) y pruebas (etiquetas_pruebas)
 */
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
    // Configuración de pool
    max: 20, // Máximo de conexiones
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// Log de conexión con información del entorno
console.log(`🔌 [LOGISTICA] Conectado a BD: ${process.env.DB_NAME || 'etiquetas'} (Entorno: ${process.env.NODE_ENV || 'production'})`);

/**
 * Verificar conexión al iniciar
 */
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('❌ [LOGISTICA] Error al conectar con la base de datos:', err.message);
        console.error('❌ [LOGISTICA] Stack:', err.stack);
    } else {
        console.log('✅ [LOGISTICA] Conexión a la base de datos establecida exitosamente');
        console.log('🕒 [LOGISTICA] Timestamp de conexión:', res.rows[0].now);
        console.log('📊 [LOGISTICA] Base de datos:', process.env.DB_NAME || 'etiquetas');
        console.log('🔌 [LOGISTICA] Host:', process.env.DB_HOST || 'localhost');
    }
});

/**
 * Manejo de errores del pool
 */
pool.on('error', (err, client) => {
    console.error('❌ [LOGISTICA] Error inesperado en el pool de conexiones:', err.message);
    console.error('❌ [LOGISTICA] Stack:', err.stack);
});

/**
 * Middleware para inyectar la conexión en las requests
 * @param {Object} req - Request de Express
 * @param {Object} res - Response de Express
 * @param {Function} next - Next middleware
 */
const dbMiddleware = (req, res, next) => {
    req.db = pool;
    next();
};

/**
 * Función helper para ejecutar queries con logs
 * @param {string} query - Query SQL
 * @param {Array} params - Parámetros de la query
 * @param {string} operacion - Nombre de la operación (para logs)
 * @returns {Promise<Object>} Resultado de la query
 */
const ejecutarQuery = async (query, params = [], operacion = 'Query') => {
    const inicio = Date.now();
    console.log(`🔍 [LOGISTICA-DB] Ejecutando ${operacion}...`);
    
    try {
        const resultado = await pool.query(query, params);
        const duracion = Date.now() - inicio;
        
        console.log(`✅ [LOGISTICA-DB] ${operacion} exitosa (${duracion}ms)`);
        console.log(`📊 [LOGISTICA-DB] Filas afectadas: ${resultado.rowCount}`);
        
        return resultado;
    } catch (error) {
        const duracion = Date.now() - inicio;
        
        console.error(`❌ [LOGISTICA-DB] Error en ${operacion} (${duracion}ms):`, error.message);
        console.error(`❌ [LOGISTICA-DB] Código de error:`, error.code);
        console.error(`❌ [LOGISTICA-DB] Detalle:`, error.detail);
        
        throw error;
    }
};

/**
 * Función helper para transacciones
 * @param {Function} callback - Función que ejecuta las queries dentro de la transacción
 * @returns {Promise<any>} Resultado del callback
 */
const ejecutarTransaccion = async (callback) => {
    const client = await pool.connect();
    
    console.log('🔄 [LOGISTICA-DB] Iniciando transacción...');
    
    try {
        await client.query('BEGIN');
        console.log('✅ [LOGISTICA-DB] Transacción iniciada');
        
        const resultado = await callback(client);
        
        await client.query('COMMIT');
        console.log('✅ [LOGISTICA-DB] Transacción confirmada (COMMIT)');
        
        return resultado;
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ [LOGISTICA-DB] Transacción revertida (ROLLBACK):', error.message);
        throw error;
    } finally {
        client.release();
        console.log('🔓 [LOGISTICA-DB] Cliente liberado al pool');
    }
};

module.exports = {
    pool,
    dbMiddleware,
    ejecutarQuery,
    ejecutarTransaccion
};
