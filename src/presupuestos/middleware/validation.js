console.log('🔍 [PRESUPUESTOS] Configurando middleware de validación...');

/**
 * Middleware de validación para el módulo de presupuestos
 * Valida datos de entrada y parámetros de las requests
 */

/**
 * Validar datos para crear presupuesto
 */
const validarCrearPresupuesto = (req, res, next) => {
    console.log('🔍 [PRESUPUESTOS] Validando datos para crear presupuesto...');
    
    const { concepto, monto, categoria } = req.body;
    const errores = [];
    
    // Validar concepto
    if (!concepto || typeof concepto !== 'string' || concepto.trim().length === 0) {
        errores.push('El concepto es requerido y debe ser un texto válido');
        console.log('❌ [PRESUPUESTOS] Concepto inválido:', concepto);
    } else if (concepto.trim().length > 255) {
        errores.push('El concepto no puede exceder 255 caracteres');
        console.log('❌ [PRESUPUESTOS] Concepto muy largo:', concepto.length);
    }
    
    // Validar monto
    if (monto === undefined || monto === null) {
        errores.push('El monto es requerido');
        console.log('❌ [PRESUPUESTOS] Monto faltante');
    } else if (isNaN(parseFloat(monto))) {
        errores.push('El monto debe ser un número válido');
        console.log('❌ [PRESUPUESTOS] Monto no numérico:', monto);
    } else if (parseFloat(monto) < 0) {
        errores.push('El monto no puede ser negativo');
        console.log('❌ [PRESUPUESTOS] Monto negativo:', monto);
    }
    
    // Validar categoría (opcional)
    if (categoria && typeof categoria !== 'string') {
        errores.push('La categoría debe ser un texto válido');
        console.log('❌ [PRESUPUESTOS] Categoría inválida:', categoria);
    } else if (categoria && categoria.length > 100) {
        errores.push('La categoría no puede exceder 100 caracteres');
        console.log('❌ [PRESUPUESTOS] Categoría muy larga:', categoria.length);
    }
    
    if (errores.length > 0) {
        console.log('❌ [PRESUPUESTOS] Errores de validación:', errores);
        return res.status(400).json({
            success: false,
            error: 'Datos de entrada inválidos',
            errores: errores,
            timestamp: new Date().toISOString()
        });
    }
    
    console.log('✅ [PRESUPUESTOS] Validación de creación exitosa');
    next();
};

/**
 * Validar datos para actualizar presupuesto
 */
const validarActualizarPresupuesto = (req, res, next) => {
    console.log('🔍 [PRESUPUESTOS] Validando datos para actualizar presupuesto...');
    
    const { concepto, monto, categoria } = req.body;
    const errores = [];
    
    // Al menos un campo debe estar presente
    if (concepto === undefined && monto === undefined && categoria === undefined) {
        errores.push('Debe proporcionar al menos un campo para actualizar');
        console.log('❌ [PRESUPUESTOS] No hay campos para actualizar');
    }
    
    // Validar concepto si está presente
    if (concepto !== undefined) {
        if (typeof concepto !== 'string' || concepto.trim().length === 0) {
            errores.push('El concepto debe ser un texto válido');
            console.log('❌ [PRESUPUESTOS] Concepto inválido:', concepto);
        } else if (concepto.trim().length > 255) {
            errores.push('El concepto no puede exceder 255 caracteres');
            console.log('❌ [PRESUPUESTOS] Concepto muy largo:', concepto.length);
        }
    }
    
    // Validar monto si está presente
    if (monto !== undefined) {
        if (isNaN(parseFloat(monto))) {
            errores.push('El monto debe ser un número válido');
            console.log('❌ [PRESUPUESTOS] Monto no numérico:', monto);
        } else if (parseFloat(monto) < 0) {
            errores.push('El monto no puede ser negativo');
            console.log('❌ [PRESUPUESTOS] Monto negativo:', monto);
        }
    }
    
    // Validar categoría si está presente
    if (categoria !== undefined) {
        if (typeof categoria !== 'string') {
            errores.push('La categoría debe ser un texto válido');
            console.log('❌ [PRESUPUESTOS] Categoría inválida:', categoria);
        } else if (categoria.length > 100) {
            errores.push('La categoría no puede exceder 100 caracteres');
            console.log('❌ [PRESUPUESTOS] Categoría muy larga:', categoria.length);
        }
    }
    
    if (errores.length > 0) {
        console.log('❌ [PRESUPUESTOS] Errores de validación:', errores);
        return res.status(400).json({
            success: false,
            error: 'Datos de entrada inválidos',
            errores: errores,
            timestamp: new Date().toISOString()
        });
    }
    
    console.log('✅ [PRESUPUESTOS] Validación de actualización exitosa');
    next();
};

