// ⚠️ ARCHIVO OBSOLETO - NO USAR
// Este archivo mantiene la estructura antigua para compatibilidad
// La implementación real está en sync_real.js

const { readSheetWithHeaders, extractSheetId, validateSheetAccess } = require('./client');

console.log('⚠️ [PRESUPUESTOS] Archivo sync.js obsoleto - usar sync_real.js');

/**
 * @deprecated Este archivo es obsoleto. Usar sync_real.js
 * Servicio de sincronización con Google Sheets (VERSIÓN ANTIGUA)
 */

/**
 * @deprecated Usar syncFromGoogleSheets de sync_real.js
 */
async function syncFromGoogleSheets(config, db) {
    console.log('⚠️ [PRESUPUESTOS] ADVERTENCIA: Usando versión obsoleta de sincronización');
    console.log('🔄 [PRESUPUESTOS] Redirigiendo a implementación real...');
    
    // Redirigir a la implementación real
    const realSync = require('./sync_real');
    return await realSync.syncFromGoogleSheets(config, db);
}

/**
 * @deprecated Usar mapSheetDataToPresupuestos de sync_real.js
 */
function mapSheetDataToPresupuestos(sheetData, suggestedMapping, config) {
    console.log('⚠️ [PRESUPUESTOS] ADVERTENCIA: Usando función obsoleta');
    const realSync = require('./sync_real');
    return realSync.mapSheetDataToPresupuestos(sheetData, config);
}

/**
 * @deprecated Usar upsertPresupuesto de sync_real.js
 */
async function upsertPresupuesto(db, registro, config) {
    console.log('⚠️ [PRESUPUESTOS] ADVERTENCIA: Usando función obsoleta');
    const realSync = require('./sync_real');
    return await realSync.upsertPresupuesto(db, registro, config);
}

/**
 * @deprecated Usar registrarLogSincronizacion de sync_real.js
 */
async function registrarLogSincronizacion(db, syncLog) {
    console.log('⚠️ [PRESUPUESTOS] ADVERTENCIA: Usando función obsoleta');
    const realSync = require('./sync_real');
    return await realSync.registrarLogSincronizacion(db, syncLog);
}

/**
 * @deprecated Usar obtenerHistorialSincronizacion de sync_real.js
 */
async function obtenerHistorialSincronizacion(db, configId = null, limit = 10) {
    console.log('⚠️ [PRESUPUESTOS] ADVERTENCIA: Usando función obsoleta');
    const realSync = require('./sync_real');
    return await realSync.obtenerHistorialSincronizacion(db, configId, limit);
}

/**
 * @deprecated Usar validarConfiguracionSync de sync_real.js
 */
async function validarConfiguracionSync(config) {
    console.log('⚠️ [PRESUPUESTOS] ADVERTENCIA: Usando función obsoleta');
    const realSync = require('./sync_real');
    return await realSync.validarConfiguracionSync(config);
}

console.log('⚠️ [PRESUPUESTOS] Archivo sync.js obsoleto cargado - usar sync_real.js');

// Exportar funciones que redirigen a la implementación real
module.exports = {
    syncFromGoogleSheets,
    mapSheetDataToPresupuestos,
    upsertPresupuesto,
    registrarLogSincronizacion,
    obtenerHistorialSincronizacion,
    validarConfiguracionSync
};
