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
 * Inicializar tablas de cuentas y movimientos bancarios si no existen
 */
const inicializarTablasBancarias = async () => {
    console.log('🔄 [FACTURACION-DB] Inicializando tablas de cuentas bancarias...');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 1. Crear tabla de cuentas bancarias
        await client.query(`
            CREATE TABLE IF NOT EXISTS public.fin_cuentas_bancarias (
                id SERIAL PRIMARY KEY,
                banco VARCHAR(150) NOT NULL,
                titular VARCHAR(150) NOT NULL,
                tipo_cuenta VARCHAR(100) NOT NULL,
                numero_cuenta VARCHAR(50) UNIQUE NOT NULL,
                cbu VARCHAR(22) UNIQUE NOT NULL,
                alias VARCHAR(100) NOT NULL,
                saldo NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
                estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVA',
                creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        // 2. Crear tabla de movimientos bancarios
        await client.query(`
            CREATE TABLE IF NOT EXISTS public.fin_movimientos_bancarios (
                id SERIAL PRIMARY KEY,
                cuenta_id INTEGER NOT NULL REFERENCES public.fin_cuentas_bancarias(id) ON DELETE CASCADE,
                fecha_movimiento TIMESTAMP NOT NULL,
                concepto VARCHAR(500) NOT NULL,
                tipo_operacion VARCHAR(100) NOT NULL,
                debito NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
                credito NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
                referencia VARCHAR(100) DEFAULT NULL,
                saldo_resultante NUMERIC(15, 2) NOT NULL,
                hash_dedup VARCHAR(64) UNIQUE NOT NULL,
                cuit_extraido VARCHAR(11) DEFAULT NULL,
                referencia_operacion VARCHAR(100) DEFAULT NULL,
                cliente_id INTEGER DEFAULT NULL REFERENCES public.bunker_clientes(id) ON DELETE SET NULL,
                estado_clasificacion VARCHAR(30) NOT NULL DEFAULT 'AUTO',
                metadata_adicional JSONB DEFAULT NULL,
                creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Ejecutar migración para añadir columnas si la tabla ya existía
        await client.query(`
            ALTER TABLE public.fin_movimientos_bancarios
            ADD COLUMN IF NOT EXISTS cuit_extraido VARCHAR(11) DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS referencia_operacion VARCHAR(100) DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS cliente_id INTEGER DEFAULT NULL REFERENCES public.bunker_clientes(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS estado_clasificacion VARCHAR(30) NOT NULL DEFAULT 'AUTO',
            ADD COLUMN IF NOT EXISTS metadata_adicional JSONB DEFAULT NULL;
        `);
        
        // 3. Crear índices
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_fin_movs_cuenta ON public.fin_movimientos_bancarios(cuenta_id);
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_fin_movs_fecha ON public.fin_movimientos_bancarios(fecha_movimiento);
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_fin_movs_cuit ON public.fin_movimientos_bancarios(cuit_extraido);
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_fin_movs_cliente ON public.fin_movimientos_bancarios(cliente_id);
        `);

        // 3b. Crear tabla local para registrar los cheques vinculados manualmente
        await client.query(`
            CREATE TABLE IF NOT EXISTS public.fin_cheques_vinculados (
                id SERIAL PRIMARY KEY,
                cheque_id UUID UNIQUE NOT NULL,
                cliente_id INTEGER REFERENCES public.bunker_clientes(id) ON DELETE SET NULL,
                numero_cheque VARCHAR(100) NOT NULL,
                importe NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
                fecha_pago DATE NOT NULL,
                banco_emisor VARCHAR(255) NOT NULL,
                librador_razon_social VARCHAR(255),
                creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_fin_cheques_cheque_id ON public.fin_cheques_vinculados(cheque_id);
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_fin_cheques_cliente ON public.fin_cheques_vinculados(cliente_id);
        `);

        // 4. Sembrado (Seed) de la cuenta Galicia por defecto
        const checkCuenta = await client.query('SELECT COUNT(*) FROM public.fin_cuentas_bancarias');
        if (parseInt(checkCuenta.rows[0].count) === 0) {
            console.log('🌱 [FACTURACION-DB] Sembrando cuenta Galicia por defecto...');
            await client.query(`
                INSERT INTO public.fin_cuentas_bancarias (
                    banco,
                    titular,
                    tipo_cuenta,
                    numero_cuenta,
                    cbu,
                    alias,
                    saldo,
                    estado
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8
                )
            `, [
                'Banco de Galicia y Buenos Aires S.A.U (CUIT: 30-50000173-5)',
                'MARTIN IGNACIO SERRANO (DU Nro. 24892174)',
                'Caja de Ahorro en Pesos (CA $)',
                '400784413734',
                '0070373230004007844141',
                'LAMDA.SER.MARTIN',
                3349084.93,
                'ACTIVA'
            ]);
            console.log('🌱 [FACTURACION-DB] Cuenta Galicia sembrada con éxito.');
        } else {
            console.log('ℹ️ [FACTURACION-DB] La tabla fin_cuentas_bancarias ya tiene datos. Omitiendo sembrado.');
        }

        await client.query('COMMIT');
        console.log('✅ [FACTURACION-DB] Tablas de cuentas bancarias inicializadas correctamente');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ [FACTURACION-DB] Error al inicializar tablas de cuentas bancarias:', error.message);
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Verificar existencia de tablas requeridas
 * @returns {Promise<Object>} Estado de las tablas
 */
const verificarTablas = async () => {
    console.log('🔍 [FACTURACION-DB] Verificando tablas requeridas...');

    // Asegurar inicialización de tablas bancarias primero
    try {
        await inicializarTablasBancarias();
    } catch (err) {
        console.error('❌ [FACTURACION-DB] Error crítico al inicializar tablas bancarias:', err.message);
    }

    const tablasRequeridas = [
        'factura_facturas',
        'factura_factura_items',
        'factura_afip_ta',
        'factura_afip_wsfe_logs',
        'factura_numeracion_afip',
        'factura_numeracion_interna',
        'fin_cuentas_bancarias',
        'fin_movimientos_bancarios',
        'fin_cheques_vinculados'
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
