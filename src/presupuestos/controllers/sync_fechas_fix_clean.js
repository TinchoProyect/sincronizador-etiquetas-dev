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
});

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
        
        // PASO 5: Obtener métricas del push y generar logging final
        const metrics = global.syncPushMetrics || {};
        const headersInserted = metrics.headers_inserted || 0;
        const headersUpdated = metrics.headers_updated || 0;
        const detailsReplaced = metrics.details_replaced || 0;
        
        // Logging final según especificación
        console.log(`[SYNC-PUSH] headers_updated=${headersUpdated} details_replaced=${detailsReplaced} headers_inserted=${headersInserted}`);
        
        // Limpiar métricas globales
        global.syncPushMetrics = {};
        
        // PASO 6: Responder con resumen
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
                anulados: countAnulados,
                headers_inserted: headersInserted,
                headers_updated: headersUpdated,
                details_replaced: detailsReplaced
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
  console.log('[SYNC-BIDI] Push con upsert mejorado...');

  try {
    // Usar la función mejorada de push que implementa upsert
    const { pushAltasLocalesASheets } = require('../../services/gsheets/sync_fechas_fix');
    const processedIds = await pushAltasLocalesASheets(presupuestosData, config, db);
    
    console.log(`[SYNC-BIDI] Push completado: ${processedIds.size} presupuestos procesados`);
    return processedIds;

  } catch (e) {
    console.error('[SYNC-BIDI] Error en push con upsert:', e?.message);
    return new Set();
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
</create_file>
