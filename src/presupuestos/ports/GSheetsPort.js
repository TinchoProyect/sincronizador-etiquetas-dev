/**
 * Puerto/Interfaz para servicios de Google Sheets
 * Define los contratos que debe cumplir cualquier implementación de Google Sheets
 */

console.log('🔍 [GSHEETS-PORT] Configurando puerto de Google Sheets...');

/**
 * Interfaz abstracta para servicios de Google Sheets
 * Define los métodos que debe implementar cualquier adapter
 */
class GSheetsPort {
    
    /**
     * Verificar estado de autenticación
     * @returns {Promise<Object>} Estado de autenticación
     */
    async checkAuthStatus() {
        throw new Error('checkAuthStatus() debe ser implementado por el adapter');
    }
    
    /**
     * Validar acceso a una hoja específica
     * @param {string} sheetId - ID de la hoja
     * @returns {Promise<Object>} Resultado de validación
     */
    async validateSheetAccess(sheetId) {
        throw new Error('validateSheetAccess() debe ser implementado por el adapter');
    }
    
    /**
     * Leer datos de una hoja con encabezados
     * @param {string} sheetId - ID de la hoja
     * @param {string} range - Rango de celdas
     * @param {string} sheetName - Nombre de la hoja
     * @returns {Promise<Object>} Datos leídos
     */
    async readSheetWithHeaders(sheetId, range, sheetName) {
        throw new Error('readSheetWithHeaders() debe ser implementado por el adapter');
    }
    
    /**
     * Extraer ID de hoja desde URL
     * @param {string} url - URL de Google Sheets
     * @returns {string} ID extraído
     */
    extractSheetId(url) {
        throw new Error('extractSheetId() debe ser implementado por el adapter');
    }
    
    /**
     * Detectar estructura de datos automáticamente
     * @param {string} sheetId - ID de la hoja
     * @param {string} sheetName - Nombre de la hoja
     * @param {number} sampleRows - Número de filas de muestra
     * @returns {Promise<Object>} Estructura detectada
     */
    async detectDataStructure(sheetId, sheetName, sampleRows) {
        throw new Error('detectDataStructure() debe ser implementado por el adapter');
    }
    
    /**
     * Generar URL de autorización (para compatibilidad OAuth2)
     * @returns {Promise<string>} URL de autorización
     */
    async generateAuthUrl() {
        throw new Error('generateAuthUrl() debe ser implementado por el adapter');
    }
    
    /**
     * Obtener token desde código (para compatibilidad OAuth2)
     * @param {string} code - Código de autorización
     * @returns {Promise<Object>} Token obtenido
     */
    async getTokenFromCode(code) {
        throw new Error('getTokenFromCode() debe ser implementado por el adapter');
    }
}

console.log('✅ [GSHEETS-PORT] Puerto de Google Sheets configurado');

module.exports = GSheetsPort;
