const { google } = require('googleapis');
const { getAuthenticatedClient } = require('./auth_with_logs');
const { USE_SA_SHEETS } = require('../../config/feature-flags');

console.log('🔍 [PRESUPUESTOS-BACK] Configurando cliente Google Sheets API con logs...');

// Adapter injection para Service Account
let adapter = null;
if (USE_SA_SHEETS) {
    try {
        const ServiceAccountAdapter = require('../../presupuestos/adapters/GoogleSheetsServiceAccountAdapter');
        adapter = new ServiceAccountAdapter();
        console.log('✅ [PRESUPUESTOS-BACK] Service Account adapter cargado en client con logs');
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-BACK] Error al cargar Service Account adapter en client con logs:', error.message);
        console.log('⚠️ [PRESUPUESTOS-BACK] Fallback a OAuth2 en client con logs');
    }
}

/**
 * Cliente para interactuar con Google Sheets API con logs detallados
 * Proporciona métodos para leer datos de hojas de cálculo
 */

/**
 * Obtener instancia de Google Sheets API
 */
async function getSheetsInstance() {
    console.log('🔍 [PRESUPUESTOS-BACK] Obteniendo instancia de Google Sheets...');
    
    try {
        const auth = await getAuthenticatedClient();
        const sheets = google.sheets({ version: 'v4', auth });
        
        console.log('✅ [PRESUPUESTOS-BACK] Instancia de Google Sheets obtenida');
        console.log('🔍 [PRESUPUESTOS-BACK] Cliente configurado con auth:', auth ? 'PRESENTE' : 'AUSENTE');
        
        return sheets;
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-BACK] Error al obtener instancia de Sheets:', error.message);
        console.log('🔍 [PRESUPUESTOS-BACK] Error details:', error);
        throw error;
    }
}

/**
 * Extraer ID de hoja desde URL
 */
function extractSheetId(url) {
    // Usar Service Account si está habilitado
    if (USE_SA_SHEETS && adapter) {
        console.log('🔍 [PRESUPUESTOS-BACK] Usando Service Account adapter para extraer ID...');
        return adapter.extractSheetId(url);
    }
    
    // Código OAuth2 original
    console.log('🔍 [PRESUPUESTOS-BACK] Extrayendo ID de hoja desde URL...');
    console.log('🔍 [PRESUPUESTOS-BACK] URL recibida:', url);
    
    try {
        // Patrones comunes de URLs de Google Sheets
        const patterns = [
            /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/,
            /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)\/edit/,
            /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)\/edit#gid=/
        ];
        
        console.log('🔍 [PRESUPUESTOS-BACK] Probando patrones de URL...');
        
        for (let i = 0; i < patterns.length; i++) {
            const pattern = patterns[i];
            console.log(`🔍 [PRESUPUESTOS-BACK] Probando patrón ${i + 1}:`, pattern);
            
            const match = url.match(pattern);
            if (match) {
                const sheetId = match[1];
                console.log('✅ [PRESUPUESTOS-BACK] ID de hoja extraído:', sheetId);
                console.log('🔍 [PRESUPUESTOS-BACK] Patrón exitoso:', i + 1);
                return sheetId;
            }
        }
        
        // Si no coincide con ningún patrón, asumir que es el ID directo
        if (url.length > 20 && !url.includes('/')) {
            console.log('✅ [PRESUPUESTOS-BACK] Usando URL como ID directo:', url);
            console.log('🔍 [PRESUPUESTOS-BACK] Longitud de URL:', url.length);
            return url;
        }
        
        console.log('❌ [PRESUPUESTOS-BACK] No se pudo extraer ID de la URL');
        throw new Error('Formato de URL no reconocido');
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-BACK] Error al extraer ID de hoja:', error.message);
        console.log('🔍 [PRESUPUESTOS-BACK] Error details:', error);
        throw error;
    }
}

/**
 * Obtener información básica de la hoja
 */
async function getSheetInfo(sheetId) {
    console.log(`🔍 [PRESUPUESTOS-BACK] Obteniendo información de hoja: ${sheetId}`);
    
    try {
        const sheets = await getSheetsInstance();
        
        console.log('🔍 [PRESUPUESTOS-BACK] Realizando llamada a spreadsheets.get...');
        const response = await sheets.spreadsheets.get({
            spreadsheetId: sheetId,
            fields: 'properties,sheets.properties'
        });
        
        console.log('🔍 [PRESUPUESTOS-BACK] Respuesta recibida de Google Sheets API');
        
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
        
        console.log('✅ [PRESUPUESTOS-BACK] Información de hoja obtenida:', info.title);
        console.log('📋 [PRESUPUESTOS-BACK] Hojas disponibles:', info.sheets.map(s => s.title));
        console.log('🔍 [PRESUPUESTOS-BACK] Total de hojas:', info.sheets.length);
        console.log('🔍 [PRESUPUESTOS-BACK] Locale:', info.locale);
        console.log('🔍 [PRESUPUESTOS-BACK] TimeZone:', info.timeZone);
        
        return info;
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-BACK] Error al obtener información de hoja:', error.message);
        console.log('🔍 [PRESUPUESTOS-BACK] Error details:', error);
        console.log('🔍 [PRESUPUESTOS-BACK] Error code:', error.code);
        console.log('🔍 [PRESUPUESTOS-BACK] Error status:', error.status);
        throw error;
    }
}

