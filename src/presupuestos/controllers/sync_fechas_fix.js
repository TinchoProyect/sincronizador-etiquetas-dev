console.log('[SYNC-FECHAS-CONTROLLER] Inicializando controlador de corrección de fechas...');

const { ejecutarCorreccionFechas } = require('../../services/gsheets/sync_fechas_fix');

/**
 * CONTROLADOR DE CORRECCIÓN DE FECHAS
 * API endpoints para la corrección definitiva de fechas DD/MM/YYYY
 */

/**
 * Ejecutar corrección completa de fechas
 * POST /api/presupuestos/sync/corregir-fechas
 */
const ejecutarCorreccion = async (req, res) => {
    console.log('[SYNC-FECHAS-FIX][START] Iniciando corrección de fechas...');
    
    try {
        const { hoja_url, sheetId, sheetName, dryRun = false } = req.body;
        
        // PASO 1: Obtener configuración (por defecto o del payload)
        let config = null;
        
        // Opción A: Usar configuración del payload
        if (hoja_url || sheetId) {
            console.log('[VALIDATION] Usando configuración del payload...');
            
            let hojaId = sheetId;
            let hojaUrl = hoja_url;
            
            // Si se proporciona URL, extraer ID
            if (hoja_url && !sheetId) {
                const hojaIdMatch = hoja_url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
                if (!hojaIdMatch) {
                    console.log('[VALIDATION][ERROR] motivo=URL_INVALIDA');
                    return res.status(400).json({
                        success: false,
                        code: 'INVALID_SHEET_URL',
                        message: 'La URL de Google Sheets proporcionada no es válida',
                        missingFields: [],
                        timestamp: new Date().toISOString()
                    });
                }
                hojaId = hojaIdMatch[1];
            }
            
            // Si se proporciona ID, construir URL
            if (sheetId && !hoja_url) {
                hojaUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
            }
            
            config = {
                hoja_id: hojaId,
                hoja_url: hojaUrl,
                hoja_nombre: sheetName || 'PresupuestosCopia',
                usuario_id: req.user?.id || null
            };
            
        } else {
            // Opción B: Usar configuración persistida por defecto
            console.log('[VALIDATION] Buscando configuración persistida...');
            
            try {
                const configQuery = `
                    SELECT sheet_url, sheet_id 
                    FROM presupuestos_config 
                    WHERE activo = true 
                    ORDER BY fecha_creacion DESC 
                    LIMIT 1
                `;
                
                const configResult = await req.db.query(configQuery);
                
                if (configResult.rows.length > 0) {
                    const configPersistida = configResult.rows[0];
                    console.log('[VALIDATION] Configuración persistida encontrada:', configPersistida.sheet_id);
                    
                    config = {
                        hoja_id: configPersistida.sheet_id,
                        hoja_url: configPersistida.sheet_url,
                        hoja_nombre: 'PresupuestosCopia',
                        usuario_id: req.user?.id || null
                    };
                } else {
                    // Usar configuración hardcodeada como último recurso
                    console.log('[VALIDATION] Usando configuración por defecto hardcodeada...');
                    
                    config = {
                        hoja_id: '1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8',
                        hoja_url: 'https://docs.google.com/spreadsheets/d/1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8/edit',
                        hoja_nombre: 'PresupuestosCopia',
                        usuario_id: req.user?.id || null
                    };
                }
                
            } catch (dbError) {
                console.log('[VALIDATION][ERROR] motivo=DB_CONFIG_ERROR, error=', dbError.message);
                
                // Fallback a configuración hardcodeada
                console.log('[VALIDATION] Fallback a configuración hardcodeada...');
                config = {
                    hoja_id: '1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8',
                    hoja_url: 'https://docs.google.com/spreadsheets/d/1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8/edit',
                    hoja_nombre: 'PresupuestosCopia',
                    usuario_id: req.user?.id || null
                };
            }
        }
        
        // PASO 2: Validar configuración final
        if (!config.hoja_id) {
            console.log('[VALIDATION][ERROR] motivo=CONFIG_MISSING');
            return res.status(400).json({
                success: false,
                code: 'CONFIG_MISSING',
                message: 'No se encontró configuración válida. Proporcione sheetId o configure el sistema.',
                missingFields: ['sheetId'],
                timestamp: new Date().toISOString()
            });
        }
        
        console.log('[VALIDATION] Configuración final:', {
            hoja_id: config.hoja_id,
            hoja_nombre: config.hoja_nombre
        });
        
        // PASO 3: Dry Run (si se solicita)
        if (dryRun) {
            console.log('[SYNC-FECHAS-FIX] Ejecutando DRY RUN...');
            
            return res.json({
                success: true,
                dryRun: true,
                message: 'Dry run completado - no se realizaron cambios',
                config: {
                    hoja_id: config.hoja_id,
                    hoja_url: config.hoja_url,
                    hoja_nombre: config.hoja_nombre
                },
                timestamp: new Date().toISOString()
            });
        }
        
        // PASO 4: Ejecutar corrección real
        console.log('[SYNC-FECHAS-FIX] Ejecutando corrección real con config:', config.hoja_id);
        const resultado = await ejecutarCorreccionFechas(config, req.db);
        
        // PASO 5: Respuesta basada en el resultado
        if (resultado.exito) {
            console.log('[SYNC-FECHAS-FIX][END] Corrección exitosa - fechas_futuras=', resultado.fechasFuturas);
            
            res.json({
                success: true,
                message: 'Corrección de fechas completada exitosamente',
                duracionSegundos: Math.round(resultado.duracionMs / 1000),
                resumen: {
                    datosLeidos: resultado.datosLeidos,
                    datosInsertados: resultado.datosInsertados,
                    fechasCorregidas: resultado.fechasCorregidas,
                    fechasNulas: resultado.fechasNulas,
                    fechasFuturas: resultado.fechasFuturas,
                    errores: resultado.errores.length
                },
                ejemplosCorreccion: resultado.ejemplosCorreccion,
                timestamp: new Date().toISOString()
            });
        } else {
            console.log('[SYNC-FECHAS-FIX][END] Corrección falló - errores=', resultado.errores.length);
            
            res.status(500).json({
                success: false,
                code: 'CORRECTION_FAILED',
                message: 'Error en la corrección de fechas',
                errores: resultado.errores,
                timestamp: new Date().toISOString()
            });
        }
        
    } catch (error) {
        console.error('[SYNC-FECHAS-FIX][ERROR] Error en corrección:', error.message);
        res.status(500).json({
            success: false,
            code: 'INTERNAL_ERROR',
            message: 'Error interno en corrección de fechas',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener estadísticas actuales de fechas
 * GET /api/presupuestos/sync/estadisticas-fechas
 */
const obtenerEstadisticasFechas = async (req, res) => {
    console.log('[SYNC-FECHAS-CONTROLLER] Obteniendo estadísticas de fechas...');
    
    try {
        // Consultas para estadísticas de fechas
        const queries = {
            total: 'SELECT COUNT(*) as count FROM presupuestos WHERE activo = true',
            conFecha: 'SELECT COUNT(*) as count FROM presupuestos WHERE activo = true AND fecha IS NOT NULL',
            sinFecha: 'SELECT COUNT(*) as count FROM presupuestos WHERE activo = true AND fecha IS NULL',
            fechasFuturas: 'SELECT COUNT(*) as count FROM presupuestos WHERE activo = true AND fecha > CURRENT_DATE',
            fechasAnteriores2020: 'SELECT COUNT(*) as count FROM presupuestos WHERE activo = true AND fecha < \'2020-01-01\'',
            fechasRecientes: 'SELECT COUNT(*) as count FROM presupuestos WHERE activo = true AND fecha >= \'2020-01-01\' AND fecha <= CURRENT_DATE'
        };
        
        const estadisticas = {};
        
        for (const [key, query] of Object.entries(queries)) {
            const result = await req.db.query(query);
            estadisticas[key] = parseInt(result.rows[0].count);
        }
        
        // Obtener muestra de fechas futuras si existen
        let muestraFechasFuturas = [];
        if (estadisticas.fechasFuturas > 0) {
            const muestraQuery = `
                SELECT id_presupuesto_ext, fecha, tipo_comprobante 
                FROM presupuestos 
                WHERE activo = true AND fecha > CURRENT_DATE 
                ORDER BY fecha DESC 
                LIMIT 5
            `;
            const muestraResult = await req.db.query(muestraQuery);
            muestraFechasFuturas = muestraResult.rows;
        }
        
        // Obtener distribución por año
        const distribucionQuery = `
            SELECT 
                EXTRACT(YEAR FROM fecha) as año,
                COUNT(*) as cantidad
            FROM presupuestos 
            WHERE activo = true AND fecha IS NOT NULL
            GROUP BY EXTRACT(YEAR FROM fecha)
            ORDER BY año DESC
            LIMIT 10
        `;
        const distribucionResult = await req.db.query(distribucionQuery);
        
        res.json({
            success: true,
            estadisticas: {
                totalRegistros: estadisticas.total,
                conFecha: estadisticas.conFecha,
                sinFecha: estadisticas.sinFecha,
                fechasFuturas: estadisticas.fechasFuturas,
                fechasAnteriores2020: estadisticas.fechasAnteriores2020,
                fechasRecientes: estadisticas.fechasRecientes,
                porcentajeConFecha: estadisticas.total > 0 ? 
                    Math.round((estadisticas.conFecha / estadisticas.total) * 100) : 0
            },
            muestraFechasFuturas: muestraFechasFuturas,
            distribucionPorAño: distribucionResult.rows,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[SYNC-FECHAS-CONTROLLER] Error obteniendo estadísticas:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener estadísticas de fechas',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener historial de correcciones
 * GET /api/presupuestos/sync/historial-correcciones
 */
const obtenerHistorialCorrecciones = async (req, res) => {
    console.log('[SYNC-FECHAS-CONTROLLER] Obteniendo historial de correcciones...');
    
    try {
        const { limit = 10, offset = 0 } = req.query;
        
        const historialQuery = `
            SELECT 
                id,
                registros_procesados,
                registros_nuevos,
                registros_actualizados,
                errores,
                fecha_sync,
                exitoso,
                duracion_segundos,
                usuario_id
            FROM presupuestos_sync_log 
            ORDER BY fecha_sync DESC 
            LIMIT $1 OFFSET $2
        `;
        
        const countQuery = 'SELECT COUNT(*) as total FROM presupuestos_sync_log';
        
        const [historialResult, countResult] = await Promise.all([
            req.db.query(historialQuery, [parseInt(limit), parseInt(offset)]),
            req.db.query(countQuery)
        ]);
        
        res.json({
            success: true,
            historial: historialResult.rows,
            pagination: {
                total: parseInt(countResult.rows[0].total),
                limit: parseInt(limit),
                offset: parseInt(offset)
            },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[SYNC-FECHAS-CONTROLLER] Error obteniendo historial:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener historial de correcciones',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Validar configuración antes de corrección
 * POST /api/presupuestos/sync/validar-configuracion
 */
const validarConfiguracion = async (req, res) => {
    console.log('[SYNC-FECHAS-CONTROLLER] Validando configuración...');
    
    try {
        const { hoja_url, sheetId } = req.body;
        
        // Si no se proporciona nada, buscar configuración persistida
        if (!hoja_url && !sheetId) {
            try {
                const configQuery = `
                    SELECT sheet_url, sheet_id 
                    FROM presupuestos_config 
                    WHERE activo = true 
                    ORDER BY fecha_creacion DESC 
                    LIMIT 1
                `;
                
                const configResult = await req.db.query(configQuery);
                
                if (configResult.rows.length > 0) {
                    const config = configResult.rows[0];
                    return res.json({
                        success: true,
                        message: 'Configuración persistida encontrada',
                        configuracion: {
                            hoja_id: config.sheet_id,
                            hoja_url: config.sheet_url,
                            origen: 'persistida'
                        },
                        timestamp: new Date().toISOString()
                    });
                } else {
                    // Usar configuración por defecto
                    return res.json({
                        success: true,
                        message: 'Usando configuración por defecto',
                        configuracion: {
                            hoja_id: '1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8',
                            hoja_url: 'https://docs.google.com/spreadsheets/d/1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8/edit',
                            origen: 'por_defecto'
                        },
                        timestamp: new Date().toISOString()
                    });
                }
            } catch (dbError) {
                return res.status(400).json({
                    success: false,
                    code: 'CONFIG_MISSING',
                    message: 'No se encontró configuración y hay error de base de datos',
                    missingFields: ['sheetId', 'hoja_url'],
                    timestamp: new Date().toISOString()
                });
            }
        }
        
        // Validar configuración proporcionada
        let hojaId = sheetId;
        
        if (hoja_url && !sheetId) {
            const hojaIdMatch = hoja_url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
            if (!hojaIdMatch) {
                return res.status(400).json({
                    success: false,
                    code: 'INVALID_SHEET_URL',
                    message: 'URL de Google Sheets inválida',
                    missingFields: [],
                    timestamp: new Date().toISOString()
                });
            }
            hojaId = hojaIdMatch[1];
        }
        
        res.json({
            success: true,
            message: 'Configuración válida',
            configuracion: {
                hoja_id: hojaId,
                hoja_url: hoja_url || `https://docs.google.com/spreadsheets/d/${hojaId}/edit`,
                hojas_esperadas: ['Presupuestos', 'DetallesPresupuestos'],
                origen: 'proporcionada'
            },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[SYNC-FECHAS-CONTROLLER] Error validando configuración:', error);
        res.status(500).json({
            success: false,
            error: 'Error al validar configuración',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

console.log('[SYNC-FECHAS-CONTROLLER] ✅ Controlador de corrección de fechas configurado');

module.exports = {
    ejecutarCorreccion,
    obtenerEstadisticasFechas,
    obtenerHistorialCorrecciones,
    validarConfiguracion
};
