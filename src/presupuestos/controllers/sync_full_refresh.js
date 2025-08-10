console.log('[SYNC-CONTROLLER] Inicializando controlador de sincronización Full Refresh...');

const { executeFullRefreshSync, getSyncState } = require('../../services/gsheets/sync_full_refresh');
const { extractSheetId } = require('../../services/gsheets/client_with_logs');

/**
 * CONTROLADOR DE SINCRONIZACIÓN FULL REFRESH
 * Expone endpoints para ejecutar sincronización completa y segura
 */

/**
 * Ejecutar sincronización Full Refresh
 * POST /api/presupuestos/sync/full-refresh
 */
const executeFullRefresh = async (req, res) => {
    console.log('[SYNC-CONTROLLER] Iniciando Full Refresh Sync...');
    
    try {
        const { 
            hoja_url, 
            mode = 'full_refresh', 
            dryRun = false 
        } = req.body;
        
        // Validar parámetros requeridos
        if (!hoja_url) {
            return res.status(400).json({
                success: false,
                error: 'URL de Google Sheets es requerida',
                timestamp: new Date().toISOString()
            });
        }
        
        // Validar modo
        const validModes = ['full_refresh', 'upsert_stage'];
        if (!validModes.includes(mode)) {
            return res.status(400).json({
                success: false,
                error: `Modo inválido. Debe ser uno de: ${validModes.join(', ')}`,
                timestamp: new Date().toISOString()
            });
        }
        
        // Verificar que no haya otra sincronización en progreso
        const currentState = getSyncState();
        if (currentState.inProgress) {
            return res.status(409).json({
                success: false,
                error: 'Ya hay una sincronización en progreso',
                currentStep: currentState.currentStep,
                progress: currentState.progress,
                timestamp: new Date().toISOString()
            });
        }
        
        // Preparar configuración
        const config = {
            hoja_url: hoja_url,
            hoja_id: extractSheetId(hoja_url),
            hoja_nombre: 'Presupuestos',
            rango: 'A:N',
            usuario_id: req.user?.id || null
        };
        
        const options = {
            mode: mode,
            dryRun: dryRun
        };
        
        console.log(`[SYNC-CONTROLLER] Configuración:`, config);
        console.log(`[SYNC-CONTROLLER] Opciones:`, options);
        
        // Ejecutar sincronización
        const result = await executeFullRefreshSync(config, req.db, options);
        
        // Responder según el resultado
        const statusCode = result.success ? 200 : 500;
        
        res.status(statusCode).json({
            success: result.success,
            mode: result.mode,
            dryRun: result.dryRun,
            duration: result.duration,
            summary: result.summary,
            preflightChecks: result.preflightChecks,
            backup: result.backup,
            validation: result.validation,
            errors: result.errors,
            timestamp: new Date().toISOString()
        });
        
        console.log(`[SYNC-CONTROLLER] ✅ Full Refresh completado: ${result.success ? 'ÉXITO' : 'ERROR'}`);
        
    } catch (error) {
        console.error('[SYNC-CONTROLLER] ❌ Error en Full Refresh:', error.message);
        
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener estado actual de sincronización
 * GET /api/presupuestos/sync/status
 */
const getSyncStatus = async (req, res) => {
    try {
        const state = getSyncState();
        
        res.json({
            success: true,
            syncState: state,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[SYNC-CONTROLLER] ❌ Error obteniendo estado:', error.message);
        
        res.status(500).json({
            success: false,
            error: 'Error al obtener estado de sincronización',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Ejecutar dry run (simulación sin cambios)
 * POST /api/presupuestos/sync/dry-run
 */
const executeDryRun = async (req, res) => {
    console.log('[SYNC-CONTROLLER] Iniciando Dry Run...');
    
    try {
        const { hoja_url, mode = 'full_refresh' } = req.body;
        
        if (!hoja_url) {
            return res.status(400).json({
                success: false,
                error: 'URL de Google Sheets es requerida',
                timestamp: new Date().toISOString()
            });
        }
        
        // Verificar que no haya otra sincronización en progreso
        const currentState = getSyncState();
        if (currentState.inProgress) {
            return res.status(409).json({
                success: false,
                error: 'Ya hay una sincronización en progreso',
                currentStep: currentState.currentStep,
                progress: currentState.progress,
                timestamp: new Date().toISOString()
            });
        }
        
        // Preparar configuración para dry run
        const config = {
            hoja_url: hoja_url,
            hoja_id: extractSheetId(hoja_url),
            hoja_nombre: 'Presupuestos',
            rango: 'A:N',
            usuario_id: req.user?.id || null
        };
        
        const options = {
            mode: mode,
            dryRun: true // Forzar dry run
        };
        
        console.log(`[SYNC-CONTROLLER] Dry Run - Configuración:`, config);
        
        // Ejecutar dry run
        const result = await executeFullRefreshSync(config, req.db, options);
        
        res.json({
            success: result.success,
            mode: result.mode,
            dryRun: true,
            duration: result.duration,
            preflightChecks: result.preflightChecks,
            dataLoaded: {
                presupuestosCount: result.dataLoaded?.presupuestos?.count || 0,
                detallesCount: result.dataLoaded?.detalles?.count || 0
            },
            validation: result.validation,
            errors: result.errors,
            recommendations: result.summary?.recommendations || [],
            timestamp: new Date().toISOString()
        });
        
        console.log(`[SYNC-CONTROLLER] ✅ Dry Run completado: ${result.success ? 'ÉXITO' : 'ERROR'}`);
        
    } catch (error) {
        console.error('[SYNC-CONTROLLER] ❌ Error en Dry Run:', error.message);
        
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener historial de sincronizaciones
 * GET /api/presupuestos/sync/history
 */
const getSyncHistory = async (req, res) => {
    try {
        const { limit = 10, offset = 0 } = req.query;
        
        const historyQuery = `
            SELECT 
                id,
                registros_procesados,
                registros_nuevos,
                registros_actualizados,
                errores,
                fecha_sync,
                exitoso,
                tipo_sync,
                duracion_segundos
            FROM presupuestos_sync_log 
            ORDER BY fecha_sync DESC 
            LIMIT $1 OFFSET $2
        `;
        
        const countQuery = `
            SELECT COUNT(*) as total 
            FROM presupuestos_sync_log
        `;
        
        const [historyResult, countResult] = await Promise.all([
            req.db.query(historyQuery, [parseInt(limit), parseInt(offset)]),
            req.db.query(countQuery)
        ]);
        
        const history = historyResult.rows.map(row => ({
            id: row.id,
            registrosProcesados: row.registros_procesados,
            registrosNuevos: row.registros_nuevos,
            registrosActualizados: row.registros_actualizados,
            errores: row.errores ? row.errores.split('\n') : [],
            fechaSync: row.fecha_sync,
            exitoso: row.exitoso,
            tipoSync: row.tipo_sync,
            duracionSegundos: row.duracion_segundos
        }));
        
        const total = parseInt(countResult.rows[0].total);
        
        res.json({
            success: true,
            history: history,
            pagination: {
                total: total,
                limit: parseInt(limit),
                offset: parseInt(offset),
                pages: Math.ceil(total / parseInt(limit))
            },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[SYNC-CONTROLLER] ❌ Error obteniendo historial:', error.message);
        
        res.status(500).json({
            success: false,
            error: 'Error al obtener historial de sincronizaciones',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener estadísticas de la base de datos actual
 * GET /api/presupuestos/sync/stats
 */
const getDatabaseStats = async (req, res) => {
    try {
        // Estadísticas básicas
        const statsQuery = `
            SELECT 
                (SELECT COUNT(*) FROM presupuestos WHERE activo = true) as total_presupuestos,
                (SELECT COUNT(*) FROM presupuestos_detalles) as total_detalles,
                (SELECT COUNT(*) FROM presupuestos WHERE fecha > CURRENT_DATE + INTERVAL '1 day') as fechas_futuras,
                (SELECT COUNT(*) FROM presupuestos WHERE fecha IS NULL) as fechas_nulas,
                (SELECT MAX(fecha) FROM presupuestos WHERE activo = true) as fecha_mas_reciente,
                (SELECT MIN(fecha) FROM presupuestos WHERE activo = true AND fecha IS NOT NULL) as fecha_mas_antigua
        `;
        
        // Estadísticas por estado
        const estadosQuery = `
            SELECT estado, COUNT(*) as cantidad 
            FROM presupuestos 
            WHERE activo = true 
            GROUP BY estado 
            ORDER BY cantidad DESC
        `;
        
        // Estadísticas por tipo de comprobante
        const tiposQuery = `
            SELECT tipo_comprobante, COUNT(*) as cantidad 
            FROM presupuestos 
            WHERE activo = true 
            GROUP BY tipo_comprobante 
            ORDER BY cantidad DESC
        `;
        
        const [statsResult, estadosResult, tiposResult] = await Promise.all([
            req.db.query(statsQuery),
            req.db.query(estadosQuery),
            req.db.query(tiposQuery)
        ]);
        
        const stats = statsResult.rows[0];
        
        res.json({
            success: true,
            stats: {
                totalPresupuestos: parseInt(stats.total_presupuestos),
                totalDetalles: parseInt(stats.total_detalles),
                fechasFuturas: parseInt(stats.fechas_futuras),
                fechasNulas: parseInt(stats.fechas_nulas),
                fechaMasReciente: stats.fecha_mas_reciente,
                fechaMasAntigua: stats.fecha_mas_antigua,
                porEstado: estadosResult.rows,
                porTipoComprobante: tiposResult.rows
            },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[SYNC-CONTROLLER] ❌ Error obteniendo estadísticas:', error.message);
        
        res.status(500).json({
            success: false,
            error: 'Error al obtener estadísticas de la base de datos',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

console.log('[SYNC-CONTROLLER] ✅ Controlador de sincronización Full Refresh configurado');

module.exports = {
    executeFullRefresh,
    getSyncStatus,
    executeDryRun,
    getSyncHistory,
    getDatabaseStats
};
