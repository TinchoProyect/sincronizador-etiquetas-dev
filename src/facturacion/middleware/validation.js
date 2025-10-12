/**
 * Middleware de validación de requests
 */

const { validarFacturaCompleta } = require('../utils/validaciones');

console.log('🔍 [FACTURACION-VALIDATION] Cargando middleware de validación...');

/**
 * Validar request de crear factura
 * Integración estricta con Presupuestos
 */
const validarCrearFactura = (req, res, next) => {
    console.log('🔍 [FACTURACION-VALIDATION] Validando request de crear factura...');
    
    try {
        const { body } = req;
        
        // Validar que exista body
        if (!body || Object.keys(body).length === 0) {
            console.error('❌ [FACTURACION-VALIDATION] Body vacío');
            return res.status(400).json({
                success: false,
                error: 'Body requerido',
                message: 'Debe proporcionar datos de la factura'
            });
        }
        
        // ========================================
        // VALIDACIONES ESTRICTAS DE INTEGRACIÓN
        // ========================================
        
        // 1. Validar usar_facturador_nuevo (REQUERIDO)
        if (body.usar_facturador_nuevo !== true) {
            console.error('❌ [FACTURACION-VALIDATION] usar_facturador_nuevo no es true');
            return res.status(400).json({
                success: false,
                error: 'Facturador nuevo requerido',
                message: 'Este endpoint solo acepta presupuestos marcados con usar_facturador_nuevo: true',
                campo_faltante: 'usar_facturador_nuevo'
            });
        }
        
        // 2. Validar fecha_presupuesto (REQUERIDO y >= 2025-10-12)
        if (!body.fecha_presupuesto) {
            console.error('❌ [FACTURACION-VALIDATION] fecha_presupuesto faltante');
            return res.status(400).json({
                success: false,
                error: 'Fecha de presupuesto requerida',
                message: 'Debe proporcionar fecha_presupuesto (formato YYYY-MM-DD)',
                campo_faltante: 'fecha_presupuesto'
            });
        }
        
        const FECHA_HITO = '2025-10-12';
        if (body.fecha_presupuesto < FECHA_HITO) {
            console.error('❌ [FACTURACION-VALIDATION] fecha_presupuesto anterior al hito:', body.fecha_presupuesto);
            return res.status(400).json({
                success: false,
                error: 'Presupuesto legado rechazado',
                message: `Solo se aceptan presupuestos con fecha >= ${FECHA_HITO}. Presupuestos anteriores deben usar el sistema legado.`,
                fecha_recibida: body.fecha_presupuesto,
                fecha_minima: FECHA_HITO
            });
        }
        
        // 3. Validar presupuesto_id (REQUERIDO)
        if (!body.presupuesto_id) {
            console.error('❌ [FACTURACION-VALIDATION] presupuesto_id faltante');
            return res.status(400).json({
                success: false,
                error: 'ID de presupuesto requerido',
                message: 'Debe proporcionar presupuesto_id',
                campo_faltante: 'presupuesto_id'
            });
        }
        
        // 4. Validar estructura de cliente (REQUERIDO)
        if (!body.cliente || typeof body.cliente !== 'object') {
            console.error('❌ [FACTURACION-VALIDATION] cliente faltante o inválido');
            return res.status(400).json({
                success: false,
                error: 'Datos de cliente requeridos',
                message: 'Debe proporcionar objeto cliente con: cliente_id, razon_social, doc_tipo, doc_nro, condicion_iva_id',
                campo_faltante: 'cliente'
            });
        }
        
        // Validar campos de cliente
        const camposCliente = ['cliente_id', 'razon_social', 'doc_tipo', 'doc_nro', 'condicion_iva_id'];
        const clienteFaltantes = camposCliente.filter(campo => body.cliente[campo] === undefined || body.cliente[campo] === null);
        
        if (clienteFaltantes.length > 0) {
            console.error('❌ [FACTURACION-VALIDATION] Campos de cliente faltantes:', clienteFaltantes);
            return res.status(400).json({
                success: false,
                error: 'Datos de cliente incompletos',
                message: 'Faltan campos requeridos en objeto cliente',
                campos_faltantes: clienteFaltantes
            });
        }
        
        // 5. Validar precio_modo (REQUERIDO)
        if (!body.precio_modo || !['NETO', 'FINAL_CON_IVA'].includes(body.precio_modo)) {
            console.error('❌ [FACTURACION-VALIDATION] precio_modo inválido:', body.precio_modo);
            return res.status(400).json({
                success: false,
                error: 'Modo de precio inválido',
                message: 'precio_modo debe ser "NETO" o "FINAL_CON_IVA"',
                valor_recibido: body.precio_modo,
                valores_validos: ['NETO', 'FINAL_CON_IVA']
            });
        }
        
        // 6. Validar items (REQUERIDO y no vacío)
        if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
            console.error('❌ [FACTURACION-VALIDATION] items faltante o vacío');
            return res.status(400).json({
                success: false,
                error: 'Items requeridos',
                message: 'Debe proporcionar al menos un item en el array items'
            });
        }
        
        // Validar cada item
        for (let i = 0; i < body.items.length; i++) {
            const item = body.items[i];
            const camposItem = ['descripcion', 'qty', 'p_unit', 'alic_iva_id'];
            const itemFaltantes = camposItem.filter(campo => item[campo] === undefined || item[campo] === null);
            
            if (itemFaltantes.length > 0) {
                console.error(`❌ [FACTURACION-VALIDATION] Item ${i} incompleto:`, itemFaltantes);
                return res.status(400).json({
                    success: false,
                    error: 'Item incompleto',
                    message: `El item en posición ${i} tiene campos faltantes`,
                    item_index: i,
                    campos_faltantes: itemFaltantes
                });
            }
        }
        
        // ========================================
        // VALIDACIONES ADICIONALES
        // ========================================
        
        // Validar factura completa (validaciones de negocio)
        const validacion = validarFacturaCompleta(body);
        
        if (!validacion.valido) {
            console.error('❌ [FACTURACION-VALIDATION] Validación de negocio fallida:', validacion.errores);
            return res.status(400).json({
                success: false,
                error: 'Datos inválidos',
                errores: validacion.errores
            });
        }
        
        console.log('✅ [FACTURACION-VALIDATION] Validación exitosa');
        console.log('   - usar_facturador_nuevo: true');
        console.log('   - fecha_presupuesto:', body.fecha_presupuesto);
        console.log('   - presupuesto_id:', body.presupuesto_id);
        console.log('   - precio_modo:', body.precio_modo);
        console.log('   - items:', body.items.length);
        
        next();
        
    } catch (error) {
        console.error('❌ [FACTURACION-VALIDATION] Error en validación:', error.message);
        return res.status(500).json({
            success: false,
            error: 'Error en validación',
            message: error.message
        });
    }
};

