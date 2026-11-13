require('dotenv').config();
const { getSharedPool } = require('../../shared/pgPoolFactory');

console.log('🔍 [LOGISTICA] Configurando conexión a base de datos...');

/**
 * Configuración de conexión a PostgreSQL
 * Base de datos compartida con el resto del sistema LAMDA
 * Respeta la lógica de switch entre producción (etiquetas) y pruebas (etiquetas_pruebas)
 */
const pool = getSharedPool({ defaultMax: 20 });

// Log de conexión con información del entorno
console.log(`🔌 [LOGISTICA] Conectado a BD: ${process.env.DB_NAME || 'etiquetas'} (Entorno: ${process.env.NODE_ENV || 'production'}, Pool max: ${pool.options.max})`);

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
                ADD COLUMN IF NOT EXISTS disponible BOOLEAN DEFAULT TRUE,
                ADD COLUMN IF NOT EXISTS rendimiento_activo BOOLEAN DEFAULT TRUE,
                ADD COLUMN IF NOT EXISTS mano_obra_activa BOOLEAN DEFAULT TRUE;
            `);
            console.log('✅ [LOGISTICA] Columnas modo_iva, es_patron, disponible, rendimiento_activo y mano_obra_activa verificadas/agregadas a bunker_lista_articulos');

            await pool.query(`
                ALTER TABLE public.bunker_articulos 
                ADD COLUMN IF NOT EXISTS pack_unidades INTEGER DEFAULT 1;
            `);
            console.log('✅ [LOGISTICA] Columna pack_unidades verificada/agregada a bunker_articulos');

            await pool.query(`
                ALTER TABLE public.ordenes_tratamiento 
                ADD COLUMN IF NOT EXISTS id_domicilio_entrega INTEGER REFERENCES public.clientes_domicilios(id);
            `);
            console.log('✅ [LOGISTICA] Columna id_domicilio_entrega verificada/agregada a ordenes_tratamiento');

            await pool.query(`
                ALTER TABLE public.factura_pagos_efectivo 
                ADD COLUMN IF NOT EXISTS id_ruta INTEGER REFERENCES public.rutas(id) ON DELETE SET NULL,
                ADD COLUMN IF NOT EXISTS orden_entrega INTEGER DEFAULT 999,
                ADD COLUMN IF NOT EXISTS id_domicilio_entrega INTEGER REFERENCES public.clientes_domicilios(id) ON DELETE SET NULL;
            `);
            console.log('✅ [LOGISTICA] Columnas id_ruta, orden_entrega e id_domicilio_entrega verificadas/agregadas a factura_pagos_efectivo');

            // Crear tabla de clientes búnker si no existe
            await pool.query(`
                CREATE TABLE IF NOT EXISTS public.bunker_clientes (
                    id SERIAL PRIMARY KEY,
                    codigo_bunker_cliente VARCHAR(50) UNIQUE NOT NULL,
                    cliente_nombre VARCHAR(255) NOT NULL,
                    razon_social VARCHAR(255) NOT NULL,
                    lomas_soft_id VARCHAR(50) UNIQUE DEFAULT NULL,
                    cuit_cuil VARCHAR(11) DEFAULT NULL,
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
                    saldo_apertura NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
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
                ALTER TABLE public.bunker_clientes ADD COLUMN IF NOT EXISTS cuit_cuil VARCHAR(11) DEFAULT NULL;
                ALTER TABLE public.bunker_clientes ADD COLUMN IF NOT EXISTS condicion_iva VARCHAR(100) DEFAULT NULL;
                ALTER TABLE public.bunker_clientes ADD COLUMN IF NOT EXISTS domicilio_fiscal VARCHAR(500) DEFAULT NULL;
                ALTER TABLE public.bunker_clientes ADD COLUMN IF NOT EXISTS provincia VARCHAR(100) DEFAULT NULL;
                ALTER TABLE public.bunker_clientes ADD COLUMN IF NOT EXISTS estado_clave VARCHAR(50) DEFAULT NULL;
                ALTER TABLE public.bunker_clientes ADD COLUMN IF NOT EXISTS categoria_monotributo VARCHAR(100) DEFAULT NULL;
                ALTER TABLE public.bunker_clientes ALTER COLUMN categoria_monotributo TYPE VARCHAR(100);
                ALTER TABLE public.bunker_clientes ADD COLUMN IF NOT EXISTS actividad_principal VARCHAR(500) DEFAULT NULL;
                ALTER TABLE public.bunker_clientes ADD COLUMN IF NOT EXISTS whatsapp_facturas TEXT DEFAULT NULL;
                ALTER TABLE public.bunker_clientes ALTER COLUMN whatsapp_facturas TYPE TEXT;
                
                ALTER TABLE public.factura_cuentas_corrientes ADD COLUMN IF NOT EXISTS saldo_apertura NUMERIC(15, 2) DEFAULT 0.00;
                ALTER TABLE public.factura_cuentas_corrientes ADD COLUMN IF NOT EXISTS configuracion_reporte JSONB DEFAULT '{}';
                ALTER TABLE public.factura_cuenta_corriente_movimientos ADD COLUMN IF NOT EXISTS presupuesto_id bigint DEFAULT NULL;
                ALTER TABLE public.factura_cuenta_corriente_movimientos_eliminados ADD COLUMN IF NOT EXISTS presupuesto_id bigint DEFAULT NULL;
                ALTER TABLE public.factura_cuenta_corriente_movimientos ADD COLUMN IF NOT EXISTS metadatos JSONB DEFAULT NULL;
                ALTER TABLE public.factura_cuenta_corriente_movimientos_eliminados ADD COLUMN IF NOT EXISTS metadatos JSONB DEFAULT NULL;
                
                ALTER TABLE public.bunker_articulos ADD COLUMN IF NOT EXISTS expresado_en_unidades BOOLEAN DEFAULT FALSE;
            `);
            console.log('✅ [LOGISTICA] Columnas fiscales, saldo_apertura, whatsapp_facturas y expresado_en_unidades verificadas/agregadas');

            // Garantizar la vinculación de artículos hermanos en bunker_articulos para la herencia parental
            await pool.query(`
                UPDATE public.bunker_articulos SET pack_hijo_codigo = 'MPBX25' WHERE articulo_id = 'MPBX5' AND (pack_hijo_codigo IS NULL OR pack_hijo_codigo != 'MPBX25');
                UPDATE public.bunker_articulos SET pack_hijo_codigo = 'SZAAX25' WHERE articulo_id = 'SZAAx5' AND (pack_hijo_codigo IS NULL OR pack_hijo_codigo != 'SZAAX25');
                UPDATE public.bunker_articulos SET pack_hijo_codigo = 'SZAAX25' WHERE articulo_id = 'SZAAX1' AND (pack_hijo_codigo IS NULL OR pack_hijo_codigo != 'SZAAX25');
                UPDATE public.bunker_articulos SET pack_hijo_codigo = 'GFGNFX1' WHERE articulo_id IN ('GDFX1', 'GDFX500G', 'GDFX200G', 'GDF5x1') AND (pack_hijo_codigo IS NULL OR pack_hijo_codigo != 'GFGNFX1');
                UPDATE public.bunker_articulos SET pack_hijo_codigo = 'GSGNFX1' WHERE articulo_id IN ('GSX1', 'GSX500G', 'GSX200G', 'GS5X1') AND (pack_hijo_codigo IS NULL OR pack_hijo_codigo != 'GSGNFX1');
            `);
            console.log('✅ [LOGISTICA] Relaciones de hermanos comerciales (pack_hijo_codigo) verificadas y configuradas');

            // [MIGRACIONES 32, 38 y 39] Índices y vista determinista (Lectura Dual + FK id_presupuesto)
            await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_articulos_codigo_barras ON public.articulos(codigo_barras);
                CREATE INDEX IF NOT EXISTS idx_articulos_numero ON public.articulos(numero);
                CREATE INDEX IF NOT EXISTS idx_presupuestos_detalles_articulo ON public.presupuestos_detalles(articulo);
                CREATE INDEX IF NOT EXISTS idx_presupuestos_detalles_presupuesto ON public.presupuestos_detalles(id_presupuesto);
                CREATE INDEX IF NOT EXISTS idx_stock_real_art_num ON public.stock_real_consolidado(articulo_numero);
                CREATE INDEX IF NOT EXISTS idx_stock_real_cod_bar ON public.stock_real_consolidado(codigo_barras);

                CREATE OR REPLACE VIEW public.v_presupuestos_detalles_resueltos AS
                SELECT
                    pd.id,
                    pd.id_presupuesto,
                    pd.id_presupuesto_ext,
                    pd.articulo,
                    COALESCE(
                        NULLIF(TRIM(a.codigo_barras), ''),
                        NULLIF(TRIM(ba.codigo_barras::text), ''),
                        NULLIF(TRIM(src.codigo_barras), ''),
                        CASE WHEN ing.id IS NOT NULL THEN ing.id::text ELSE NULL END,
                        pd.articulo
                    )::text AS codigo_barras,
                    pd.cantidad,
                    pd.cantidad_original,
                    pd.precio1,
                    pd.valor1,
                    pd.iva1,
                    pd.diferencia,
                    pd.fecha_actualizacion,
                    COALESCE(
                        ba.articulo_id,
                        a.numero::character varying,
                        src.articulo_numero::character varying,
                        CASE WHEN ing.id IS NOT NULL THEN ing.id::text::character varying ELSE NULL END,
                        pd.articulo::character varying
                    ) AS articulo_numero,
                    COALESCE(
                        NULLIF(TRIM(ba.descripcion_generada::text), ''),
                        NULLIF(TRIM(ba.descripcion::text), ''),
                        NULLIF(TRIM(a.nombre), ''),
                        NULLIF(TRIM(src.descripcion), ''),
                        NULLIF(TRIM(ing.nombre), ''),
                        pd.articulo
                    ) AS descripcion,
                    COALESCE(NULLIF(TRIM(ba.descripcion_generada::text), ''), NULLIF(TRIM(ba.descripcion::text), '')) AS descripcion_bunker,
                    NULLIF(TRIM(a.nombre), '') AS descripcion_legacy,
                    NULLIF(TRIM(src.descripcion), '') AS descripcion_stock,
                    CASE WHEN ing.id IS NOT NULL THEN true ELSE false END AS es_ingrediente,
                    ing.id AS ingrediente_id,
                    NULLIF(TRIM(ing.nombre), '') AS descripcion_ingrediente
                FROM public.presupuestos_detalles pd
                LEFT JOIN LATERAL (
                    SELECT a_inner.numero, a_inner.codigo_barras, a_inner.nombre
                    FROM public.articulos a_inner
                    WHERE a_inner.codigo_barras = pd.articulo OR a_inner.numero = pd.articulo
                    ORDER BY (a_inner.codigo_barras = pd.articulo) DESC
                    LIMIT 1
                ) a ON true
                LEFT JOIN LATERAL (
                    SELECT ba_inner.articulo_id, ba_inner.codigo_barras, ba_inner.descripcion_generada, ba_inner.descripcion
                    FROM public.bunker_articulos ba_inner
                    WHERE ba_inner.articulo_id::text = pd.articulo
                       OR ba_inner.codigo_barras::text = pd.articulo
                       OR (a.numero IS NOT NULL AND ba_inner.articulo_id::text = a.numero)
                    ORDER BY
                       (ba_inner.articulo_id::text = pd.articulo) DESC,
                       (ba_inner.codigo_barras::text = pd.articulo) DESC
                    LIMIT 1
                ) ba ON true
                LEFT JOIN LATERAL (
                    SELECT src_inner.articulo_numero, src_inner.codigo_barras, src_inner.descripcion
                    FROM public.stock_real_consolidado src_inner
                    WHERE src_inner.codigo_barras = pd.articulo
                       OR src_inner.articulo_numero = pd.articulo
                       OR (a.numero IS NOT NULL AND src_inner.articulo_numero = a.numero)
                       OR (ba.articulo_id IS NOT NULL AND src_inner.articulo_numero = ba.articulo_id::text)
                    ORDER BY (src_inner.codigo_barras = pd.articulo) DESC
                    LIMIT 1
                ) src ON true
                LEFT JOIN LATERAL (
                    SELECT ing_inner.id, ing_inner.codigo, ing_inner.nombre
                    FROM public.ingredientes ing_inner
                    WHERE a.numero IS NULL
                      AND ba.articulo_id IS NULL
                      AND src.articulo_numero IS NULL
                      AND (ing_inner.id::text = pd.articulo OR ing_inner.codigo::text = pd.articulo)
                    ORDER BY (ing_inner.id::text = pd.articulo) DESC
                    LIMIT 1
                ) ing ON true;
            `);
            await pool.query("ALTER TABLE public.bunker_prospectos ADD COLUMN IF NOT EXISTS en_pool_logistica BOOLEAN DEFAULT false;");
            await pool.query("ALTER TABLE public.bunker_prospectos ADD COLUMN IF NOT EXISTS cliente_activo_id INTEGER;");
            await pool.query("ALTER TABLE public.bunker_prospectos ADD COLUMN IF NOT EXISTS cliente_domicilio_id INTEGER;");
            console.log('✅ [LOGISTICA] Vista v_presupuestos_detalles_resueltos e índices verificados/creados');
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
