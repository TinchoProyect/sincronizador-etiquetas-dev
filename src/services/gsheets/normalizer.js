/**
 * Normalizador de datos para escritura a Google Sheets
 * Garantiza formatos consistentes: fechas YYYY-MM-DD, números con punto decimal
 */

console.log('🔍 [NORMALIZER] Configurando normalizador de datos...');

/**
 * Formatear fecha a ISO YYYY-MM-DD
 * @param {string|Date} fecha - Fecha a formatear
 * @returns {string|null} Fecha en formato YYYY-MM-DD o null si inválida
 */
function formatDateISO(fecha) {
    if (!fecha) {
        return null;
    }
    
    try {
        let dateObj;
        
        if (fecha instanceof Date) {
            dateObj = fecha;
        } else if (typeof fecha === 'string') {
            // Manejar diferentes formatos de entrada
            if (fecha.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
                // DD/MM/YYYY -> convertir a YYYY-MM-DD
                const [day, month, year] = fecha.split('/');
                dateObj = new Date(year, month - 1, day);
            } else {
                dateObj = new Date(fecha);
            }
        } else {
            return null;
        }
        
        if (isNaN(dateObj.getTime())) {
            console.log('⚠️ [NORMALIZER] Fecha inválida:', fecha);
            return null;
        }
        
        // Formatear a YYYY-MM-DD
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        
        const formatted = `${year}-${month}-${day}`;
        console.log('📅 [NORMALIZER] Fecha formateada:', fecha, '->', formatted);
        
        return formatted;
    } catch (error) {
        console.error('❌ [NORMALIZER] Error formateando fecha:', error.message);
        return null;
    }
}

/**
 * Normalizar número con punto decimal a 2 decimales
 * @param {string|number} numero - Número a normalizar
 * @returns {string} Número formateado con punto decimal
 */
function normalizeNumber(numero) {
    if (numero === null || numero === undefined || numero === '') {
        return '0.00';
    }
    
    try {
        let numValue;
        
        if (typeof numero === 'string') {
            // Reemplazar coma por punto si existe
            numValue = parseFloat(numero.replace(',', '.'));
        } else {
            numValue = parseFloat(numero);
        }
        
        if (isNaN(numValue)) {
            console.log('⚠️ [NORMALIZER] Número inválido:', numero);
            return '0.00';
        }
        
        const normalized = numValue.toFixed(2);
        console.log('🔢 [NORMALIZER] Número normalizado:', numero, '->', normalized);
        
        return normalized;
    } catch (error) {
        console.error('❌ [NORMALIZER] Error normalizando número:', error.message);
        return '0.00';
    }
}

/**
 * Normalizar payload completo de presupuesto para escritura a Sheets
 * @param {Object} presupuesto - Datos del presupuesto
 * @param {Array} detalles - Array de detalles del presupuesto
 * @returns {Object} Payload normalizado
 */