/**
 * Validar request de emitir factura
 */
const validarEmitirFactura = (req, res, next) => {
    console.log('🔍 [FACTURACION-VALIDATION] Validando request de emitir factura...');
    
    try {
        const { id } = req.params;
        
        // Validar ID
        if (!id || isNaN(parseInt(id))) {
            console.error('❌ [FACTURACION-VALIDATION] ID inválido:', id);
            return res.status(400).json({
                success: false,
                error: 'ID inválido',
                message: 'Debe proporcionar un ID numérico válido'
            });
        }
        
        console.log('✅ [FACTURACION-VALIDATION] Validación exitosa');
        next();
        
    } catch (error) {
        console.error('❌ [FACTURACION-VALIDATION] Error en validación:', error.message);
        return res.status(500).json({
            success: false,
            error: 'Error en validación',
            message: error.message
        });
    }
};

/**
 * Validar parámetros de query
 */
const validarQueryParams = (paramsRequeridos) => {
    return (req, res, next) => {
        console.log('🔍 [FACTURACION-VALIDATION] Validando query params...');
        
        try {
            const { query } = req;
            const faltantes = [];
            
            for (const param of paramsRequeridos) {
                if (!query[param]) {
                    faltantes.push(param);
                }
            }
            
            if (faltantes.length > 0) {
                console.error('❌ [FACTURACION-VALIDATION] Parámetros faltantes:', faltantes);
                return res.status(400).json({
                    success: false,
                    error: 'Parámetros faltantes',
                    faltantes
                });
            }
            
            console.log('✅ [FACTURACION-VALIDATION] Query params válidos');
            next();
            
        } catch (error) {
            console.error('❌ [FACTURACION-VALIDATION] Error en validación:', error.message);
            return res.status(500).json({
                success: false,
                error: 'Error en validación',
                message: error.message
            });
        }
    };
};

