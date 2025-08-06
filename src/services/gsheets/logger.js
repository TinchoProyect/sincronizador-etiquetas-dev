console.log('[LOGGER] Inicializando servicio de logging...');

/**
 * Servicio de Logging para Sincronización
 * Maneja el registro detallado de operaciones y errores
 */

/**
 * Registrar log de sincronización en base de datos
 * @param {Object} syncLog - Log de sincronización completo
 * @param {Object} db - Conexión a base de datos
 * @returns {number} ID del log creado
 */
async function registrarLogSincronizacion(syncLog, db) {
    console.log('[LOGGER] 📝 Registrando log de sincronización en base de datos...');
    
    try {
        const query = `
            INSERT INTO presupuestos_sync_log (
                config_id, fecha_sync, exitoso, registros_procesados,
                registros_nuevos, registros_actualizados, errores, 
                warnings, duracion_ms, fases, estadisticas
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id;
        `;
        
        const values = [
            syncLog.config_id,
            syncLog.fecha_inicio,
            syncLog.exitoso,
            syncLog.registros_procesados || 0,
            syncLog.registros_nuevos || 0,
            syncLog.registros_actualizados || 0,
            JSON.stringify(syncLog.errores || []),
            JSON.stringify(syncLog.warnings || []),
            syncLog.duracion_ms || 0,
            JSON.stringify(syncLog.fases || {}),
            JSON.stringify(syncLog.estadisticas || {})
        ];
        
        const result = await db.query(query, values);
        const logId = result.rows[0].id;
        
        console.log(`[LOGGER] ✅ Log registrado exitosamente con ID: ${logId}`);
        console.log(`[LOGGER] - Exitoso: ${syncLog.exitoso}`);
        console.log(`[LOGGER] - Registros procesados: ${syncLog.registros_procesados}`);
        console.log(`[LOGGER] - Duración: ${syncLog.duracion_ms}ms`);
        console.log(`[LOGGER] - Errores: ${syncLog.errores?.length || 0}`);
        console.log(`[LOGGER] - Warnings: ${syncLog.warnings?.length || 0}`);
        
        return logId;
        
    } catch (error) {
        console.error('[LOGGER] ❌ Error registrando log de sincronización:', error.message);
        console.error('[LOGGER] Stack trace:', error.stack);
        console.error('[LOGGER] Datos del log que falló:', {
            config_id: syncLog.config_id,
            exitoso: syncLog.exitoso,
            registros_procesados: syncLog.registros_procesados
        });
        
        throw new Error(`Error registrando log: ${error.message}`);
    }
}

/**
 * Obtener historial de logs de sincronización
 * @param {Object} db - Conexión a base de datos
 * @param {Object} options - Opciones de consulta
 * @returns {Array} Array de logs
 */