function normalizeBudgetPayload(presupuesto, detalles) {
    console.log('🔄 [NORMALIZER] Normalizando payload completo...');
    
    try {
        // Normalizar presupuesto
        const presupuestoNormalizado = {
            id_presupuesto_ext: presupuesto.id_presupuesto_ext || '',
            fecha: formatDateISO(presupuesto.fecha),
            id_cliente: presupuesto.id_cliente || '',
            agente: presupuesto.agente || '',
            fecha_entrega: formatDateISO(presupuesto.fecha_entrega),
            tipo_comprobante: presupuesto.tipo_comprobante || '',
            nota: presupuesto.nota || '',
            estado: presupuesto.estado || 'PENDIENTE',
            informe_generado: presupuesto.informe_generado || '',
            cliente_nuevo_id: presupuesto.cliente_nuevo_id || '',
            punto_entrega: presupuesto.punto_entrega || '',
            descuento: normalizeNumber(presupuesto.descuento)
        };
        
        // Normalizar detalles
        const detallesNormalizados = detalles.map((detalle, index) => {
            const detalleNormalizado = {
                id_detalle_presupuesto: detalle.id_detalle_presupuesto || '',
                id_presupuesto: presupuesto.id_presupuesto_ext,
                articulo: detalle.articulo || '',
                cantidad: normalizeNumber(detalle.cantidad),
                valor1: normalizeNumber(detalle.valor1),
                precio1: normalizeNumber(detalle.precio1),
                iva1: normalizeNumber(detalle.iva1),
                diferencia: normalizeNumber(detalle.diferencia),
                condicion: detalle.condicion || '',
                camp1: normalizeNumber(detalle.camp1),
                camp2: normalizeNumber(detalle.camp2),
                camp3: normalizeNumber(detalle.camp3),
                camp4: normalizeNumber(detalle.camp4),
                camp5: normalizeNumber(detalle.camp5)
            };
            
            console.log(`📋 [NORMALIZER] Detalle ${index + 1} normalizado:`, detalle.articulo);
            
            return detalleNormalizado;
        });
        
        const payloadNormalizado = {
            presupuesto: presupuestoNormalizado,
            detalles: detallesNormalizados
        };
        
        console.log('✅ [NORMALIZER] Payload normalizado:', {
            presupuesto_id: presupuestoNormalizado.id_presupuesto_ext,
            fecha: presupuestoNormalizado.fecha,
            detalles_count: detallesNormalizados.length
        });
        
        return payloadNormalizado;
        
    } catch (error) {
        console.error('❌ [NORMALIZER] Error normalizando payload:', error.message);
        throw error;
    }
}

/**
 * Convertir array de valores a formato para Google Sheets
 * @param {Array} valores - Array de valores a convertir
 * @returns {Array} Array formateado para Sheets
 */
function formatRowForSheets(valores) {
    return valores.map(valor => {
        if (valor === null || valor === undefined) {
            return '';
        }
        
        // Mantener strings como están
        if (typeof valor === 'string') {
            return valor;
        }
        
        // Convertir números a string con formato correcto
        if (typeof valor === 'number') {
            return valor.toString();
        }
        
        return String(valor);
    });
}

/**
 * Validar que los datos normalizados sean correctos
 * @param {Object} payload - Payload normalizado
 * @returns {Object} Resultado de validación
 */
function validateNormalizedPayload(payload) {
    const validation = {
        isValid: true,
        errors: [],
        warnings: []
    };
    
    try {
        const { presupuesto, detalles } = payload;
        
        // Validar presupuesto
        if (!presupuesto.id_presupuesto_ext) {
            validation.errors.push('ID de presupuesto requerido');
        }
        
        if (!presupuesto.id_cliente) {
            validation.errors.push('ID de cliente requerido');
        }
        
        if (!presupuesto.fecha) {
            validation.warnings.push('Fecha de presupuesto no especificada');
        }
        
        // Validar detalles
        if (!detalles || detalles.length === 0) {
            validation.errors.push('Al menos un detalle es requerido');
        } else {
            detalles.forEach((detalle, index) => {
                if (!detalle.articulo) {
                    validation.errors.push(`Detalle ${index + 1}: Artículo requerido`);
                }
                
                if (parseFloat(detalle.cantidad) <= 0) {
                    validation.warnings.push(`Detalle ${index + 1}: Cantidad debe ser mayor a 0`);
                }
                
                if (parseFloat(detalle.precio1) < 0) {
                    validation.warnings.push(`Detalle ${index + 1}: Precio no puede ser negativo`);
                }
            });
        }
        
        validation.isValid = validation.errors.length === 0;
        
        console.log(`${validation.isValid ? '✅' : '❌'} [NORMALIZER] Validación:`, {
            errors: validation.errors.length,
            warnings: validation.warnings.length
        });
        
    } catch (error) {
        console.error('❌ [NORMALIZER] Error en validación:', error.message);
        validation.isValid = false;
        validation.errors.push(`Error de validación: ${error.message}`);
    }
    
    return validation;
}

console.log('✅ [NORMALIZER] Normalizador de datos configurado');

module.exports = {
    formatDateISO,
    normalizeNumber,
    normalizeBudgetPayload,
    formatRowForSheets,
    validateNormalizedPayload
};
