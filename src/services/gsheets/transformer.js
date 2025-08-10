console.log('[TRANSFORMER] Inicializando servicio de transformación de datos...');

/**
 * Servicio de Transformación de Datos
 * Convierte datos de Google Sheets al formato requerido por PostgreSQL
 */

/**
 * Transformar datos de presupuesto desde Google Sheets a formato PostgreSQL
 * @param {Object} rawRow - Fila cruda desde Google Sheets
 * @returns {Object} Objeto transformado para PostgreSQL
 */
function transformPresupuesto(rawRow) {
    console.log(`[TRANSFORMER] Transformando presupuesto: ${rawRow.IDPresupuesto || 'SIN_ID'}`);
    
    try {
        const transformed = {
            id_ext: rawRow.IDPresupuesto?.toString().trim() || null,
            fecha: parseDate(rawRow.Fecha),
            cliente: parseInt(rawRow.IDCliente) || null,
            agente: rawRow.Agente?.toString().trim() || null,
            fecha_entrega: parseInt(rawRow['Fecha de entrega']) || null,
            factura_efectivo: rawRow['Factura/Efectivo']?.toString().trim() || null,
            nota: rawRow.Nota?.toString().trim() || null,
            estado: rawRow.Estado?.toString().trim() || null,
            informe_generado: rawRow.InformeGenerado?.toString().trim() || null,
            cliente_nuevo_id: rawRow.ClienteNuevoID?.toString().trim() || null,
            estado_imprime_pdf: rawRow['Estado/ImprimePDF']?.toString().trim() || null,
            punto_entrega: rawRow.PuntoEntrega?.toString().trim() || null,
            descuento: parseFloat(rawRow.Descuento) || 0.00
        };
        
        console.log(`[TRANSFORMER] ✅ Presupuesto transformado: ${transformed.id_ext}`);
        
        return transformed;
        
    } catch (error) {
        console.error(`[TRANSFORMER] ❌ Error transformando presupuesto:`, error.message);
        console.error(`[TRANSFORMER] Datos originales:`, rawRow);
        throw new Error(`Error en transformación de presupuesto: ${error.message}`);
    }
}

/**
 * Transformar datos de detalle desde Google Sheets a formato PostgreSQL
 * @param {Object} rawRow - Fila cruda desde Google Sheets
 * @returns {Object} Objeto transformado para PostgreSQL
 */
function transformDetalle(rawRow) {
    console.log(`[TRANSFORMER] Transformando detalle: ${rawRow.IDPresupuesto || 'SIN_ID'} - ${rawRow.Articulo || 'SIN_ARTICULO'}`);
    
    try {
        const transformed = {
            id_presupuesto_ext: rawRow.IDPresupuesto?.toString().trim() || null,
            articulo: rawRow.Articulo?.toString().trim() || null,
            cantidad: parseFloat(rawRow.Cantidad) || 0.00,
            valor1: parseFloat(rawRow.Valor1) || 0.00,
            precio1: parseFloat(rawRow.Precio1) || 0.00,
            iva1: parseFloat(rawRow.IVA1) || 0.00,
            diferencia: parseFloat(rawRow.Diferencia) || 0.00,
            camp1: parseFloat(rawRow.Camp1) || 0.00,
            camp2: parseFloat(rawRow.Camp2) || 0.00,
            camp3: parseFloat(rawRow.Camp3) || 0.00,
            camp4: parseFloat(rawRow.Camp4) || 0.00,
            camp5: parseFloat(rawRow.Camp5) || 0.00,
            camp6: parseFloat(rawRow.Camp6) || 0.00
        };
        
        console.log(`[TRANSFORMER] ✅ Detalle transformado: ${transformed.id_presupuesto_ext} - ${transformed.articulo}`);
        
        return transformed;
        
    } catch (error) {
        console.error(`[TRANSFORMER] ❌ Error transformando detalle:`, error.message);
        console.error(`[TRANSFORMER] Datos originales:`, rawRow);
        throw new Error(`Error en transformación de detalle: ${error.message}`);
    }
}

/**
 * Transformar lote de presupuestos
 * @param {Array} rawPresupuestos - Array de presupuestos crudos
 * @returns {Array} Array de presupuestos transformados
 */