async function obtenerHistorialLogs(db, options = {}) {
    const {
        limit = 10,
        offset = 0,
        config_id = null,
        exitoso = null,
        fecha_desde = null,
        fecha_hasta = null
    } = options;
    
    console.log(`[LOGGER] 📋 Obteniendo historial de logs (límite: ${limit}, offset: ${offset})...`);
    
    try {
        let whereConditions = [];
        let queryParams = [];
        let paramIndex = 1;
        
        // Construir condiciones WHERE dinámicamente
        if (config_id !== null) {
            whereConditions.push(`psl.config_id = $${paramIndex}`);
            queryParams.push(config_id);
            paramIndex++;
        }
        
        if (exitoso !== null) {
            whereConditions.push(`psl.exitoso = $${paramIndex}`);
            queryParams.push(exitoso);
            paramIndex++;
        }
        
        if (fecha_desde) {
            whereConditions.push(`psl.fecha_sync >= $${paramIndex}`);
            queryParams.push(fecha_desde);
            paramIndex++;
        }
        
        if (fecha_hasta) {
            whereConditions.push(`psl.fecha_sync <= $${paramIndex}`);
            queryParams.push(fecha_hasta);
            paramIndex++;
        }
        
        const whereClause = whereConditions.length > 0 ? 
            `WHERE ${whereConditions.join(' AND ')}` : '';
        
        const query = `
            SELECT 
                psl.id,
                psl.config_id,
                psl.fecha_sync,
                psl.exitoso,
                psl.registros_procesados,
                psl.registros_nuevos,
                psl.registros_actualizados,
                psl.errores,
                psl.warnings,
                psl.duracion_ms,
                psl.fases,
                psl.estadisticas,
                pc.hoja_url,
                pc.hoja_id,
                pc.hoja_nombre
            FROM presupuestos_sync_log psl
            LEFT JOIN presupuestos_config pc ON pc.id = psl.config_id
            ${whereClause}
            ORDER BY psl.fecha_sync DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        
        queryParams.push(limit, offset);
        
        const result = await db.query(query, queryParams);
        const logs = result.rows;
        
        // Parsear campos JSON
        const logsProcessed = logs.map(log => ({
            ...log,
            errores: typeof log.errores === 'string' ? JSON.parse(log.errores) : log.errores,
            warnings: typeof log.warnings === 'string' ? JSON.parse(log.warnings) : log.warnings,
            fases: typeof log.fases === 'string' ? JSON.parse(log.fases) : log.fases,
            estadisticas: typeof log.estadisticas === 'string' ? JSON.parse(log.estadisticas) : log.estadisticas
        }));
        
        console.log(`[LOGGER] ✅ Historial obtenido: ${logs.length} registros`);
        
        return logsProcessed;
        
    } catch (error) {
        console.error('[LOGGER] ❌ Error obteniendo historial de logs:', error.message);
        throw new Error(`Error en historial: ${error.message}`);
    }
}

/**
 * Obtener estadísticas de logs
 * @param {Object} db - Conexión a base de datos
 * @param {Object} options - Opciones de consulta
 * @returns {Object} Estadísticas de logs
 */
async function obtenerEstadisticasLogs(db, options = {}) {
    const {
        fecha_desde = null,
        fecha_hasta = null,
        config_id = null
    } = options;
    
    console.log('[LOGGER] 📊 Obteniendo estadísticas de logs...');
    
    try {
        let whereConditions = [];
        let queryParams = [];
        let paramIndex = 1;
        
        if (config_id !== null) {
            whereConditions.push(`config_id = $${paramIndex}`);
            queryParams.push(config_id);
            paramIndex++;
        }
        
        if (fecha_desde) {
            whereConditions.push(`fecha_sync >= $${paramIndex}`);
            queryParams.push(fecha_desde);
            paramIndex++;
        }
        
        if (fecha_hasta) {
            whereConditions.push(`fecha_sync <= $${paramIndex}`);
            queryParams.push(fecha_hasta);
            paramIndex++;
        }
        
        const whereClause = whereConditions.length > 0 ? 
            `WHERE ${whereConditions.join(' AND ')}` : '';
        
        const queries = {
            general: `
                SELECT 
                    COUNT(*) as total_sincronizaciones,
                    COUNT(*) FILTER (WHERE exitoso = true) as sincronizaciones_exitosas,
                    COUNT(*) FILTER (WHERE exitoso = false) as sincronizaciones_fallidas,
                    SUM(registros_procesados) as total_registros_procesados,
                    SUM(registros_nuevos) as total_registros_nuevos,
                    SUM(registros_actualizados) as total_registros_actualizados,
                    AVG(duracion_ms) as duracion_promedio_ms,
                    MIN(fecha_sync) as primera_sincronizacion,
                    MAX(fecha_sync) as ultima_sincronizacion
                FROM presupuestos_sync_log
                ${whereClause}
            `,
            porDia: `
                SELECT 
                    DATE(fecha_sync) as fecha,
                    COUNT(*) as sincronizaciones,
                    COUNT(*) FILTER (WHERE exitoso = true) as exitosas,
                    SUM(registros_procesados) as registros_procesados
                FROM presupuestos_sync_log
                ${whereClause}
                GROUP BY DATE(fecha_sync)
                ORDER BY fecha DESC
                LIMIT 30
            `,
            erroresComunes: `
                SELECT 
                    error_msg,
                    COUNT(*) as frecuencia
                FROM (
                    SELECT 
                        jsonb_array_elements_text(errores::jsonb) as error_msg
                    FROM presupuestos_sync_log
                    ${whereClause}
                    AND jsonb_array_length(errores::jsonb) > 0
                ) errors
                GROUP BY error_msg
                ORDER BY frecuencia DESC
                LIMIT 10
            `
        };
        
        const results = {};
        
        for (const [key, query] of Object.entries(queries)) {
            try {
                const result = await db.query(query, queryParams);
                results[key] = result.rows;
            } catch (queryError) {
                console.error(`[LOGGER] ❌ Error en consulta ${key}:`, queryError.message);
                results[key] = [];
            }
        }
        
        const estadisticas = {
            resumen: results.general[0] || {},
            tendencia: results.porDia || [],
            erroresComunes: results.erroresComunes || [],
            timestamp: new Date().toISOString()
        };
        
        // Calcular métricas adicionales
        if (estadisticas.resumen.total_sincronizaciones > 0) {
            estadisticas.resumen.tasa_exito = (
                (estadisticas.resumen.sincronizaciones_exitosas / estadisticas.resumen.total_sincronizaciones) * 100
            ).toFixed(2) + '%';
            
            estadisticas.resumen.duracion_promedio_segundos = (
                estadisticas.resumen.duracion_promedio_ms / 1000
            ).toFixed(2) + 's';
        }
        
        console.log(`[LOGGER] ✅ Estadísticas obtenidas:`);
        console.log(`[LOGGER] - Total sincronizaciones: ${estadisticas.resumen.total_sincronizaciones}`);
        console.log(`[LOGGER] - Tasa de éxito: ${estadisticas.resumen.tasa_exito}`);
        console.log(`[LOGGER] - Registros procesados: ${estadisticas.resumen.total_registros_procesados}`);
        
        return estadisticas;
        
    } catch (error) {
        console.error('[LOGGER] ❌ Error obteniendo estadísticas:', error.message);
        throw new Error(`Error en estadísticas: ${error.message}`);
    }
}

/**
 * Limpiar logs antiguos
 * @param {Object} db - Conexión a base de datos
 * @param {number} diasAntiguedad - Días de antigüedad para eliminar
 * @returns {Object} Resultado de la limpieza
 */
async function limpiarLogsAntiguos(db, diasAntiguedad = 90) {
    console.log(`[LOGGER] 🧹 Limpiando logs anteriores a ${diasAntiguedad} días...`);
    
    try {
        const query = `
            DELETE FROM presupuestos_sync_log
            WHERE fecha_sync < NOW() - INTERVAL '${diasAntiguedad} days'
            RETURNING id
        `;
        
        const result = await db.query(query);
        const eliminados = result.rowCount;
        
        console.log(`[LOGGER] ✅ Limpieza completada: ${eliminados} logs eliminados`);
        
        return {
            eliminados: eliminados,
            diasAntiguedad: diasAntiguedad,
            fecha_limite: new Date(Date.now() - (diasAntiguedad * 24 * 60 * 60 * 1000)).toISOString()
        };
        
    } catch (error) {
        console.error('[LOGGER] ❌ Error limpiando logs antiguos:', error.message);
        throw new Error(`Error en limpieza: ${error.message}`);
    }
}

/**
 * Generar reporte de sincronización
 * @param {Object} syncLog - Log de sincronización
 * @returns {Object} Reporte formateado
 */
function generarReporteSincronizacion(syncLog) {
    console.log('[LOGGER] 📄 Generando reporte de sincronización...');
    
    const reporte = {
        id: syncLog.id || 'N/A',
        timestamp: syncLog.fecha_inicio || new Date().toISOString(),
        duracion: syncLog.duracion_ms ? `${(syncLog.duracion_ms / 1000).toFixed(2)}s` : 'N/A',
        estado: syncLog.exitoso ? '✅ EXITOSO' : '❌ FALLIDO',
        resumen: {
            registros_procesados: syncLog.registros_procesados || 0,
            registros_nuevos: syncLog.registros_nuevos || 0,
            registros_actualizados: syncLog.registros_actualizados || 0,
            errores: syncLog.errores?.length || 0,
            warnings: syncLog.warnings?.length || 0
        },
        fases: {},
        configuracion: {
            config_id: syncLog.config_id,
            hoja_id: syncLog.hoja_id,
            hoja_nombre: syncLog.hoja_nombre
        }
    };
    
    // Procesar información de fases
    if (syncLog.fases) {
        Object.entries(syncLog.fases).forEach(([fase, datos]) => {
            reporte.fases[fase] = {
                duracion: datos.duracion_ms ? `${datos.duracion_ms}ms` : 'N/A',
                exitoso: datos.exitoso ? '✅' : '❌',
                detalles: datos
            };
        });
    }
    
    // Top 5 errores más frecuentes
    if (syncLog.errores && syncLog.errores.length > 0) {
        const errorCount = {};
        syncLog.errores.forEach(error => {
            errorCount[error] = (errorCount[error] || 0) + 1;
        });
        
        reporte.errores_frecuentes = Object.entries(errorCount)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5)
            .map(([error, count]) => ({ error, count }));
    }
    
    console.log(`[LOGGER] ✅ Reporte generado para sincronización ${reporte.estado}`);
    
    return reporte;
}

/**
 * Exportar logs a CSV
 * @param {Array} logs - Array de logs
 * @returns {string} Contenido CSV
 */
function exportarLogsCSV(logs) {
    console.log(`[LOGGER] 📊 Exportando ${logs.length} logs a CSV...`);
    
    const headers = [
        'ID', 'Fecha', 'Exitoso', 'Duración (ms)', 'Registros Procesados',
        'Registros Nuevos', 'Registros Actualizados', 'Errores', 'Warnings',
        'Hoja ID', 'Hoja Nombre'
    ];
    
    const csvRows = [headers.join(',')];
    
    logs.forEach(log => {
        const row = [
            log.id,
            log.fecha_sync,
            log.exitoso ? 'SI' : 'NO',
            log.duracion_ms || 0,
            log.registros_procesados || 0,
            log.registros_nuevos || 0,
            log.registros_actualizados || 0,
            log.errores?.length || 0,
            log.warnings?.length || 0,
            log.hoja_id || '',
            log.hoja_nombre || ''
        ];
        
        csvRows.push(row.map(field => `"${field}"`).join(','));
    });
    
    const csvContent = csvRows.join('\n');
    
    console.log(`[LOGGER] ✅ CSV generado con ${logs.length} registros`);
    
    return csvContent;
}

console.log('[LOGGER] ✅ Servicio de logging configurado');

module.exports = {
    registrarLogSincronizacion,
    obtenerHistorialLogs,
    obtenerEstadisticasLogs,
    limpiarLogsAntiguos,
    generarReporteSincronizacion,
    exportarLogsCSV
};
