/**
 * Adapter para Google Sheets usando Service Account
 * Implementa GSheetsPort usando el cliente Service Account
 */

const GSheetsPort = require('../ports/GSheetsPort');
const { getSheets } = require('../../google/gsheetsClient');
const { GSHEETS_DEBUG } = require('../../config/feature-flags');

if (GSHEETS_DEBUG) {
    console.log('🔍 [SA-ADAPTER] Configurando adapter Service Account...');
}

class GoogleSheetsServiceAccountAdapter extends GSheetsPort {
    
    constructor() {
        super();
        console.log('🔍 [SA-ADAPTER] Adapter Service Account inicializado');
    }
    
    /**
     * Verificar estado de autenticación (Service Account siempre autenticado)
     */
    async checkAuthStatus() {
        console.log('🔍 [SA-ADAPTER] Verificando estado de autenticación Service Account...');
        
        try {
            // Test connection con Service Account
            await getSheets();
            
            console.log('✅ [SA-ADAPTER] Service Account autenticado correctamente');
            
            return {
                authenticated: true,
                authType: 'service_account',
                hasValidToken: true,
                scopes: [
                    'https://www.googleapis.com/auth/spreadsheets',
                    'https://www.googleapis.com/auth/drive.readonly'
                ]
            };
        } catch (error) {
            console.error('❌ [SA-ADAPTER] Error en autenticación Service Account:', error.message);
            
            return {
                authenticated: false,
                authType: 'service_account',
                hasValidToken: false,
                error: error.message
            };
        }
    }
    
    /**
     * Validar acceso a una hoja específica
     */
    async validateSheetAccess(sheetId) {
        console.log(`🔍 [SA-ADAPTER] Validando acceso a hoja: ${sheetId}`);
        
        try {
            const sheets = await getSheets();
            const spreadsheetId = process.env.SPREADSHEET_ID || sheetId;
            
            const response = await sheets.spreadsheets.get({
                spreadsheetId: spreadsheetId,
                fields: 'properties,sheets.properties'
            });
            
            const spreadsheet = response.data;
            const info = {
                hasAccess: true,
                sheetTitle: spreadsheet.properties.title,
                availableSheets: spreadsheet.sheets.map(sheet => sheet.properties.title),
                locale: spreadsheet.properties.locale,
                timeZone: spreadsheet.properties.timeZone
            };
            
            console.log('✅ [SA-ADAPTER] Acceso validado:', info.sheetTitle);
            console.log('📋 [SA-ADAPTER] Hojas disponibles:', info.availableSheets);
            
            return info;
            
        } catch (error) {
            console.error('❌ [SA-ADAPTER] Error al validar acceso:', error.message);
            
            let errorType = 'unknown';
            if (error.message.includes('not found')) {
                errorType = 'not_found';
            } else if (error.message.includes('permission')) {
                errorType = 'permission_denied';
            }
            
            return {
                hasAccess: false,
                error: error.message,
                errorType: errorType
            };
        }
    }
    
    /**
     * Leer datos de una hoja con encabezados
     */
    async readSheetWithHeaders(sheetId, range, sheetName) {
        console.log(`🔍 [SA-ADAPTER] Leyendo datos: ${sheetName}!${range}`);
        
        try {
            const sheets = await getSheets();
            const spreadsheetId = process.env.SPREADSHEET_ID || sheetId;
            const fullRange = sheetName ? `${sheetName}!${range}` : range;
            
            console.log('📋 [SA-ADAPTER] Parámetros:', {
                spreadsheetId: spreadsheetId,
                range: fullRange
            });
            
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: fullRange,
                valueRenderOption: 'UNFORMATTED_VALUE',
                dateTimeRenderOption: 'FORMATTED_STRING'
            });
            
            const values = response.data.values || [];
            
            if (values.length === 0) {
                console.log('⚠️ [SA-ADAPTER] No se encontraron datos');
                return {
                    headers: [],
                    rows: [],
                    totalRows: 0,
                    range: response.data.range,
                    majorDimension: response.data.majorDimension
                };
            }
            
            const headers = values[0] || [];
            const rows = values.slice(1).map((row, index) => {
                const rowObject = {};
                headers.forEach((header, colIndex) => {
                    rowObject[header] = row[colIndex] || null;
                });
                rowObject._rowIndex = index + 2; // +2 porque empezamos desde fila 1 y saltamos encabezados
                return rowObject;
            });
            
            console.log(`✅ [SA-ADAPTER] Datos leídos: ${rows.length} filas`);
            console.log('📊 [SA-ADAPTER] Encabezados:', headers);
            const TAIL = 5;
            const filas = rows || [];
            const ultimas5 = filas.slice(-TAIL);
            console.log('[SA-ADAPTER] Últimas 5 filas:', ultimas5);
            
            return {
                headers: headers,
                rows: rows,
                totalRows: rows.length,
                range: response.data.range,
                majorDimension: response.data.majorDimension,
                rawData: {
                    values: values,
                    rowCount: values.length,
                    columnCount: values.length > 0 ? Math.max(...values.map(row => row.length)) : 0
                }
            };
            
        } catch (error) {
            console.error('❌ [SA-ADAPTER] Error al leer datos:', error.message);
            throw error;
        }
    }
    
    /**
     * Extraer ID de hoja desde URL
     */
    extractSheetId(url) {
        console.log('🔍 [SA-ADAPTER] Extrayendo ID de hoja desde URL...');
        
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
                    console.log('✅ [SA-ADAPTER] ID de hoja extraído:', sheetId);
                    return sheetId;
                }
            }
            
            // Si no coincide con ningún patrón, asumir que es el ID directo
            if (url.length > 20 && !url.includes('/')) {
                console.log('✅ [SA-ADAPTER] Usando URL como ID directo:', url);
                return url;
            }
            
            throw new Error('Formato de URL no reconocido');
        } catch (error) {
            console.error('❌ [SA-ADAPTER] Error al extraer ID de hoja:', error.message);
            throw error;
        }
    }
    
    /**
     * Detectar estructura de datos automáticamente
     */
    async detectDataStructure(sheetId, sheetName, sampleRows = 10) {
        console.log(`🔍 [SA-ADAPTER] Detectando estructura de datos...`);
        
        try {
            // Leer una muestra de datos
            const sampleRange = `A1:Z${sampleRows + 1}`; // +1 para incluir encabezados
            const data = await this.readSheetWithHeaders(sheetId, sampleRange, sheetName);
            
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
            
            console.log('✅ [SA-ADAPTER] Estructura detectada:', structure);
            
            return structure;
        } catch (error) {
            console.error('❌ [SA-ADAPTER] Error al detectar estructura:', error.message);
            throw error;
        }
    }
    
    /**
     * Generar URL de autorización (compatibilidad OAuth2 - no aplicable para Service Account)
     */
    async generateAuthUrl() {
        console.log('⚠️ [SA-ADAPTER] generateAuthUrl() no aplicable para Service Account');
        throw new Error('Service Account no requiere autorización manual. Use checkAuthStatus() para verificar configuración.');
    }
    
    /**
     * Obtener token desde código (compatibilidad OAuth2 - no aplicable para Service Account)
     */
    async getTokenFromCode(code) {
        console.log('⚠️ [SA-ADAPTER] getTokenFromCode() no aplicable para Service Account');
        throw new Error('Service Account no usa códigos de autorización. Use checkAuthStatus() para verificar configuración.');
    }
}

console.log('✅ [SA-ADAPTER] Adapter Service Account configurado');

module.exports = GoogleSheetsServiceAccountAdapter;
