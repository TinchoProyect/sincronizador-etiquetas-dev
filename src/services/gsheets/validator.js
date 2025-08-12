console.log('[VALIDATOR] Inicializando servicio de validación de datos...');

/**
 * Servicio de Validación de Datos
 * Valida datos transformados antes de la sincronización con PostgreSQL
 */

/**
 * Validar datos de presupuesto
 * @param {Object} presupuesto - Datos de presupuesto transformados
 * @returns {Object} Resultado de validación
 */
function validatePresupuesto(presupuesto) {
    console.log(`[VALIDATOR] Validando presupuesto: ${presupuesto.id_ext || 'SIN_ID'}`);
    
    const errors = [];
    const warnings = [];
    
    try {
        // VALIDACIONES OBLIGATORIAS
        if (!presupuesto.id_ext) {
            errors.push('IDPresupuesto (id_ext) es obligatorio');
        } else if (typeof presupuesto.id_ext !== 'string' || presupuesto.id_ext.trim().length === 0) {
            errors.push('IDPresupuesto debe ser un texto válido');
        }
        
        // VALIDACIONES DE TIPO
        if (presupuesto.cliente !== null && presupuesto.cliente !== undefined) {
            if (!Number.isInteger(presupuesto.cliente)) {
                errors.push('IDCliente debe ser un número entero');
            }
        }
        
        if (presupuesto.fecha_entrega !== null && presupuesto.fecha_entrega !== undefined) {
            if (!Number.isInteger(presupuesto.fecha_entrega)) {
                errors.push('Fecha de entrega debe ser un número entero');
            }
        }
        
        if (presupuesto.descuento !== null && presupuesto.descuento !== undefined) {
            if (typeof presupuesto.descuento !== 'number') {
                errors.push('Descuento debe ser numérico');
            } else if (presupuesto.descuento < 0) {
                warnings.push('Descuento es negativo');
            }
        }
        
        // VALIDACIONES DE FECHA
        if (presupuesto.fecha !== null && presupuesto.fecha !== undefined) {
            if (!(presupuesto.fecha instanceof Date)) {
                errors.push('Fecha debe ser un objeto Date válido');
            } else if (isNaN(presupuesto.fecha.getTime())) {
                errors.push('Fecha contiene un valor inválido');
            }
        }
        
        // VALIDACIONES DE LONGITUD DE TEXTO
        const textFields = [
            { field: 'agente', maxLength: 255 },
            { field: 'factura_efectivo', maxLength: 100 },
            { field: 'nota', maxLength: 1000 },
            { field: 'estado', maxLength: 50 },
            { field: 'informe_generado', maxLength: 100 },
            { field: 'cliente_nuevo_id', maxLength: 100 },
            { field: 'estado_imprime_pdf', maxLength: 100 },
            { field: 'punto_entrega', maxLength: 255 }
        ];
        
        for (const { field, maxLength } of textFields) {
            if (presupuesto[field] && typeof presupuesto[field] === 'string') {
                if (presupuesto[field].length > maxLength) {
                    errors.push(`${field} excede la longitud máxima de ${maxLength} caracteres`);
                }
            }
        }
        
        // VALIDACIONES DE NEGOCIO
        if (presupuesto.estado && !isValidEstado(presupuesto.estado)) {
            warnings.push(`Estado "${presupuesto.estado}" no es un valor estándar`);
        }
        
        const result = {
            isValid: errors.length === 0,
            errors: errors,
            warnings: warnings,
            id_ext: presupuesto.id_ext
        };
        
        if (result.isValid) {
            console.log(`[VALIDATOR] ✅ Presupuesto válido: ${presupuesto.id_ext}`);
        } else {
            console.log(`[VALIDATOR] ❌ Presupuesto inválido: ${presupuesto.id_ext} - ${errors.length} errores`);
        }
        
        return result;
        
    } catch (error) {
        console.error(`[VALIDATOR] ❌ Error validando presupuesto:`, error.message);
        return {
            isValid: false,
            errors: [`Error interno de validación: ${error.message}`],
            warnings: [],
            id_ext: presupuesto.id_ext
        };
    }
}

/**
 * Validar datos de detalle
 * @param {Object} detalle - Datos de detalle transformados
 * @returns {Object} Resultado de validación
 */
