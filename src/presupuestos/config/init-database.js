console.log('[PRESUPUESTOS-BACK] 🔍 Inicializando base de datos...');

const { pool } = require('./database');

/**
 * Crear tablas necesarias para el módulo de presupuestos
 */
const crearTablas = async () => {
    try {
        console.log('[PRESUPUESTOS-BACK] Verificando y creando tablas necesarias...');
        
        // Tabla principal de presupuestos
        const crearTablaPresupuestos = `
            CREATE TABLE IF NOT EXISTS presupuestos (
                id SERIAL PRIMARY KEY,
                id_presupuesto_ext VARCHAR(255) NOT NULL,
                id_cliente VARCHAR(255),
                fecha DATE,
                fecha_entrega VARCHAR(255),
                agente VARCHAR(255),
                tipo_comprobante VARCHAR(255),
                nota TEXT,
                estado VARCHAR(100),
                informe_generado VARCHAR(100),
                cliente_nuevo_id VARCHAR(255),
                punto_entrega VARCHAR(255),
                descuento DECIMAL(10,2) DEFAULT 0,
                hoja_nombre VARCHAR(255),
                hoja_url TEXT,
                usuario_id INTEGER,
                activo BOOLEAN DEFAULT true,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(id_presupuesto_ext)
            );
        `;
        
        await pool.query(crearTablaPresupuestos);
        console.log('[PRESUPUESTOS-BACK] ✅ Tabla presupuestos verificada/creada');
        
        // Tabla de detalles de presupuestos
        const crearTablaDetalles = `
            CREATE TABLE IF NOT EXISTS presupuestos_detalles (
                id SERIAL PRIMARY KEY,
                id_detalle_ext VARCHAR(255),
                id_presupuesto INTEGER REFERENCES presupuestos(id) ON DELETE CASCADE,
                articulo VARCHAR(255),
                cantidad DECIMAL(10,3),
                valor1 DECIMAL(10,2),
                precio1 DECIMAL(10,2),
                iva1 DECIMAL(10,2),
                diferencia DECIMAL(10,2),
                camp1 TEXT,
                camp2 TEXT,
                camp3 TEXT,
                camp4 TEXT,
                camp5 TEXT,
                camp6 TEXT,
                condicion VARCHAR(255),
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;
        
        await pool.query(crearTablaDetalles);
        console.log('[PRESUPUESTOS-BACK] ✅ Tabla presupuestos_detalles verificada/creada');
        
        // 🛑 [MICRO-ETAPA 6] Retirada la recreación e inserción en cada arranque de presupuestos_config y presupuestos_sync_log (100% Local-First)
        const tieneConfig = false;

        // Agregar columna 'usar_precios_bunker' a presupuestos si no existe (Fase 3 Transición Bunker)
        const addUsarPreciosBunkerColumn = `
            ALTER TABLE public.presupuestos
            ADD COLUMN IF NOT EXISTS usar_precios_bunker BOOLEAN DEFAULT false;
        `;
        await pool.query(addUsarPreciosBunkerColumn);
        console.log('[PRESUPUESTOS-BACK] ✅ Columna usar_precios_bunker verificada/creada');
        
        // Agregar columna 'archivado' a presupuestos si no existe
        const addArchivadoColumn = `
            ALTER TABLE public.presupuestos 
            ADD COLUMN IF NOT EXISTS archivado BOOLEAN DEFAULT false;
        `;
        await pool.query(addArchivadoColumn);
        console.log('[PRESUPUESTOS-BACK] ✅ Columna archivado verificada/creada');
        
        // Agregar columna 'modificado_portal' a presupuestos si no existe
        const addModificadoPortalColumn = `
            ALTER TABLE public.presupuestos 
            ADD COLUMN IF NOT EXISTS modificado_portal BOOLEAN DEFAULT false;
        `;
        await pool.query(addModificadoPortalColumn);
        console.log('[PRESUPUESTOS-BACK] ✅ Columna modificado_portal verificada/creada');
        
        // Verificar datos existentes
        const contarPresupuestos = `SELECT COUNT(*) as total FROM presupuestos WHERE activo = true`;
        const presupuestosResult = await pool.query(contarPresupuestos);
        const totalPresupuestos = parseInt(presupuestosResult.rows[0].total);
        
        console.log(`[PRESUPUESTOS-BACK] 📊 Total presupuestos en BD: ${totalPresupuestos}`);
        
        console.log('[PRESUPUESTOS-BACK] ✅ Inicialización de base de datos completada');
        
        return {
            success: true,
            tablas_creadas: true,
            configuracion_existe: tieneConfig,
            total_presupuestos: totalPresupuestos
        };
        
    } catch (error) {
        console.error('[PRESUPUESTOS-BACK] ❌ Error al inicializar base de datos:', error);
        throw error;
    }
};

module.exports = {
    crearTablas
};
