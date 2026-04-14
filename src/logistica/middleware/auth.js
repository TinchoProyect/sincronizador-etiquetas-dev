/**
 * Middleware de Autenticación y Autorización
 * Módulo de Logística
 */

/**
 * Valida que el usuario tenga el permiso especificado
 * Por ahora es un placeholder - se integrará con el sistema de usuarios existente
 */
function validatePermissions(permiso) {
    return (req, res, next) => {
        // TODO: Integrar con sistema de autenticación real
        // Por ahora, permitir todas las operaciones en desarrollo
        
        console.log(`[AUTH] Validando permiso: ${permiso}`);
        
        // Simular usuario autenticado para desarrollo
        if (!req.user) {
            req.user = {
                id: 1,
                nombre: 'Usuario de Desarrollo',
                permisos: ['*'] // Todos los permisos en desarrollo
            };
        }
        
        // Validar permiso
        if (req.user.permisos.includes('*') || req.user.permisos.includes(permiso)) {
            next();
        } else {
            res.status(403).json({
                success: false,
                error: 'No tienes permisos para realizar esta acción',
                permiso_requerido: permiso
            });
        }
    };
}

/**
 * Middleware para validar sesión
 * Por ahora es un placeholder
 */
function validateSession(req, res, next) {
    // TODO: Integrar con sistema de sesiones real
    console.log('[AUTH] Validando sesión');
    
    // Simular sesión válida en desarrollo
    req.user = {
        id: 1,
        nombre: 'Usuario de Desarrollo',
        permisos: ['*']
    };
    
    next();
}

/**
 * Middleware para verificar token móvil de chofer (sin DB)
 */
function verificarTokenChofer(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'Token no proporcionado' });
    }
    const token = authHeader.substring(7);
    try {
        const decoded = Buffer.from(token, 'base64').toString('utf-8');
        const choferId = parseInt(decoded.split(':')[0]);
        if (isNaN(choferId)) throw new Error("ID inválido");
        req.choferId = choferId;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, error: 'Token inválido' });
    }
}

module.exports = {
    validatePermissions,
    validateSession,
    verificarTokenChofer
};