/**
 * Sanitizar datos de entrada
 */
const sanitizarDatos = (req, res, next) => {
    console.log('🧹 [FACTURACION-VALIDATION] Sanitizando datos...');
    
    try {
        // Sanitizar strings (remover espacios extra, etc.)
        if (req.body) {
            req.body = sanitizarObjeto(req.body);
        }
        
        if (req.query) {
            req.query = sanitizarObjeto(req.query);
        }
        
        console.log('✅ [FACTURACION-VALIDATION] Datos sanitizados');
        next();
        
    } catch (error) {
        console.error('❌ [FACTURACION-VALIDATION] Error sanitizando:', error.message);
        next(); // Continuar aunque falle la sanitización
    }
};

/**
 * Sanitizar objeto recursivamente
 */
const sanitizarObjeto = (obj) => {
    if (typeof obj !== 'object' || obj === null) {
        return obj;
    }
    
    if (Array.isArray(obj)) {
        return obj.map(item => sanitizarObjeto(item));
    }
    
    const sanitizado = {};
    
    for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
            // Remover espacios extra
            sanitizado[key] = value.trim();
        } else if (typeof value === 'object') {
            sanitizado[key] = sanitizarObjeto(value);
        } else {
            sanitizado[key] = value;
        }
    }
    
    return sanitizado;
};

/**
 * Validar límites de paginación
 */
const validarPaginacion = (req, res, next) => {
    console.log('🔍 [FACTURACION-VALIDATION] Validando paginación...');
    
    try {
        const { limit = 50, offset = 0 } = req.query;
        
        const limitNum = parseInt(limit);
        const offsetNum = parseInt(offset);
        
        if (isNaN(limitNum) || limitNum < 1 || limitNum > 1000) {
            console.error('❌ [FACTURACION-VALIDATION] Limit inválido:', limit);
            return res.status(400).json({
                success: false,
                error: 'Limit inválido',
                message: 'Limit debe estar entre 1 y 1000'
            });
        }
        
        if (isNaN(offsetNum) || offsetNum < 0) {
            console.error('❌ [FACTURACION-VALIDATION] Offset inválido:', offset);
            return res.status(400).json({
                success: false,
                error: 'Offset inválido',
                message: 'Offset debe ser mayor o igual a 0'
            });
        }
        
        req.query.limit = limitNum;
        req.query.offset = offsetNum;
        
        console.log('✅ [FACTURACION-VALIDATION] Paginación válida');
        next();
        
    } catch (error) {
        console.error('❌ [FACTURACION-VALIDATION] Error validando paginación:', error.message);
        return res.status(500).json({
            success: false,
            error: 'Error en validación',
            message: error.message
        });
    }
};

console.log('✅ [FACTURACION-VALIDATION] Middleware de validación cargado');

module.exports = {
    validarCrearFactura,
    validarEmitirFactura,
    validarQueryParams,
    sanitizarDatos,
    validarPaginacion
};
