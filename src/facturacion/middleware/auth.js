/**
 * Middleware de autenticación y logging
 */

console.log('🔍 [FACTURACION-AUTH] Cargando middleware de autenticación...');

/**
 * Middleware de logging de requests
 */
const requestLogger = (req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`📥 [FACTURACION-REQUEST] ${timestamp} ${req.method} ${req.originalUrl}`);
    
    if (req.body && Object.keys(req.body).length > 0) {
        console.log(`📊 [FACTURACION-REQUEST] Body:`, JSON.stringify(req.body, null, 2));
    }
    
    if (req.query && Object.keys(req.query).length > 0) {
        console.log(`📊 [FACTURACION-REQUEST] Query:`, JSON.stringify(req.query, null, 2));
    }
    
    next();
};

/**
 * Middleware de autenticación (STUB)
 * En producción, validar JWT o sesión
 */
const authenticate = (req, res, next) => {
    console.log('🔐 [FACTURACION-AUTH] Verificando autenticación...');
    
    // STUB: Por ahora, permitir todas las requests
    console.log('⚠️ [FACTURACION-AUTH] STUB: Autenticación deshabilitada en desarrollo');
    
    // En producción, descomentar y validar:
    /*
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        console.error('❌ [FACTURACION-AUTH] Token no proporcionado');
        return res.status(401).json({
            success: false,
            error: 'No autorizado',
            message: 'Token de autenticación requerido'
        });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        console.log('✅ [FACTURACION-AUTH] Usuario autenticado:', decoded.id);
    } catch (error) {
        console.error('❌ [FACTURACION-AUTH] Token inválido:', error.message);
        return res.status(401).json({
            success: false,
            error: 'No autorizado',
            message: 'Token inválido o expirado'
        });
    }
    */
    
    next();
};

/**
 * Middleware de autorización por permisos (STUB)
 */
const authorize = (...permisos) => {
    return (req, res, next) => {
        console.log('🔐 [FACTURACION-AUTH] Verificando permisos:', permisos);
        
        // STUB: Por ahora, permitir todas las requests
        console.log('⚠️ [FACTURACION-AUTH] STUB: Autorización deshabilitada en desarrollo');
        
        // En producción, descomentar y validar:
        /*
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'No autorizado',
                message: 'Usuario no autenticado'
            });
        }
        
        const tienePermiso = permisos.some(permiso => 
            req.user.permisos?.includes(permiso)
        );
        
        if (!tienePermiso) {
            console.error('❌ [FACTURACION-AUTH] Permisos insuficientes');
            return res.status(403).json({
                success: false,
                error: 'Prohibido',
                message: 'No tiene permisos para realizar esta acción'
            });
        }
        
        console.log('✅ [FACTURACION-AUTH] Permisos verificados');
        */
        
        next();
    };
};

/**
 * Middleware de manejo de errores
 */
const errorHandler = (err, req, res, next) => {
    console.error('❌ [FACTURACION-ERROR] Error capturado:', err.message);
    console.error('❌ [FACTURACION-ERROR] Stack:', err.stack);
    
    // Determinar código de estado
    let statusCode = err.statusCode || 500;
    
    // Errores de validación
    if (err.name === 'ValidationError') {
        statusCode = 400;
    }
    
    // Errores de base de datos
    if (err.code === '23505') { // Unique violation
        statusCode = 409;
    }
    
    if (err.code === '23503') { // Foreign key violation
        statusCode = 400;
    }
    
    res.status(statusCode).json({
        success: false,
        error: err.message || 'Error interno del servidor',
        code: err.code,
        timestamp: new Date().toISOString(),
        path: req.originalUrl
    });
};

/**
 * Middleware para capturar errores asíncronos
 */
const asyncHandler = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};

console.log('✅ [FACTURACION-AUTH] Middleware de autenticación cargado');

module.exports = {
    requestLogger,
    authenticate,
    authorize,
    errorHandler,
    asyncHandler
};
