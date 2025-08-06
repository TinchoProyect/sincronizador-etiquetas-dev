const { google } = require('googleapis');
const { getAuthenticatedClient } = require('./auth');

console.log('🔍 [PRESUPUESTOS] Configurando cliente Google Sheets API...');

/**
 * Cliente para interactuar con Google Sheets API
 * Proporciona métodos para leer datos de hojas de cálculo
 */

/**
 * Obtener instancia de Google Sheets API
 */
async function getSheetsInstance() {
    console.log('🔍 [PRESUPUESTOS] Obteniendo instancia de Google Sheets...');
    
    try {
        const auth = await getAuthenticatedClient();
        const sheets = google.sheets({ version: 'v4', auth });
        
        console.log('✅ [PRESUPUESTOS] Instancia de Google Sheets obtenida');
        return sheets;
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al obtener instancia de Sheets:', error.message);
        throw error;
    }
}

/**
 * Extraer ID de hoja desde URL
 */
function extractSheetId(url) {
    console.log('🔍 [PRESUPUESTOS] Extrayendo ID de hoja desde URL...');
    
    try {
        // Patrones comunes de URLs de Google Sheets
        const patterns = [
            /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/,
            /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)\/edit/,
            /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)\/edit#gid=/
        ];
        
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) {
                const sheetId = match[1];
                console.log('✅ [PRESUPUESTOS] ID de hoja extraído:', sheetId);
                return sheetId;
            }
        }
        
        // Si no coincide con ningún patrón, asumir que es el ID directo
        if (url.length > 20 && !url.includes('/')) {
            console.log('✅ [PRESUPUESTOS] Usando URL como ID directo:', url);
            return url;
        }
        
        throw new Error('Formato de URL no reconocido');
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al extraer ID de hoja:', error.message);
        throw error;
    }
}

/**
 * Obtener información básica de la hoja
 */
async function getSheetInfo(sheetId) {
    console.log(`🔍 [PRESUPUESTOS] Obteniendo información de hoja: ${sheetId}`);
    
    try {
        const sheets = await getSheetsInstance();
        
        const response = await sheets.spreadsheets.get({
            spreadsheetId: sheetId,
            fields: 'properties,sheets.properties'
        });
        
        const spreadsheet = response.data;
        const info = {
            title: spreadsheet.properties.title,
            locale: spreadsheet.properties.locale,
            timeZone: spreadsheet.properties.timeZone,
            sheets: spreadsheet.sheets.map(sheet => ({
                sheetId: sheet.properties.sheetId,
                title: sheet.properties.title,
                index: sheet.properties.index,
                sheetType: sheet.properties.sheetType,
                gridProperties: sheet.properties.gridProperties
            }))
        };
        
        console.log('✅ [PRESUPUESTOS] Información de hoja obtenida:', info.title);
        console.log('📋 [PRESUPUESTOS] Hojas disponibles:', info.sheets.map(s => s.title));
        
        return info;
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al obtener información de hoja:', error.message);
        throw error;
    }
}

/**
 * Leer datos de un rango específico
 */
async function readSheetRange(sheetId, range, sheetName = null) {
    console.log(`🔍 [PRESUPUESTOS] Leyendo rango: ${range} de hoja: ${sheetId}`);
    
    try {
        const sheets = await getSheetsInstance();
        
        // Construir el rango completo
        const fullRange = sheetName ? `${sheetName}!${range}` : range;
        console.log('📋 [PRESUPUESTOS] Rango completo:', fullRange);
        
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: fullRange,
            valueRenderOption: 'UNFORMATTED_VALUE',
            dateTimeRenderOption: 'FORMATTED_STRING'
        });
        
        const values = response.data.values || [];
        
        console.log(`✅ [PRESUPUESTOS] Datos leídos: ${values.length} filas`);
        console.log('📊 [PRESUPUESTOS] Primeras 3 filas:', values.slice(0, 3));
        
        return {
            range: response.data.range,
            majorDimension: response.data.majorDimension,
            values: values,
            rowCount: values.length,
            columnCount: values.length > 0 ? Math.max(...values.map(row => row.length)) : 0
        };
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al leer rango:', error.message);
        throw error;
    }
}

/**
 * Leer datos con encabezados
 */
