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
        const pres = await readSheetWithHeaders(config.hoja_id, 'A:O', 'Presupuestos');
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
 */
const ejecutarSincronizacionBidireccional = async (req, res) => {
    console.log('[SYNC-BIDI] Iniciando sincronización bidireccional...');
    
    try {
        // PASO 1: Resolver configuración (igual que otros endpoints)
        let config = null;
        
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
                console.log('[SYNC-BIDI] Configuración persistida encontrada:', configPersistida.sheet_id);
                
                config = {
                    hoja_id: configPersistida.sheet_id,
                    hoja_url: configPersistida.sheet_url,
                    hoja_nombre: 'PresupuestosCopia',
                    usuario_id: req.user?.id || null
                };
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
        
        console.log('[SYNC-BIDI] Configuración final:', {
            hoja_id: config.hoja_id,
            hoja_nombre: config.hoja_nombre
        });
        
        // PASO 2: Leer datos actuales de Sheets
        console.log('[SYNC-BIDI] Leyendo datos actuales de Sheets...');
        const presupuestosSheets = await readSheetWithHeaders(config.hoja_id, 'A:O', 'Presupuestos');
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
        const { pushAltasLocalesASheets, pushDetallesLocalesASheets } = require('../../services/gsheets/sync_fechas_fix');
        
        // Releer después de marcar anulados
        const presupuestosActualizados1 = await readSheetWithHeaders(config.hoja_id, 'A:O', 'Presupuestos');
        const presupuestosData_updated = { 
            headers: presupuestosActualizados1.headers, 
            rows: presupuestosActualizados1.rows 
        };
        
        const insertedIds = await pushCambiosLocalesConTimestamp(presupuestosData_updated, config, req.db);
        await pushDetallesLocalesASheets(insertedIds, config, req.db);
        
        console.log(`[SYNC-BTN] phase=push-upserts count=${insertedIds?.size || 0}`);
        
        // ===== FASE 3: PULL CAMBIOS REMOTOS =====
        console.log('[SYNC-BTN] === FASE 3: PULL CAMBIOS REMOTOS ===');
        
        // Releer Sheets después de todos los pushes
        const presupuestosFinales = await readSheetWithHeaders(config.hoja_id, 'A:O', 'Presupuestos');
        const detallesFinales = await readSheetWithHeaders(config.hoja_id, 'A:Q', 'DetallesPresupuestos');
        
        const pullResult = await pullCambiosRemotosConTimestampMejorado(presupuestosFinales, detallesFinales, req.db);
        
        console.log(`[SYNC-BTN] phase=pull count=${pullResult.recibidos + pullResult.actualizados}`);
        
        // PASO 5: Responder con resumen
        res.json({
            success: true,
            fases: {
                push_deletes: countAnulados,
                push_upserts: insertedIds ? insertedIds.size : 0,
                pull: pullResult.recibidos + pullResult.actualizados
            },
            push: {
                enviados: insertedIds ? insertedIds.size : 0,
                detallesEnviados: null,
                anulados: countAnulados
            },
            pull: {
                recibidos: pullResult.recibidos,
                actualizados: pullResult.actualizados,
                omitidos: pullResult.omitidos
            },
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
 * Push de cambios locales priorizando ALTAS NUEVAS y recientes.
 * - No depende de LastModified para decidir si existe: usa sólo el ID (col A).
 * - APPEND si el ID NO existe en Sheets.
 * - NO actualiza registros existentes (evita tocar históricos).
 * - Sólo mira "recientes" para no recorrer toda la historia.
 * - Limita escrituras por corrida para cuidar cuota.
 */
async function pushCambiosLocalesConTimestamp(presupuestosData, config, db) {
  console.log('[SYNC-BIDI] Push (solo ALTAS nuevas y recientes)…');

  // ⚙️ Parámetros de seguridad
  const ONLY_RECENT_DAYS = parseInt(process.env.SYNC_ONLY_RECENT_DAYS || '30', 10); // ventana de recencia
  const MAX_APPENDS_PER_SYNC = parseInt(process.env.SYNC_MAX_APPENDS || '20', 10); // cap de appends

  try {
    const { getSheets } = require('../../google/gsheetsClient');
    const sheets = await getSheets();

    // ==== 1) Construir índice de IDs existentes en Sheets (columna A) ====
    const sheetIdSet = new Set();
    const sheetRowIndex = new Map(); // por si en el futuro querés updates
    presupuestosData.rows.forEach((row, i) => {
      const id = (row[presupuestosData.headers[0]] || '').toString().trim(); // A: IDPresupuesto
      if (id) {
        sheetIdSet.add(id);
        sheetRowIndex.set(id, i + 2); // (2-based, por encabezado)
      }
    });

    console.log('[SYNC-BIDI] IDs actuales en Sheets:', sheetIdSet.size);

    // ==== 2) Traer SOLO locales recientes (por fecha_actualizacion) ====
    // Nota: si tu campo “fecha_actualizacion” puede ser null para nuevas ALTAS,
    // usamos NOW() como fallback al construir la fila.
  const rs = await db.query(
      `
      SELECT id_presupuesto_ext, id_cliente, fecha, fecha_entrega, agente, tipo_comprobante,
             nota, estado, informe_generado, cliente_nuevo_id, punto_entrega, descuento,
             fecha_actualizacion, activo, necesita_sync_sheets
      FROM public.presupuestos
      WHERE (activo = true OR necesita_sync_sheets = true)
      ORDER BY fecha_actualizacion DESC NULLS FIRST
      LIMIT 800
      `
    );

    console.log('[SYNC-BIDI] Locales recientes leídos:', rs.rowCount);

    // ==== 3) Filtrar solo ALTAS nuevas (ID no existe en Sheets) ====
    const nuevas = [];
    for (const r of rs.rows) {
      const id = (r.id_presupuesto_ext || '').toString().trim();
      if (!id) {
        console.log('[SYNC-BIDI][OMIT] Sin ID externo, no se puede subir.');
        continue;
      }

      if (!sheetIdSet.has(id)) {
        nuevas.push(r);
        console.log('[SYNC-BIDI][CANDIDATO-APPEND] ID nuevo (no existe en Sheets):', id);
      } else {
        // Existe → no lo tocamos (evitamos reescrituras históricas)
      }
    }

    if (nuevas.length === 0) {
      console.log('[SYNC-BIDI] No hay ALTAS nuevas para subir (recientes).');
      return new Set();
    }

    // ==== 4) Cap de escritura por cuota ====
    const aAppend = nuevas.slice(0, MAX_APPENDS_PER_SYNC);
    console.log(`[SYNC-BIDI] ALTAS nuevas detectadas=${nuevas.length} | aAppend (cap)=${aAppend.length}`);

    // ==== 5) Helper de formateo A:O (coherente con tu esquema) ====
    const toRow = (r) => {
      const pctStr = formatDescuentoForSheet(r.descuento);
      const lastModifiedAR = toSheetDateTimeAR(r.fecha_actualizacion || Date.now());
      return [
        (r.id_presupuesto_ext ?? '').toString().trim(), // A  IDPresupuesto
        toSheetDate(r.fecha),                           // B  Fecha
        r.id_cliente ?? '',                             // C  IDCliente
        r.agente ?? '',                                 // D  Agente
        toSheetDate(r.fecha_entrega),                   // E  Fecha de entrega
        r.tipo_comprobante ?? '',                       // F  Factura/Efectivo
        r.nota ?? '',                                   // G  Nota
        r.estado ?? '',                                 // H  Estado
        r.informe_generado ?? '',                       // I  InformeGenerado
        r.cliente_nuevo_id ?? '',                       // J  ClienteNuevID
        '',                                             // K  Estado/ImprimePDF
        r.punto_entrega ?? '',                          // L  PuntoEntrega
        pctStr,                                         // M  Descuento
        lastModifiedAR,                                 // N  LastModified (lo inicializamos)
        true                                            // O  Activo
      ];
    };

    // ==== 6) Hacer APPEND (uno por uno; cap bajo evita cuota) ====
    const insertedIds = new Set();

    for (const r of aAppend) {
      const id = (r.id_presupuesto_ext ?? '').toString().trim();
      const values = [toRow(r)];

      try {
        await sheets.spreadsheets.values.append({
          spreadsheetId: config.hoja_id,
          range: 'Presupuestos!A1:O1',
          valueInputOption: 'USER_ENTERED', // deja a Sheets interpretar fechas/locales
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values, majorDimension: 'ROWS' }
        });
        console.log('[SYNC-BIDI][APPEND-OK]', id);
        insertedIds.add(id);
      } catch (e) {
        console.warn('[SYNC-BIDI][APPEND-ERR]', id, e?.message);
      }
    }

    console.log('[SYNC-BIDI] ALTAS insertadas efectivamente:', insertedIds.size);
    return insertedIds;

  } catch (e) {
    console.warn('[SYNC-BIDI] Error general en push (altas recientes):', e?.message);
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
                    await syncDetallesDesdeSheets(detallesSheets, idsCambiados, db);
                } catch (e) {
                    console.warn('[SYNC-BIDI] No se pudieron sincronizar detalles:', e?.message);
                }
            }

            // MEJORA CRÍTICA: Siempre verificar presupuestos sin detalles locales, independientemente de si hubo cambios
            console.log('[SYNC-BIDI] Verificando presupuestos sin detalles locales...');
            try {
                // Función helper para búsqueda robusta de columnas (movida aquí para reutilización)
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
                
                if (idxId !== -1) {
                    console.log(`[SYNC-BIDI] ✅ Columna de ID encontrada: "${H[idxId]}" (índice ${idxId})`);
                    
                    // 1) IDs que tienen al menos un detalle en la hoja DetallesPresupuestos
                    const idsConDetallesEnSheets = new Set(
                        detallesSheets.rows
                            .map(r => {
                                const id = String((Array.isArray(r) ? r[idxId] : r[H[idxId]]) ?? '').trim();
                                return id;
                            })
                            .filter(Boolean)
                    );

                    console.log(`[SYNC-BIDI] Presupuestos con detalles en Sheets: ${idsConDetallesEnSheets.size}`);
                    
                    // Log de muestra de IDs encontrados
                    const muestraIds = Array.from(idsConDetallesEnSheets).slice(0, 5);
                    console.log(`[SYNC-BIDI] Muestra de IDs con detalles en Sheets: ${muestraIds.join(', ')}`);

                    if (idsConDetallesEnSheets.size > 0) {
                        // 2) De esos, ¿cuáles NO tienen detalles en local?
                        console.log('[SYNC-BIDI] Consultando presupuestos sin detalles en BD local...');
                        
                        const rs = await db.query(`
                            SELECT p.id_presupuesto_ext
                            FROM public.presupuestos p
                            LEFT JOIN public.presupuestos_detalles d
                            ON d.id_presupuesto_ext = p.id_presupuesto_ext
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
                        `, [Array.from(idsConDetallesEnSheets)]);

                        const idsSinDetallesLocal = new Set(
                            rs.rows
                            .map(r => (r.id_presupuesto_ext || '').toString().trim())
                            .filter(Boolean)
                        );

                        console.log(`[SYNC-BIDI] Presupuestos sin detalles en BD local: ${idsSinDetallesLocal.size}`);

                        if (idsSinDetallesLocal.size > 0) {
                            console.log(
                            '[SYNC-BIDI] 🚨 PRESUPUESTOS SIN DETALLES DETECTADOS:',
                            Array.from(idsSinDetallesLocal).join(', ')
                            );
                            
                            console.log('[SYNC-BIDI] Ejecutando syncDetallesDesdeSheets para presupuestos sin detalles...');
                            await syncDetallesDesdeSheets(detallesSheets, idsSinDetallesLocal, db);
                            console.log(`[SYNC-BIDI] ✅ Detalles sincronizados para ${idsSinDetallesLocal.size} presupuestos`);
                        } else {
                            console.log('[SYNC-BIDI] ✅ Todos los presupuestos ya tienen sus detalles locales');
                        }
                    } else {
                        console.warn('[SYNC-BIDI] ⚠️ No se encontraron presupuestos con detalles en Sheets');
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
             activo, fecha_actualizacion, hoja_nombre, hoja_url, usuario_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        `;
        
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
                activo = $13,
                fecha_actualizacion = $14
            WHERE id_presupuesto_ext = $1
        `;
        
        await db.query(updateQuery, [
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
            presupuesto.activo,
            presupuesto.lastModified
        ]);
        
    } catch (error) {
        console.error('[SYNC-BIDI] Error actualizando desde Sheet:', error.message);
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
        // CORRECCIÓN CRÍTICA: Mapeo correcto según especificación del usuario
        // camp1 (local) ↔ Camp2 (Google Sheets - columna J)
        // camp2 (local) ↔ Camp3 (Google Sheets - columna K)
        // camp3 (local) ↔ Camp4 (Google Sheets - columna L)
        // camp4 (local) ↔ Camp5 (Google Sheets - columna M)
        // camp5 (local) ↔ Camp6 (Google Sheets - columna N)
        // camp6 (local) ↔ Condicion (Google Sheets - columna O)
        camp1:   findColumnIndex('Camp2', 'Camp 2', 'Campo2'),           // camp1 ↔ Camp2 (columna J)
        camp2:   findColumnIndex('Camp3', 'Camp 3', 'Campo3'),           // camp2 ↔ Camp3 (columna K)
        camp3:   findColumnIndex('Camp4', 'Camp 4', 'Campo4'),           // camp3 ↔ Camp4 (columna L)
        camp4:   findColumnIndex('Camp5', 'Camp 5', 'Campo5'),           // camp4 ↔ Camp5 (columna M)
        camp5:   findColumnIndex('Camp6', 'Camp 6', 'Campo6'),           // camp5 ↔ Camp6 (columna N)
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

                // Filtrar filas de detalles - MEJORADO con mejor lógica
                const filas = [];
                let filasOmitidas = 0;

                detallesSheets.rows.forEach((row, i) => {
                const idCell = String(cell(row, idx.id) ?? '').trim();
                if (idCell && idSet.has(idCell)) {
                    const articulo = String(cell(row, idx.art) ?? '').trim();
                    if (articulo) {
                    filas.push(row);
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

                console.log(`[SYNC-BIDI][DETALLES] 📊 Filas procesadas: ${filas.length} incluidas, ${filasOmitidas} omitidas de ${detallesSheets.rows.length} totales`);
                console.log(`[DET-DBG][POST-FILTER] incluidas=${filas.length} / tot=${detallesSheets.rows.length}`);
                filas.slice(-5).forEach((r, i2) => {
                const idByIdx   = r?.[idx.id];
                const idByName  = (r && H[idx.id] != null) ? r[H[idx.id]] : undefined;
                const artByIdx  = r?.[idx.art];
                const artByName = (r && H[idx.art] != null) ? r[H[idx.art]] : undefined;
                console.log('[DET-DBG][CAND]', {
                    pos: i2,
                    mode: Array.isArray(r) ? 'array' : 'obj',
                    id_idx: idByIdx, id_name: idByName,
                    art_idx: artByIdx, art_name: artByName
                });
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

        // Insertar nuevos detalles - MEJORADO con mejor manejo de errores
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


                await db.query(
                    `INSERT INTO public.presupuestos_detalles
                       (id_presupuesto_ext, articulo, cantidad, valor1, precio1, iva1,
                        camp1, camp2, camp3, camp4, camp5, camp6, fecha_actualizacion)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
                    [idCell, articulo, cantidad, valor1, precio1, iva1,
                     camp1, camp2, camp3, camp4, camp5, camp6]
                );
                
                insertedCount++;
                
                // Log de los primeros 3 detalles insertados
                if (insertedCount <= 3) {
                    console.log(`[SYNC-BIDI][DETALLES] ✅ Detalle ${insertedCount}: ${idCell} - ${articulo} (cant: ${cantidad}, precio: ${precio1})`);
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

  // mapa: id -> nro de fila en Sheets (2-based, por el encabezado)
  const rowById = new Map();
  presupuestosData.rows.forEach((r, i) => {
    const id = String(r[H[idxId]] ?? '').trim();
    if (id) rowById.set(id, i + 2);
  });

  // MEJORA CRÍTICA: Incluir presupuestos recién anulados (mismo ciclo)
  // Usar fecha_actualizacion para capturar cambios recientes
  const rs = await db.query(`
    SELECT id_presupuesto_ext, fecha_actualizacion
    FROM public.presupuestos
    WHERE activo = false 
    AND COALESCE(id_presupuesto_ext,'') <> ''
    AND fecha_actualizacion >= NOW() - INTERVAL '1 hour'
    ORDER BY fecha_actualizacion DESC
  `);
  
  if (!rs.rowCount) {
    console.log('[SYNC-BTN] No hay presupuestos anulados recientes para marcar en Sheets');
    return 0;
  }

  console.log(`[SYNC-BTN] Encontrados ${rs.rowCount} presupuestos anulados recientes para marcar en Sheets`);

  const now = toSheetDateTimeAR(Date.now());
  const data = [];
  let marcados = 0;

  for (const { id_presupuesto_ext } of rs.rows) {
    const id = String(id_presupuesto_ext).trim();
    const rowNum = rowById.get(id);
    if (!rowNum) {
      console.log(`[SYNC-BTN] Presupuesto anulado ${id} no existe en Sheets, omitiendo`);
      continue; // si no existe en Sheets, nada que marcar
    }

    // O (Activo) -> FALSE
    data.push({ range: `Presupuestos!O${rowNum}:O${rowNum}`, values: [[false]] });
    // H (Estado) -> 'Anulado' (opcional pero recomendable)
    data.push({ range: `Presupuestos!H${rowNum}:H${rowNum}`, values: [['Anulado']] });
    // N (LastModified) -> ahora (CRÍTICO para LWW)
    data.push({ range: `Presupuestos!N${rowNum}:N${rowNum}`, values: [[now]] });
    
    marcados++;
    console.log(`[SYNC-BTN] Marcando como anulado en Sheets: ${id} (fila ${rowNum})`);
  }

  if (data.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: config.hoja_id,
      requestBody: { valueInputOption: 'USER_ENTERED', data }
    });
    console.log(`[SYNC-BTN] ✅ Marcados ${marcados} presupuestos como inactivos en Sheets`);
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
 * Pull de cambios remotos con comparación de timestamp MEJORADO
 * INCLUYE TIE-BREAK: cuando timestamps son iguales, anulación local gana
 */
async function pullCambiosRemotosConTimestampMejorado(presupuestosSheets, detallesSheets, db) {
    console.log('[SYNC-BIDI] Comparando timestamps para pull (con tie-break para anulaciones)...');
    
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
            const esInactivoEnSheets = String(activoValue ?? '').toLowerCase() === 'false';

            if (!localData) {
                // No existe localmente: crear solo si en Sheets está ACTIVO
                if (esInactivoEnSheets) {
                    console.log('[SYNC-BIDI] Omitiendo presupuesto inactivo de Sheets:', id);
                    omitidos++;
                    continue;
                }
                await insertarPresupuestoDesdeSheet(row, presupuestosSheets.headers, db);
                recibidos++;
                idsCambiados.add(id);
                console.log('[SYNC-BIDI] Nuevo desde Sheets:', id);
            } else if (localData.activo === false) {
                // MEJORA CRÍTICA: TIE-BREAK para anulaciones
                // Si local está inactivo, verificar si debe prevalecer sobre Sheets
                const timeDiff = Math.abs(sheetTimestamp.getTime() - localData.timestamp.getTime());
                const isTimestampTie = timeDiff < 60000; // menos de 1 minuto = empate
                
                if (isTimestampTie || sheetTimestamp <= localData.timestamp) {
                    // Local gana: mantener anulación local
                    console.log(`[SYNC-BIDI] TIE-BREAK: Anulación local prevalece sobre Sheets para ${id}`);
                    omitidos++;
                    continue;
                } else if (sheetTimestamp > localData.timestamp && !esInactivoEnSheets) {
                    // Sheets más reciente y activo: reactivar local
                    await actualizarPresupuestoDesdeSheet(row, presupuestosSheets.headers, db);
                    actualizados++;
                    idsCambiados.add(id);
                    console.log('[SYNC-BIDI] Reactivado desde Sheets (más reciente):', id);
                } else {
                    omitidos++;
                }
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
                await syncDetallesDesdeSheets(detallesSheets, idsCambiados, db);
            } catch (e) {
                console.warn('[SYNC-BIDI] No se pudieron sincronizar detalles:', e?.message);
            }
        }

        // MEJORA CRÍTICA: Siempre verificar presupuestos sin detalles locales, independientemente de si hubo cambios
        console.log('[SYNC-BIDI] Verificando presupuestos sin detalles locales...');
        try {
            // Función helper para búsqueda robusta de columnas (movida aquí para reutilización)
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
            
            if (idxId !== -1) {
                console.log(`[SYNC-BIDI] ✅ Columna de ID encontrada: "${H[idxId]}" (índice ${idxId})`);
                
                // 1) IDs que tienen al menos un detalle en la hoja DetallesPresupuestos
                const idsConDetallesEnSheets = new Set(
                    detallesSheets.rows
                        .map(r => {
                            const id = String((Array.isArray(r) ? r[idxId] : r[H[idxId]]) ?? '').trim();
                            return id;
                        })
                        .filter(Boolean)
                );

                console.log(`[SYNC-BIDI] Presupuestos con detalles en Sheets: ${idsConDetallesEnSheets.size}`);
                
                // Log de muestra de IDs encontrados
                const muestraIds = Array.from(idsConDetallesEnSheets).slice(0, 5);
                console.log(`[SYNC-BIDI] Muestra de IDs con detalles en Sheets: ${muestraIds.join(', ')}`);

                if (idsConDetallesEnSheets.size > 0) {
                    // 2) De esos, ¿cuáles NO tienen detalles en local?
                    console.log('[SYNC-BIDI] Consultando presupuestos sin detalles en BD local...');
                    
                    const rs = await db.query(`
                        SELECT p.id_presupuesto_ext
                        FROM public.presupuestos p
                        LEFT JOIN public.presupuestos_detalles d
                        ON d.id_presupuesto_ext = p.id_presupuesto_ext
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
                    `, [Array.from(idsConDetallesEnSheets)]);

                    const idsSinDetallesLocal = new Set(
                        rs.rows
                        .map(r => (r.id_presupuesto_ext || '').toString().trim())
                        .filter(Boolean)
                    );

                    console.log(`[SYNC-BIDI] Presupuestos sin detalles en BD local: ${idsSinDetallesLocal.size}`);

                    if (idsSinDetallesLocal.size > 0) {
                        console.log(
                        '[SYNC-BIDI] 🚨 PRESUPUESTOS SIN DETALLES DETECTADOS:',
                        Array.from(idsSinDetallesLocal).join(', ')
                        );
                        
                        console.log('[SYNC-BIDI] Ejecutando syncDetallesDesdeSheets para presupuestos sin detalles...');
                        await syncDetallesDesdeSheets(detallesSheets, idsSinDetallesLocal, db);
                        console.log(`[SYNC-BIDI] ✅ Detalles sincronizados para ${idsSinDetallesLocal.size} presupuestos`);
                    } else {
                        console.log('[SYNC-BIDI] ✅ Todos los presupuestos ya tienen sus detalles locales');
                    }
                } else {
                    console.warn('[SYNC-BIDI] ⚠️ No se encontraron presupuestos con detalles en Sheets');
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

console.log('[SYNC-FECHAS-CONTROLLER] ✅ Controlador de corrección de fechas configurado');

module.exports = {
    ejecutarCorreccion,
    obtenerEstadisticasFechas,
    obtenerHistorialCorrecciones,
    validarConfiguracion,
    ejecutarPushAltas,
    ejecutarSincronizacionBidireccional
};