/**
 * Validar ID de presupuesto
 */
const validarIdPresupuesto = (req, res, next) => {
    console.log('🔍 [PRESUPUESTOS] Validando ID de presupuesto...');
    
    const { id } = req.params;
    
    if (!id) {
        console.log('❌ [PRESUPUESTOS] ID faltante');
        return res.status(400).json({
            success: false,
            error: 'ID de presupuesto requerido',
            timestamp: new Date().toISOString()
        });
    }
    
    const idNumerico = parseInt(id);
    
    if (isNaN(idNumerico) || idNumerico <= 0) {
        console.log('❌ [PRESUPUESTOS] ID inválido:', id);
        return res.status(400).json({
            success: false,
            error: 'ID de presupuesto debe ser un número entero positivo',
            timestamp: new Date().toISOString()
        });
    }
    
    console.log(`✅ [PRESUPUESTOS] ID válido: ${idNumerico}`);
    req.params.id = idNumerico; // Normalizar a número
    next();
};

/**
 * Validar parámetros de filtrado
 */
const validarFiltros = (req, res, next) => {
    console.log('🔍 [PRESUPUESTOS] Validando filtros de consulta...');
    
    const {
        limit,
        offset,
        monto_min,
        monto_max,
        fecha_desde,
        fecha_hasta,
        order_by,
        order_dir
    } = req.query;
    
    const errores = [];
    
    // Validar limit
    if (limit !== undefined) {
        const limitNum = parseInt(limit);
        if (isNaN(limitNum) || limitNum <= 0 || limitNum > 1000) {
            errores.push('El límite debe ser un número entre 1 y 1000');
            console.log('❌ [PRESUPUESTOS] Límite inválido:', limit);
        }
    }
    
    // Validar offset
    if (offset !== undefined) {
        const offsetNum = parseInt(offset);
        if (isNaN(offsetNum) || offsetNum < 0) {
            errores.push('El offset debe ser un número mayor o igual a 0');
            console.log('❌ [PRESUPUESTOS] Offset inválido:', offset);
        }
    }
    
    // Validar montos
    if (monto_min !== undefined) {
        const montoMinNum = parseFloat(monto_min);
        if (isNaN(montoMinNum)) {
            errores.push('El monto mínimo debe ser un número válido');
            console.log('❌ [PRESUPUESTOS] Monto mínimo inválido:', monto_min);
        }
    }
    
    if (monto_max !== undefined) {
        const montoMaxNum = parseFloat(monto_max);
        if (isNaN(montoMaxNum)) {
            errores.push('El monto máximo debe ser un número válido');
            console.log('❌ [PRESUPUESTOS] Monto máximo inválido:', monto_max);
        }
    }
    
    // Validar fechas
    if (fecha_desde !== undefined) {
        const fechaDesde = new Date(fecha_desde);
        if (isNaN(fechaDesde.getTime())) {
            errores.push('La fecha desde debe ser una fecha válida (YYYY-MM-DD)');
            console.log('❌ [PRESUPUESTOS] Fecha desde inválida:', fecha_desde);
        }
    }
    
    if (fecha_hasta !== undefined) {
        const fechaHasta = new Date(fecha_hasta);
        if (isNaN(fechaHasta.getTime())) {
            errores.push('La fecha hasta debe ser una fecha válida (YYYY-MM-DD)');
            console.log('❌ [PRESUPUESTOS] Fecha hasta inválida:', fecha_hasta);
        }
    }
    
    // Validar ordenamiento
    if (order_by !== undefined) {
        const validOrderFields = ['fecha_registro', 'fecha_sincronizacion', 'categoria', 'concepto', 'monto'];
        if (!validOrderFields.includes(order_by)) {
            errores.push(`El campo de ordenamiento debe ser uno de: ${validOrderFields.join(', ')}`);
            console.log('❌ [PRESUPUESTOS] Campo de ordenamiento inválido:', order_by);
        }
    }
    
    if (order_dir !== undefined) {
        if (!['ASC', 'DESC', 'asc', 'desc'].includes(order_dir)) {
            errores.push('La dirección de ordenamiento debe ser ASC o DESC');
            console.log('❌ [PRESUPUESTOS] Dirección de ordenamiento inválida:', order_dir);
        }
    }
    
    if (errores.length > 0) {
        console.log('❌ [PRESUPUESTOS] Errores de validación de filtros:', errores);
        return res.status(400).json({
            success: false,
            error: 'Parámetros de filtrado inválidos',
            errores: errores,
            timestamp: new Date().toISOString()
        });
    }
    
    console.log('✅ [PRESUPUESTOS] Validación de filtros exitosa');
    next();
};

