console.log('[SYNC-FECHAS-CONTROLLER] Inicializando controlador de corrección de fechas...');

const { readSheetWithHeaders } = require('../../services/gsheets/client_with_logs');
const { ejecutarCorreccionFechas } = require('../../services/gsheets/sync_fechas_fix');

// Función helper para formato de fecha simple (d/m/yyyy)
function toSheetDate(val) {
    if (!val) return '';
    const d = new Date(val);
    if (isNaN(d)) {
        // si ya viene en texto d/m/yyyy, lo dejamos
        return String(val);
    }
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

// Función helper para formato de fecha AppSheet Argentina
function toSheetDateTimeAR(value) {
    const d = value ? new Date(value) : new Date();
    // Forzamos zona horaria de Argentina para que coincida con AppSheet/Sheets
    const f = new Intl.DateTimeFormat('es-AR', {
        timeZone: 'America/Argentina/Buenos_Aires',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    }).formatToParts(d);
    const parts = Object.fromEntries(f.map(p => [p.type, p.value]));
    return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}

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
            
            // Reemplazo: no usar hojaId ni hojaUrl directamente, sino leer desde presupuestos_config
            const { rows: [cfg] } = await req.db.query(`
                SELECT hoja_id, hoja_nombre, hoja_url, COALESCE(usuario_id, 1) AS usuario_id
                FROM presupuestos_config
                WHERE activo = true
                ORDER BY id DESC
                LIMIT 1
            `);
            
            config = {
                hoja_id:   cfg.hoja_id,
                hoja_nombre: cfg.hoja_nombre,
                hoja_url:  cfg.hoja_url,
                usuario_id: cfg.usuario_id
            };
            
        } else {
            // Opción B: Usar configuración persistida por defecto
            console.log('[VALIDATION] Buscando configuración persistida...');
            
            try {
                const configQuery = `
                    SELECT hoja_id, hoja_nombre, hoja_url, COALESCE(usuario_id, 1) AS usuario_id
                    FROM presupuestos_config
                    WHERE activo = true
                    ORDER BY id DESC
                    LIMIT 1
                `;
                
                const configResult = await req.db.query(configQuery);
                
                if (configResult.rows.length > 0) {
                    const configPersistida = configResult.rows[0];
                    console.log('[VALIDATION] Configuración persistida encontrada:', configPersistida.hoja_id);
                    
                    config = {
                        hoja_id: configPersistida.hoja_id,
                        hoja_url: configPersistida.hoja_url,
                        hoja_nombre: configPersistida.hoja_nombre,
                        usuario_id: configPersistida.usuario_id
                    };
                } else {
                    // Usar configuración hardcodeada como último recurso
                    console.log('[VALIDATION] Usando configuración por defecto hardcodeada...');
                    
                    config = {
                        hoja_id: '1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8',
                        hoja_url: 'https://docs.google.com/spreadsheets/d/1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8/edit',
                        hoja_nombre: 'PresupuestosCopia',
                        usuario_id: 1
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
                    usuario_id: 1
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
            
            // PASO 6: Registrar log de sincronización exitosa con hora local de Argentina
            try {
                await req.db.query(
                    `INSERT INTO public.presupuestos_sync_log (fecha_sync, exitoso, origen)
                     VALUES (CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires', true, 'service_account')`
                );
                console.log('[SYNC-FECHAS-FIX] ✅ Log de sincronización registrado con hora local');
            } catch (logError) {
                console.warn('[SYNC-FECHAS-FIX] ⚠️ presupuestos_sync_log no disponible. Continúo.', logError.code || logError.message);
            }
            
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

/**
 * Ejecutar push ligero de ALTAS locales a Google Sheets
 * POST /api/presupuestos/sync/push-altas
 */
const ejecutarPushAltas = async (req, res) => {
    console.log('[PUSH-ALTAS] Iniciando push de ALTAS locales...');
    
    try {
        // PASO 1: Resolver configuración (igual que ejecutarCorreccion)
        let config = null;
        
        // Buscar configuración persistida
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
                console.log('[PUSH-ALTAS] Configuración persistida encontrada:', configPersistida.sheet_id);
                
                config = {
                    hoja_id: configPersistida.sheet_id,
                    hoja_url: configPersistida.sheet_url,
                    hoja_nombre: 'PresupuestosCopia',
                    usuario_id: req.user?.id || null
                };
            } else {
                // Usar configuración por defecto
                console.log('[PUSH-ALTAS] Usando configuración por defecto...');
                
                config = {
                    hoja_id: '1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8',
                    hoja_url: 'https://docs.google.com/spreadsheets/d/1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8/edit',
                    hoja_nombre: 'PresupuestosCopia',
                    usuario_id: req.user?.id || null
                };
            }
            
        } catch (dbError) {
            console.log('[PUSH-ALTAS] Error DB, usando configuración por defecto:', dbError.message);
            
            config = {
                hoja_id: '1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8',
                hoja_url: 'https://docs.google.com/spreadsheets/d/1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8/edit',
                hoja_nombre: 'PresupuestosCopia',
                usuario_id: req.user?.id || null
            };
        }
        
        // PASO 2: Validar configuración
        if (!config.hoja_id) {
            console.log('[PUSH-ALTAS] Error: No se encontró configuración válida');
            return res.status(400).json({
                success: false,
                code: 'CONFIG_MISSING',
                message: 'No se encontró configuración válida',
                timestamp: new Date().toISOString()
            });
        }
        
        console.log('[PUSH-ALTAS] Configuración final:', {
            hoja_id: config.hoja_id,
            hoja_nombre: config.hoja_nombre
        });
        
        // PASO 3: Preparar presupuestosData_like mínimo
        console.log('[PUSH-ALTAS] Leyendo datos actuales de Sheets...');
        const pres = await readSheetWithHeaders(config.hoja_id, 'A:P', 'Presupuestos');
        const presupuestosData_like = { 
            headers: pres.headers, 
            rows: pres.rows 
        };
        
        console.log('[PUSH-ALTAS] Datos leídos:', {
            headers: presupuestosData_like.headers.length,
            rows: presupuestosData_like.rows.length
        });
        
        // PASO 4: Ejecutar push de ALTAS usando las funciones del servicio
        console.log('[PUSH-ALTAS] Ejecutando pushAltasLocalesASheets...');
        
        // Importar las funciones del servicio
        const { pushAltasLocalesASheets, pushDetallesLocalesASheets } = require('../../services/gsheets/sync_fechas_fix');
        
        const insertedIds = await pushAltasLocalesASheets(presupuestosData_like, config, req.db);
        
        console.log('[PUSH-ALTAS] insertedHeaders=', insertedIds?.size || 0);
        
        // PASO 5: Ejecutar push de DETALLES
        console.log('[PUSH-ALTAS] Ejecutando pushDetallesLocalesASheets...');
        await pushDetallesLocalesASheets(insertedIds, config, req.db);
        
        console.log('[PUSH-ALTAS] Push completado exitosamente');
        
        // PASO 6: Responder
        res.json({
            success: true,
            insertedHeaders: insertedIds ? insertedIds.size : 0,
            insertedDetails: null, // pushDetallesLocalesASheets no retorna número
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[PUSH-ALTAS] Error en push de ALTAS:', error.message);
        res.status(500).json({
            success: false,
            code: 'PUSH_ERROR',
            message: 'Error interno en push de ALTAS',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Ejecutar sincronización bidireccional (push + pull) con regla "gana el último cambio"
 * POST /api/presupuestos/sync/bidireccional
 * 
 * ORDEN CORREGIDO PARA FIX "DOBLE CLICK":
 * 1. PUSH anulaciones locales → Sheets (primera fase)
 * 2. PUSH altas/updates locales → Sheets  
 * 3. PULL cambios remotos → Local (con tie-break para anulaciones)
 * 
 * IMPLEMENTA FILTROS CUTOFF_AT: Solo procesa registros >= cutoff_at
 */
const ejecutarSincronizacionBidireccional = async (req, res) => {
    console.log('[SYNC-BIDI] Iniciando sincronización bidireccional con filtros cutoff_at...');
    
    try {
        // PASO 1: Resolver configuración y obtener cutoff_at
        let config = null;
        let cutoffAt = null;
        
        try {
            const configQuery = `
                SELECT hoja_id, hoja_url, hoja_nombre, cutoff_at, usuario_id
                FROM presupuestos_config 
                WHERE activo = true 
                ORDER BY fecha_creacion DESC 
                LIMIT 1
            `;
            
            const configResult = await req.db.query(configQuery);
            
            if (configResult.rows.length > 0) {
                const configPersistida = configResult.rows[0];
                console.log('[SYNC-BIDI] Configuración persistida encontrada:', configPersistida.hoja_id);
                
                config = {
                    hoja_id: configPersistida.hoja_id,
                    hoja_url: configPersistida.hoja_url,
                    hoja_nombre: configPersistida.hoja_nombre || 'PresupuestosCopia',
                    usuario_id: configPersistida.usuario_id || req.user?.id || null
                };
                cutoffAt = configPersistida.cutoff_at;
            } else {
                console.log('[SYNC-BIDI] Usando configuración por defecto...');
                
                config = {
                    hoja_id: '1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8',
                    hoja_url: 'https://docs.google.com/spreadsheets/d/1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8/edit',
                    hoja_nombre: 'PresupuestosCopia',
                    usuario_id: req.user?.id || null
                };
            }
            
        } catch (dbError) {
            console.log('[SYNC-BIDI] Error DB, usando configuración por defecto:', dbError.message);
            
            config = {
                hoja_id: '1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8',
                hoja_url: 'https://docs.google.com/spreadsheets/d/1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8/edit',
                hoja_nombre: 'PresupuestosCopia',
                usuario_id: req.user?.id || null
            };
        }
        
        if (!config.hoja_id) {
            console.log('[SYNC-BIDI] Error: No se encontró configuración válida');
            return res.status(400).json({
                success: false,
                code: 'CONFIG_MISSING',
                message: 'No se encontró configuración válida',
                timestamp: new Date().toISOString()
            });
        }
        
        // VALIDAR CUTOFF_AT
        if (!cutoffAt) {
            console.log('[SYNC-BIDI] Error: cutoff_at no configurado');
            return res.status(400).json({
                success: false,
                code: 'CUTOFF_MISSING',
                message: 'cutoff_at no está configurado en presupuestos_config',
                timestamp: new Date().toISOString()
            });
        }
        
        console.log('[SYNC-BIDI] Configuración final:', {
            hoja_id: config.hoja_id,
            hoja_nombre: config.hoja_nombre,
            cutoff_at: cutoffAt
        });
        
        // Agregar cutoff_at a config para pasarlo a las funciones
        config.cutoff_at = cutoffAt;
        
        const AUTO_SYNC_ENABLED = process.env.AUTO_SYNC_ENABLED ?? 'false';
        const GSHEETS_DEBUG = process.env.GSHEETS_DEBUG ?? 'false';
        console.log(`[DIAG-SYNC] start route=POST /api/presupuestos/sync/bidireccional sheetId=${config?.hoja_id} flags={AUTO_SYNC_ENABLED: ${AUTO_SYNC_ENABLED}, GSHEETS_DEBUG: ${GSHEETS_DEBUG}}`);
        
        // PASO 2: Leer datos actuales de Sheets
        console.log('[SYNC-BIDI] Leyendo datos actuales de Sheets...');
        const presupuestosSheets = await readSheetWithHeaders(config.hoja_id, 'A:P', 'Presupuestos');
        const detallesSheets = await readSheetWithHeaders(config.hoja_id, 'A:Q', 'DetallesPresupuestos');
        
        console.log('[SYNC-BIDI] Datos leídos de Sheets:', {
            presupuestos: presupuestosSheets.rows.length,
            detalles: detallesSheets.rows.length
        });
        
        const presupuestosData_like = { 
            headers: presupuestosSheets.headers, 
            rows: presupuestosSheets.rows 
        };
        
        // ===== FASE 1: PUSH ANULACIONES (FIX CRÍTICO) =====
        console.log('[SYNC-BTN] === FASE 1: PUSH ANULACIONES ===');
        const countAnulados = await marcarAnuladosEnSheetsConConteo(presupuestosData_like, config, req.db);
        console.log(`[SYNC-BTN] phase=push-deletes count=${countAnulados}`);
        
        // ===== FASE 2: PUSH ALTAS/UPDATES =====
        console.log('[SYNC-BTN] === FASE 2: PUSH ALTAS/UPDATES ===');
        
        // === DIAG: última edición local y conjunto de editados (solo log) ===
        try {
          // Si ya existen variables locales con estos datos, usalas para loguear; si no, calculá aquí sin cambiar la lógica del flujo.
          const localRows = typeof localLastEdits !== 'undefined'
            ? localLastEdits
            : (await req.db.query(`
                SELECT p.id_presupuesto_ext AS id,
                       GREATEST(
                         MAX(COALESCE(p.fecha_actualizacion,'epoch'::timestamp)),
                         MAX(COALESCE(d.fecha_actualizacion,'epoch'::timestamp))
                       ) AS local_last_edit
                FROM presupuestos p
                LEFT JOIN presupuestos_detalles d ON d.id_presupuesto = p.id
                WHERE p.activo = true
                GROUP BY p.id_presupuesto_ext;
              `)).rows;

          console.log('[DIAG-LOCAL] count=%d sample=%o',
            Array.isArray(localRows) ? localRows.length : 0,
            Array.isArray(localRows) ? localRows.slice(0,5) : []
          );

          // Construir mapa de LastModified remoto desde 'presupuestosSheets' ya leído arriba
          const idCol = presupuestosSheets.headers[0];       // "IDPresupuesto"
          const lmCol = presupuestosSheets.headers[13];      // "LastModified"
          const remoteLM = new Map(
            presupuestosSheets.rows.map(r => [ r[idCol], r[lmCol] ])
          );

          // Intento de set de editados solo para diagnóstico (no altera el flujo)
          const parseLM = (v) => {
            // Maneja string tipo "14/09/2025 3:05:01" o número excel (45914)
            if (typeof v === 'number') { // excel serial date
              const ms = (v - 25569) * 86400 * 1000;
              return new Date(ms);
            }
            return new Date(v);
          };

          const editedIds = new Set();
          const debugComparisons = [];
          
          localRows.forEach(row => {
            const rlm = remoteLM.get(row.id);
            if (!rlm) {
              editedIds.add(row.id);
              debugComparisons.push({
                id: row.id,
                reason: 'ALTA_LOCAL_NO_EXISTE_REMOTO',
                localDate: row.local_last_edit,
                remoteDate: 'N/A'
              });
              return;
            }
            
            const rDate = parseLM(rlm);
            const lDate = new Date(row.local_last_edit);
            
            debugComparisons.push({
              id: row.id,
              localDate: lDate.toISOString(),
              remoteDate: rDate.toISOString(),
              localNewer: lDate > rDate,
              timeDiffMinutes: Math.round((lDate - rDate) / (1000 * 60))
            });
            
            if (lDate > rDate) {
              editedIds.add(row.id);
            }
          });

          console.log('[DIAG-EDIT-SET] size=%d sample=%o',
            editedIds.size,
            Array.from(editedIds).slice(0,5)
          );
          
          // Log detallado de comparaciones (primeros 10)
          console.log('[DIAG-TIMESTAMP-COMPARISON] Primeras 10 comparaciones:');
          debugComparisons.slice(0, 10).forEach((comp, i) => {
            console.log(`[DIAG-TIMESTAMP-COMPARISON] ${i+1}. ID: ${comp.id}`);
            console.log(`   Local: ${comp.localDate}, Remoto: ${comp.remoteDate}`);
            console.log(`   Local más nuevo: ${comp.localNewer}, Diff: ${comp.timeDiffMinutes || 'N/A'} min`);
            console.log(`   Razón: ${comp.reason || (comp.localNewer ? 'LOCAL_NEWER' : 'REMOTE_NEWER_OR_EQUAL')}`);
          });
        } catch (e) {
          console.log('[DIAG-EDIT-SET] error_en_diag', e?.message || e);
        }
        
        const { pushAltasLocalesASheets, pushDetallesLocalesASheets, pushDetallesModificadosASheets } = require('../../services/gsheets/sync_fechas_fix');
        
        // Releer después de marcar anulados
        const presupuestosActualizados1 = await readSheetWithHeaders(config.hoja_id, 'A:P', 'Presupuestos');
        const presupuestosData_updated = { 
            headers: presupuestosActualizados1.headers, 
            rows: presupuestosActualizados1.rows 
        };
        
        // USAR LA FUNCIÓN DEL SERVICIO que tiene filtros cutoff_at correctos
        const { pushCambiosLocalesConTimestamp } = require('../../services/gsheets/sync_fechas_fix');
        const result = await pushCambiosLocalesConTimestamp(presupuestosData_updated, config, req.db);
        const confirmedIds = new Set([...(result.insertedIds || []), ...(result.modifiedIds || [])]);
        
        // SIMPLIFICACIÓN CRÍTICA: pushDetallesLocalesASheets ya maneja la sincronización completa
        // No necesitamos eliminar detalles en Sheets porque:
        // 1. Los detalles se eliminan en LOCAL antes de insertar (en pushDetallesLocalesASheets)
        // 2. Los nuevos detalles se insertan en Sheets con IDs únicos
        // 3. La eliminación en Sheets era innecesaria y causaba lentitud
        console.log('[SYNC-BTN] === SINCRONIZANDO DETALLES PARA PRESUPUESTOS NUEVOS Y MODIFICADOS ===');
        
        // ===== FASE 2B: PUSH DETALLES PARA PRESUPUESTOS NUEVOS Y MODIFICADOS (FLUJO ORIGINAL RESTAURADO) =====
        console.log('[SYNC-BTN] === FASE 2B: PUSH DETALLES PARA PRESUPUESTOS NUEVOS Y MODIFICADOS ===');
        
        if (confirmedIds && confirmedIds.size > 0) {
            console.log('[SYNC-BTN] Sincronizando detalles usando flujo original (pushDetallesLocalesASheets)...');
            await pushDetallesLocalesASheets(confirmedIds, config, req.db);
        }
        
        console.log(`[SYNC-BTN] phase=push-upserts count=${confirmedIds?.size || 0}`);
        
        // ===== FASE 3: PULL CAMBIOS REMOTOS (SOLO PARA PRESUPUESTOS NO MODIFICADOS LOCALMENTE) =====
        console.log('[SYNC-BTN] === FASE 3: PULL CAMBIOS REMOTOS ===');
        
        // Releer Sheets después de todos los pushes
        const presupuestosFinales = await readSheetWithHeaders(config.hoja_id, 'A:P', 'Presupuestos');
        const detallesFinales = await readSheetWithHeaders(config.hoja_id, 'A:Q', 'DetallesPresupuestos');
        
        // CRÍTICO: Excluir del PULL los IDs que fueron modificados localmente
        const pullResult = await pullCambiosRemotosConTimestampMejorado(presupuestosFinales, detallesFinales, config, req.db, confirmedIds);
        
        console.log(`[SYNC-BTN] phase=pull count=${pullResult.recibidos + pullResult.actualizados}`);
        
        // PASO 4: Registrar log de sincronización con contadores completos
        try {
            const totalProcesados = (confirmedIds ? confirmedIds.size : 0) + pullResult.recibidos + pullResult.actualizados;
            const totalOmitidos = (pullResult.omitidosPorCutoff || 0) + (pullResult.omitidosPorSinFecha || 0);
            
            await req.db.query(`
                INSERT INTO public.presupuestos_sync_log 
                (fecha_sync, exitoso, registros_procesados, registros_nuevos, registros_actualizados, 
                 detalles, tipo_sync, usuario_id)
                VALUES (
                    CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires', 
                    true, 
                    $1, 
                    $2, 
                    $3, 
                    $4, 
                    'bidireccional_manual', 
                    $5
                )
            `, [
                totalProcesados,
                pullResult.recibidos + (confirmedIds ? confirmedIds.size : 0),
                pullResult.actualizados,
                JSON.stringify({
                    push_deletes: countAnulados,
                    push_upserts: confirmedIds ? confirmedIds.size : 0,
                    pull_recibidos: pullResult.recibidos,
                    pull_actualizados: pullResult.actualizados,
                    pull_omitidos: pullResult.omitidos,
                    omitidos_por_cutoff: pullResult.omitidosPorCutoff || 0,
                    omitidos_por_sin_fecha: pullResult.omitidosPorSinFecha || 0,
                    cutoff_at: config.cutoff_at
                }),
                config.usuario_id
            ]);
            console.log('[SYNC-BIDI] ✅ Log de sincronización registrado con contadores completos');
            
            // CRÍTICO: Actualizar cutoff_at AL FINAL de la sincronización
            const ahoraAR = new Date();
            await req.db.query(`
                UPDATE presupuestos_config 
                SET cutoff_at = $1
                WHERE activo = true
            `, [ahoraAR]);
            console.log('[SYNC-BIDI] ✅ cutoff_at actualizado AL FINAL a:', ahoraAR.toISOString());
            
            // VERIFICACIÓN: Confirmar que NO hay registros que pasen el nuevo filtro
            const verificacionPresupuestos = await req.db.query(`
                SELECT COUNT(*) as count
                FROM presupuestos p
                WHERE p.activo = true 
                  AND p.id_presupuesto_ext IS NOT NULL
                  AND p.fecha_actualizacion >= $1
            `, [ahoraAR]);
            
            const verificacionDetalles = await req.db.query(`
                SELECT COUNT(*) as count
                FROM presupuestos_detalles d
                INNER JOIN presupuestos p ON p.id_presupuesto_ext = d.id_presupuesto_ext
                WHERE p.activo = true 
                  AND d.fecha_actualizacion >= $1
            `, [ahoraAR]);
            
            console.log('[SYNC-BIDI] 🔍 Verificación post-actualización cutoff_at:');
            console.log(`   Presupuestos > nuevo_cutoff: ${verificacionPresupuestos.rows[0].count}`);
            console.log(`   Detalles > nuevo_cutoff: ${verificacionDetalles.rows[0].count}`);
            
            if (verificacionPresupuestos.rows[0].count == 0 && verificacionDetalles.rows[0].count == 0) {
                console.log('[SYNC-BIDI] ✅ PERFECTO: Próxima sync NO procesará registros antiguos');
            } else {
                console.log('[SYNC-BIDI] ⚠️ ADVERTENCIA: Aún hay registros que pasarían el filtro');
            }
            
        } catch (logError) {
            console.warn('[SYNC-BIDI] ⚠️ Error registrando log:', logError.message);
        }
        
        // PASO 5: Responder con resumen
        res.json({
            success: true,
            fases: {
                push_deletes: countAnulados,
                push_upserts: confirmedIds ? confirmedIds.size : 0,
                pull: pullResult.recibidos + pullResult.actualizados
            },
            push: {
                enviados: confirmedIds ? confirmedIds.size : 0,
                detallesEnviados: null,
                anulados: countAnulados
            },
            pull: {
                recibidos: pullResult.recibidos,
                actualizados: pullResult.actualizados,
                omitidos: pullResult.omitidos,
                omitidosPorCutoff: pullResult.omitidosPorCutoff || 0,
                omitidosPorSinFecha: pullResult.omitidosPorSinFecha || 0
            },
            cutoff_at: config.cutoff_at,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[SYNC-BIDI] Error en sincronización bidireccional:', error.message);
        res.status(500).json({
            success: false,
            code: 'SYNC_BIDI_ERROR',
            message: 'Error interno en sincronización bidireccional',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Push de cambios locales con detección de MODIFICACIONES (CONTROLADOR LOCAL)
 * IMPLEMENTA: Detectar editados y reemplazar filas existentes en Sheets
 * SOLUCIÓN AL PROBLEMA: local_last_edit > LastModified de Sheets
 */
async function pushCambiosLocalesConTimestampLocal(presupuestosData, config, db) {
  console.log('[SYNC-BTN] phase=push-updates iniciando...');
  
  console.log('[PUSH-HEAD] start', {
    hoja: config.hoja_nombre,
    hojaId: config.hoja_id,
    cutoffAt: (config.cutoff_at?.toISOString?.() || config.cutoff_at)
  });

  try {
    const { getSheets } = require('../../google/gsheetsClient');
    const sheets = await getSheets();

    // ==== 1) Construir remoteById = Map(IDPresupuesto → { lastModified, _rowIndex }) ====
    const remoteById = new Map();
    presupuestosData.rows.forEach((row, i) => {
      const id = (row[presupuestosData.headers[0]] || '').toString().trim();
      const lastModified = row[presupuestosData.headers[13]] || '';
      if (id) {
        remoteById.set(id, { 
          lastModified, 
          _rowIndex: i + 2  // +2 porque fila 1 es header
        });
      }
    });

    console.log('[SYNC-BTN] remoteById construido:', remoteById.size, 'registros');

    // ==== 2) Calcular local_last_edit por ID CON FILTRO CUTOFF_AT ====
    const cutoffAt = config.cutoff_at || new Date(Date.now() - 7*24*60*60*1000);
    console.log('[SYNC-BTN] Aplicando filtro cutoff_at:', cutoffAt);
    
    // PASO 2A: Generar id_presupuesto_ext para presupuestos sin ID externo
    const { generatePresupuestoId } = require('../../services/gsheets/idGenerator');
    
    const presupuestosSinIdQuery = `
      SELECT p.id, p.fecha_actualizacion
      FROM presupuestos p
      WHERE p.activo = true 
        AND p.id_presupuesto_ext IS NULL
        AND p.fecha_actualizacion >= $1  -- Incluye iguales a cutoff_at
      ORDER BY p.fecha_actualizacion DESC
      LIMIT 100
    `;
    
    const rsSinId = await db.query(presupuestosSinIdQuery, [cutoffAt]);
    
    if (rsSinId.rowCount > 0) {
      console.log(`[SYNC-BTN] Generando id_presupuesto_ext para ${rsSinId.rowCount} presupuestos sin ID externo`);
      
      for (const row of rsSinId.rows) {
        const nuevoIdExterno = generatePresupuestoId();
        await db.query(`
          UPDATE public.presupuestos 
          SET id_presupuesto_ext = $1, fecha_actualizacion = NOW()
          WHERE id = $2
        `, [nuevoIdExterno, row.id]);
        
        console.log(`[SYNC-BTN] ID externo generado: ${row.id} → ${nuevoIdExterno}`);
      }
    }
    
    const localLastEditQuery = `
      SELECT
        p.id_presupuesto_ext AS id,
        p.id_cliente,
        p.fecha,
        p.fecha_entrega,
        p.agente,
        p.tipo_comprobante,
        p.nota,
        p.estado,
        p.informe_generado,
        p.cliente_nuevo_id,
        p.punto_entrega,
        p.descuento,
        p.activo,
        GREATEST(
          p.fecha_actualizacion,
          COALESCE(MAX(d.fecha_actualizacion), p.fecha_actualizacion)
        ) AS local_last_edit
      FROM public.presupuestos p
      LEFT JOIN public.presupuestos_detalles d
        ON d.id_presupuesto = p.id
      WHERE p.activo = true
        AND p.id_presupuesto_ext IS NOT NULL
      GROUP BY
        p.id_presupuesto_ext, p.id_cliente, p.fecha, p.fecha_entrega,
        p.agente, p.tipo_comprobante, p.nota, p.estado, p.informe_generado,
        p.cliente_nuevo_id, p.punto_entrega, p.descuento, p.activo, p.fecha_actualizacion
      HAVING GREATEST(
        p.fecha_actualizacion,
        COALESCE(MAX(d.fecha_actualizacion), p.fecha_actualizacion)
      ) > $1  -- ESTRICTO: solo posteriores a última sync
    `;

    const rs = await db.query(localLastEditQuery, [cutoffAt]);
    console.log('[SYNC-BTN] local_last_edit calculado para', rs.rowCount, 'presupuestos (incluyendo IDs recién generados)');
    
    // DIAGNÓSTICO CRÍTICO: Mostrar qué presupuestos se encontraron
    console.log('[SYNC-DIAG] cutoff_at usado:', cutoffAt.toISOString());
    console.log('[SYNC-DIAG] Presupuestos encontrados:', rs.rows.slice(0, 5).map(r => ({
      id: r.id,
      fecha_actualizacion: r.local_last_edit,
      pasaCutoff: new Date(r.local_last_edit) >= cutoffAt
    })));
    
    // DIAGNÓSTICO: Verificar si hay presupuestos que NO pasan el filtro
    const rsAll = await db.query(`
      SELECT p.id_presupuesto_ext AS id, p.fecha_actualizacion, p.activo
      FROM public.presupuestos p
      WHERE p.activo = true AND p.id_presupuesto_ext IS NOT NULL
      ORDER BY p.fecha_actualizacion DESC
      LIMIT 10
    `);
    console.log('[SYNC-DIAG] Todos los presupuestos activos (top 10):', rsAll.rows.map(r => ({
      id: r.id,
      fecha_actualizacion: r.fecha_actualizacion,
      pasaCutoff: new Date(r.fecha_actualizacion) >= cutoffAt
    })));
    
    console.log('[PUSH-HEAD] candidatos', { count: rs.rows.length, sample: rs.rows.slice(0,5).map(r => r.id) });

    // ==== 3) Detectar editados: toUpdate = locales.filter(l => remoteById.has(l.id) && local_last_edit(l) > parse(remote.lastModified)) ====
    const toUpdate = [];
    const toInsert = [];

    // Helper para parsear LastModified que puede venir como string o número Excel
    const parseLastModified = (val) => {
      if (!val) return new Date(0);
      
      // Si es número (Excel serial date)
      if (typeof val === 'number') {
        const excelEpoch = new Date(1900, 0, 1);
        const days = val - 2; // Excel cuenta desde 1900-01-01 pero tiene bug del año bisiesto
        return new Date(excelEpoch.getTime() + days * 24 * 60 * 60 * 1000);
      }
      
      // Si es string, intentar parsear
      try {
        // Formato dd/mm/yyyy hh:mm:ss
        const ddmmyyyyRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/;
        const match = String(val).match(ddmmyyyyRegex);
        if (match) {
          const [, day, month, year, hour, minute, second] = match;
          return new Date(year, month - 1, day, hour, minute, second);
        }
        return new Date(val);
      } catch (e) {
        return new Date(0);
      }
    };

    for (const row of rs.rows) {
      const id = (row.id || '').toString().trim();
      if (!id) continue;

      const localLastEdit = new Date(row.local_last_edit);
      const remote = remoteById.get(id);

      if (!remote) {
        // No existe en Sheets → ALTA
        toInsert.push(row);
        console.log('[SYNC-BTN] ALTA detectada:', id);
      } else {
        // Existe en Sheets → comparar timestamps
        const remoteLastModified = parseLastModified(remote.lastModified);
        
        if (localLastEdit > remoteLastModified) {
          // Local más nuevo → UPDATE
          toUpdate.push({ ...row, _rowIndex: remote._rowIndex });
          console.log('[SYNC-BTN] UPDATE detectado:', id, 
            'local:', localLastEdit.toISOString(), 
            'remote:', remoteLastModified.toISOString());
        }
      }
    }

    console.log(`[SYNC-BTN] phase=push-updates count=${toUpdate.length}`);
    console.log(`[DIAG-UPDATE-ROWS] sample=${JSON.stringify(toUpdate.slice(0,5).map(x=>x.id))}`);

    // ==== 4) Reemplazar filas en Sheets (no append) ====
    const updatedIds = new Set();
    const insertedIds = new Set();

    // ==== 5) Reutilizar el mismo helper de ALTAS (sin armar arrays "a mano") ====
    const { pushAltasLocalesASheets } = require('../../services/gsheets/sync_fechas_fix');
    
    // Importar el helper de mapeo usado en ALTAS
    const toSheetRowPresupuesto = (r) => {
      // Usar EXACTAMENTE el mismo mapeo que las inserciones
      const pctStr = formatDescuentoForSheet(r.descuento);
      const lastModifiedAR = toSheetDateTimeAR(r.local_last_edit || Date.now());

      // Asegurar que ningún campo quede vacío o con valor por defecto incorrecto
      return [
        (r.id ?? '').toString().trim(),                 // A  IDPresupuesto
        toSheetDate(r.fecha),                           // B  Fecha
        r.id_cliente !== undefined && r.id_cliente !== null ? r.id_cliente.toString() : '',  // C  IDCliente
        r.agente !== undefined && r.agente !== null ? r.agente.toString() : '',            // D  Agente
        toSheetDate(r.fecha_entrega),                   // E  Fecha de entrega
        r.tipo_comprobante !== undefined && r.tipo_comprobante !== null ? r.tipo_comprobante.toString() : '', // F  Factura/Efectivo
        r.nota !== undefined && r.nota !== null ? r.nota.toString() : '',                  // G  Nota
        r.estado !== undefined && r.estado !== null ? r.estado.toString() : '',            // H  Estado
        r.informe_generado !== undefined && r.informe_generado !== null ? r.informe_generado.toString() : '', // I  InformeGenerado
        r.cliente_nuevo_id !== undefined && r.cliente_nuevo_id !== null ? r.cliente_nuevo_id.toString() : '', // J  ClienteNuevID
        '',                                             // K  Estado/ImprimePDF
        r.punto_entrega !== undefined && r.punto_entrega !== null ? r.punto_entrega.toString() : '',          // L  PuntoEntrega
        pctStr,                                         // M  Descuento
        lastModifiedAR,                                 // N  LastModified
        r.activo !== false                              // O  Activo
      ];
    };

    // ==== 6) Procesar UPDATES (reemplazar filas existentes con mapeo completo) ====
    const confirmedIds = new Set();
    
    for (const r of toUpdate.slice(0, 20)) { // Limitar para cuidar cuota
      const id = (r.id ?? '').toString().trim();
      const mappedRow = toSheetRowPresupuesto(r);
      const values = [mappedRow];
      const rowIndex = r._rowIndex;

      // Log de muestra de filas ya mapeadas (como en ALTAS)
      if (updatedIds.size < 2) {
        console.log(`[DIAG-UPDATE-MAP] sample=${JSON.stringify({ id, mappedRow: mappedRow.slice(0, 5) })}`);
      }

      try {
        console.log(`[PUSH-HEAD] hoja=${config.hoja_nombre}, id=${config.hoja_id}`);
        await sheets.spreadsheets.values.update({
          spreadsheetId: config.hoja_id,
          range: `${config.hoja_nombre}!A${rowIndex}:O${rowIndex}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values, majorDimension: 'ROWS' }
        });
        updatedIds.add(id);
        confirmedIds.add(id);
        console.log('[SYNC-BTN] UPDATE-OK:', id, `(fila ${rowIndex})`);
      } catch (e) {
        console.warn('[SYNC-BTN] UPDATE-ERR:', id, e?.message);
      }
    }

    // ==== 7) Leer IDs existentes en Sheets para evitar duplicados ====
    const headExisting = await sheets.spreadsheets.values.get({
      spreadsheetId: config.hoja_id,
      range: `${config.hoja_nombre}!A:A`
    });
    const existingHeaderIds = new Set((headExisting.data.values || [])
      .slice(1) // Saltar header
      .map(r => String(r[0] || '').trim())
      .filter(Boolean));

    console.log('[PUSH-HEAD] IDs existentes en Sheets:', existingHeaderIds.size);

    // ==== 8) Procesar INSERTS (append nuevas filas con deduplicación) ====
    const totalLocales = toInsert.length;
    let yaExistentes = 0, aInsertar = 0;
    
    for (const r of toInsert.slice(0, 10)) { // Limitar para cuidar cuota
      const id = String(r.id || '').trim();
      
      if (existingHeaderIds.has(id)) { 
        console.log('[PUSH-HEAD] skip por existente:', id);
        yaExistentes++; 
        continue; 
      }
      
      const mappedRow = toSheetRowPresupuesto(r);
      const values = [mappedRow];

      try {
        console.log(`[PUSH-HEAD] hoja=${config.hoja_nombre}, id=${config.hoja_id}`);
        await sheets.spreadsheets.values.append({
          spreadsheetId: config.hoja_id,
          range: `${config.hoja_nombre}!A1:O1`,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values, majorDimension: 'ROWS' }
        });
        insertedIds.add(id);
        confirmedIds.add(id);
        aInsertar++;
        console.log('[SYNC-BTN] INSERT-OK:', id);
      } catch (e) {
        console.warn('[SYNC-BTN] INSERT-ERR:', id, e?.message);
      }
    }
    
    console.log('[PUSH-HEAD] métricas encabezados:', { totalLocales, yaExistentes, aInsertar });

    // ✅ FIX CRÍTICO CORREGIDO: ACTUALIZACIÓN TOTAL
    // Cuando un presupuesto se modifica, se debe reemplazar COMPLETAMENTE:
    // 1. Reescribir presupuesto en Sheets (ya se hace arriba)
    // 2. Reemplazar TODOS los detalles relacionados por los actuales de local
    
    // Logs claros como solicitó el usuario
    Array.from(updatedIds).forEach(id => console.log('[PUSH-HEAD] UPDATE-OK: %s', id));
    Array.from(insertedIds).forEach(id => console.log('[PUSH-HEAD] INSERT-OK: %s', id));
    
    // Log de existentes pero NO los agregamos a confirmed
    const existingValidIds = new Set();
    for (const r of rs.rows) {
      const id = String(r.id || '').trim();
      if (id && existingHeaderIds.has(id) && !insertedIds.has(id) && !updatedIds.has(id)) {
        existingValidIds.add(id);
      }
    }
    
    Array.from(existingValidIds).forEach(id => console.log('[PUSH-HEAD] skip por existente: %s', id));
    
    // CREAR SET COMBINADO: INSERTADOS + ACTUALIZADOS para sincronización total
    const idsParaSincronizacionTotal = new Set([...insertedIds, ...updatedIds]);
    
    console.log('[PUSH-HEAD] ✅ NUEVOS para sincronización total: %d (inserts=%d)', 
                insertedIds.size, insertedIds.size);
    console.log('[PUSH-HEAD] ✅ MODIFICADOS para sincronización total: %d (updates=%d)', 
                updatedIds.size, updatedIds.size);
    console.log('[PUSH-HEAD] ✅ TOTAL para sincronización completa de detalles: %d', 
                idsParaSincronizacionTotal.size);
    console.log('[PUSH-HEAD] ✅ Otros procesados: existentes=%d', existingValidIds.size);
    
    console.log('[PUSH-HEAD] done', {
      updated: updatedIds.size,
      inserted: insertedIds.size,
      existing: existingValidIds.size,
      confirmed_for_total_sync: idsParaSincronizacionTotal.size,
      sync_breakdown: {
        nuevos_completos: insertedIds.size,
        modificados_reemplazo_total: updatedIds.size
      }
    });
    
    // RETORNAR INSERTADOS + ACTUALIZADOS para sincronización total de detalles
    // Esto garantiza que tanto presupuestos nuevos como modificados 
    // tengan sus detalles completamente sincronizados
    return idsParaSincronizacionTotal;

  } catch (e) {
    console.warn('[SYNC-BTN] Error en push updates:', e?.message);
    return new Set();
  }
}

/**
 * Pull de cambios remotos con comparación de timestamp
 */
async function pullCambiosRemotosConTimestamp(presupuestosSheets, detallesSheets, db) {
    console.log('[SYNC-BIDI] Comparando timestamps para pull...');
    
    let recibidos = 0;
    let actualizados = 0;
    let omitidos = 0;

    const idsCambiados = new Set(); // ← guardamos IDs creados/actualizados

    try {
        // Crear mapa de timestamps locales (incluye inactivos)
        const localTimestamps = new Map();
        const rsLocal = await db.query(`
            SELECT id_presupuesto_ext, fecha_actualizacion, activo
            FROM public.presupuestos
        `);
        
        rsLocal.rows.forEach(row => {
            const id = (row.id_presupuesto_ext || '').toString().trim();
            const timestamp = new Date(row.fecha_actualizacion || 0);
            localTimestamps.set(id, { timestamp, activo: row.activo });
        });

            // Procesar registros de Sheets
            for (const row of presupuestosSheets.rows) {
                const id = (row[presupuestosSheets.headers[0]] || '').toString().trim();
                const sheetLastModified = row[presupuestosSheets.headers[13]]; // columna N
                
                if (!id || !sheetLastModified) continue;
                
                const sheetTimestamp = new Date(parseLastModifiedToDate(sheetLastModified));
                const localData = localTimestamps.get(id); // { timestamp, activo } o undefined

                // Columna O (Activo) en Sheets
                const activoValue = row[presupuestosSheets.headers[14]];
                const esInactivo = String(activoValue ?? '').toLowerCase() === 'false';

                if (!localData) {
                    // No existe localmente: crear solo si en Sheets está ACTIVO
                    if (esInactivo) {
                        console.log('[SYNC-BIDI] Omitiendo presupuesto inactivo de Sheets:', id);
                        omitidos++;
                        continue;
                    }
                    await insertarPresupuestoDesdeSheet(row, presupuestosSheets.headers, db);
                    recibidos++;
                    idsCambiados.add(id);
                    console.log('[SYNC-BIDI] Nuevo desde Sheets:', id);
                } else if (localData.activo === false) {
                    // Existe local pero está inactivo: NO recrear
                    omitidos++;
                    continue;
                } else if (sheetTimestamp > localData.timestamp) {
                    // Sheet más reciente, actualizar local
                    await actualizarPresupuestoDesdeSheet(row, presupuestosSheets.headers, db);
                    actualizados++;
                    idsCambiados.add(id);
                    console.log('[SYNC-BIDI] Actualizado desde Sheets:', id,
                        'sheet:', sheetTimestamp.toISOString(),
                        'local:', localData.timestamp.toISOString());
                } else {
                    // Local más reciente o igual, omitir
                    omitidos++;
                }
            }

            // Si hubo encabezados nuevos/actualizados, traemos sus detalles desde la hoja "DetallesPresupuestos"
            if (idsCambiados.size > 0) {
                try {
                    console.log('[SYNC-BIDI] Sincronizando detalles para presupuestos cambiados:', Array.from(idsCambiados).join(', '));
                // CORRECCIÓN: Eliminar llamada recursiva innecesaria
                // Los detalles ya se sincronizaron arriba en el mismo bucle
                console.log('[SYNC-BIDI] ✅ Detalles ya sincronizados en el bucle principal');
            } catch (e) {
                console.warn('[SYNC-BIDI] No se pudieron sincronizar detalles:', e?.message);
            }
            }

        // MEJORA CRÍTICA CON FILTRO CUTOFF_AT: Solo verificar presupuestos modificados recientemente
        console.log('[SYNC-BIDI] Verificando presupuestos sin detalles locales (solo recientes)...');
        try {
            // FILTRO CRÍTICO: Solo procesar presupuestos que fueron modificados >= cutoff_at
            // Esto evita el procesamiento masivo de todos los detalles existentes
            
            const cutoffAt = new Date(config.cutoff_at);
            console.log('[SYNC-BIDI] Aplicando filtro cutoff_at para verificación de detalles:', cutoffAt.toISOString());
            
            // Función helper para búsqueda robusta de columnas
            const findColumnIndex = (headers, ...candidates) => {
                const normalize = (s) => (s ?? '').toString()
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '') // quitar acentos
                    .replace(/\s+/g, '') // quitar espacios
                    .toLowerCase();
                
                const headerMap = new Map();
                headers.forEach((name, i) => headerMap.set(normalize(name), i));
                
                for (const candidate of candidates) {
                    const hit = headerMap.get(normalize(candidate));
                    if (hit !== undefined) return hit;
                }
                return -1;
            };

            const H = detallesSheets.headers || [];
            const idxId = findColumnIndex(H, 'IDPresupuesto', 'IdPresupuesto', 'ID Presupuesto', 'Id Presupuesto', 'id_presupuesto');
            const idxLastModified = findColumnIndex(H, 'LastModified', 'Last Modified', 'Ultima Modificacion');
            
            if (idxId !== -1) {
                console.log(`[SYNC-BIDI] ✅ Columna de ID encontrada: "${H[idxId]}" (índice ${idxId})`);
                
                // FILTRO CUTOFF_AT: Solo IDs con detalles modificados recientemente en Sheets
                const idsConDetallesRecientes = new Set();
                
                detallesSheets.rows.forEach(r => {
                    const id = String((Array.isArray(r) ? r[idxId] : r[H[idxId]]) ?? '').trim();
                    
                    if (!id) return;
                    
                    // Verificar si el detalle fue modificado recientemente
                    if (idxLastModified !== -1) {
                        const lastModified = Array.isArray(r) ? r[idxLastModified] : r[H[idxLastModified]];
                        if (lastModified) {
                            try {
                                const detalleTimestamp = new Date(lastModified);
                                if (detalleTimestamp >= cutoffAt) {
                                    idsConDetallesRecientes.add(id);
                                }
                            } catch (e) {
                                // Si no se puede parsear la fecha, omitir
                            }
                        }
                    } else {
                        // Si no hay columna LastModified, solo incluir si el presupuesto fue cambiado
                        if (idsCambiados.has(id)) {
                            idsConDetallesRecientes.add(id);
                        }
                    }
                });

                console.log(`[SYNC-BIDI] Presupuestos con detalles RECIENTES en Sheets (>= cutoff_at): ${idsConDetallesRecientes.size}`);
                
                if (idsConDetallesRecientes.size > 0) {
                    // Log de muestra de IDs encontrados
                    const muestraIds = Array.from(idsConDetallesRecientes).slice(0, 5);
                    console.log(`[SYNC-BIDI] Muestra de IDs con detalles recientes: ${muestraIds.join(', ')}`);

                    // 2) De esos, ¿cuáles NO tienen detalles en local?
                    console.log('[SYNC-BIDI] Consultando presupuestos sin detalles en BD local (solo recientes)...');
                    
                    const rs = await db.query(`
                        SELECT p.id_presupuesto_ext
                        FROM public.presupuestos p
                        LEFT JOIN public.presupuestos_detalles d
                        ON d.id_presupuesto_ext = p.id_presupuesto_ext
                        LEFT JOIN public.presupuestos_detalles_map m
                        ON m.local_detalle_id = d.id
                        WHERE p.activo = true
                        AND p.id_presupuesto_ext = ANY($1::text[])
                        GROUP BY p.id_presupuesto_ext
                        HAVING COUNT(d.id) = 0
                            OR (
                                    COUNT(d.id) > 0
                                AND COALESCE(SUM(d.cantidad),0) = 0
                                AND COALESCE(SUM(d.valor1),0)   = 0
                                AND COALESCE(SUM(d.precio1),0)  = 0
                                AND COALESCE(SUM(d.iva1),0)     = 0
                            )
                            OR (
                                    COUNT(d.id) > 0
                                AND COUNT(m.local_detalle_id) = 0
                            )
                    `, [Array.from(idsConDetallesRecientes)]);

                    const idsSinDetallesLocal = new Set(
                        rs.rows
                        .map(r => (r.id_presupuesto_ext || '').toString().trim())
                        .filter(Boolean)
                    );

                    console.log(`[SYNC-BIDI] Presupuestos sin detalles en BD local (filtrados): ${idsSinDetallesLocal.size}`);

                    if (idsSinDetallesLocal.size > 0) {
                        console.log(
                        '[SYNC-BIDI] 🚨 PRESUPUESTOS SIN DETALLES O SIN MAP DETECTADOS:',
                        Array.from(idsSinDetallesLocal).join(', ')
                        );
                        
                        // Separar presupuestos sin detalles de presupuestos solo sin MAP
                        const presupuestosSinDetalles = new Set();
                        const presupuestosSoloSinMap = new Set();
                        
                        for (const id of idsSinDetallesLocal) {
                            const verificacion = await db.query(`
                                SELECT COUNT(d.id) as count_detalles
                                FROM presupuestos_detalles d
                                WHERE d.id_presupuesto_ext = $1
                            `, [id]);
                            
                            if (verificacion.rows[0].count_detalles == 0) {
                                presupuestosSinDetalles.add(id);
                            } else {
                                presupuestosSoloSinMap.add(id);
                            }
                        }
                        
                        console.log(`[SYNC-BIDI] Presupuestos SIN detalles: ${presupuestosSinDetalles.size}`);
                        console.log(`[SYNC-BIDI] Presupuestos SOLO sin MAP: ${presupuestosSoloSinMap.size}`);
                        
                        // Para presupuestos sin detalles: usar syncDetallesDesdeSheets (elimina + crea)
                        if (presupuestosSinDetalles.size > 0) {
                            console.log('[SYNC-BIDI] Ejecutando syncDetallesDesdeSheets para presupuestos SIN detalles...');
                            await syncDetallesDesdeSheets(detallesSheets, presupuestosSinDetalles, db);
                            console.log(`[SYNC-BIDI] ✅ Detalles sincronizados para ${presupuestosSinDetalles.size} presupuestos`);
                        }
                        
                        // Para presupuestos solo sin MAP: crear MAP sin tocar detalles
                        if (presupuestosSoloSinMap.size > 0) {
                            console.log('[SYNC-BIDI] Creando MAP para presupuestos que ya tienen detalles...');
                            await crearMapParaDetallesExistentes(detallesSheets, presupuestosSoloSinMap, db);
                            console.log(`[SYNC-BIDI] ✅ MAP creado para ${presupuestosSoloSinMap.size} presupuestos`);
                        }
                    } else {
                        console.log('[SYNC-BIDI] ✅ Todos los presupuestos recientes ya tienen sus detalles locales y MAP');
                    }
                } else {
                    console.log('[SYNC-BIDI] ✅ No hay presupuestos con detalles recientes en Sheets (filtro cutoff_at aplicado)');
                }
            } else {
                console.error('[SYNC-BIDI] ❌ NO SE ENCONTRÓ COLUMNA DE ID en DetallesPresupuestos');
                console.error('[SYNC-BIDI] Encabezados disponibles:', H);
                console.error('[SYNC-BIDI] Candidatos buscados: IDPresupuesto, IdPresupuesto, ID Presupuesto, Id Presupuesto, id_presupuesto');
            }
        } catch (e) {
            console.error('[SYNC-BIDI] ❌ Error crítico verificando presupuestos sin detalles:', e?.message);
            console.error('[SYNC-BIDI] Stack trace:', e?.stack);
        }

        console.log('[SYNC-BIDI] Pull completado:', { recibidos, actualizados, omitidos });
        
        return { recibidos, actualizados, omitidos };
        
    } catch (error) {
        console.error('[SYNC-BIDI] Error en pull:', error.message);
        return { recibidos, actualizados, omitidos };
    }
}

/**
 * Helper para parsear LastModified a Date
 */
function parseLastModifiedToDate(value) {
    if (!value) return new Date(0);
    
    try {
        // Intentar parseo directo
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
            return date;
        }
        
        // Intentar formato dd/mm/yyyy hh:mm[:ss]
        const ddmmyyyyRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
        const match = value.match(ddmmyyyyRegex);
        
        if (match) {
            const [, day, month, year, hour, minute, second = '00'] = match;
            return new Date(year, month - 1, day, hour, minute, second);
        }
        
        return new Date(0);
    } catch (error) {
        return new Date(0);
    }
}

// === FIX % DESCUENTO ===
// Convierte "10", "10%", "0.1", "0,1" -> 0.10 (decimal entre 0 y 1)
function parseDescuento(input) {
    if (input === null || input === undefined || input === '') return 0;
    const s = String(input).replace('%', '').replace(',', '.').trim();
    const n = parseFloat(s);
    if (!Number.isFinite(n)) return 0;
    const dec = n > 1 ? n / 100 : n;             // 10  -> 0.10 | 0.1 -> 0.10
    const clamped = Math.max(0, Math.min(dec, 1)); // limita a 0..1
    return clamped;
}

// Devuelve "10%" (o con 1/2 decimales si hace falta) a partir de 0.10 o 10
function formatDescuentoForSheet(value) {
    if (value === null || value === undefined || value === '') return '';
    let n = Number(value);
    if (!Number.isFinite(n)) return '';
    const pct = n > 1 ? n : n * 100;
    const pretty = Number.isInteger(pct) ? String(pct) : (Math.round(pct * 100) / 100).toString();
    return `${pretty}%`;
}

/**
 * Insertar presupuesto desde Sheet
 */
async function insertarPresupuestoDesdeSheet(row, headers, db) {
    try {
        const presupuesto = procesarPresupuestoDesdeSheet(row, headers);
        
        const insertQuery = `
            INSERT INTO presupuestos 
            (id_presupuesto_ext, id_cliente, fecha, fecha_entrega, agente, tipo_comprobante,
             nota, estado, informe_generado, cliente_nuevo_id, punto_entrega, descuento,
             secuencia, activo, fecha_actualizacion, hoja_nombre, hoja_url, usuario_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        `;
        
        console.log(`[PRESUPUESTO] Creando presupuesto desde Sheets, forzando secuencia = 'Imprimir', id_presupuesto_ext: ${presupuesto.id_presupuesto_ext}`);
        
        await db.query(insertQuery, [
            presupuesto.id_presupuesto_ext,
            presupuesto.id_cliente,
            presupuesto.fecha,
            presupuesto.fecha_entrega,
            presupuesto.agente,
            presupuesto.tipo_comprobante,
            presupuesto.nota,
            presupuesto.estado,
            presupuesto.informe_generado,
            presupuesto.cliente_nuevo_id,
            presupuesto.punto_entrega,
            presupuesto.descuento,
            'Imprimir', // FORZAR secuencia = 'Imprimir' cuando viene de Sheets
            presupuesto.activo,
            presupuesto.lastModified,
            presupuesto.hoja_nombre,
            presupuesto.hoja_url,
            presupuesto.usuario_id
        ]);
        
    } catch (error) {
        console.error('[SYNC-BIDI] Error insertando desde Sheet:', error.message);
    }
}

/**
 * Actualizar presupuesto desde Sheet
 */
async function actualizarPresupuestoDesdeSheet(row, headers, db) {
    try {
        const presupuesto = procesarPresupuestoDesdeSheet(row, headers);
        
        console.log(`[SYNC-DEBUG] Entrando a actualizarPresupuestoDesdeSheet para id_presupuesto_ext=${presupuesto.id_presupuesto_ext}`);
        
        const updateQuery = `
            UPDATE presupuestos SET
                id_cliente = $2,
                fecha = $3,
                fecha_entrega = $4,
                agente = $5,
                tipo_comprobante = $6,
                nota = $7,
                estado = $8,
                informe_generado = $9,
                cliente_nuevo_id = $10,
                punto_entrega = $11,
                descuento = $12,
                secuencia = $13,
                activo = $14,
                fecha_actualizacion = $15
            WHERE id_presupuesto_ext = $1
        `;
        
        console.log('[SYNC-DEBUG] Valores antes de UPDATE desde Sheets:', {
            id_presupuesto_ext: presupuesto.id_presupuesto_ext,
            secuencia_forzada: 'Imprimir',
            estado: presupuesto.estado,
            lastModified: presupuesto.lastModified
        });
        
        console.log(`[PRESUPUESTO] Actualizando presupuesto desde Sheets, forzando secuencia = 'Imprimir', id_presupuesto_ext: ${presupuesto.id_presupuesto_ext}`);
        
        await db.query(updateQuery, [
            presupuesto.id_presupuesto_ext,     // $1
            presupuesto.id_cliente,             // $2
            presupuesto.fecha,                  // $3
            presupuesto.fecha_entrega,          // $4
            presupuesto.agente,                 // $5
            presupuesto.tipo_comprobante,       // $6
            presupuesto.nota,                   // $7
            presupuesto.estado,                 // $8
            presupuesto.informe_generado,       // $9
            presupuesto.cliente_nuevo_id,       // $10
            presupuesto.punto_entrega,          // $11
            presupuesto.descuento,              // $12
            'Imprimir',                         // $13 - FORZAR secuencia = 'Imprimir' cuando viene de Sheets
            presupuesto.activo,                 // $14
            presupuesto.lastModified            // $15
        ]);
        
        // VERIFICACIÓN POST-UPDATE: Confirmar que secuencia quedó en 'Imprimir'
        const check = await db.query(
            'SELECT secuencia, estado, activo FROM presupuestos WHERE id_presupuesto_ext = $1',
            [presupuesto.id_presupuesto_ext]
        );
        console.log('[SYNC-DEBUG] Secuencia en BD DESPUÉS del UPDATE desde Sheets:', {
            id_presupuesto_ext: presupuesto.id_presupuesto_ext,
            secuencia: check.rows[0]?.secuencia,
            estado: check.rows[0]?.estado,
            activo: check.rows[0]?.activo
        });
        
    } catch (error) {
        console.error('[SYNC-BIDI] Error actualizando desde Sheet:', error.message);
        console.error('[SYNC-DEBUG] Stack trace:', error.stack);
    }
}

/**
 * Procesar presupuesto desde Sheet
 */
function procesarPresupuestoDesdeSheet(row, headers) {
    const { parseDate } = require('../../services/gsheets/transformer');
    
    // Procesar columna Activo (columna O = headers[14])
    const activoValue = row[headers[14]];
    let activo = true;
    if (activoValue !== undefined && activoValue !== null && activoValue !== '') {
        const activoStr = activoValue.toString().toLowerCase();
        if (activoStr === 'false' || activoStr === '0') {
            activo = false;
        }
    }
    
    // Procesar LastModified (columna N = headers[13])
    const lastModifiedValue = row[headers[13]];
    const lastModified = parseLastModifiedToDate(lastModifiedValue);
    
    return {
        id_presupuesto_ext: (row[headers[0]] || '').toString().trim(),
        id_cliente: (row[headers[2]] || '').toString().trim(),
        fecha: parseDate(row[headers[1]]),
        fecha_entrega: parseDate(row[headers[4]]),
        agente: row[headers[3]] || null,
        tipo_comprobante: row[headers[5]] || null,
        nota: row[headers[6]] || null,
        estado: row[headers[7]] || 'pendiente',
        informe_generado: row[headers[8]] || null,
        cliente_nuevo_id: row[headers[9]] || null,
        punto_entrega: row[headers[11]] || null,
        descuento: parseDescuento(row[headers[12]]),
        activo: activo,
        lastModified: lastModified.toISOString(),
        hoja_nombre: 'Presupuestos',
        hoja_url: null,
        usuario_id: null
    };
}

/**
 * Copia (refresca) los detalles de los presupuestos indicados desde la hoja "DetallesPresupuestos"
 * hacia la tabla public.presupuestos_detalles.
 *
 * MEJORADO: Solución específica para problema de AppSheet - sincronización más robusta
 */
async function syncDetallesDesdeSheets(detallesSheets, idsCambiados, db) {
    console.log('[SYNC-BIDI][DETALLES] 🚀 Iniciando sincronización MEJORADA de detalles...');
    
    console.log('[DET-DBG][SHAPE]', {
        rows: Array.isArray(detallesSheets.rows) ? detallesSheets.rows.length : -1,
        modeFirst: Array.isArray(detallesSheets.rows?.[0]) ? 'array' : (typeof detallesSheets.rows?.[0]),
        sampleFirst: detallesSheets.rows?.[0]
        });



    if (!detallesSheets || !detallesSheets.headers || !Array.isArray(detallesSheets.rows)) {
        console.warn('[SYNC-BIDI][DETALLES] ❌ Dataset de detalles inválido o vacío');
        return;
    }

    if (!idsCambiados || idsCambiados.size === 0) {
        console.warn('[SYNC-BIDI][DETALLES] ❌ No hay IDs para sincronizar');
        return;
    }

    // Función mejorada para normalizar nombres de columnas
    const normalizeColumnName = (s) => {
        return (s ?? '').toString()
            .normalize('NFD')                    // Descomponer caracteres acentuados
            .replace(/[\u0300-\u036f]/g, '')     // Quitar acentos
            .replace(/\s+/g, '')                 // Quitar espacios
            .toLowerCase();                      // Convertir a minúsculas
    };

    const toNumber = (x) => {
        if (x === null || x === undefined || x === '') return 0;
        const s = String(x).replace('%', '').replace(',', '.').trim();
        const n = parseFloat(s);
        return Number.isFinite(n) ? n : 0;
    };

    // Crear mapa de encabezados normalizados
    const H = detallesSheets.headers;
    const headerMap = new Map();
    H.forEach((name, i) => {
        const normalized = normalizeColumnName(name);
        headerMap.set(normalized, i);
    });

    console.log(`[SYNC-BIDI][DETALLES] 📋 Headers disponibles: ${H.join(', ')}`);

    // Función robusta para encontrar índices de columnas
    const findColumnIndex = (...candidates) => {
        for (const candidate of candidates) {
            const normalized = normalizeColumnName(candidate);
            const index = headerMap.get(normalized);
            if (index !== undefined) {
                console.log(`[SYNC-BIDI][DETALLES] ✅ Columna encontrada: "${candidate}" -> índice ${index} (header: "${H[index]}")`);
                return index;
            }
        }
        console.warn(`[SYNC-BIDI][DETALLES] ⚠️ Columna NO encontrada para candidatos: ${candidates.join(', ')}`);
        return -1;
    };

    // Buscar índices de columnas críticas con múltiples variantes
    const idx = {
        id:      findColumnIndex('IDPresupuesto', 'IdPresupuesto', 'ID Presupuesto', 'Id Presupuesto', 'id_presupuesto'),
        art:     findColumnIndex('Articulo', 'Artículo', 'Article'),
        cant:    findColumnIndex('Cantidad', 'Cant', 'Quantity'),
        valor1:  findColumnIndex('Valor1', 'Valor 1', 'Valor', 'Value1'),
        precio1: findColumnIndex('Precio1', 'Precio 1', 'Precio', 'Price1'),
        iva1:    findColumnIndex('IVA1', 'IVA 1', 'IVA', 'Iva1'),
        diferencia: findColumnIndex('Diferencia', 'Diff', 'Difference'),
        // MAPEO CORRECTO según documentación del usuario:
        // LOCAL → SHEETS:
        // camp1 local → (I) Camp1 Sheets
        // camp2 local → (K) Camp3 Sheets (porcentaje: 0.210 → 21,00%)
        // camp3 local → (L) Camp4 Sheets
        // camp4 local → (M) Camp5 Sheets  
        // camp5 local → (N) Camp6 Sheets
        // camp6 local → (O) Condicion Sheets
        // NOTA: (J) Camp2 Sheets = mismo valor que precio1 (se calcula automáticamente)
        camp1:   findColumnIndex('Camp1', 'Camp 1'),                     // camp1 ↔ Camp1 (columna I)
        camp2:   findColumnIndex('Camp3', 'Camp 3'),                     // camp2 ↔ Camp3 (columna K) - PORCENTAJE
        camp3:   findColumnIndex('Camp4', 'Camp 4'),                     // camp3 ↔ Camp4 (columna L)
        camp4:   findColumnIndex('Camp5', 'Camp 5'),                     // camp4 ↔ Camp5 (columna M)
        camp5:   findColumnIndex('Camp6', 'Camp 6'),                     // camp5 ↔ Camp6 (columna N)
        camp6:   findColumnIndex('Condicion', 'Condición', 'Condition')  // camp6 ↔ Condicion (columna O)
    };

    console.log('[SYNC-BIDI][DETALLES] 🔍 Índices de columnas encontrados:', idx);
    const cell = (row, index) => (Array.isArray(row) ? row?.[index] : row?.[H[index]]);
    


            // [DET-DBG] Diagnóstico de lectura en crudo (últimas 5)
                const tailRaw = detallesSheets.rows.slice(-5);
                console.log('[DET-DBG][RAW-TAIL] count=', tailRaw.length);
                tailRaw.forEach((row, i) => {
                const byIdxArt  = row?.[idx.art];
                const byNameArt = (row && H[idx.art] != null) ? row[H[idx.art]] : undefined;
                const byIdxId   = row?.[idx.id];
                const byNameId  = (row && H[idx.id] != null) ? row[H[idx.id]] : undefined;
                console.log('[DET-DBG][RAW]', {
                    pos: i,
                    mode: Array.isArray(row) ? 'array' : 'obj',
                    id_byIdx: byIdxId, id_byName: byNameId,
                    art_byIdx: byIdxArt, art_byName: byNameArt,
                    typeof_art_byIdx: typeof byIdxArt, typeof_art_byName: typeof byNameArt
                });
                });





    // Validar que se encontraron las columnas críticas
    const columnasCriticas = ['id', 'art', 'cant', 'valor1', 'precio1', 'iva1'];
    const columnasFaltantes = columnasCriticas.filter(col => idx[col] === -1);
    
    if (columnasFaltantes.length > 0) {
        console.error('[SYNC-BIDI][DETALLES] ❌ FALTAN ENCABEZADOS CRÍTICOS en DetallesPresupuestos');
        console.error('[SYNC-BIDI][DETALLES] Columnas faltantes:', columnasFaltantes);
        console.error('[SYNC-BIDI][DETALLES] Encabezados disponibles:', H);
        console.error('[SYNC-BIDI][DETALLES] ⚠️ NO SE SINCRONIZARÁN DETALLES');
        return;
    }

    console.log(`[SYNC-BIDI][DETALLES] ✅ Todas las columnas críticas encontradas. Columna ID: "${H[idx.id]}" (índice ${idx.id})`);

    // Convertir IDs a Set para búsqueda rápida - MEJORADO
    const idSet = new Set();
    Array.from(idsCambiados).forEach(id => {
        const cleanId = (id || '').toString().trim();
        if (cleanId) {
            idSet.add(cleanId);
        }
    });

    console.log(`[SYNC-BIDI][DETALLES] 🎯 IDs a sincronizar (${idSet.size}): ${Array.from(idSet).slice(0, 5).join(', ')}${idSet.size > 5 ? '...' : ''}`);

    // DIAGNÓSTICO MEJORADO: Verificar qué IDs tienen detalles en Sheets
    const idsConDetallesEnSheets = new Set();
    const muestraDetalles = [];
    
    detallesSheets.rows.forEach((row, i) => {
        // Probar múltiples formas de acceso al ID
        let idCell = '';
        
        // Método 1: Por índice
        if (row[idx.id] !== undefined && row[idx.id] !== null && row[idx.id] !== '') {
            idCell = row[idx.id].toString().trim();
        }
        // Método 2: Por nombre de header
        else if (row[H[idx.id]] !== undefined && row[H[idx.id]] !== null && row[H[idx.id]] !== '') {
            idCell = row[H[idx.id]].toString().trim();
        }
        // Método 3: Acceso directo por nombres comunes
        else if (row['IdPresupuesto'] !== undefined && row['IdPresupuesto'] !== null && row['IdPresupuesto'] !== '') {
            idCell = row['IdPresupuesto'].toString().trim();
        }
        else if (row['IDPresupuesto'] !== undefined && row['IDPresupuesto'] !== null && row['IDPresupuesto'] !== '') {
            idCell = row['IDPresupuesto'].toString().trim();
        }
        
        if (idCell) {
            idsConDetallesEnSheets.add(idCell);
            
            // Guardar muestra para debugging
            if (muestraDetalles.length < 3) {
                muestraDetalles.push({
                    fila: i + 2,
                    id: idCell,
                    articulo: row[idx.art] || 'N/A',
                    cantidad: row[idx.cant] || 0
                });
            }
        }
    });

    console.log(`[SYNC-BIDI][DETALLES] 📊 IDs con detalles en Sheets: ${idsConDetallesEnSheets.size}`);
    console.log(`[SYNC-BIDI][DETALLES] 📋 Muestra de detalles encontrados:`, muestraDetalles);

    // Verificar coincidencias entre IDs solicitados e IDs disponibles
    const idsCoincidentes = Array.from(idSet).filter(id => idsConDetallesEnSheets.has(id));
    const idsFaltantes = Array.from(idSet).filter(id => !idsConDetallesEnSheets.has(id));

    console.log(`[SYNC-BIDI][DETALLES] ✅ IDs coincidentes (${idsCoincidentes.length}): ${idsCoincidentes.join(', ')}`);
    if (idsFaltantes.length > 0) {
        console.log(`[SYNC-BIDI][DETALLES] ⚠️ IDs sin detalles en Sheets (${idsFaltantes.length}): ${idsFaltantes.join(', ')}`);
    }

    if (idsCoincidentes.length === 0) {
        console.log('[SYNC-BIDI][DETALLES] ❌ No hay coincidencias entre IDs solicitados e IDs con detalles en Sheets');
        
        // Mostrar muestra de IDs disponibles para debugging
        const muestraIdsDisponibles = Array.from(idsConDetallesEnSheets).slice(0, 10);
        console.log('[SYNC-BIDI][DETALLES] 📋 Muestra de IDs disponibles en Sheets:', muestraIdsDisponibles);
        return;
    }

                // FILTRO ESTRICTO: Solo filas únicas por presupuesto+artículo
                const filas = [];
                const filasUnicas = new Map(); // presupuesto+artículo -> fila más reciente
                let filasOmitidas = 0;

                // PASO 1: Identificar filas únicas por presupuesto+artículo
                detallesSheets.rows.forEach((row, i) => {
                    const idCell = String(cell(row, idx.id) ?? '').trim();
                    if (idCell && idSet.has(idCell)) {
                        const articulo = String(cell(row, idx.art) ?? '').trim();
                        if (articulo) {
                            const key = `${idCell}-${articulo}`;
                            
                            // Solo mantener la primera ocurrencia (más reciente en Sheets)
                            if (!filasUnicas.has(key)) {
                                filasUnicas.set(key, row);
                                filas.push(row);
                            } else {
                                console.warn(`[SYNC-BIDI][DETALLES] ⚠️ DUPLICADO EN SHEETS OMITIDO: ${key}`);
                                filasOmitidas++;
                            }
                        } else {
                            console.warn('[DET-DBG][SKIP-NO-ART]', {
                                id: idCell,
                                art_idx: cell(row, idx.art),
                                mode: Array.isArray(row) ? 'array' : 'obj'
                            });
                            filasOmitidas++;
                        }
                    } else if (idCell) {
                        filasOmitidas++;
                    }
                });

                console.log(`[SYNC-BIDI][DETALLES] 📊 Filas procesadas: ${filas.length} únicas incluidas, ${filasOmitidas} omitidas de ${detallesSheets.rows.length} totales`);
                console.log(`[SYNC-BIDI][DETALLES] 🔍 Combinaciones únicas: ${filasUnicas.size}`);
                
                // Log de muestra de filas únicas
                const muestraUnicas = Array.from(filasUnicas.entries()).slice(0, 5);
                console.log(`[SYNC-BIDI][DETALLES] 📋 Muestra de combinaciones únicas:`);
                muestraUnicas.forEach(([key, row], i) => {
                    console.log(`   ${i+1}. ${key}: fila con artículo ${cell(row, idx.art)}`);
                });

    if (filas.length === 0) {
        console.log('[SYNC-BIDI][DETALLES] ❌ No hay filas válidas para sincronizar');
        return;
    }

    // Ejecutar sincronización en transacción - MEJORADO
    console.log('[SYNC-BIDI][DETALLES] 🔄 Iniciando transacción de sincronización...');
    
    await db.query('BEGIN');
    try {
        // Eliminar detalles existentes para los presupuestos especificados
        const deleteResult = await db.query(
            `DELETE FROM public.presupuestos_detalles
              WHERE id_presupuesto_ext = ANY($1::text[])`,
            [Array.from(idSet)]
        );
        
        console.log(`[SYNC-BIDI][DETALLES] 🗑️ Detalles eliminados: ${deleteResult.rowCount}`);

        let insertedCount = 0;
        let skippedCount = 0;
        const erroresInsercion = [];

        // VALIDACIÓN ANTI-DUPLICADOS: Crear Set para evitar duplicados por presupuesto+artículo
        const detallesYaInsertados = new Set();
        
        // Insertar nuevos detalles - MEJORADO con validación anti-duplicados
        for (let i = 0; i < filas.length; i++) {
            const r = filas[i];
            
            try {
                // Obtener ID del presupuesto
                let idCell = '';
                if (r[idx.id] !== undefined && r[idx.id] !== null && r[idx.id] !== '') {
                    idCell = r[idx.id].toString().trim();
                } else if (r[H[idx.id]] !== undefined && r[H[idx.id]] !== null && r[H[idx.id]] !== '') {
                    idCell = r[H[idx.id]].toString().trim();
                } else if (r['IdPresupuesto'] !== undefined && r['IdPresupuesto'] !== null && r['IdPresupuesto'] !== '') {
                    idCell = r['IdPresupuesto'].toString().trim();
                } else if (r['IDPresupuesto'] !== undefined && r['IDPresupuesto'] !== null && r['IDPresupuesto'] !== '') {
                    idCell = r['IDPresupuesto'].toString().trim();
                }

                if (!idCell) {
                    skippedCount++;
                    continue;
                }

                const articulo = String(cell(r, idx.art) ?? '').trim();
                if (!articulo) {
                    console.warn('[DET-DBG][SKIP-NO-ART]', {
                        id: idCell,
                        art_idx: cell(r, idx.art),
                        mode: Array.isArray(r) ? 'array' : 'obj'
                    });
                    skippedCount++;
                    continue;
                }

                // VALIDACIÓN CRÍTICA: Evitar duplicados por presupuesto+artículo
                const detalleKey = `${idCell}-${articulo}`;
                if (detallesYaInsertados.has(detalleKey)) {
                    console.warn(`[SYNC-BIDI][DETALLES] ⚠️ DUPLICADO DETECTADO: ${detalleKey} - SALTANDO`);
                    skippedCount++;
                    continue;
                }
                
                // Marcar como insertado para evitar duplicados
                detallesYaInsertados.add(detalleKey);

                const n = (k) => toNumber(cell(r, k));
                const cantidad = n(idx.cant);
                const valor1   = n(idx.valor1);
                const precio1  = n(idx.precio1);
                const iva1     = n(idx.iva1);
                const camp1    = (idx.camp1 !== -1 ? n(idx.camp1) : null);
                const camp2    = (idx.camp2 !== -1 ? n(idx.camp2) : null);
                const camp3    = (idx.camp3 !== -1 ? n(idx.camp3) : null);
                const camp4    = (idx.camp4 !== -1 ? n(idx.camp4) : null);
                const camp5    = (idx.camp5 !== -1 ? n(idx.camp5) : null);
                const camp6    = (idx.camp6 !== -1 ? n(idx.camp6) : null);

                if (insertedCount < 5) {
                    const preview = {
                        id_presupuesto_ext: idCell,
                        articulo, cantidad, valor1, precio1, iva1,
                        camp1, camp2, camp3, camp4, camp5, camp6
                    };
                    console.log('[DET-DBG][WILL-INSERT]', preview);
                }

                // VALIDACIÓN ADICIONAL: Verificar que no existe ya en BD
                const existeEnBD = await db.query(
                    `SELECT id FROM public.presupuestos_detalles 
                     WHERE id_presupuesto_ext = $1 AND articulo = $2`,
                    [idCell, articulo]
                );
                
                if (existeEnBD.rowCount > 0) {
                    console.warn(`[SYNC-BIDI][DETALLES] ⚠️ DETALLE YA EXISTE EN BD: ${idCell}-${articulo} - SALTANDO`);
                    skippedCount++;
                    continue;
                }

                // CRÍTICO: Obtener id_presupuesto numérico local para FK
                const presupuestoLocalResult = await db.query(
                    `SELECT id FROM public.presupuestos WHERE id_presupuesto_ext = $1`,
                    [idCell]
                );
                
                if (presupuestoLocalResult.rowCount === 0) {
                    console.error(`[SYNC-BIDI][DETALLES] ❌ No se encontró presupuesto local para ID: ${idCell}`);
                    skippedCount++;
                    continue;
                }
                
                const idPresupuestoLocal = presupuestoLocalResult.rows[0].id;

                // OBTENER DIFERENCIA CON ACCESO CORRECTO
                const diferencia = (idx.diferencia !== -1) ? 
                    (cell(r, idx.diferencia) || r.Diferencia || r['Diferencia'] || 0) : 0;
                
                // LOG ESPECÍFICO PARA DEBUGGING DEL CAMPO DIFERENCIA
                if (idCell && idCell.includes('8347c87e')) {
                    console.log(`🔍 [DIFERENCIA-BIDI-DEBUG] Presupuesto 8347c87e - Artículo ${articulo}:`);
                    console.log(`   cell(r, idx.diferencia): ${cell(r, idx.diferencia)} (idx: ${idx.diferencia})`);
                    console.log(`   r.Diferencia: ${r.Diferencia} (tipo: ${typeof r.Diferencia})`);
                    console.log(`   r['Diferencia']: ${r['Diferencia']} (tipo: ${typeof r['Diferencia']})`);
                    console.log(`   diferencia final: ${diferencia} (tipo: ${typeof diferencia})`);
                    console.log(`   toNumber(diferencia): ${toNumber(diferencia)}`);
                }
                
                const diferenciaFinal = toNumber(diferencia);

                const insertResult = await db.query(
                    `INSERT INTO public.presupuestos_detalles
                       (id_presupuesto, id_presupuesto_ext, articulo, cantidad, valor1, precio1, iva1, diferencia,
                        camp1, camp2, camp3, camp4, camp5, camp6, fecha_actualizacion)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
                     RETURNING id`,
                    [idPresupuestoLocal, idCell, articulo, cantidad, valor1, precio1, iva1, diferenciaFinal,
                     camp1, camp2, camp3, camp4, camp5, camp6]
                );
                
                const localDetalleId = insertResult.rows[0].id;
                
                // USAR EL ID REAL DE SHEETS (columna A: IDDetallePresupuesto)
                let idDetallePresupuesto = '';
                
                // Obtener ID de Sheets de múltiples formas
                if (r[0] !== undefined && r[0] !== null && r[0] !== '') {
                    idDetallePresupuesto = r[0].toString().trim();
                } else if (r[H[0]] !== undefined && r[H[0]] !== null && r[H[0]] !== '') {
                    idDetallePresupuesto = r[H[0]].toString().trim();
                } else if (r['IDDetallePresupuesto'] !== undefined && r['IDDetallePresupuesto'] !== null && r['IDDetallePresupuesto'] !== '') {
                    idDetallePresupuesto = r['IDDetallePresupuesto'].toString().trim();
                }
                
                // Si no se puede obtener el ID de Sheets, generar uno como fallback
                if (!idDetallePresupuesto) {
                    console.warn('[SYNC-BIDI][DETALLES] ⚠️ No se pudo obtener ID de Sheets, generando fallback');
                    const crypto = require('crypto');
                    const mkId = r => crypto.createHash('sha1')
                      .update(`${r.id_presupuesto_ext}|${r.articulo}|${r.cantidad}|${r.valor1}|${r.precio1}|${r.iva1}|${r.diferencia}|${r.camp1}|${r.camp2}|${r.camp3}|${r.camp4}|${r.camp5}|${r.camp6}`)
                      .digest('hex').slice(0, 8);
                    
                    idDetallePresupuesto = mkId({
                        id_presupuesto_ext: idCell,
                        articulo: articulo,
                        cantidad: cantidad,
                        valor1: valor1,
                        precio1: precio1,
                        iva1: iva1,
                        diferencia: 0,
                        camp1: camp1,
                        camp2: camp2,
                        camp3: camp3,
                        camp4: camp4,
                        camp5: camp5,
                        camp6: camp6
                    });
                } else {
                    console.log(`[SYNC-BIDI][DETALLES] ✅ Usando ID real de Sheets: ${idDetallePresupuesto}`);
                }
                
                // Upsert en presupuestos_detalles_map con fuente='AppSheet' (presupuesto viene de Google Sheets/AppSheet)
                await db.query(
                    `INSERT INTO public.presupuestos_detalles_map (local_detalle_id, id_detalle_presupuesto, fuente, fecha_asignacion)
                     VALUES ($1, $2, 'AppSheet', CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires')
                     ON CONFLICT (local_detalle_id) DO UPDATE
                     SET id_detalle_presupuesto = EXCLUDED.id_detalle_presupuesto,
                         fuente = 'AppSheet',
                         fecha_asignacion = EXCLUDED.fecha_asignacion`,
                    [localDetalleId, idDetallePresupuesto]
                );
                
                insertedCount++;
                
                // LOG ESPECÍFICO PARA VERIFICAR CREACIÓN DE MAP EN PRIMER CORRIDO
                console.log(`[MAP-PRIMER-CORRIDO] ✅ MAP creado: local_id=${localDetalleId} sheet_id=${idDetallePresupuesto} presup=${idCell} art=${articulo}`);
                
                // Log de los primeros 3 detalles insertados
                if (insertedCount <= 3) {
                    console.log(`[SYNC-BIDI][DETALLES] ✅ Detalle ${insertedCount}: ${idCell} - ${articulo} (cant: ${cantidad}, precio: ${precio1}, diferencia: ${diferenciaFinal})`);
                }
                
            } catch (insertError) {
                const errorMsg = `Fila ${i + 1}: ${insertError.message}`;
                erroresInsercion.push(errorMsg);
                console.error(`[SYNC-BIDI][DETALLES] ❌ Error insertando detalle: ${errorMsg}`);
                skippedCount++;
            }
        }

        // Verificar si hubo errores críticos
        if (erroresInsercion.length > 0 && erroresInsercion.length > filas.length * 0.5) {
            throw new Error(`Demasiados errores de inserción: ${erroresInsercion.length}/${filas.length}`);
        }

        await db.query('COMMIT');
        console.log(`[SYNC-BIDI][DETALLES] ✅ Sincronización completada exitosamente:`);
        console.log(`[SYNC-BIDI][DETALLES]    - Insertados: ${insertedCount}`);
        console.log(`[SYNC-BIDI][DETALLES]    - Omitidos: ${skippedCount}`);
        console.log(`[SYNC-BIDI][DETALLES]    - Errores: ${erroresInsercion.length}`);
        console.log(`[SYNC-BIDI][DETALLES]    - Presupuestos procesados: ${idSet.size}`);
        
        // Log de errores si los hay (pero no críticos)
        if (erroresInsercion.length > 0 && erroresInsercion.length <= 3) {
            console.warn(`[SYNC-BIDI][DETALLES] ⚠️ Errores menores encontrados:`, erroresInsercion);
        } else if (erroresInsercion.length > 3) {
            console.warn(`[SYNC-BIDI][DETALLES] ⚠️ ${erroresInsercion.length} errores encontrados (mostrando primeros 3):`, erroresInsercion.slice(0, 3));
        }
        
    } catch (e) {
        await db.query('ROLLBACK');
        console.error('[SYNC-BIDI][DETALLES] ❌ Error en transacción, rollback ejecutado:', e?.message);
        console.error('[SYNC-BIDI][DETALLES] Stack trace:', e?.stack);
        throw e;
    }
}


/**
 * Marcar presupuestos anulados en Sheets (versión con conteo para logs)
 * FIX CRÍTICO: Esta función ahora se ejecuta PRIMERA en el pipeline
 */
async function marcarAnuladosEnSheetsConConteo(presupuestosData, config, db) {
  const { getSheets } = require('../../google/gsheetsClient');
  const sheets = await getSheets();

  const H = presupuestosData.headers || [];
  const idxId = 0;   // Col A: ID
  const idxLM = 13;  // Col N: LastModified
  const idxActivo = 14; // Col O: Activo
  const idxEstado = 7;  // Col H: Estado

  // Crear mapa: id -> { rowNum, lastModified, activo }
  const rowById = new Map();
  presupuestosData.rows.forEach((r, i) => {
    const id = String(r[H[idxId]] ?? '').trim();
    if (id) {
      rowById.set(id, { 
        rowNum: i + 2,  // +2 porque fila 1 es header
        lastModified: r[H[idxLM]],
        activo: r[H[idxActivo]]
      });
    }
  });

  // MEJORA CRÍTICA: Incluir presupuestos recién anulados usando cutoff_at
  const cutoffAt = config.cutoff_at;
  const rs = await db.query(`
    SELECT id_presupuesto_ext, fecha_actualizacion
    FROM public.presupuestos
    WHERE activo = false 
    AND COALESCE(id_presupuesto_ext,'') <> ''
    AND fecha_actualizacion >= $1  -- Incluye iguales a cutoff_at
    ORDER BY fecha_actualizacion DESC
  `, [cutoffAt]);
  
  if (!rs.rowCount) {
    console.log('[SYNC-BTN] No hay presupuestos anulados recientes para marcar en Sheets');
    return 0;
  }

  console.log(`[SYNC-BTN] Encontrados ${rs.rowCount} presupuestos anulados recientes para marcar en Sheets`);

  // Helper para parsear LastModified de Sheets
  const parseLastModified = (val) => {
    if (!val) return new Date(0);
    if (typeof val === 'number') {
      const excelEpoch = new Date(1900, 0, 1);
      const days = val - 2;
      return new Date(excelEpoch.getTime() + days * 24 * 60 * 60 * 1000);
    }
    const ddmmyyyyRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/;
    const match = String(val).match(ddmmyyyyRegex);
    if (match) {
      const [, day, month, year, hour, minute, second] = match;
      return new Date(year, month - 1, day, hour, minute, second);
    }
    return new Date(val);
  };

  const now = toSheetDateTimeAR(Date.now());
  const data = [];
  let marcados = 0;
  let omitidosPorSheetMasReciente = 0;

  for (const { id_presupuesto_ext, fecha_actualizacion } of rs.rows) {
    const id = String(id_presupuesto_ext).trim();
    const sheetData = rowById.get(id);
    
    if (!sheetData) {
      console.log(`[SYNC-BTN] Presupuesto anulado ${id} no existe en Sheets, omitiendo`);
      continue;
    }

    // FILTRO CRÍTICO: Si ya está anulado en Sheets, NO tocarlo
    const activoEnSheet = String(sheetData.activo ?? '').toLowerCase();
    if (activoEnSheet === 'false' || activoEnSheet === '0') {
      console.log(`[SYNC-BTN] ⚠️ Presupuesto ${id} YA está anulado en Sheets, omitiendo`);
      console.log(`[SYNC-BTN]    Razón: Evitar actualizar LastModified innecesariamente`);
      omitidosPorSheetMasReciente++;
      continue;
    }

    // CRÍTICO: Comparar timestamps antes de marcar como anulado
    const localTimestamp = new Date(fecha_actualizacion);
    const sheetTimestamp = parseLastModified(sheetData.lastModified);
    
    if (sheetTimestamp > localTimestamp) {
      console.log(`[SYNC-BTN] ⚠️ OMITIENDO anulación de ${id} - SHEET más reciente`);
      console.log(`[SYNC-BTN]    Local: ${localTimestamp.toISOString()} (anulado)`);
      console.log(`[SYNC-BTN]    Sheet: ${sheetTimestamp.toISOString()} (posiblemente reactivado)`);
      console.log(`[SYNC-BTN]    Decisión: SHEET gana, NO marcar como anulado`);
      omitidosPorSheetMasReciente++;
      continue;
    }

    // Solo marcar como anulado si LOCAL es más reciente o igual Y no está ya anulado
    console.log(`[SYNC-BTN] Marcando como anulado en Sheets: ${id} (LOCAL más reciente)`);
    console.log(`[SYNC-BTN]    Local: ${localTimestamp.toISOString()}`);
    console.log(`[SYNC-BTN]    Sheet: ${sheetTimestamp.toISOString()}`);

    // O (Activo) -> FALSE
    data.push({ range: `Presupuestos!O${sheetData.rowNum}:O${sheetData.rowNum}`, values: [[false]] });
    // H (Estado) -> 'Anulado'
    data.push({ range: `Presupuestos!H${sheetData.rowNum}:H${sheetData.rowNum}`, values: [['Anulado']] });
    // N (LastModified) -> ahora (CRÍTICO para LWW)
    data.push({ range: `Presupuestos!N${sheetData.rowNum}:N${sheetData.rowNum}`, values: [[now]] });
    
    marcados++;
  }

  if (data.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: config.hoja_id,
      requestBody: { valueInputOption: 'USER_ENTERED', data }
    });
    console.log(`[SYNC-BTN] ✅ Marcados ${marcados} presupuestos como inactivos en Sheets`);
  }

  if (omitidosPorSheetMasReciente > 0) {
    console.log(`[SYNC-BTN] ⚠️ Omitidos ${omitidosPorSheetMasReciente} presupuestos por SHEET más reciente (posiblemente reactivados)`);
  }

  return marcados;
}

/**
 * Versión original de marcarAnuladosEnSheets (mantenida para compatibilidad)
 */
async function marcarAnuladosEnSheets(presupuestosData, config, db) {
  const { getSheets } = require('../../google/gsheetsClient');
  const sheets = await getSheets();

  const H = presupuestosData.headers || [];
  const idxId = 0;   // Col A: ID
  const idxLM = 13;  // Col N: LastModified
  const idxActivo = 14; // Col O: Activo
  const idxEstado = 7;  // Col H: Estado

  // mapa: id -> nro de fila en Sheets (2-based, por el encabezado)
  const rowById = new Map();
  presupuestosData.rows.forEach((r, i) => {
    const id = String(r[H[idxId]] ?? '').trim();
    if (id) rowById.set(id, i + 2);
  });

  // Traer los que están inactivos en local
  const rs = await db.query(`
    SELECT id_presupuesto_ext
    FROM public.presupuestos
    WHERE activo = false AND COALESCE(id_presupuesto_ext,'') <> ''
  `);
  if (!rs.rowCount) return;

  const now = toSheetDateTimeAR(Date.now());
  const data = [];

  for (const { id_presupuesto_ext } of rs.rows) {
    const id = String(id_presupuesto_ext).trim();
    const rowNum = rowById.get(id);
    if (!rowNum) continue; // si no existe en Sheets, nada que marcar

    // O (Activo) -> FALSE
    data.push({ range: `Presupuestos!O${rowNum}:O${rowNum}`, values: [[false]] });
    // H (Estado) -> 'Anulado' (opcional pero recomendable)
    data.push({ range: `Presupuestos!H${rowNum}:H${rowNum}`, values: [['Anulado']] });
    // N (LastModified) -> ahora
    data.push({ range: `Presupuestos!N${rowNum}:N${rowNum}`, values: [[now]] });
  }

  if (data.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: config.hoja_id,
      requestBody: { valueInputOption: 'USER_ENTERED', data }
    });
    console.log('[SYNC-BIDI] Marcados como inactivos en Sheets:', rs.rowCount);
  }
}

/**
 * Eliminar y recrear detalles en Sheets para presupuestos modificados localmente
 * SOLO ACTUALIZA SHEETS - NO TOCA LOCAL
 */
async function eliminarYRecrearDetallesEnSheets(idsModificadosLocalmente, config, db) {
    console.log('[PUSH-DETALLES-MODIFICADOS] Eliminando y recreando detalles en Sheets...');
    
    if (!idsModificadosLocalmente || idsModificadosLocalmente.size === 0) {
        console.log('[PUSH-DETALLES-MODIFICADOS] No hay IDs modificados localmente');
        return;
    }
    
    try {
        const { getSheets } = require('../../google/gsheetsClient');
        const sheets = await getSheets();
        
        // 1. Leer detalles actuales de Sheets para encontrar filas a eliminar
        const detallesSheets = await readSheetWithHeaders(config.hoja_id, 'A:Q', 'DetallesPresupuestos');
        
        // 2. Encontrar filas en Sheets que pertenecen a presupuestos modificados localmente
        const filasAEliminar = [];
        const idsModificadosArray = Array.from(idsModificadosLocalmente);
        
        detallesSheets.rows.forEach((row, index) => {
            const idPresupuesto = (row[detallesSheets.headers[1]] || '').toString().trim(); // Columna B: IdPresupuesto
            if (idsModificadosArray.includes(idPresupuesto)) {
                filasAEliminar.push(index + 2); // +2 porque fila 1 es header
            }
        });
        
        console.log(`[PUSH-DETALLES-MODIFICADOS] Encontradas ${filasAEliminar.length} filas de detalles a eliminar en Sheets`);
        
        // 3. Eliminar filas en Sheets (de abajo hacia arriba para no alterar índices)
        if (filasAEliminar.length > 0) {
            const filasOrdenadas = filasAEliminar.sort((a, b) => b - a); // Orden descendente
            
            for (const fila of filasOrdenadas) {
                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId: config.hoja_id,
                    requestBody: {
                        requests: [{
                            deleteDimension: {
                                range: {
                                    sheetId: 0, // Asumiendo que DetallesPresupuestos es la primera hoja
                                    dimension: 'ROWS',
                                    startIndex: fila - 1, // 0-based
                                    endIndex: fila
                                }
                            }
                        }]
                    }
                });
            }
            
            console.log(`[PUSH-DETALLES-MODIFICADOS] ✅ Eliminadas ${filasAEliminar.length} filas de detalles en Sheets`);
        }
        
        // 4. Obtener detalles actuales de LOCAL para los presupuestos modificados
        const detallesLocales = await db.query(`
            SELECT d.id, d.id_presupuesto_ext, d.articulo, d.cantidad, d.valor1, d.precio1,
                   d.iva1, d.diferencia, d.camp1, d.camp2, d.camp3, d.camp4, d.camp5, d.camp6
            FROM public.presupuestos_detalles d
            WHERE d.id_presupuesto_ext = ANY($1)
            ORDER BY d.id_presupuesto_ext, d.id
        `, [idsModificadosArray]);
        
        console.log(`[PUSH-DETALLES-MODIFICADOS] Encontrados ${detallesLocales.rowCount} detalles locales para recrear en Sheets`);
        
        // 5. Recrear detalles en Sheets con mapeo correcto
        if (detallesLocales.rowCount > 0) {
            const nowAR = toSheetDateTimeAR(Date.now());
            const num2 = v => (v == null || v === '') ? '' : Math.round(Number(v) * 100) / 100;
            const num3 = v => (v == null || v === '') ? '' : Math.round(Number(v) * 1000) / 1000;
            const asText = v => (v == null) ? '' : String(v).trim();
            
            // Generar IDs únicos para los detalles y crear MAP
            const detallesParaSheets = [];
            
            for (const r of detallesLocales.rows) {
                // Generar ID único para Sheets
                const crypto = require('crypto');
                const timestamp = Date.now() + Math.random() * 1000;
                const hash = crypto.createHash('sha1')
                    .update(`${r.id_presupuesto_ext}|${r.articulo}|${r.cantidad}|${r.valor1}|${r.precio1}|${r.iva1}|${r.diferencia}|${r.camp1}|${r.camp2}|${r.camp3}|${r.camp4}|${r.camp5}|${r.camp6}|${timestamp}`)
                    .digest('hex');
                const idDetallePresupuesto = `${hash.slice(0, 8)}-${hash.slice(8, 12)}`;
                
                // Actualizar MAP
                await db.query(`
                    INSERT INTO public.presupuestos_detalles_map
                    (local_detalle_id, id_detalle_presupuesto, fuente, fecha_asignacion)
                    VALUES ($1, $2, 'Local', CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires')
                    ON CONFLICT (local_detalle_id) DO UPDATE
                    SET id_detalle_presupuesto = EXCLUDED.id_detalle_presupuesto,
                        fuente = 'Local',
                        fecha_asignacion = EXCLUDED.fecha_asignacion
                `, [r.id, idDetallePresupuesto]);
                
                // Mapear para Sheets con mapeo correcto
                const mappedRow = [
                    idDetallePresupuesto,           // A  IDDetallePresupuesto
                    asText(r.id_presupuesto_ext),   // B  IdPresupuesto
                    asText(r.articulo),             // C  Articulo
                    num2(r.cantidad),               // D  Cantidad
                    num2(r.valor1),                 // E  Valor1
                    num2(r.precio1),                // F  Precio1
                    num2(r.iva1),                   // G  IVA1
                    num2(r.diferencia),             // H  Diferencia
                    num2(r.camp1),                  // I  Camp1 (camp1 local → Camp1 Sheets)
                    num2(r.precio1),                // J  Camp2 (mismo valor que precio1)
                    num3(r.camp2),                  // K  Camp3 (camp2 local → Camp3 Sheets - PORCENTAJE)
                    num2(r.camp3),                  // L  Camp4 (camp3 local → Camp4 Sheets)
                    num2(r.camp4),                  // M  Camp5 (camp4 local → Camp5 Sheets)
                    num2(r.camp5),                  // N  Camp6 (camp5 local → Camp6 Sheets)
                    asText(r.camp6),                // O  Condicion (camp6 local → Condicion Sheets)
                    nowAR,                          // P  LastModified
                    true                            // Q  Activo
                ];
                
                detallesParaSheets.push(mappedRow);
            }
            
            // 6. Insertar todos los detalles en Sheets
            if (detallesParaSheets.length > 0) {
                await sheets.spreadsheets.values.append({
                    spreadsheetId: config.hoja_id,
                    range: 'DetallesPresupuestos!A1:Q1',
                    valueInputOption: 'USER_ENTERED',
                    insertDataOption: 'INSERT_ROWS',
                    requestBody: {
                        values: detallesParaSheets,
                        majorDimension: 'ROWS'
                    }
                });
                
                console.log(`[PUSH-DETALLES-MODIFICADOS] ✅ Recreados ${detallesParaSheets.length} detalles en Sheets`);
            }
        }
        
    } catch (error) {
        console.error('[PUSH-DETALLES-MODIFICADOS] Error:', error.message);
        throw error;
    }
}

/**
 * Pull de cambios remotos con LWW REAL basado en última sincronización
 * IMPLEMENTA LWW REAL: Solo procesa presupuestos con LastModified > última sincronización
 * REFRESCO INTEGRAL: Encabezado + detalles + mapeo en una sola corrida
 * EXCLUYE: IDs que fueron modificados localmente (para evitar conflictos)
 */
async function pullCambiosRemotosConTimestampMejorado(presupuestosSheets, detallesSheets, config, db, idsModificadosLocalmente = new Set()) {
    console.log('[SYNC-BIDI] 🔄 Iniciando PULL con LWW REAL basado en última sincronización...');
    
    let recibidos = 0;
    let actualizados = 0;
    let omitidos = 0;
    let omitidosPorSinFecha = 0;
    let omitidosPorAnteriores = 0;

    const idsCambiados = new Set(); // ← guardamos IDs creados/actualizados

    // PASO 1: Obtener cutoff_at de configuración (CORRECCIÓN CRÍTICA)
    console.log('[LWW-REAL] Obteniendo cutoff_at de configuración...');
    
    const cutoffQuery = `
        SELECT cutoff_at
        FROM presupuestos_config 
        WHERE activo = true 
        ORDER BY fecha_creacion DESC 
        LIMIT 1
    `;
    
    const cutoffResult = await db.query(cutoffQuery);
    
    let fechaUltimaSync;
    if (cutoffResult.rows.length > 0 && cutoffResult.rows[0].cutoff_at) {
        fechaUltimaSync = new Date(cutoffResult.rows[0].cutoff_at);
        console.log('[LWW-REAL] ✅ Fecha cutoff_at:', fechaUltimaSync.toISOString());
    } else {
        // Si no hay cutoff_at, usar fecha muy antigua
        fechaUltimaSync = new Date('2020-01-01');
        console.log('[LWW-REAL] ⚠️ No hay cutoff_at configurado, usando fecha base:', fechaUltimaSync.toISOString());
    }

    // Función para parsear el valor de activo desde Sheets con reglas robustas
    function parseActivo(value) {
        if (value === null || value === undefined) return null;
        const val = String(value).trim().toLowerCase();
        if (['false', '0', 'n', 'no', ''].includes(val)) return false;
        if (['true', '1', 's', 'sí', 'si'].includes(val)) return true;
        return null; // no se infiere true por defecto
    }

    // Función para parsear LastModified robustamente (tz AR) - CORREGIDA FINAL
    function parseLastModifiedRobust(value) {
        if (!value) return new Date(0);
        
        try {
            // Si es número (Excel serial date)
            if (typeof value === 'number') {
                // CORRECCIÓN: Excel serial date correcto
                const excelEpoch = new Date(1900, 0, 1);
                const days = value - 2; // Excel cuenta desde 1900-01-01 pero tiene bug del año bisiesto
                return new Date(excelEpoch.getTime() + days * 24 * 60 * 60 * 1000);
            }
            
            // Si es string, intentar parsear formato dd/mm/yyyy hh:mm:ss (AR)
            if (typeof value === 'string') {
                const ddmmyyyyRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/;
                const match = value.match(ddmmyyyyRegex);
                if (match) {
                    const [, day, month, year, hour, minute, second] = match;
                    
                    // CORRECCIÓN CRÍTICA: Interpretar como hora local Argentina directamente
                    // Las fechas de AppSheet/Sheets ya vienen en hora local Argentina
                    return new Date(year, month - 1, day, hour, minute, second);
                }
            }
            
            // Fallback: parseo directo
            const directDate = new Date(value);
            if (!isNaN(directDate.getTime())) {
                return directDate;
            }
            
            return new Date(0);
        } catch (e) {
            console.warn('[LWW-REAL] Error parseando LastModified:', value, e.message);
            return new Date(0);
        }
    }

    try {
        // PASO 2: Crear mapa de timestamps locales
        const localTimestamps = new Map();
        const localActivos = new Map();
        const rsLocal = await db.query(`
            SELECT id_presupuesto_ext, fecha_actualizacion, activo
            FROM public.presupuestos
        `);
        
        rsLocal.rows.forEach(row => {
            const id = (row.id_presupuesto_ext || '').toString().trim();
            const timestamp = new Date(row.fecha_actualizacion || 0);
            localTimestamps.set(id, timestamp);
            localActivos.set(id, row.activo);
        });

        // PASO 3: Procesar registros de Sheets con LWW REAL
        console.log('[LWW-REAL] 🔄 Procesando registros de Sheets con LWW REAL...');
        console.log(`[LWW-REAL] Criterio: Solo presupuestos con LastModified > ${fechaUltimaSync.toISOString()}`);
        
        let candidatosLWW = 0;
        let procesadosLWW = 0;
        
        for (const row of presupuestosSheets.rows) {
            const id = (row[presupuestosSheets.headers[0]] || '').toString().trim();
            const sheetLastModified = row[presupuestosSheets.headers[13]]; // columna N
            
            if (!id) {
                omitidos++;
                continue;
            }
            
            // FILTRO CRÍTICO: Excluir IDs que fueron modificados localmente (ya procesados en PUSH)
            if (idsModificadosLocalmente.has(id)) {
                console.log('[LWW-REAL] Omitiendo ID modificado localmente (ya procesado en PUSH):', id);
                omitidos++;
                continue;
            }
            
            // VALIDACIÓN MÍNIMA: Omitir si no tiene LastModified
            if (!sheetLastModified) {
                console.log('[LWW-REAL] Omitiendo por sin fecha - ID:', id);
                omitidosPorSinFecha++;
                continue;
            }
            
            const sheetTimestamp = parseLastModifiedRobust(sheetLastModified);
            
            // FILTRO LWW REAL: Solo procesar si LastModified > última sincronización
            if (sheetTimestamp <= fechaUltimaSync) {
                console.log(`[LWW-REAL] Omitiendo por anterior a última sync - ID: ${id}, Sheet: ${sheetTimestamp.toISOString()}`);
                omitidosPorAnteriores++;
                continue;
            }
            
            candidatosLWW++;
            console.log(`[LWW-REAL] ✅ CANDIDATO para LWW - ID: ${id}, Sheet: ${sheetTimestamp.toISOString()}`);
            
            const localTimestamp = localTimestamps.get(id);
            const localActivo = localActivos.get(id);
            const remoteActivoRaw = row[presupuestosSheets.headers[14]];
            const remoteActivo = parseActivo(remoteActivoRaw);
            
            if (!localTimestamp) {
                // No existe localmente: crear solo si en Sheets está ACTIVO (true)
                if (remoteActivo === false) {
                    console.log('[LWW-REAL] Omitiendo presupuesto inactivo de Sheets:', id);
                    omitidos++;
                    continue;
                }
                
                await insertarPresupuestoDesdeSheet(row, presupuestosSheets.headers, db);
                recibidos++;
                idsCambiados.add(id);
                procesadosLWW++;
                console.log('[LWW-REAL] ✅ NUEVO desde Sheets:', id);
            } else {
                // IMPLEMENTACIÓN LWW REAL: Comparar timestamps
                console.log(`[LWW-REAL] Comparando timestamps para ID ${id}:`);
                console.log(`[LWW-REAL]   Local: ${localTimestamp.toISOString()}, activo: ${localActivo}`);
                console.log(`[LWW-REAL]   Sheet: ${sheetTimestamp.toISOString()}, activo: ${remoteActivo}`);
                console.log(`[LWW-REAL]   Última sync: ${fechaUltimaSync.toISOString()}`);
                
                // FILTRO CRÍTICO: NO actualizar si local está inactivo
                // Los presupuestos anulados localmente NO deben reactivarse desde Sheets
                // porque ya fueron procesados en FASE 1 (PUSH Anulaciones)
                if (localActivo === false) {
                    console.log(`[LWW-REAL] ⚠️ Omitiendo presupuesto inactivo LOCAL - ID: ${id}`);
                    console.log(`[LWW-REAL]    Razón: Ya fue procesado en FASE 1 (PUSH Anulaciones)`);
                    omitidos++;
                    continue;
                }
                
                if (sheetTimestamp > localTimestamp) {
                    // Sheet más reciente → UPDATE INTEGRAL
                    console.log(`[LWW-REAL] ✅ sheet>local → UPDATE INTEGRAL`);
                    
                    // Aplicar regla sticky delete para activo
                    let activoFinal = true;
                    if (localActivo === false || remoteActivo === false) {
                        activoFinal = false;
                    } else if (remoteActivo === null) {
                        activoFinal = localActivo;
                    }

                    const presupuestoActualizado = { ...row };
                    presupuestoActualizado[presupuestosSheets.headers[14]] = activoFinal;

                    await actualizarPresupuestoDesdeSheet(presupuestoActualizado, presupuestosSheets.headers, db);

                    actualizados++;
                    idsCambiados.add(id);
                    procesadosLWW++;

                    console.log('[LWW-REAL] ✅ ACTUALIZADO encabezado desde Sheets:', id);
                } else {
                    // Local más reciente o igual → SKIP
                    console.log(`[LWW-REAL] sheet<=local → skip (mantener Local)`);
                    omitidos++;
                }
            }
        }
        
        console.log(`[LWW-REAL] 📊 Resumen LWW:`);
        console.log(`[LWW-REAL]   Candidatos (LastModified > última_sync): ${candidatosLWW}`);
        console.log(`[LWW-REAL]   Procesados efectivamente: ${procesadosLWW}`);
        console.log(`[LWW-REAL]   Omitidos por anteriores a última_sync: ${omitidosPorAnteriores}`);
        
        // PASO 3B: Sincronizar presupuestos con DETALLES modificados (FIX CRÍTICO)
        console.log('\n[LWW-REAL] 🔍 Verificando detalles modificados en JIT...');
        
        const idsConDetallesModificados = new Set();
        
        detallesSheets.rows.forEach(detRow => {
            const idPresupuesto = (detRow[detallesSheets.headers[1]] || '').toString().trim();
            const detalleLastModified = detRow[detallesSheets.headers[15]]; // Columna P: LastModified
            
            if (!idPresupuesto || !detalleLastModified) return;
            
            // Excluir IDs ya procesados en PUSH o en el bucle anterior
            if (idsModificadosLocalmente.has(idPresupuesto) || idsCambiados.has(idPresupuesto)) return;
            
            const detalleTimestamp = parseLastModifiedRobust(detalleLastModified);
            
            // Si el detalle fue modificado después de la última sync
            if (detalleTimestamp > fechaUltimaSync) {
                idsConDetallesModificados.add(idPresupuesto);
            }
        });
        
        console.log(`[LWW-REAL] Presupuestos con detalles modificados en JIT: ${idsConDetallesModificados.size}`);
        
        if (idsConDetallesModificados.size > 0) {
            console.log(`[LWW-REAL] IDs con detalles modificados: ${Array.from(idsConDetallesModificados).join(', ')}`);
            
            for (const id of idsConDetallesModificados) {
                // Buscar presupuesto en Sheets
                const presupRow = presupuestosSheets.rows.find(r => 
                    (r[presupuestosSheets.headers[0]] || '').toString().trim() === id
                );
                
                if (!presupRow) {
                    console.log(`[LWW-REAL] ⚠️ Presupuesto ${id} no encontrado en Sheets`);
                    continue;
                }
                
                const localTimestampData = localTimestamps.get(id);
                const remoteActivoRaw = presupRow[presupuestosSheets.headers[14]];
                const remoteActivo = parseActivo(remoteActivoRaw);
                
                if (!localTimestampData) {
                    // No existe en local → crear
                    if (remoteActivo === false) {
                        console.log(`[LWW-REAL] Omitiendo presupuesto inactivo: ${id}`);
                        continue;
                    }
                    
                    await insertarPresupuestoDesdeSheet(presupRow, presupuestosSheets.headers, db);
                    recibidos++;
                    idsCambiados.add(id);
                    console.log(`[LWW-REAL] ✅ NUEVO (por detalle modificado en JIT): ${id}`);
                } else {
                    // Existe en local → actualizar
                    console.log(`[SYNC-LWW] ID: ${id}`);
                    console.log(`[SYNC-LWW]   Razón: Detalle modificado en JIT después de última sync`);
                    console.log(`[SYNC-LWW]   Decisión: Actualizar LOCAL desde JIT`);
                    
                    await actualizarPresupuestoDesdeSheet(presupRow, presupuestosSheets.headers, db);
                    actualizados++;
                    idsCambiados.add(id);
                    console.log(`[LWW-REAL] ✅ ACTUALIZADO (por detalle modificado en JIT): ${id}`);
                }
            }
        }
        
        // INFORMACIÓN TEMPRANA: Si no hay candidatos, informar sin hacer cambios
        if (candidatosLWW === 0 && idsConDetallesModificados.size === 0) {
            console.log('[LWW-REAL] ℹ️ NO HAY REGISTROS POSTERIORES A LA ÚLTIMA SINCRONIZACIÓN');
            console.log('[LWW-REAL] ℹ️ No se realizarán cambios en esta sincronización');
            
            return { 
                recibidos: 0, 
                actualizados: 0, 
                omitidos: omitidos + omitidosPorSinFecha + omitidosPorAnteriores,
                omitidosPorCutoff: 0,
                omitidosPorSinFecha: omitidosPorSinFecha,
                omitidosPorAnteriores: omitidosPorAnteriores,
                mensaje: 'No hay registros posteriores a la última sincronización'
            };
        }

        // PASO 4: REFRESCO INTEGRAL para presupuestos que pasaron LWW REAL
        if (idsCambiados.size > 0) {
            try {
                console.log('[LWW-REAL] 🔄 Ejecutando REFRESCO INTEGRAL para presupuestos con LWW REAL...');
                
                // SEPARAR presupuestos NUEVOS de ACTUALIZADOS para logs específicos
                const presupuestosNuevos = new Set();
                const presupuestosActualizados = new Set();
                
                for (const id of idsCambiados) {
                    const localTimestamp = localTimestamps.get(id);
                    if (!localTimestamp) {
                        presupuestosNuevos.add(id);
                    } else {
                        presupuestosActualizados.add(id);
                    }
                }
                
                console.log(`[LWW-REAL] 📊 REFRESCO INTEGRAL:`);
                console.log(`[LWW-REAL]   Presupuestos NUEVOS: ${presupuestosNuevos.size}`);
                console.log(`[LWW-REAL]   Presupuestos ACTUALIZADOS: ${presupuestosActualizados.size}`);
                
                // LOGS SIMPLES como solicitó el usuario
                if (presupuestosActualizados.size > 0) {
                    console.log('[LWW-REAL] 📝 IDs ACTUALIZADOS:', Array.from(presupuestosActualizados).join(', '));
                }
                
                // APLICAR REFRESCO INTEGRAL: encabezado + detalles + mapeo
                console.log('[LWW-REAL] Aplicando refresco integral (encabezado + detalles + mapeo)...');
                
                // Contar detalles antes de la sincronización
                const detallesAntesQuery = `
                    SELECT COUNT(*) as count
                    FROM presupuestos_detalles 
                    WHERE id_presupuesto_ext = ANY($1::text[])
                `;
                const detallesAntes = await db.query(detallesAntesQuery, [Array.from(idsCambiados)]);
                const countDetallesAntes = parseInt(detallesAntes.rows[0].count);
                
                // SINCRONIZACIÓN INTEGRAL: DELETE + INSERT completo de detalles
                await syncDetallesDesdeSheets(detallesSheets, idsCambiados, db);
                
                // Contar detalles después de la sincronización
                const detallesDespuesQuery = `
                    SELECT COUNT(*) as count
                    FROM presupuestos_detalles 
                    WHERE id_presupuesto_ext = ANY($1::text[])
                `;
                const detallesDespues = await db.query(detallesDespuesQuery, [Array.from(idsCambiados)]);
                const countDetallesDespues = parseInt(detallesDespues.rows[0].count);
                
                // Verificar mapeo consistente
                const mapeoConsistenteQuery = `
                    SELECT COUNT(d.id) as detalles_count, COUNT(m.local_detalle_id) as map_count
                    FROM presupuestos_detalles d
                    LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
                    WHERE d.id_presupuesto_ext = ANY($1::text[])
                `;
                const mapeoConsistente = await db.query(mapeoConsistenteQuery, [Array.from(idsCambiados)]);
                const detallesCount = parseInt(mapeoConsistente.rows[0].detalles_count);
                const mapCount = parseInt(mapeoConsistente.rows[0].map_count);
                const mapeoEsConsistente = detallesCount === mapCount;
                
                // LOGS SIMPLES como solicitó el usuario
                console.log(`[LWW-REAL] ✅ REFRESCO INTEGRAL COMPLETADO:`);
                console.log(`[LWW-REAL]   Presupuestos actualizados: ${presupuestosActualizados.size}`);
                console.log(`[LWW-REAL]   Detalles eliminados: ${countDetallesAntes}`);
                console.log(`[LWW-REAL]   Detalles insertados: ${countDetallesDespues}`);
                console.log(`[LWW-REAL]   Mapeo consistente: ${mapeoEsConsistente ? 'SÍ' : 'NO'} (${mapCount}/${detallesCount})`);
                
                if (mapeoEsConsistente) {
                    console.log('[LWW-REAL] ✅ detalles_map quedó consistente en esta misma corrida');
                } else {
                    console.log('[LWW-REAL] ⚠️ detalles_map NO está consistente - revisar');
                }
                
            } catch (e) {
                console.error('[LWW-REAL] ❌ Error en refresco integral:', e?.message);
            }
        }

        console.log('[LWW-REAL] Pull completado:', { 
            recibidos, 
            actualizados, 
            omitidos, 
            omitidosPorSinFecha,
            omitidosPorAnteriores
        });
        
        return { 
            recibidos, 
            actualizados, 
            omitidos, 
            omitidosPorCutoff: 0, // No usamos cutoff_at en LWW REAL
            omitidosPorSinFecha,
            omitidosPorAnteriores
        };
        
    } catch (error) {
        console.error('[LWW-REAL] Error en pull:', error.message);
        return { recibidos, actualizados, omitidos };
    }
}

/**
 * Crear MAP para detalles existentes sin eliminarlos
 * SOLO CREA MAP - NO TOCA DETALLES EXISTENTES
 */
async function crearMapParaDetallesExistentes(detallesSheets, idsPresupuestos, db) {
    console.log('[CREATE-MAP] 🚀 Creando MAP para detalles existentes...');
    
    if (!idsPresupuestos || idsPresupuestos.size === 0) {
        console.log('[CREATE-MAP] ❌ No hay IDs para procesar');
        return;
    }
    
    try {
        const crypto = require('crypto');
        let mapCreados = 0;
        
        // Obtener detalles locales que no tienen MAP
        const detallesLocales = await db.query(`
            SELECT d.id, d.id_presupuesto_ext, d.articulo, d.cantidad, d.valor1, d.precio1,
                   d.iva1, d.diferencia, d.camp1, d.camp2, d.camp3, d.camp4, d.camp5, d.camp6
            FROM presupuestos_detalles d
            LEFT JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
            WHERE d.id_presupuesto_ext = ANY($1::text[])
              AND m.local_detalle_id IS NULL
            ORDER BY d.id_presupuesto_ext, d.id
        `, [Array.from(idsPresupuestos)]);
        
        console.log(`[CREATE-MAP] Detalles locales sin MAP: ${detallesLocales.rowCount}`);
        
        if (detallesLocales.rowCount === 0) {
            console.log('[CREATE-MAP] ✅ No hay detalles sin MAP para procesar');
            return;
        }
        
        await db.query('BEGIN');
        
        for (const detalle of detallesLocales.rows) {
            try {
                // Generar ID único para Sheets con formato correcto
                const timestamp = Date.now() + Math.random() * 1000;
                const hash = crypto.createHash('sha1')
                    .update(`${detalle.id_presupuesto_ext}|${detalle.articulo}|${detalle.cantidad}|${detalle.valor1}|${detalle.precio1}|${detalle.iva1}|${detalle.diferencia}|${detalle.camp1}|${detalle.camp2}|${detalle.camp3}|${detalle.camp4}|${detalle.camp5}|${detalle.camp6}|${timestamp}`)
                    .digest('hex');
                
                const idDetallePresupuesto = `${hash.slice(0, 8)}-${hash.slice(8, 12)}`;
                
                // Verificar que el ID sea único
                const existeId = await db.query(`
                    SELECT 1 FROM presupuestos_detalles_map 
                    WHERE id_detalle_presupuesto = $1
                `, [idDetallePresupuesto]);
                
                if (existeId.rowCount > 0) {
                    console.warn(`[CREATE-MAP] ⚠️ ID duplicado generado: ${idDetallePresupuesto}, saltando`);
                    continue;
                }
                
                // Crear MAP con fuente='AppSheet' (porque el presupuesto viene de Google Sheets/AppSheet)
                await db.query(`
                    INSERT INTO presupuestos_detalles_map
                    (local_detalle_id, id_detalle_presupuesto, fuente, fecha_asignacion)
                    VALUES ($1, $2, 'AppSheet', CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires')
                `, [detalle.id, idDetallePresupuesto]);
                
                mapCreados++;
                
                if (mapCreados <= 5) {
                    console.log(`[CREATE-MAP] ✅ MAP creado: local=${detalle.id} sheet=${idDetallePresupuesto} presup=${detalle.id_presupuesto_ext}`);
                }
                
            } catch (error) {
                console.error(`[CREATE-MAP] ❌ Error creando MAP para detalle ${detalle.id}:`, error.message);
            }
        }
        
        await db.query('COMMIT');
        console.log(`[CREATE-MAP] ✅ MAP creados exitosamente: ${mapCreados}`);
        
    } catch (error) {
        await db.query('ROLLBACK');
        console.error('[CREATE-MAP] ❌ Error creando MAP, rollback ejecutado:', error.message);
        throw error;
    }
}

/**
 * Ejecutar sincronización bidireccional TOLERANTE A CUOTAS (NUEVO)
 * POST /api/presupuestos/sync/bidireccional-safe
 * 
 * Implementa:
 * - Control de tasa de escrituras (respeta cuotas de Google Sheets)
 * - Reintentos automáticos con backoff exponencial
 * - Procesamiento por lotes controlados
 * - Progreso visible para el frontend
 * - Minimización de escrituras (solo cambios reales)
 * - Idempotencia y reanudación
 */
const ejecutarSincronizacionBidireccionalSafe = async (req, res) => {
    console.log('[SYNC-BIDI-SAFE] 🚀 Iniciando sincronización bidireccional tolerante a cuotas...');
    
    try {
        // PASO 1: Obtener configuración activa
        const configQuery = `
            SELECT hoja_id, hoja_nombre, hoja_url, cutoff_at, usuario_id
            FROM presupuestos_config 
            WHERE activo = true 
            ORDER BY fecha_creacion DESC 
            LIMIT 1
        `;
        
        const configResult = await req.db.query(configQuery);
        
        if (configResult.rows.length === 0) {
            return res.status(400).json({
                success: false,
                code: 'CONFIG_MISSING',
                message: 'No se encontró configuración activa en presupuestos_config',
                timestamp: new Date().toISOString()
            });
        }
        
        const config = configResult.rows[0];
        
        // Validar cutoff_at
        if (!config.cutoff_at) {
            // Inicializar cutoff_at si no existe (7 días atrás)
            const cutoffInicial = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            await req.db.query(`
                UPDATE presupuestos_config 
                SET cutoff_at = $1
                WHERE activo = true
            `, [cutoffInicial]);
            
            config.cutoff_at = cutoffInicial;
            console.log('[SYNC-BIDI-SAFE] cutoff_at inicializado:', cutoffInicial.toISOString());
        }
        
        console.log('[SYNC-BIDI-SAFE] Configuración:', {
            hoja_id: config.hoja_id,
            hoja_nombre: config.hoja_nombre,
            cutoff_at: config.cutoff_at
        });
        
        // PASO 2: Importar y ejecutar servicio tolerante a cuotas
        const { ejecutarSincronizacionBidireccionalQuotaSafe } = require('../../services/gsheets/syncQuotaSafe');
        
        // Callback de progreso (puede ser extendido para SSE/WebSocket)
        const progressLog = [];
        const onProgress = async (progressInfo) => {
            progressLog.push({
                timestamp: new Date().toISOString(),
                ...progressInfo
            });
            
            // Log en consola para seguimiento
            console.log(`[SYNC-PROGRESS] ${progressInfo.fase}: Lote ${progressInfo.currentBatch}/${progressInfo.totalBatches} - ${progressInfo.progressPercent}%`);
            
            // Aquí podrías emitir evento a frontend via WebSocket/SSE si está implementado
            // socketIO.emit('sync-progress', progressInfo);
        };
        
        // PASO 3: Ejecutar sincronización con control de cuota
        const startTime = Date.now();
        const summary = await ejecutarSincronizacionBidireccionalQuotaSafe(
            config,
            req.db,
            onProgress
        );
        const endTime = Date.now();
        
        // PASO 4: Registrar log de sincronización
        try {
            await req.db.query(`
                INSERT INTO public.presupuestos_sync_log 
                (fecha_sync, exitoso, registros_procesados, registros_nuevos, registros_actualizados, 
                 detalles, tipo_sync, usuario_id, duracion_segundos)
                VALUES (
                    CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires', 
                    true, 
                    $1, 
                    $2, 
                    $3, 
                    $4, 
                    'bidireccional_safe', 
                    $5,
                    $6
                )
            `, [
                summary.metrics.presupuestosInsertados + summary.metrics.presupuestosActualizados,
                summary.metrics.presupuestosInsertados,
                summary.metrics.presupuestosActualizados,
                JSON.stringify({
                    ...summary.metrics,
                    quotaStats: summary.quotaStats,
                    progressLog: progressLog.slice(-10) // Últimos 10 eventos de progreso
                }),
                config.usuario_id || req.user?.id || null,
                summary.duration
            ]);
            
            console.log('[SYNC-BIDI-SAFE] ✅ Log de sincronización registrado');
        } catch (logError) {
            console.warn('[SYNC-BIDI-SAFE] ⚠️ Error registrando log:', logError.message);
        }
        
        // PASO 5: Responder con resumen detallado
        res.json({
            success: true,
            message: 'Sincronización bidireccional completada exitosamente con control de cuota',
            duracion: summary.duration,
            duracionMs: endTime - startTime,
            metrics: {
                presupuestos: {
                    leidos: summary.metrics.presupuestosLeidos,
                    insertados: summary.metrics.presupuestosInsertados,
                    actualizados: summary.metrics.presupuestosActualizados,
                    borrados: summary.metrics.presupuestosBorrados
                },
                detalles: {
                    leidos: summary.metrics.detallesLeidos,
                    insertados: summary.metrics.detallesInsertados,
                    actualizados: summary.metrics.detallesActualizados,
                    borrados: summary.metrics.detallesBorrados
                },
                optimizacion: {
                    omitidosPorCutoff: summary.metrics.omitidosPorCutoff,
                    omitidosPorSinCambios: summary.metrics.omitidosPorSinCambios,
                    escriturasTotales: summary.quotaStats.totalWrites,
                    escriturasOptimizadas: summary.metrics.omitidosPorSinCambios
                },
                cuota: {
                    totalEscrituras: summary.quotaStats.totalWrites,
                    totalReintentos: summary.quotaStats.totalRetries,
                    cuotasExcedidas: summary.quotaStats.quotaExceededCount,
                    utilizacionPorcentaje: summary.quotaStats.utilizationPercent
                },
                errores: summary.metrics.errores
            },
            cutoffAtActualizado: summary.cutoffAtActualizado,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[SYNC-BIDI-SAFE] ❌ Error en sincronización:', error.message);
        
        // Verificar si es error de cuota
        const { QuotaExceededError } = require('../../services/gsheets/quotaManager');
        
        if (error instanceof QuotaExceededError) {
            return res.status(429).json({
                success: false,
                code: 'QUOTA_EXCEEDED',
                message: 'La cuota de Google Sheets fue excedida tras varios reintentos. Por favor intente la sincronización nuevamente en 1-2 minutos.',
                retryAfter: error.retryAfter || 60,
                partialResults: error.state,
                timestamp: new Date().toISOString()
            });
        }
        
        // Otros errores
        res.status(500).json({
            success: false,
            code: 'SYNC_ERROR',
            message: 'Error interno en sincronización bidireccional',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

console.log('[SYNC-FECHAS-CONTROLLER] ✅ Controlador de corrección de fechas configurado');

module.exports = {
    ejecutarCorreccion,
    obtenerEstadisticasFechas,
    obtenerHistorialCorrecciones,
    validarConfiguracion,
    ejecutarPushAltas,
    ejecutarSincronizacionBidireccional,
    ejecutarSincronizacionBidireccionalSafe  // NUEVO
};