function validateDetalle(detalle) {
    console.log(`[VALIDATOR] Validando detalle: ${detalle.id_presupuesto_ext || 'SIN_ID'} - ${detalle.articulo || 'SIN_ARTICULO'}`);
    
    const errors = [];
    const warnings = [];
    
    try {
        // VALIDACIONES OBLIGATORIAS
        if (!detalle.id_presupuesto_ext) {
            errors.push('IDPresupuesto (id_presupuesto_ext) es obligatorio en detalle');
        } else if (typeof detalle.id_presupuesto_ext !== 'string' || detalle.id_presupuesto_ext.trim().length === 0) {
            errors.push('IDPresupuesto debe ser un texto válido');
        }
        
        if (!detalle.articulo) {
            errors.push('Articulo es obligatorio');
        } else if (typeof detalle.articulo !== 'string' || detalle.articulo.trim().length === 0) {
            errors.push('Articulo debe ser un texto válido');
        }
        
        // VALIDACIONES DE CAMPOS NUMÉRICOS
        const numericFields = [
            'cantidad', 'valor1', 'precio1', 'iva1', 'diferencia',
            'camp1', 'camp2', 'camp3', 'camp4', 'camp5', 'camp6'
        ];
        
        for (const field of numericFields) {
            if (detalle[field] !== null && detalle[field] !== undefined) {
                if (typeof detalle[field] !== 'number') {
                    errors.push(`${field} debe ser numérico`);
                } else if (isNaN(detalle[field])) {
                    errors.push(`${field} contiene un valor numérico inválido`);
                }
            }
        }
        
        // VALIDACIONES DE NEGOCIO
        if (detalle.cantidad !== null && detalle.cantidad !== undefined) {
            if (detalle.cantidad < 0) {
                warnings.push('Cantidad es negativa');
            }
            if (detalle.cantidad === 0) {
                warnings.push('Cantidad es cero');
            }
        }
        
        if (detalle.precio1 !== null && detalle.precio1 !== undefined) {
            if (detalle.precio1 < 0) {
                warnings.push('Precio1 es negativo');
            }
        }
        
        if (detalle.iva1 !== null && detalle.iva1 !== undefined) {
            if (detalle.iva1 < 0 || detalle.iva1 > 100) {
                warnings.push('IVA1 fuera del rango esperado (0-100)');
            }
        }
        
        // VALIDACIÓN DE LONGITUD DE TEXTO
        if (detalle.articulo && detalle.articulo.length > 255) {
            errors.push('Articulo excede la longitud máxima de 255 caracteres');
        }
        
        const result = {
            isValid: errors.length === 0,
            errors: errors,
            warnings: warnings,
            id_presupuesto_ext: detalle.id_presupuesto_ext,
            articulo: detalle.articulo
        };
        
        if (result.isValid) {
            console.log(`[VALIDATOR] ✅ Detalle válido: ${detalle.id_presupuesto_ext} - ${detalle.articulo}`);
        } else {
            console.log(`[VALIDATOR] ❌ Detalle inválido: ${detalle.id_presupuesto_ext} - ${detalle.articulo} - ${errors.length} errores`);
        }
        
        return result;
        
    } catch (error) {
        console.error(`[VALIDATOR] ❌ Error validando detalle:`, error.message);
        return {
            isValid: false,
            errors: [`Error interno de validación: ${error.message}`],
            warnings: [],
            id_presupuesto_ext: detalle.id_presupuesto_ext,
            articulo: detalle.articulo
        };
    }
}

/**
 * Validar lote de presupuestos
 * @param {Array} presupuestos - Array de presupuestos transformados
 * @returns {Object} Resultado de validación del lote
 */
function validatePresupuestos(presupuestos) {
    console.log(`[VALIDATOR] Validando lote de ${presupuestos.length} presupuestos...`);
    
    const validPresupuestos = [];
    const invalidPresupuestos = [];
    const allErrors = [];
    const allWarnings = [];
    
    for (let i = 0; i < presupuestos.length; i++) {
        const validation = validatePresupuesto(presupuestos[i]);
        
        if (validation.isValid) {
            validPresupuestos.push(presupuestos[i]);
        } else {
            invalidPresupuestos.push({
                index: i,
                data: presupuestos[i],
                validation: validation
            });
        }
        
        allErrors.push(...validation.errors.map(error => ({
            index: i,
            id_ext: validation.id_ext,
            error: error
        })));
        
        allWarnings.push(...validation.warnings.map(warning => ({
            index: i,
            id_ext: validation.id_ext,
            warning: warning
        })));
    }
    
    const result = {
        valid: validPresupuestos,
        invalid: invalidPresupuestos,
        errors: allErrors,
        warnings: allWarnings,
        stats: {
            total: presupuestos.length,
            valid: validPresupuestos.length,
            invalid: invalidPresupuestos.length,
            errorCount: allErrors.length,
            warningCount: allWarnings.length
        }
    };
    
    console.log(`[VALIDATOR] ✅ Lote de presupuestos validado: ${result.stats.valid} válidos, ${result.stats.invalid} inválidos`);
    
    return result;
}

