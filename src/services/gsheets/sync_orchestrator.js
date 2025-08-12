console.log('[SYNC_ORCHESTRATOR] Inicializando orquestador de sincronización...');

// Importar todos los servicios necesarios
const { readPresupuestosData } = require('./reader');
const { transformPresupuestos, transformDetalles } = require('./transformer');
const { validatePresupuestos, validateDetalles, generateValidationReport } = require('./validator');
const { verifyReferentialIntegrity, generateIntegrityStats } = require('./integrity');
const { upsertPresupuestos, upsertDetalles, getPresupuestosStats } = require('./database');
const { registrarLogSincronizacion } = require('./logger');

/**
 * Orquestador Principal de Sincronización
 * Coordina todo el proceso de sincronización desde Google Sheets a PostgreSQL
 */

/**
 * Ejecutar sincronización completa desde Google Sheets
 * @param {Object} config - Configuración de sincronización
 * @param {Object} db - Conexión a base de datos
 * @returns {Object} Resultado completo de la sincronización
 */
async function syncCompleteFromGoogleSheets(config, db) {
    const startTime = new Date();
    console.log(`[SYNC_ORCHESTRATOR] 🚀 INICIANDO SINCRONIZACIÓN COMPLETA`);
    console.log(`[SYNC_ORCHESTRATOR] Configuración: ${config.hoja_id} - ${config.hoja_nombre}`);
    
    // Inicializar log de sincronización
    const syncLog = {
        config_id: config.id,
        hoja_id: config.hoja_id,
        hoja_nombre: config.hoja_nombre,
        fecha_inicio: startTime,
        exitoso: false,
        registros_procesados: 0,
        registros_nuevos: 0,
        registros_actualizados: 0,
        errores: [],
        warnings: [],
        fases: {},
        estadisticas: {},
        duracion_ms: 0
    };
    
    try {
        // ==========================================
        // FASE 1: LECTURA DESDE GOOGLE SHEETS
        // ==========================================
        console.log(`[SYNC_ORCHESTRATOR] 📖 FASE 1: Leyendo datos desde Google Sheets...`);
        const faseInicioLectura = new Date();
        
        const rawData = await readPresupuestosData(config.hoja_id);
        
        syncLog.fases.lectura = {
            inicio: faseInicioLectura,
            fin: new Date(),
            duracion_ms: new Date() - faseInicioLectura,
            presupuestos_leidos: rawData.metadata.presupuestosCount,
            detalles_leidos: rawData.metadata.detallesCount,
            exitoso: true
        };
        
        console.log(`[SYNC_ORCHESTRATOR] ✅ FASE 1 COMPLETADA:`);
        console.log(`[SYNC_ORCHESTRATOR] - Presupuestos leídos: ${rawData.metadata.presupuestosCount}`);
        console.log(`[SYNC_ORCHESTRATOR] - Detalles leídos: ${rawData.metadata.detallesCount}`);
        
        // ==========================================
        // FASE 2: TRANSFORMACIÓN DE DATOS
        // ==========================================
        console.log(`[SYNC_ORCHESTRATOR] 🔄 FASE 2: Transformando datos...`);
        const faseInicioTransformacion = new Date();
        
        const transformedPresupuestos = transformPresupuestos(rawData.presupuestos);
        const transformedDetalles = transformDetalles(rawData.detalles);
        
        syncLog.fases.transformacion = {
            inicio: faseInicioTransformacion,
            fin: new Date(),
            duracion_ms: new Date() - faseInicioTransformacion,
            presupuestos_transformados: transformedPresupuestos.stats.successful,
            presupuestos_errores: transformedPresupuestos.stats.failed,
            detalles_transformados: transformedDetalles.stats.successful,
            detalles_errores: transformedDetalles.stats.failed,
            exitoso: true
        };
        
        // Agregar errores de transformación al log
        transformedPresupuestos.errors.forEach(error => {
            syncLog.errores.push(`Transformación presupuesto índice ${error.index}: ${error.error}`);
        });
        
        transformedDetalles.errors.forEach(error => {
            syncLog.errores.push(`Transformación detalle índice ${error.index}: ${error.error}`);
        });
        
        console.log(`[SYNC_ORCHESTRATOR] ✅ FASE 2 COMPLETADA:`);
        console.log(`[SYNC_ORCHESTRATOR] - Presupuestos transformados: ${transformedPresupuestos.stats.successful}/${transformedPresupuestos.stats.total}`);
        console.log(`[SYNC_ORCHESTRATOR] - Detalles transformados: ${transformedDetalles.stats.successful}/${transformedDetalles.stats.total}`);
        
        // ==========================================
        // FASE 3: VALIDACIÓN DE DATOS
        // ==========================================
        console.log(`[SYNC_ORCHESTRATOR] ✅ FASE 3: Validando datos...`);
        const faseInicioValidacion = new Date();
        
        const presupuestosValidation = validatePresupuestos(transformedPresupuestos.transformed);
        const detallesValidation = validateDetalles(transformedDetalles.transformed);
        const validationReport = generateValidationReport(presupuestosValidation, detallesValidation);
        
        syncLog.fases.validacion = {
            inicio: faseInicioValidacion,
            fin: new Date(),
            duracion_ms: new Date() - faseInicioValidacion,
            presupuestos_validos: presupuestosValidation.stats.valid,
            presupuestos_invalidos: presupuestosValidation.stats.invalid,
            detalles_validos: detallesValidation.stats.valid,
            detalles_invalidos: detallesValidation.stats.invalid,
            total_errores_validacion: validationReport.summary.totalErrors,
            total_warnings_validacion: validationReport.summary.totalWarnings,
            exitoso: true
        };
        
        // Agregar errores y warnings de validación al log
        presupuestosValidation.errors.forEach(error => {
            syncLog.errores.push(`Validación presupuesto ${error.id_ext}: ${error.error}`);
        });
        
        detallesValidation.errors.forEach(error => {
            syncLog.errores.push(`Validación detalle ${error.id_presupuesto_ext}-${error.articulo}: ${error.error}`);
        });
        
        presupuestosValidation.warnings.forEach(warning => {
            syncLog.warnings.push(`Warning presupuesto ${warning.id_ext}: ${warning.warning}`);
        });
        
        detallesValidation.warnings.forEach(warning => {
            syncLog.warnings.push(`Warning detalle ${warning.id_presupuesto_ext}-${warning.articulo}: ${warning.warning}`);
        });
        
        console.log(`[SYNC_ORCHESTRATOR] ✅ FASE 3 COMPLETADA:`);
        console.log(`[SYNC_ORCHESTRATOR] - Presupuestos válidos: ${presupuestosValidation.stats.valid}/${presupuestosValidation.stats.total}`);
        console.log(`[SYNC_ORCHESTRATOR] - Detalles válidos: ${detallesValidation.stats.valid}/${detallesValidation.stats.total}`);
        console.log(`[SYNC_ORCHESTRATOR] - Errores de validación: ${validationReport.summary.totalErrors}`);
        console.log(`[SYNC_ORCHESTRATOR] - Warnings: ${validationReport.summary.totalWarnings}`);
        
        // ==========================================
        // FASE 4: VERIFICACIÓN DE INTEGRIDAD
        // ==========================================
        console.log(`[SYNC_ORCHESTRATOR] 🔗 FASE 4: Verificando integridad referencial...`);
        const faseInicioIntegridad = new Date();
        
        const integrityResult = await verifyReferentialIntegrity(
            presupuestosValidation.valid,
            detallesValidation.valid,
            db
        );
        
        const integrityStats = generateIntegrityStats(integrityResult);
        
        syncLog.fases.integridad = {
            inicio: faseInicioIntegridad,
            fin: new Date(),
            duracion_ms: new Date() - faseInicioIntegridad,
            huerfanos_encontrados: integrityResult.orphansFound,
            huerfanos_resueltos: integrityResult.orphansResolved,
            padres_creados: integrityResult.parentsCreated,
            duplicados_removidos_presupuestos: integrityResult.duplicatesRemoved.presupuestos,
            duplicados_removidos_detalles: integrityResult.duplicatesRemoved.detalles,
            score_integridad: integrityStats.quality.dataIntegrityScore,
            exitoso: true
        };
        
        console.log(`[SYNC_ORCHESTRATOR] ✅ FASE 4 COMPLETADA:`);
        console.log(`[SYNC_ORCHESTRATOR] - Presupuestos finales: ${integrityResult.stats.finalPresupuestos}`);
        console.log(`[SYNC_ORCHESTRATOR] - Detalles finales: ${integrityResult.stats.finalDetalles}`);
        console.log(`[SYNC_ORCHESTRATOR] - Padres creados: ${integrityResult.parentsCreated}`);
        console.log(`[SYNC_ORCHESTRATOR] - Score de integridad: ${integrityStats.quality.dataIntegrityScore}/100`);
        
        // ==========================================
        // FASE 5: SINCRONIZACIÓN DE PRESUPUESTOS
        // ==========================================
        console.log(`[SYNC_ORCHESTRATOR] 💾 FASE 5: Sincronizando presupuestos...`);
        const faseInicioSyncPresupuestos = new Date();
        
        const presupuestosResults = await upsertPresupuestos(integrityResult.validPresupuestos, db);
        
        syncLog.fases.sync_presupuestos = {
            inicio: faseInicioSyncPresupuestos,
            fin: new Date(),
            duracion_ms: new Date() - faseInicioSyncPresupuestos,
            total: presupuestosResults.total,
            exitosos: presupuestosResults.successful,
            fallidos: presupuestosResults.failed,
            insertados: presupuestosResults.inserted,
            actualizados: presupuestosResults.updated,
            exitoso: presupuestosResults.failed === 0
        };
        
        // Agregar errores de sincronización de presupuestos
        presupuestosResults.errors.forEach(error => {
            syncLog.errores.push(`Sync presupuesto ${error.presupuesto.id_ext}: ${error.result.error}`);
        });
        
        syncLog.registros_nuevos += presupuestosResults.inserted;
        syncLog.registros_actualizados += presupuestosResults.updated;
        
        console.log(`[SYNC_ORCHESTRATOR] ✅ FASE 5 COMPLETADA:`);
        console.log(`[SYNC_ORCHESTRATOR] - Presupuestos procesados: ${presupuestosResults.successful}/${presupuestosResults.total}`);
        console.log(`[SYNC_ORCHESTRATOR] - Insertados: ${presupuestosResults.inserted}, Actualizados: ${presupuestosResults.updated}`);
        
        // ==========================================
        // FASE 6: SINCRONIZACIÓN DE DETALLES
        // ==========================================
        console.log(`[SYNC_ORCHESTRATOR] 💾 FASE 6: Sincronizando detalles...`);
        const faseInicioSyncDetalles = new Date();
        
        const detallesResults = await upsertDetalles(integrityResult.validDetalles, db);
        
        syncLog.fases.sync_detalles = {
            inicio: faseInicioSyncDetalles,
            fin: new Date(),
            duracion_ms: new Date() - faseInicioSyncDetalles,
            total: detallesResults.total,
            exitosos: detallesResults.successful,
            fallidos: detallesResults.failed,
            insertados: detallesResults.inserted,
            actualizados: detallesResults.updated,
            exitoso: detallesResults.failed === 0
        };
        
        // Agregar errores de sincronización de detalles
        detallesResults.errors.forEach(error => {
            syncLog.errores.push(`Sync detalle ${error.detalle.id_presupuesto_ext}-${error.detalle.articulo}: ${error.result.error}`);
        });
        
        syncLog.registros_nuevos += detallesResults.inserted;
        syncLog.registros_actualizados += detallesResults.updated;
        
        console.log(`[SYNC_ORCHESTRATOR] ✅ FASE 6 COMPLETADA:`);
        console.log(`[SYNC_ORCHESTRATOR] - Detalles procesados: ${detallesResults.successful}/${detallesResults.total}`);
        console.log(`[SYNC_ORCHESTRATOR] - Insertados: ${detallesResults.inserted}, Actualizados: ${detallesResults.updated}`);
        
        // ==========================================
        // FASE 7: ESTADÍSTICAS FINALES
        // ==========================================
        console.log(`[SYNC_ORCHESTRATOR] 📊 FASE 7: Generando estadísticas finales...`);
        const faseInicioEstadisticas = new Date();
        
        const finalStats = await getPresupuestosStats(db);
        
        syncLog.fases.estadisticas = {
            inicio: faseInicioEstadisticas,
            fin: new Date(),
            duracion_ms: new Date() - faseInicioEstadisticas,
            exitoso: true
        };
        
        syncLog.estadisticas = {
            ...finalStats,
            validationReport: validationReport,
            integrityStats: integrityStats
        };
        
        console.log(`[SYNC_ORCHESTRATOR] ✅ FASE 7 COMPLETADA:`);
        console.log(`[SYNC_ORCHESTRATOR] - Total presupuestos en BD: ${finalStats.totalPresupuestos}`);
        console.log(`[SYNC_ORCHESTRATOR] - Total detalles en BD: ${finalStats.totalDetalles}`);
        
        // ==========================================
        // FINALIZACIÓN
        // ==========================================
        syncLog.registros_procesados = presupuestosResults.successful + detallesResults.successful;
        syncLog.exitoso = syncLog.errores.length === 0 || (presupuestosResults.successful > 0 || detallesResults.successful > 0);
        syncLog.fecha_fin = new Date();
        syncLog.duracion_ms = syncLog.fecha_fin - startTime;
        
        // Guardar log en base de datos usando el servicio de logging
        await registrarLogSincronizacion(syncLog, db);
        
        console.log(`[SYNC_ORCHESTRATOR] 🎉 SINCRONIZACIÓN COMPLETADA:`);
        console.log(`[SYNC_ORCHESTRATOR] - Duración: ${syncLog.duracion_ms}ms`);
        console.log(`[SYNC_ORCHESTRATOR] - Registros procesados: ${syncLog.registros_procesados}`);
        console.log(`[SYNC_ORCHESTRATOR] - Nuevos: ${syncLog.registros_nuevos}, Actualizados: ${syncLog.registros_actualizados}`);
        console.log(`[SYNC_ORCHESTRATOR] - Errores: ${syncLog.errores.length}, Warnings: ${syncLog.warnings.length}`);
        console.log(`[SYNC_ORCHESTRATOR] - Exitoso: ${syncLog.exitoso ? '✅' : '❌'}`);
        
        return syncLog;
        
    } catch (error) {
        console.error('[SYNC_ORCHESTRATOR] ❌ ERROR CRÍTICO EN SINCRONIZACIÓN:', error.message);
        console.error('[SYNC_ORCHESTRATOR] Stack trace:', error.stack);
        
        syncLog.exitoso = false;
        syncLog.errores.push(`Error crítico: ${error.message}`);
        syncLog.fecha_fin = new Date();
        syncLog.duracion_ms = syncLog.fecha_fin - startTime;
        
        // Intentar guardar log incluso con error usando el servicio de logging
        try {
            await registrarLogSincronizacion(syncLog, db);
        } catch (logError) {
            console.error('[SYNC_ORCHESTRATOR] ❌ Error guardando log de error:', logError.message);
        }
        
        throw error;
    }
}


