const { Pool } = require('pg');

console.log('🔍 [FACTURACION] Configurando conexión a base de datos...');

/**
 * Configuración de conexión a PostgreSQL
 * Base de datos compartida con el resto del sistema LAMDA
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
    connectionTimeoutMillis: 10000,
});

/**
 * Verificar conexión al iniciar
 */
pool.query('SELECT NOW() AT TIME ZONE $1 as now', ['America/Argentina/Buenos_Aires'], (err, res) => {
    if (err) {
        console.error('❌ [FACTURACION] Error al conectar con la base de datos:', err.message);
        console.error('❌ [FACTURACION] Stack:', err.stack);
    } else {
        console.log('✅ [FACTURACION] Conexión a la base de datos establecida exitosamente');
        console.log('🕒 [FACTURACION] Timestamp de conexión (Argentina):', res.rows[0].now);
        console.log('📊 [FACTURACION] Base de datos:', process.env.DB_NAME || 'etiquetas');
        console.log('🔌 [FACTURACION] Host:', process.env.DB_HOST || 'localhost');
    }
});

/**
 * Manejo de errores del pool
 */
pool.on('error', (err, client) => {
    console.error('❌ [FACTURACION] Error inesperado en el pool de conexiones:', err.message);
    console.error('❌ [FACTURACION] Stack:', err.stack);
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
    console.log(`🔍 [FACTURACION-DB] Ejecutando ${operacion}...`);

    try {
        const resultado = await pool.query(query, params);
        const duracion = Date.now() - inicio;

        console.log(`✅ [FACTURACION-DB] ${operacion} exitosa (${duracion}ms)`);
        console.log(`📊 [FACTURACION-DB] Filas afectadas: ${resultado.rowCount}`);

        return resultado;
    } catch (error) {
        const duracion = Date.now() - inicio;

        console.error(`❌ [FACTURACION-DB] Error en ${operacion} (${duracion}ms):`, error.message);
        console.error(`❌ [FACTURACION-DB] Código de error:`, error.code);
        console.error(`❌ [FACTURACION-DB] Detalle:`, error.detail);

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

    console.log('🔄 [FACTURACION-DB] Iniciando transacción...');

    try {
        await client.query('BEGIN');
        console.log('✅ [FACTURACION-DB] Transacción iniciada');

        const resultado = await callback(client);

        await client.query('COMMIT');
        console.log('✅ [FACTURACION-DB] Transacción confirmada (COMMIT)');

        return resultado;
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ [FACTURACION-DB] Transacción revertida (ROLLBACK):', error.message);
        throw error;
    } finally {
        client.release();
        console.log('🔓 [FACTURACION-DB] Cliente liberado al pool');
    }
};

/**
 * Verificar existencia de tablas requeridas
 * @returns {Promise<Object>} Estado de las tablas
 */
const verificarTablas = async () => {
    console.log('🔍 [FACTURACION-DB] Verificando tablas requeridas...');

    const tablasRequeridas = [
        'factura_facturas',
        'factura_factura_items',
        'factura_afip_ta',
        'factura_afip_wsfe_logs',
        'factura_numeracion_afip',
        'factura_numeracion_interna'
    ];

    const resultado = {
        todas_existen: true,
        tablas: {}
    };

    for (const tabla of tablasRequeridas) {
        try {
            const query = `
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = $1
                )
            `;
            const res = await pool.query(query, [tabla]);
            const existe = res.rows[0].exists;

            resultado.tablas[tabla] = existe;

            if (existe) {
                console.log(`✅ [FACTURACION-DB] Tabla ${tabla} existe`);
            } else {
                console.error(`❌ [FACTURACION-DB] Tabla ${tabla} NO existe`);
                resultado.todas_existen = false;
            }
        } catch (error) {
            console.error(`❌ [FACTURACION-DB] Error verificando tabla ${tabla}:`, error.message);
            resultado.tablas[tabla] = false;
            resultado.todas_existen = false;
        }
    }

    if (resultado.todas_existen) {
        console.log('✅ [FACTURACION-DB] Todas las tablas requeridas existen');
    } else {
        console.error('❌ [FACTURACION-DB] Faltan tablas requeridas');
    }

    return resultado;
};

module.exports = {
    pool,
    dbMiddleware,
    ejecutarQuery,
    ejecutarTransaccion,
    verificarTablas
};