/**
 * Validar parámetros de resumen
 */
const validarResumen = (req, res, next) => {
    console.log('🔍 [PRESUPUESTOS] Validando parámetros de resumen...');
    
    const { tipo, fecha_desde, fecha_hasta } = req.query;
    const errores = [];
    
    // Validar tipo de resumen
    if (tipo && !['categoria', 'fecha'].includes(tipo)) {
        errores.push('El tipo de resumen debe ser "categoria" o "fecha"');
        console.log('❌ [PRESUPUESTOS] Tipo de resumen inválido:', tipo);
    }
    
    // Validar fechas si están presentes
    if (fecha_desde !== undefined) {
        const fechaDesde = new Date(fecha_desde);
        if (isNaN(fechaDesde.getTime())) {
            errores.push('La fecha desde debe ser una fecha válida (YYYY-MM-DD)');
            console.log('❌ [PRESUPUESTOS] Fecha desde inválida:', fecha_desde);
        }
    }
    
    if (fecha_hasta !== undefined) {
        const fechaHasta = new Date(fecha_hasta);
        if (isNaN(fechaHasta.getTime())) {
            errores.push('La fecha hasta debe ser una fecha válida (YYYY-MM-DD)');
            console.log('❌ [PRESUPUESTOS] Fecha hasta inválida:', fecha_hasta);
        }
    }
    
    // Validar que fecha_desde sea anterior a fecha_hasta
    if (fecha_desde && fecha_hasta) {
        const fechaDesde = new Date(fecha_desde);
        const fechaHasta = new Date(fecha_hasta);
        
        if (fechaDesde > fechaHasta) {
            errores.push('La fecha desde debe ser anterior a la fecha hasta');
            console.log('❌ [PRESUPUESTOS] Rango de fechas inválido:', { fecha_desde, fecha_hasta });
        }
    }
    
    if (errores.length > 0) {
        console.log('❌ [PRESUPUESTOS] Errores de validación de resumen:', errores);
        return res.status(400).json({
            success: false,
            error: 'Parámetros de resumen inválidos',
            errores: errores,
            timestamp: new Date().toISOString()
        });
    }
    
    console.log('✅ [PRESUPUESTOS] Validación de resumen exitosa');
    next();
};

/**
 * Sanitizar datos de entrada
 */
const sanitizarDatos = (req, res, next) => {
    console.log('🔍 [PRESUPUESTOS] Sanitizando datos de entrada...');
    
    // Sanitizar body
    if (req.body) {
        if (req.body.concepto && typeof req.body.concepto === 'string') {
            req.body.concepto = req.body.concepto.trim();
        }
        
        if (req.body.categoria && typeof req.body.categoria === 'string') {
            req.body.categoria = req.body.categoria.trim();
        }
        
        if (req.body.sheet_name && typeof req.body.sheet_name === 'string') {
            req.body.sheet_name = req.body.sheet_name.trim();
        }
        
        if (req.body.monto !== undefined) {
            req.body.monto = parseFloat(req.body.monto);
        }
    }
    
    // Sanitizar query params
    if (req.query) {
        if (req.query.categoria && typeof req.query.categoria === 'string') {
            req.query.categoria = req.query.categoria.trim();
        }
        
        if (req.query.concepto && typeof req.query.concepto === 'string') {
            req.query.concepto = req.query.concepto.trim();
        }
        
        if (req.query.limit) {
            req.query.limit = parseInt(req.query.limit) || 100;
        }
        
        if (req.query.offset) {
            req.query.offset = parseInt(req.query.offset) || 0;
        }
    }
    
    console.log('✅ [PRESUPUESTOS] Datos sanitizados');
    next();
};

console.log('✅ [PRESUPUESTOS] Middleware de validación configurado');

module.exports = {
    validarCrearPresupuesto,
    validarActualizarPresupuesto,
    validarIdPresupuesto,
    validarFiltros,
    validarResumen,
    sanitizarDatos
};
