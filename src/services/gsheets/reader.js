const { readSheetWithHeaders } = require('./client_with_logs');

console.log('[READER] Inicializando servicio de lectura Google Sheets...');

/**
 * Servicio de Lectura de Datos desde Google Sheets
 * Lee ambas hojas (Presupuestos y DetallesPresupuestos) simultáneamente
 */

/**
 * Leer datos completos de presupuestos desde Google Sheets
 * @param {string} sheetId - ID del archivo de Google Sheets
 * @returns {Object} Datos de presupuestos y detalles con metadata
 */
async function readPresupuestosData(sheetId) {
    console.log(`[READER] Iniciando lectura de datos desde Google Sheets: ${sheetId}`);
    
    try {
        // PASO 1: Leer hoja "Presupuestos" rango A:Z
        console.log('[READER] Leyendo hoja "Presupuestos"...');
        const presupuestosData = await readSheetWithHeaders(sheetId, 'A:Z', 'Presupuestos');
        
        // PASO 2: Leer hoja "DetallesPresupuestos" rango A:Z
        console.log('[READER] Leyendo hoja "DetallesPresupuestos"...');
        const detallesData = await readSheetWithHeaders(sheetId, 'A:Z', 'DetallesPresupuestos');
        
        // PASO 3: Filtrar columna "Condicion" de detalles (según especificación)
        console.log('[READER] Filtrando columna "Condicion" de detalles...');
        const detallesFiltrados = detallesData.rows.map(row => {
            const { Condicion, ...rowSinCondicion } = row;
            return rowSinCondicion;
        });
        
        const result = {
            presupuestos: presupuestosData.rows,
            detalles: detallesFiltrados,
            metadata: {
                presupuestosCount: presupuestosData.rows.length,
                detallesCount: detallesFiltrados.length,
                presupuestosHeaders: presupuestosData.headers,
                detallesHeaders: detallesData.headers.filter(h => h !== 'Condicion'),
                timestamp: new Date().toISOString(),
                sheetId: sheetId
            }
        };
        
        console.log(`[READER] ✅ Lectura completada:`);
        console.log(`[READER] - Presupuestos: ${result.metadata.presupuestosCount} registros`);
        console.log(`[READER] - Detalles: ${result.metadata.detallesCount} registros`);
        console.log(`[READER] - Encabezados Presupuestos: ${result.metadata.presupuestosHeaders.join(', ')}`);
        console.log(`[READER] - Encabezados Detalles: ${result.metadata.detallesHeaders.join(', ')}`);
        
        return result;
        
    } catch (error) {
        console.error('[READER] ❌ Error al leer datos desde Google Sheets:', error.message);
        console.error('[READER] Stack trace:', error.stack);
        throw new Error(`Error en lectura de Google Sheets: ${error.message}`);
    }
}

/**
 * Leer solo hoja de presupuestos
 * @param {string} sheetId - ID del archivo de Google Sheets
 * @returns {Object} Datos de presupuestos únicamente
 */
async function readPresupuestosOnly(sheetId) {
    console.log(`[READER] Leyendo solo hoja "Presupuestos" desde: ${sheetId}`);
    
    try {
        const presupuestosData = await readSheetWithHeaders(sheetId, 'A:Z', 'Presupuestos');
        
        const result = {
            presupuestos: presupuestosData.rows,
            metadata: {
                count: presupuestosData.rows.length,
                headers: presupuestosData.headers,
                timestamp: new Date().toISOString(),
                sheetId: sheetId
            }
        };
        
        console.log(`[READER] ✅ Presupuestos leídos: ${result.metadata.count} registros`);
        
        return result;
        
    } catch (error) {
        console.error('[READER] ❌ Error al leer presupuestos:', error.message);
        throw new Error(`Error en lectura de presupuestos: ${error.message}`);
    }
}

/**
 * Leer solo hoja de detalles
 * @param {string} sheetId - ID del archivo de Google Sheets
 * @returns {Object} Datos de detalles únicamente
 */
async function readDetallesOnly(sheetId) {
    console.log(`[READER] Leyendo solo hoja "DetallesPresupuestos" desde: ${sheetId}`);
    
    try {
        const detallesData = await readSheetWithHeaders(sheetId, 'A:Z', 'DetallesPresupuestos');
        
        // Filtrar columna "Condicion"
        const detallesFiltrados = detallesData.rows.map(row => {
            const { Condicion, ...rowSinCondicion } = row;
            return rowSinCondicion;
        });
        
        const result = {
            detalles: detallesFiltrados,
            metadata: {
                count: detallesFiltrados.length,
                headers: detallesData.headers.filter(h => h !== 'Condicion'),
                timestamp: new Date().toISOString(),
                sheetId: sheetId
            }
        };
        
        console.log(`[READER] ✅ Detalles leídos: ${result.metadata.count} registros`);
        
        return result;
        
    } catch (error) {
        console.error('[READER] ❌ Error al leer detalles:', error.message);
        throw new Error(`Error en lectura de detalles: ${error.message}`);
    }
}

/**
 * Verificar estructura de hojas
 * @param {string} sheetId - ID del archivo de Google Sheets
 * @returns {Object} Información sobre la estructura de las hojas
 */
async function verifySheetStructure(sheetId) {
    console.log(`[READER] Verificando estructura de hojas: ${sheetId}`);
    
    try {
        const { getSheetInfo } = require('./client_with_logs');
        const sheetInfo = await getSheetInfo(sheetId);
        
        // Verificar que existan las hojas requeridas
        const presupuestosSheet = sheetInfo.sheets.find(s => s.title === 'Presupuestos');
        const detallesSheet = sheetInfo.sheets.find(s => s.title === 'DetallesPresupuestos');
        
        const structure = {
            spreadsheetTitle: sheetInfo.title,
            hasPresupuestosSheet: !!presupuestosSheet,
            hasDetallesSheet: !!detallesSheet,
            availableSheets: sheetInfo.sheets.map(s => s.title),
            presupuestosInfo: presupuestosSheet || null,
            detallesInfo: detallesSheet || null,
            isValid: !!presupuestosSheet && !!detallesSheet
        };
        
        console.log(`[READER] ✅ Estructura verificada:`);
        console.log(`[READER] - Título: ${structure.spreadsheetTitle}`);
        console.log(`[READER] - Hoja Presupuestos: ${structure.hasPresupuestosSheet ? '✅' : '❌'}`);
        console.log(`[READER] - Hoja DetallesPresupuestos: ${structure.hasDetallesSheet ? '✅' : '❌'}`);
        console.log(`[READER] - Hojas disponibles: ${structure.availableSheets.join(', ')}`);
        
        return structure;
        
    } catch (error) {
        console.error('[READER] ❌ Error al verificar estructura:', error.message);
        throw new Error(`Error en verificación de estructura: ${error.message}`);
    }
}

console.log('[READER] ✅ Servicio de lectura Google Sheets configurado');

module.exports = {
    readPresupuestosData,
    readPresupuestosOnly,
    readDetallesOnly,
    verifySheetStructure
};