/**
 * Leer datos de un rango específico
 */
async function readSheetRange(sheetId, range, sheetName = null) {
    console.log(`🔍 [PRESUPUESTOS-BACK] Leyendo rango: ${range} de hoja: ${sheetId}`);
    
    try {
        const sheets = await getSheetsInstance();
        
        // Construir el rango completo
        const fullRange = sheetName ? `${sheetName}!${range}` : range;
        console.log('📋 [PRESUPUESTOS-BACK] Rango completo:', fullRange);
        console.log('🔍 [PRESUPUESTOS-BACK] Sheet ID:', sheetId);
        console.log('🔍 [PRESUPUESTOS-BACK] Sheet Name:', sheetName);
        console.log('🔍 [PRESUPUESTOS-BACK] Range:', range);
        
        console.log('🔍 [PRESUPUESTOS-BACK] Realizando llamada a spreadsheets.values.get...');
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: fullRange,
            valueRenderOption: 'UNFORMATTED_VALUE',
            dateTimeRenderOption: 'FORMATTED_STRING'
        });
        
        console.log('🔍 [PRESUPUESTOS-BACK] Respuesta recibida de values.get');
        
        const values = response.data.values || [];
        
        console.log(`✅ [PRESUPUESTOS-BACK] Datos leídos: ${values.length} filas`);
        console.log('📊 [PRESUPUESTOS-BACK] Primeras 3 filas:', values.slice(0, 3));
        console.log('🔍 [PRESUPUESTOS-BACK] Range devuelto:', response.data.range);
        console.log('🔍 [PRESUPUESTOS-BACK] Major dimension:', response.data.majorDimension);
        
        const result = {
            range: response.data.range,
            majorDimension: response.data.majorDimension,
            values: values,
            rowCount: values.length,
            columnCount: values.length > 0 ? Math.max(...values.map(row => row.length)) : 0
        };
        
        console.log('🔍 [PRESUPUESTOS-BACK] Resultado procesado:', {
            rowCount: result.rowCount,
            columnCount: result.columnCount,
            hasData: result.values.length > 0
        });
        
        return result;
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-BACK] Error al leer rango:', error.message);
        console.log('🔍 [PRESUPUESTOS-BACK] Error details:', error);
        console.log('🔍 [PRESUPUESTOS-BACK] Error code:', error.code);
        console.log('🔍 [PRESUPUESTOS-BACK] Error status:', error.status);
        throw error;
    }
}

/**
 * Leer datos con encabezados
 */
async function readSheetWithHeaders(sheetId, range, sheetName = null) {
    // Usar Service Account si está habilitado
    if (USE_SA_SHEETS && adapter) {
        console.log('🔍 [PRESUPUESTOS-BACK] Usando Service Account adapter para leer datos...');
        return await adapter.readSheetWithHeaders(sheetId, range, sheetName);
    }
    
    // Código OAuth2 original
    console.log(`🔍 [PRESUPUESTOS-BACK] Leyendo datos con encabezados: ${range}`);
    
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
            console.log('⚠️ [PRESUPUESTOS-BACK] No se encontraron datos');
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
        console.log('🔍 [PRESUPUESTOS-BACK] Mapeando filas con encabezados...');
        const mappedRows = rows.map((row, index) => {
            const rowObject = {};
            headers.forEach((header, colIndex) => {
                rowObject[header] = row[colIndex] || null;
            });
            rowObject._rowIndex = index + 2; // +2 porque empezamos desde fila 1 y saltamos encabezados
            return rowObject;
        });
        
        console.log('✅ [PRESUPUESTOS-BACK] Datos procesados con encabezados');
        console.log('📋 [PRESUPUESTOS-BACK] Encabezados:', headers);
        console.log(`📊 [PRESUPUESTOS-BACK] Filas de datos: ${mappedRows.length}`);
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
        
        const result = {
            headers: headers,
            rows: mappedRows,
            totalRows: mappedRows.length,
            rawData: data
        };
        
        console.log('🔍 [PRESUPUESTOS-BACK] Resultado final:', {
            headersCount: result.headers.length,
            rowsCount: result.rows.length,
            totalRows: result.totalRows
        });
        
        return result;
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-BACK] Error al leer datos con encabezados:', error.message);
        console.log('🔍 [GSHEETS-DEBUG] ❌ ERROR EN LECTURA DE HOJA:', error.message);
        console.log('🔍 [GSHEETS-DEBUG] Stack trace:', error.stack);
        console.log('🔍 [PRESUPUESTOS-BACK] Error details:', error);
        throw error;
    }
}