/**
 * Ejecutar sincronización con transacción
 * @param {Object} config - Configuración de sincronización
 * @param {Object} db - Pool de conexiones
 * @returns {Object} Resultado de la sincronización
 */
async function syncWithTransaction(config, db) {
    console.log('[SYNC_ORCHESTRATOR] 🔄 Iniciando sincronización con transacción...');
    
    const client = await db.connect();
    
    try {
        await client.query('BEGIN');
        console.log('[SYNC_ORCHESTRATOR] ✅ Transacción iniciada');
        
        const result = await syncCompleteFromGoogleSheets(config, client);
        
        if (result.exitoso && result.errores.length === 0) {
            await client.query('COMMIT');
            console.log('[SYNC_ORCHESTRATOR] ✅ Transacción confirmada');
        } else {
            await client.query('ROLLBACK');
            console.log('[SYNC_ORCHESTRATOR] ⚠️ Transacción revertida por errores');
        }
        
        return result;
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[SYNC_ORCHESTRATOR] ❌ Transacción revertida por error crítico:', error.message);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Obtener historial de sincronizaciones
 * @param {Object} db - Conexión a base de datos
 * @param {number} limit - Límite de registros
 * @returns {Array} Historial de sincronizaciones
 */
async function getSyncHistory(db, limit = 10) {
    console.log(`[SYNC_ORCHESTRATOR] 📋 Obteniendo historial de sincronizaciones (límite: ${limit})...`);
    
    try {
        const query = `
            SELECT 
                psl.*,
                pc.hoja_url,
                pc.hoja_id,
                pc.hoja_nombre
            FROM presupuestos_sync_log psl
            LEFT JOIN presupuestos_config pc ON pc.id = psl.config_id
            ORDER BY psl.fecha_sync DESC
            LIMIT $1
        `;
        
        const result = await db.query(query, [limit]);
        const historial = result.rows;
        
        console.log(`[SYNC_ORCHESTRATOR] ✅ Historial obtenido: ${historial.length} registros`);
        
        return historial;
        
    } catch (error) {
        console.error('[SYNC_ORCHESTRATOR] ❌ Error obteniendo historial:', error.message);
        throw new Error(`Error en historial: ${error.message}`);
    }
}

console.log('[SYNC_ORCHESTRATOR] ✅ Orquestador de sincronización configurado');

module.exports = {
    syncCompleteFromGoogleSheets,
    syncWithTransaction,
    registrarLogSincronizacion,
    getSyncHistory
};