async function readSheetWithHeaders(sheetId, range, sheetName = null) {
    console.log(`🔍 [PRESUPUESTOS] Leyendo datos con encabezados: ${range}`);
    
    // 🔍 LOG PUNTO 4: Intento de acceso a la hoja Presupuestos
    console.log('🔍 [GSHEETS-DEBUG] PUNTO 4: Intento de acceso a la hoja');
    console.log('🔍 [GSHEETS-DEBUG] Nombre exacto de la hoja que intenta abrir:', sheetName || 'Primera hoja disponible');
    console.log('🔍 [GSHEETS-DEBUG] Rango solicitado:', range);
    console.log('🔍 [GSHEETS-DEBUG] ID de la hoja:', sheetId);
    
    try {
        const data = await readSheetRange(sheetId, range, sheetName);
        
        console.log('🔍 [GSHEETS-DEBUG] PUNTO 5: Datos leídos exitosamente');
        console.log('🔍 [GSHEETS-DEBUG] Datos en bruto recibidos:', {
            totalValues: data.values.length,
            range: data.range,
            majorDimension: data.majorDimension,
            rowCount: data.rowCount,
            columnCount: data.columnCount
        });
        
        if (data.values.length === 0) {
            console.log('⚠️ [PRESUPUESTOS] No se encontraron datos');
            console.log('🔍 [GSHEETS-DEBUG] ❌ RESULTADO: 0 filas - hoja vacía o rango incorrecto');
            return {
                headers: [],
                rows: [],
                totalRows: 0
            };
        }
        
        const headers = data.values[0] || [];
        const rows = data.values.slice(1);
        
        console.log('🔍 [GSHEETS-DEBUG] PUNTO 6: Procesando encabezados y filas');
        console.log('🔍 [GSHEETS-DEBUG] Encabezados encontrados:', headers);
        console.log('🔍 [GSHEETS-DEBUG] Total de filas de datos (sin encabezados):', rows.length);
        console.log('🔍 [GSHEETS-DEBUG] Primeras 3 filas en bruto:', rows.slice(0, 3));
        
        // Convertir filas a objetos usando encabezados
        const mappedRows = rows.map((row, index) => {
            const rowObject = {};
            headers.forEach((header, colIndex) => {
                rowObject[header] = row[colIndex] || null;
            });
            rowObject._rowIndex = index + 2; // +2 porque empezamos desde fila 1 y saltamos encabezados
            return rowObject;
        });
        
        console.log('✅ [PRESUPUESTOS] Datos procesados con encabezados');
        console.log('📋 [PRESUPUESTOS] Encabezados:', headers);
        console.log(`📊 [PRESUPUESTOS] Filas de datos: ${mappedRows.length}`);
        console.log('🔍 [GSHEETS-DEBUG] Primeras 2 filas mapeadas:', mappedRows.slice(0, 2));
        
        // 🔍 LOG PUNTO 7: Resultado final antes del return
        console.log('🔍 [GSHEETS-DEBUG] PUNTO 7: Resultado final antes del return');
        console.log('🔍 [GSHEETS-DEBUG] Cantidad de registros cargados:', mappedRows.length);
        
        if (mappedRows.length === 0) {
            console.log('🔍 [GSHEETS-DEBUG] ❌ RESULTADO FINAL: 0 registros después de mapear');
            console.log('🔍 [GSHEETS-DEBUG] Datos en bruto antes de aplicar filtros:', {
                totalRawRows: rows.length,
                sampleRawRow: rows[0],
                headers: headers
            });
        }
        
        return {
            headers: headers,
            rows: mappedRows,
            totalRows: mappedRows.length,
            rawData: data
        };
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al leer datos con encabezados:', error.message);
        console.log('🔍 [GSHEETS-DEBUG] ❌ ERROR EN LECTURA DE HOJA:', error.message);
        console.log('🔍 [GSHEETS-DEBUG] Stack trace:', error.stack);
        throw error;
    }
}

/**
 * Validar acceso a hoja
 */
async function validateSheetAccess(sheetId) {
    console.log(`🔍 [PRESUPUESTOS] Validando acceso a hoja: ${sheetId}`);
    
    try {
        const info = await getSheetInfo(sheetId);
        
        console.log('✅ [PRESUPUESTOS] Acceso validado exitosamente');
        return {
            hasAccess: true,
            sheetTitle: info.title,
            availableSheets: info.sheets.map(s => s.title)
        };
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error de acceso:', error.message);
        
        let errorType = 'unknown';
        if (error.message.includes('not found')) {
            errorType = 'not_found';
        } else if (error.message.includes('permission')) {
            errorType = 'permission_denied';
        } else if (error.message.includes('Autorización requerida')) {
            errorType = 'auth_required';
        }
        
        return {
            hasAccess: false,
            error: error.message,
            errorType: errorType
        };
    }
}