/**
 * Validar acceso a hoja
 */
async function validateSheetAccess(sheetId) {
    // Usar Service Account si está habilitado
    if (USE_SA_SHEETS && adapter) {
        console.log('🔍 [PRESUPUESTOS-BACK] Usando Service Account adapter para validar acceso...');
        return await adapter.validateSheetAccess(sheetId);
    }
    
    // Código OAuth2 original
    console.log(`🔍 [PRESUPUESTOS-BACK] Validando acceso a hoja: ${sheetId}`);
    
    try {
        const info = await getSheetInfo(sheetId);
        
        console.log('✅ [PRESUPUESTOS-BACK] Acceso validado exitosamente');
        
        const result = {
            hasAccess: true,
            sheetTitle: info.title,
            availableSheets: info.sheets.map(s => s.title)
        };
        
        console.log('🔍 [PRESUPUESTOS-BACK] Resultado de validación:', result);
        
        return result;
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-BACK] Error de acceso:', error.message);
        console.log('🔍 [PRESUPUESTOS-BACK] Error details:', error);
        
        let errorType = 'unknown';
        if (error.message.includes('not found')) {
            errorType = 'not_found';
        } else if (error.message.includes('permission')) {
            errorType = 'permission_denied';
        } else if (error.message.includes('Autorización requerida')) {
            errorType = 'auth_required';
        }
        
        console.log('🔍 [PRESUPUESTOS-BACK] Error type:', errorType);
        
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
    console.log(`🔍 [PRESUPUESTOS-BACK] Obteniendo metadatos de hoja: ${sheetId}`);
    console.log('🔍 [PRESUPUESTOS-BACK] Sheet name solicitado:', sheetName);
    
    try {
        const info = await getSheetInfo(sheetId);
        
        let targetSheet = null;
        if (sheetName) {
            console.log('🔍 [PRESUPUESTOS-BACK] Buscando hoja específica:', sheetName);
            targetSheet = info.sheets.find(sheet => sheet.title === sheetName);
            if (!targetSheet) {
                console.log('❌ [PRESUPUESTOS-BACK] Hoja no encontrada:', sheetName);
                console.log('🔍 [PRESUPUESTOS-BACK] Hojas disponibles:', info.sheets.map(s => s.title));
                throw new Error(`Hoja '${sheetName}' no encontrada`);
            }
            console.log('✅ [PRESUPUESTOS-BACK] Hoja encontrada:', targetSheet.title);
        } else {
            targetSheet = info.sheets[0]; // Primera hoja por defecto
            console.log('🔍 [PRESUPUESTOS-BACK] Usando primera hoja por defecto:', targetSheet.title);
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
        
        console.log('✅ [PRESUPUESTOS-BACK] Metadatos obtenidos:', metadata);
        
        return metadata;
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-BACK] Error al obtener metadatos:', error.message);
        console.log('🔍 [PRESUPUESTOS-BACK] Error details:', error);
        throw error;
    }
}

/**
 * Detectar estructura de datos automáticamente
 */
async function detectDataStructure(sheetId, sheetName = null, sampleRows = 10) {
    // Usar Service Account si está habilitado
    if (USE_SA_SHEETS && adapter) {
        console.log('🔍 [PRESUPUESTOS-BACK] Usando Service Account adapter para detectar estructura...');
        return await adapter.detectDataStructure(sheetId, sheetName, sampleRows);
    }
    
    // Código OAuth2 original
    console.log(`🔍 [PRESUPUESTOS-BACK] Detectando estructura de datos...`);
    console.log('🔍 [PRESUPUESTOS-BACK] Sample rows:', sampleRows);
    
    try {
        // Leer una muestra de datos
        const sampleRange = `A1:Z${sampleRows + 1}`; // +1 para incluir encabezados
        console.log('🔍 [PRESUPUESTOS-BACK] Sample range:', sampleRange);
        
        const data = await readSheetWithHeaders(sheetId, sampleRange, sheetName);
        
        if (data.headers.length === 0) {
            console.log('❌ [PRESUPUESTOS-BACK] No se encontraron encabezados');
            throw new Error('No se encontraron encabezados en la hoja');
        }
        
        console.log('🔍 [PRESUPUESTOS-BACK] Analizando tipos de datos...');
        
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
            
            console.log(`🔍 [PRESUPUESTOS-BACK] Columna '${header}': tipo=${dataType}, valores=${values.length}`);
            
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
        
        console.log('✅ [PRESUPUESTOS-BACK] Estructura detectada:', structure);
        console.log('🔍 [PRESUPUESTOS-BACK] Suggested mappings:', structure.suggestedMapping);
        
        return structure;
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-BACK] Error al detectar estructura:', error.message);
        console.log('🔍 [PRESUPUESTOS-BACK] Error details:', error);
        throw error;
    }
}

console.log('✅ [PRESUPUESTOS-BACK] Cliente Google Sheets configurado con logs');

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
