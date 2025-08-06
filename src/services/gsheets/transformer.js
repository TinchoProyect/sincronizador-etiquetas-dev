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
 * Parsear fecha desde diferentes formatos
 * @param {*} dateValue - Valor de fecha desde Google Sheets
 * @returns {Date|null} Fecha parseada o null
 */
function parseDate(dateValue) {
    if (!dateValue) return null;
    
    try {
        // Si ya es una fecha
        if (dateValue instanceof Date) {
            return dateValue;
        }
        
        // Si es un string
        if (typeof dateValue === 'string') {
            const trimmed = dateValue.trim();
            
            // Formato ISO
            if (trimmed.match(/^\d{4}-\d{2}-\d{2}/)) {
                return new Date(trimmed);
            }
            
            // Formato DD/MM/YYYY
            if (trimmed.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
                const [day, month, year] = trimmed.split('/');
                return new Date(year, month - 1, day);
            }
            
            // Formato MM/DD/YYYY
            if (trimmed.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
                const parsed = new Date(trimmed);
                if (!isNaN(parsed.getTime())) {
                    return parsed;
                }
            }
            
            // Intentar parseo directo
            const parsed = new Date(trimmed);
            if (!isNaN(parsed.getTime())) {
                return parsed;
            }
        }
        
        // Si es un número (timestamp)
        if (typeof dateValue === 'number') {
            return new Date(dateValue);
        }
        
        console.warn(`[TRANSFORMER] ⚠️ No se pudo parsear fecha: ${dateValue}`);
        return null;
        
    } catch (error) {
        console.error(`[TRANSFORMER] ❌ Error parseando fecha ${dateValue}:`, error.message);
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