function transformPresupuestos(rawPresupuestos) {
    console.log(`[TRANSFORMER] Transformando lote de ${rawPresupuestos.length} presupuestos...`);
    
    const transformed = [];
    const errors = [];
    
    for (let i = 0; i < rawPresupuestos.length; i++) {
        try {
            const transformedItem = transformPresupuesto(rawPresupuestos[i]);
            transformed.push(transformedItem);
        } catch (error) {
            errors.push({
                index: i,
                data: rawPresupuestos[i],
                error: error.message
            });
            console.error(`[TRANSFORMER] ❌ Error en presupuesto índice ${i}:`, error.message);
        }
    }
    
    console.log(`[TRANSFORMER] ✅ Lote transformado: ${transformed.length} exitosos, ${errors.length} errores`);
    
    return {
        transformed,
        errors,
        stats: {
            total: rawPresupuestos.length,
            successful: transformed.length,
            failed: errors.length
        }
    };
}

/**
 * Transformar lote de detalles
 * @param {Array} rawDetalles - Array de detalles crudos
 * @returns {Array} Array de detalles transformados
 */
function transformDetalles(rawDetalles) {
    console.log(`[TRANSFORMER] Transformando lote de ${rawDetalles.length} detalles...`);
    
    const transformed = [];
    const errors = [];
    
    for (let i = 0; i < rawDetalles.length; i++) {
        try {
            const transformedItem = transformDetalle(rawDetalles[i]);
            transformed.push(transformedItem);
        } catch (error) {
            errors.push({
                index: i,
                data: rawDetalles[i],
                error: error.message
            });
            console.error(`[TRANSFORMER] ❌ Error en detalle índice ${i}:`, error.message);
        }
    }
    
    console.log(`[TRANSFORMER] ✅ Lote transformado: ${transformed.length} exitosos, ${errors.length} errores`);
    
    return {
        transformed,
        errors,
        stats: {
            total: rawDetalles.length,
            successful: transformed.length,
            failed: errors.length
        }
    };
}

/**
 * Parsear fecha con corrección definitiva DD/MM/YYYY
 * @param {*} dateValue - Valor de fecha desde Google Sheets
 * @returns {string|null} Fecha en formato YYYY-MM-DD para PostgreSQL DATE o null
 */
function parseDate(dateValue) {
    if (!dateValue) return null;
    
    try {
        // OPCIÓN A (RECOMENDADA): Serial de Google Sheets
        if (typeof dateValue === 'number') {
            // Google Sheets usa el mismo sistema que Excel: 1 = 1900-01-01
            // Pero Google Sheets corrige el bug del año bisiesto de Excel
            const SHEETS_EPOCH = new Date(1899, 11, 30); // 30 de diciembre de 1899
            const parsed = new Date(SHEETS_EPOCH.getTime() + dateValue * 24 * 60 * 60 * 1000);
            
            // Validar rango razonable
            if (parsed.getFullYear() < 1900 || parsed.getFullYear() > 2030) {
                return null;
            }
            
            // Formatear como DATE para PostgreSQL
            const year = parsed.getFullYear();
            const month = String(parsed.getMonth() + 1).padStart(2, '0');
            const day = String(parsed.getDate()).padStart(2, '0');
            
            return `${year}-${month}-${day}`;
        }
        
        // OPCIÓN B: String DD/MM/YYYY (patrón fijo, sin new Date())
        if (typeof dateValue === 'string') {
            const trimmed = dateValue.trim();
            
            // Tratar 1970-01-01 como sin fecha
            if (trimmed === '1970-01-01' || trimmed === '01/01/1970') {
                return null;
            }
            
            // Formato DD/MM/YYYY estricto
            const ddmmyyyyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
            if (ddmmyyyyMatch) {
                const day = parseInt(ddmmyyyyMatch[1], 10);
                const month = parseInt(ddmmyyyyMatch[2], 10);
                const year = parseInt(ddmmyyyyMatch[3], 10);
                
                // Validar rangos
                if (year < 1900 || year > 2030 || month < 1 || month > 12 || day < 1 || day > 31) {
                    return null;
                }
                
                // Validar fecha válida (no 31/02, etc.)
                const testDate = new Date(year, month - 1, day);
                if (testDate.getFullYear() !== year || testDate.getMonth() !== month - 1 || testDate.getDate() !== day) {
                    return null;
                }
                
                // Formatear como DATE para PostgreSQL
                const monthStr = String(month).padStart(2, '0');
                const dayStr = String(day).padStart(2, '0');
                
                return `${year}-${monthStr}-${dayStr}`;
            }
            
            // Formato ISO YYYY-MM-DD
            const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (isoMatch) {
                const year = parseInt(isoMatch[1], 10);
                const month = parseInt(isoMatch[2], 10);
                const day = parseInt(isoMatch[3], 10);
                
                // Validar rangos
                if (year < 1900 || year > 2030 || month < 1 || month > 12 || day < 1 || day > 31) {
                    return null;
                }
                
                return trimmed; // Ya está en formato correcto
            }
        }
        
        // Si es Date object
        if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
            const year = dateValue.getFullYear();
            const month = String(dateValue.getMonth() + 1).padStart(2, '0');
            const day = String(dateValue.getDate()).padStart(2, '0');
            
            return `${year}-${month}-${day}`;
        }
        
        return null;
        
    } catch (error) {
        return null;
    }
}

