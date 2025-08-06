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
        
        // Tabla de configuración de Google Sheets
        const crearTablaConfig = `
            CREATE TABLE IF NOT EXISTS presupuestos_config (
                id SERIAL PRIMARY KEY,
                hoja_url TEXT NOT NULL,
                hoja_id VARCHAR(255) NOT NULL,
                hoja_nombre VARCHAR(255),
                rango VARCHAR(100) DEFAULT 'A:Z',
                activo BOOLEAN DEFAULT true,
                usuario_id INTEGER,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;
        
        await pool.query(crearTablaConfig);
        console.log('[PRESUPUESTOS-BACK] ✅ Tabla presupuestos_config verificada/creada');
        
        // Tabla de log de sincronizaciones
        const crearTablaSyncLog = `
            CREATE TABLE IF NOT EXISTS presupuestos_sync_log (
                id SERIAL PRIMARY KEY,
                fecha_sync TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                exitoso BOOLEAN DEFAULT false,
                registros_procesados INTEGER DEFAULT 0,
                registros_nuevos INTEGER DEFAULT 0,
                registros_actualizados INTEGER DEFAULT 0,
                errores TEXT,
                detalles JSONB,
                usuario_id INTEGER,
                duracion_ms INTEGER
            );
        `;
        
        await pool.query(crearTablaSyncLog);
        console.log('[PRESUPUESTOS-BACK] ✅ Tabla presupuestos_sync_log verificada/creada');
        
        // Insertar configuración por defecto si no existe
        const verificarConfig = `
            SELECT COUNT(*) as total FROM presupuestos_config WHERE activo = true
        `;
        
        const configResult = await pool.query(verificarConfig);
        const tieneConfig = parseInt(configResult.rows[0].total) > 0;
        
        if (!tieneConfig) {
            console.log('[PRESUPUESTOS-BACK] 🔧 Insertando configuración por defecto...');
            
            const insertarConfigDefault = `
                INSERT INTO presupuestos_config (
                    hoja_url, 
                    hoja_id, 
                    hoja_nombre, 
                    rango, 
                    activo, 
                    usuario_id
                ) VALUES (
                    'https://docs.google.com/spreadsheets/d/1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8/edit',
                    '1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8',
                    'PresupuestosCopia',
                    'A:Z',
                    true,
                    1
                )
            `;
            
            await pool.query(insertarConfigDefault);
            console.log('[PRESUPUESTOS-BACK] ✅ Configuración por defecto insertada');
        } else {
            console.log('[PRESUPUESTOS-BACK] ✅ Configuración existente encontrada');
        }
        
        // Verificar datos existentes
        const contarPresupuestos = `SELECT COUNT(*) as total FROM presupuestos WHERE activo = true`;
        const presupuestosResult = await pool.query(contarPresupuestos);
        const totalPresupuestos = parseInt(presupuestosResult.rows[0].total);
        
        console.log(`[PRESUPUESTOS-BACK] 📊 Total presupuestos en BD: ${totalPresupuestos}`);
        
        if (totalPresupuestos === 0) {
            console.log('[PRESUPUESTOS-BACK] ⚠️ No hay datos en la BD. Se requiere sincronización con Google Sheets.');
        }
        
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