/**
 * Validar lote de detalles
 * @param {Array} detalles - Array de detalles transformados
 * @returns {Object} Resultado de validación del lote
 */
function validateDetalles(detalles) {
    console.log(`[VALIDATOR] Validando lote de ${detalles.length} detalles...`);
    
    const validDetalles = [];
    const invalidDetalles = [];
    const allErrors = [];
    const allWarnings = [];
    
    for (let i = 0; i < detalles.length; i++) {
        const validation = validateDetalle(detalles[i]);
        
        if (validation.isValid) {
            validDetalles.push(detalles[i]);
        } else {
            invalidDetalles.push({
                index: i,
                data: detalles[i],
                validation: validation
            });
        }
        
        allErrors.push(...validation.errors.map(error => ({
            index: i,
            id_presupuesto_ext: validation.id_presupuesto_ext,
            articulo: validation.articulo,
            error: error
        })));
        
        allWarnings.push(...validation.warnings.map(warning => ({
            index: i,
            id_presupuesto_ext: validation.id_presupuesto_ext,
            articulo: validation.articulo,
            warning: warning
        })));
    }
    
    const result = {
        valid: validDetalles,
        invalid: invalidDetalles,
        errors: allErrors,
        warnings: allWarnings,
        stats: {
            total: detalles.length,
            valid: validDetalles.length,
            invalid: invalidDetalles.length,
            errorCount: allErrors.length,
            warningCount: allWarnings.length
        }
    };
    
    console.log(`[VALIDATOR] ✅ Lote de detalles validado: ${result.stats.valid} válidos, ${result.stats.invalid} inválidos`);
    
    return result;
}

/**
 * Verificar si un estado es válido
 * @param {string} estado - Estado a verificar
 * @returns {boolean} True si es válido
 */
function isValidEstado(estado) {
    const validEstados = [
        'PENDIENTE', 'APROBADO', 'RECHAZADO', 'EN_PROCESO', 
        'COMPLETADO', 'CANCELADO', 'FACTURADO', 'ENTREGADO',
        'IMPORTADO_AUTOMATICO'
    ];
    
    return validEstados.includes(estado.toUpperCase());
}

/**
 * Generar reporte de validación
 * @param {Object} presupuestosValidation - Resultado de validación de presupuestos
 * @param {Object} detallesValidation - Resultado de validación de detalles
 * @returns {Object} Reporte consolidado
 */
function generateValidationReport(presupuestosValidation, detallesValidation) {
    console.log('[VALIDATOR] Generando reporte de validación...');
    
    const report = {
        timestamp: new Date().toISOString(),
        presupuestos: {
            total: presupuestosValidation.stats.total,
            valid: presupuestosValidation.stats.valid,
            invalid: presupuestosValidation.stats.invalid,
            errors: presupuestosValidation.stats.errorCount,
            warnings: presupuestosValidation.stats.warningCount
        },
        detalles: {
            total: detallesValidation.stats.total,
            valid: detallesValidation.stats.valid,
            invalid: detallesValidation.stats.invalid,
            errors: detallesValidation.stats.errorCount,
            warnings: detallesValidation.stats.warningCount
        },
        summary: {
            totalRecords: presupuestosValidation.stats.total + detallesValidation.stats.total,
            validRecords: presupuestosValidation.stats.valid + detallesValidation.stats.valid,
            invalidRecords: presupuestosValidation.stats.invalid + detallesValidation.stats.invalid,
            totalErrors: presupuestosValidation.stats.errorCount + detallesValidation.stats.errorCount,
            totalWarnings: presupuestosValidation.stats.warningCount + detallesValidation.stats.warningCount
        },
        detailedErrors: {
            presupuestos: presupuestosValidation.errors,
            detalles: detallesValidation.errors
        },
        detailedWarnings: {
            presupuestos: presupuestosValidation.warnings,
            detalles: detallesValidation.warnings
        }
    };
    
    console.log(`[VALIDATOR] ✅ Reporte generado: ${report.summary.validRecords}/${report.summary.totalRecords} registros válidos`);
    
    return report;
}

console.log('[VALIDATOR] ✅ Servicio de validación configurado');

module.exports = {
    validatePresupuesto,
    validateDetalle,
    validatePresupuestos,
    validateDetalles,
    isValidEstado,
    generateValidationReport
};
