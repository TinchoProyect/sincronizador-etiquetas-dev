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
    connectionTimeoutMillis: 10000,
});

// Log de conexión con información del entorno
console.log(`🔌 [LOGISTICA] Conectado a BD: ${process.env.DB_NAME || 'etiquetas'} (Entorno: ${process.env.NODE_ENV || 'production'})`);

/**
 * Verificar conexión al iniciar
 */
pool.query('SELECT NOW()', async (err, res) => {
    if (err) {
        console.error('❌ [LOGISTICA] Error al conectar con la base de datos:', err.message);
        console.error('❌ [LOGISTICA] Stack:', err.stack);
    } else {
        console.log('✅ [LOGISTICA] Conexión a la base de datos establecida exitosamente');
        console.log('🕒 [LOGISTICA] Timestamp de conexión:', res.rows[0].now);
        console.log('📊 [LOGISTICA] Base de datos:', process.env.DB_NAME || 'etiquetas');
        console.log('🔌 [LOGISTICA] Host:', process.env.DB_HOST || 'localhost');

        // Patcher setup to introduce DDL alterations to public.bunker_lista_articulos
        try {
            await pool.query(`
                ALTER TABLE public.bunker_lista_articulos 
                ADD COLUMN IF NOT EXISTS modo_iva VARCHAR(20) DEFAULT 'COMPLETO',
                ADD COLUMN IF NOT EXISTS es_patron BOOLEAN DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS fuente_costo_default VARCHAR(50),
                ADD COLUMN IF NOT EXISTS disponible BOOLEAN DEFAULT TRUE;
            `);
            console.log('✅ [LOGISTICA] Columnas modo_iva, es_patron y disponible verificadas/agregadas a bunker_lista_articulos');

            await pool.query(`
                ALTER TABLE public.ordenes_tratamiento 
                ADD COLUMN IF NOT EXISTS id_domicilio_entrega INTEGER REFERENCES public.clientes_domicilios(id);
            `);
            console.log('✅ [LOGISTICA] Columna id_domicilio_entrega verificada/agregada a ordenes_tratamiento');

            // Crear tabla de clientes búnker si no existe
            await pool.query(`
                CREATE TABLE IF NOT EXISTS public.bunker_clientes (
                    id SERIAL PRIMARY KEY,
                    codigo_bunker_cliente VARCHAR(50) UNIQUE NOT NULL,
                    cliente_nombre VARCHAR(255) NOT NULL,
                    razon_social VARCHAR(255) NOT NULL,
                    lomas_soft_id VARCHAR(50) UNIQUE DEFAULT NULL,
                    cuit_cuil VARCHAR(11) UNIQUE DEFAULT NULL,
                    condicion_iva VARCHAR(100) DEFAULT NULL,
                    domicilio_fiscal VARCHAR(500) DEFAULT NULL,
                    provincia VARCHAR(100) DEFAULT NULL,
                    estado_clave VARCHAR(50) DEFAULT NULL,
                    categoria_monotributo VARCHAR(100) DEFAULT NULL,
                    actividad_principal VARCHAR(500) DEFAULT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_bunker_clientes_busqueda ON public.bunker_clientes(codigo_bunker_cliente, cliente_nombre, lomas_soft_id);
            `);
            console.log('✅ [LOGISTICA] Tabla public.bunker_clientes y sus índices verificados/creados');

            // Crear tablas de cuenta corriente si no existen
            await pool.query(`
                CREATE TABLE IF NOT EXISTS public.factura_cuentas_corrientes (
                    id SERIAL PRIMARY KEY,
                    codigo_bunker_cliente VARCHAR(50) NOT NULL REFERENCES public.bunker_clientes(codigo_bunker_cliente) ON DELETE CASCADE,
                    nombre_cuenta VARCHAR(255) NOT NULL DEFAULT 'Cuenta Principal',
                    moneda VARCHAR(10) NOT NULL DEFAULT 'ARS',
                    saldo NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
                    estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVA',
                    creada_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    actualizada_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(codigo_bunker_cliente, nombre_cuenta)
                );
                CREATE TABLE IF NOT EXISTS public.factura_cuenta_corriente_movimientos (
                    id SERIAL PRIMARY KEY,
                    cuenta_corriente_id INTEGER NOT NULL REFERENCES public.factura_cuentas_corrientes(id) ON DELETE CASCADE,
                    tipo_movimiento VARCHAR(10) NOT NULL,
                    monto NUMERIC(15, 2) NOT NULL,
                    saldo_resultante NUMERIC(15, 2) NOT NULL,
                    tipo_comprobante VARCHAR(50),
                    comprobante_id bigint REFERENCES public.factura_facturas(id) ON DELETE SET NULL,
                    presupuesto_id bigint DEFAULT NULL,
                    descripcion VARCHAR(500) NOT NULL,
                    fecha_movimiento TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    metadatos JSONB DEFAULT NULL
                );
                CREATE TABLE IF NOT EXISTS public.factura_cuenta_corriente_movimientos_eliminados (
                    id SERIAL PRIMARY KEY,
                    original_id INTEGER NOT NULL,
                    cuenta_corriente_id INTEGER NOT NULL,
                    tipo_movimiento VARCHAR(10) NOT NULL,
                    monto NUMERIC(15, 2) NOT NULL,
                    saldo_resultante NUMERIC(15, 2) NOT NULL,
                    tipo_comprobante VARCHAR(50),
                    comprobante_id bigint,
                    presupuesto_id bigint DEFAULT NULL,
                    descripcion VARCHAR(500) NOT NULL,
                    fecha_movimiento TIMESTAMP,
                    creado_en TIMESTAMP,
                    eliminado_el TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    motivo_eliminacion TEXT,
                    metadatos JSONB DEFAULT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_factura_cc_cliente ON public.factura_cuentas_corrientes(codigo_bunker_cliente);
                CREATE INDEX IF NOT EXISTS idx_factura_cc_movs_cuenta ON public.factura_cuenta_corriente_movimientos(cuenta_corriente_id);
            `);
            console.log('✅ [LOGISTICA] Tablas de Cuenta Corriente y movimientos verificadas/creadas');


            // ARQUITECTURA FISCAL (Fase 1 y 3): Asegurar columnas fiscales en instalaciones previas
            await pool.query(`
                ALTER TABLE public.bunker_clientes ADD COLUMN IF NOT EXISTS cuit_cuil VARCHAR(11) UNIQUE DEFAULT NULL;
                ALTER TABLE public.bunker_clientes ADD COLUMN IF NOT EXISTS condicion_iva VARCHAR(100) DEFAULT NULL;
                ALTER TABLE public.bunker_clientes ADD COLUMN IF NOT EXISTS domicilio_fiscal VARCHAR(500) DEFAULT NULL;
                ALTER TABLE public.bunker_clientes ADD COLUMN IF NOT EXISTS provincia VARCHAR(100) DEFAULT NULL;
                ALTER TABLE public.bunker_clientes ADD COLUMN IF NOT EXISTS estado_clave VARCHAR(50) DEFAULT NULL;
                ALTER TABLE public.bunker_clientes ADD COLUMN IF NOT EXISTS categoria_monotributo VARCHAR(100) DEFAULT NULL;
                ALTER TABLE public.bunker_clientes ALTER COLUMN categoria_monotributo TYPE VARCHAR(100);
                ALTER TABLE public.bunker_clientes ADD COLUMN IF NOT EXISTS actividad_principal VARCHAR(500) DEFAULT NULL;
                ALTER TABLE public.bunker_clientes ADD COLUMN IF NOT EXISTS whatsapp_facturas TEXT DEFAULT NULL;
                ALTER TABLE public.bunker_clientes ALTER COLUMN whatsapp_facturas TYPE TEXT;
                
                ALTER TABLE public.factura_cuenta_corriente_movimientos ADD COLUMN IF NOT EXISTS presupuesto_id bigint DEFAULT NULL;
                ALTER TABLE public.factura_cuenta_corriente_movimientos_eliminados ADD COLUMN IF NOT EXISTS presupuesto_id bigint DEFAULT NULL;
                ALTER TABLE public.factura_cuenta_corriente_movimientos ADD COLUMN IF NOT EXISTS metadatos JSONB DEFAULT NULL;
                ALTER TABLE public.factura_cuenta_corriente_movimientos_eliminados ADD COLUMN IF NOT EXISTS metadatos JSONB DEFAULT NULL;
            `);
            console.log('✅ [LOGISTICA] Columnas fiscales y whatsapp_facturas (TEXT) verificadas/agregadas a bunker_clientes');

            // Garantizar la vinculación de artículos hermanos en bunker_articulos para la herencia parental
            await pool.query(`
                UPDATE public.bunker_articulos SET pack_hijo_codigo = 'MPBX25' WHERE articulo_id = 'MPBX5' AND (pack_hijo_codigo IS NULL OR pack_hijo_codigo != 'MPBX25');
                UPDATE public.bunker_articulos SET pack_hijo_codigo = 'SZAAX25' WHERE articulo_id = 'SZAAx5' AND (pack_hijo_codigo IS NULL OR pack_hijo_codigo != 'SZAAX25');
                UPDATE public.bunker_articulos SET pack_hijo_codigo = 'SZAAX25' WHERE articulo_id = 'SZAAX1' AND (pack_hijo_codigo IS NULL OR pack_hijo_codigo != 'SZAAX25');
            `);
            console.log('✅ [LOGISTICA] Relaciones de hermanos comerciales (pack_hijo_codigo) verificadas y configuradas');
        } catch (alterErr) {
            console.error('❌ [LOGISTICA] Error al realizar ALTER TABLE o vinculaciones en base de datos:', alterErr.message);
        }
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