/**
 * Obtener metadatos de la hoja
 */
async function getSheetMetadata(sheetId, sheetName = null) {
    console.log(`🔍 [PRESUPUESTOS] Obteniendo metadatos de hoja: ${sheetId}`);
    
    try {
        const info = await getSheetInfo(sheetId);
        
        let targetSheet = null;
        if (sheetName) {
            targetSheet = info.sheets.find(sheet => sheet.title === sheetName);
            if (!targetSheet) {
                throw new Error(`Hoja '${sheetName}' no encontrada`);
            }
        } else {
            targetSheet = info.sheets[0]; // Primera hoja por defecto
        }
        
        const metadata = {
            spreadsheetTitle: info.title,
            spreadsheetId: sheetId,
            sheetTitle: targetSheet.title,
            sheetId: targetSheet.sheetId,
            rowCount: targetSheet.gridProperties.rowCount,
            columnCount: targetSheet.gridProperties.columnCount,
            locale: info.locale,
            timeZone: info.timeZone,
            lastModified: new Date().toISOString() // Google Sheets no proporciona esta info fácilmente
        };
        
        console.log('✅ [PRESUPUESTOS] Metadatos obtenidos:', metadata);
        
        return metadata;
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al obtener metadatos:', error.message);
        throw error;
    }
}

/**
 * Detectar estructura de datos automáticamente
 */
async function detectDataStructure(sheetId, sheetName = null, sampleRows = 10) {
    console.log(`🔍 [PRESUPUESTOS] Detectando estructura de datos...`);
    
    try {
        // Leer una muestra de datos
        const sampleRange = `A1:Z${sampleRows + 1}`; // +1 para incluir encabezados
        const data = await readSheetWithHeaders(sheetId, sampleRange, sheetName);
        
        if (data.headers.length === 0) {
            throw new Error('No se encontraron encabezados en la hoja');
        }
        
        // Analizar tipos de datos
        const columnAnalysis = data.headers.map(header => {
            const values = data.rows.map(row => row[header]).filter(val => val !== null && val !== '');
            
            let dataType = 'text';
            if (values.length > 0) {
                const numericValues = values.filter(val => !isNaN(parseFloat(val)));
                const dateValues = values.filter(val => !isNaN(Date.parse(val)));
                
                if (numericValues.length / values.length > 0.8) {
                    dataType = 'number';
                } else if (dateValues.length / values.length > 0.8) {
                    dataType = 'date';
                }
            }
            
            return {
                name: header,
                dataType: dataType,
                sampleValues: values.slice(0, 3),
                nonEmptyCount: values.length
            };
        });
        
        const structure = {
            hasHeaders: true,
            columnCount: data.headers.length,
            estimatedRowCount: data.totalRows,
            columns: columnAnalysis,
            suggestedMapping: {
                categoria: columnAnalysis.find(col => 
                    col.name.toLowerCase().includes('categoria') || 
                    col.name.toLowerCase().includes('category')
                )?.name,
                concepto: columnAnalysis.find(col => 
                    col.name.toLowerCase().includes('concepto') || 
                    col.name.toLowerCase().includes('descripcion') ||
                    col.name.toLowerCase().includes('description')
                )?.name,
                monto: columnAnalysis.find(col => 
                    col.dataType === 'number' && (
                        col.name.toLowerCase().includes('monto') ||
                        col.name.toLowerCase().includes('precio') ||
                        col.name.toLowerCase().includes('amount') ||
                        col.name.toLowerCase().includes('cost')
                    )
                )?.name
            }
        };
        
        console.log('✅ [PRESUPUESTOS] Estructura detectada:', structure);
        
        return structure;
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al detectar estructura:', error.message);
        throw error;
    }
}

console.log('✅ [PRESUPUESTOS] Cliente Google Sheets configurado');

module.exports = {
    getSheetsInstance,
    extractSheetId,
    getSheetInfo,
    readSheetRange,
    readSheetWithHeaders,
    validateSheetAccess,
    getSheetMetadata,
    detectDataStructure
};