/**
 * Limpiar y validar texto
 * @param {*} textValue - Valor de texto
 * @param {number} maxLength - Longitud máxima (opcional)
 * @returns {string|null} Texto limpio o null
 */
function cleanText(textValue, maxLength = null) {
    if (!textValue) return null;
    
    try {
        let cleaned = textValue.toString().trim();
        
        // Remover caracteres de control
        cleaned = cleaned.replace(/[\x00-\x1F\x7F]/g, '');
        
        // Truncar si es necesario
        if (maxLength && cleaned.length > maxLength) {
            cleaned = cleaned.substring(0, maxLength);
            console.warn(`[TRANSFORMER] ⚠️ Texto truncado a ${maxLength} caracteres: ${cleaned}`);
        }
        
        return cleaned || null;
        
    } catch (error) {
        console.error(`[TRANSFORMER] ❌ Error limpiando texto ${textValue}:`, error.message);
        return null;
    }
}

/**
 * Parsear número con validación
 * @param {*} numValue - Valor numérico
 * @param {number} defaultValue - Valor por defecto
 * @returns {number} Número parseado
 */
function parseNumber(numValue, defaultValue = 0) {
    if (numValue === null || numValue === undefined || numValue === '') {
        return defaultValue;
    }
    
    try {
        // Si ya es un número
        if (typeof numValue === 'number') {
            return isNaN(numValue) ? defaultValue : numValue;
        }
        
        // Si es string, limpiar y parsear
        if (typeof numValue === 'string') {
            const cleaned = numValue.trim().replace(/[^\d.-]/g, '');
            const parsed = parseFloat(cleaned);
            return isNaN(parsed) ? defaultValue : parsed;
        }
        
        // Intentar conversión directa
        const parsed = parseFloat(numValue);
        return isNaN(parsed) ? defaultValue : parsed;
        
    } catch (error) {
        console.error(`[TRANSFORMER] ❌ Error parseando número ${numValue}:`, error.message);
        return defaultValue;
    }
}

/**
 * Validar estructura de datos transformados
 * @param {Object} transformed - Datos transformados
 * @param {string} type - Tipo de datos ('presupuesto' o 'detalle')
 * @returns {Object} Resultado de validación
 */
function validateTransformed(transformed, type) {
    const errors = [];
    
    if (type === 'presupuesto') {
        if (!transformed.id_ext) {
            errors.push('id_ext es obligatorio');
        }
        
        if (transformed.cliente && typeof transformed.cliente !== 'number') {
            errors.push('cliente debe ser numérico');
        }
        
        if (transformed.descuento && typeof transformed.descuento !== 'number') {
            errors.push('descuento debe ser numérico');
        }
    }
    
    if (type === 'detalle') {
        if (!transformed.id_presupuesto_ext) {
            errors.push('id_presupuesto_ext es obligatorio');
        }
        
        if (!transformed.articulo) {
            errors.push('articulo es obligatorio');
        }
        
        // Validar campos numéricos
        const numericFields = ['cantidad', 'valor1', 'precio1', 'iva1', 'diferencia', 'camp1', 'camp2', 'camp3', 'camp4', 'camp5', 'camp6'];
        for (const field of numericFields) {
            if (transformed[field] && typeof transformed[field] !== 'number') {
                errors.push(`${field} debe ser numérico`);
            }
        }
    }
    
    return {
        isValid: errors.length === 0,
        errors: errors
    };
}

console.log('[TRANSFORMER] ✅ Servicio de transformación configurado');

module.exports = {
    transformPresupuesto,
    transformDetalle,
    transformPresupuestos,
    transformDetalles,
    parseDate,
    cleanText,
    parseNumber,
    validateTransformed
};
