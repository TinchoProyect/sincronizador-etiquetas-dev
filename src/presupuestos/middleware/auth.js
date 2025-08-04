console.log('🔍 [PRESUPUESTOS] Cargando middleware de autenticación...');

/**
 * Middleware básico de autenticación para el módulo de presupuestos
 * Integra con el sistema de usuarios existente del proyecto LAMDA
 */

// Middleware para logging de requests
const requestLogger = (req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`🔍 [PRESUPUESTOS] ${timestamp} - ${req.method} ${req.originalUrl}`);
    
    // Log del body si existe (para debugging)
    if (req.body && Object.keys(req.body).length > 0) {
        console.log('📥 [PRESUPUESTOS] Request body:', JSON.stringify(req.body, null, 2));
    }
    
    next();
};

// Middleware para validar sesión básica (placeholder para futura integración)
const validateSession = (req, res, next) => {
    // TODO: Integrar con sistema de autenticación existente
    console.log('🔐 [PRESUPUESTOS] Validando sesión de usuario...');
    
    // Por ahora, permitir todas las requests (desarrollo)
    // En producción, aquí se validaría la sesión del usuario
    req.user = {
        id: 1,
        nombre: 'Usuario Sistema',
        rol: 'admin'
    };
    
    console.log('✅ [PRESUPUESTOS] Usuario autenticado:', req.user.nombre);
    next();
};

// Middleware para validar permisos específicos del módulo
const validatePermissions = (requiredPermission) => {
    return (req, res, next) => {
        console.log(`🔒 [PRESUPUESTOS] Validando permiso: ${requiredPermission}`);
        
        // TODO: Implementar validación real de permisos
        // Por ahora, permitir todos los permisos (desarrollo)
        console.log('✅ [PRESUPUESTOS] Permiso concedido');
        next();
    };
};

// Middleware para manejo de errores específico del módulo
const errorHandler = (err, req, res, next) => {
    console.error('❌ [PRESUPUESTOS] Error en middleware:', err.message);
    console.error('❌ [PRESUPUESTOS] Stack trace:', err.stack);
    
    // Respuesta de error estructurada
    const errorResponse = {
        error: 'Error interno del módulo de presupuestos',
        message: err.message,
        timestamp: new Date().toISOString(),
        path: req.originalUrl
    };
    
    // En desarrollo, incluir stack trace
    if (process.env.NODE_ENV === 'development') {
        errorResponse.stack = err.stack;
    }
    
    res.status(500).json(errorResponse);
};

console.log('✅ [PRESUPUESTOS] Middleware de autenticación configurado');

module.exports = {
    requestLogger,
    validateSession,
    validatePermissions,
    errorHandler
};
