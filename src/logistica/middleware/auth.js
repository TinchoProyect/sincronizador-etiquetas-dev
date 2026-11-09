/**
 * Middleware de Autenticación y Autorización
 * Módulo de Logística
 */

const { verificarTokenOExtraerUsuario } = require('../../shared/lamdaCloudAuthGuard');

/**
 * Extrae el ID numérico del chofer desde req.lamdaUser, JWT Cloud o token base64(id:timestamp)
 */
function extraerChoferIdDeRequest(req) {
    if (req.lamdaUser && Number.isInteger(Number(req.lamdaUser.id)) && Number(req.lamdaUser.id) > 0) {
        return Number(req.lamdaUser.id);
    }

    const authHeader = req.headers.authorization || req.headers['x-access-token'] || req.headers['x-chofer-token'];
    if (!authHeader) return null;

    const userExtraido = verificarTokenOExtraerUsuario(authHeader);
    if (userExtraido && Number.isInteger(Number(userExtraido.id)) && Number(userExtraido.id) > 0) {
        return Number(userExtraido.id);
    }

    try {
        const rawToken = String(authHeader).startsWith('Bearer ')
            ? String(authHeader).substring(7).trim()
            : String(authHeader).trim();
        const decoded = Buffer.from(rawToken, 'base64').toString('utf-8');
        const choferId = parseInt(decoded.split(':')[0], 10);
        if (Number.isInteger(choferId) && choferId > 0) {
            return choferId;
        }
    } catch (_) {}

    return null;
}

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
    const choferId = extraerChoferIdDeRequest(req);
    if (!choferId) {
        const tieneHeader = Boolean(req.headers.authorization || req.headers['x-access-token'] || req.headers['x-chofer-token']);
        return res.status(401).json({
            success: false,
            error: tieneHeader ? 'Token inválido' : 'Token no proporcionado'
        });
    }
    req.choferId = choferId;
    next();
}

module.exports = {
    validatePermissions,
    validateSession,
    verificarTokenChofer,
    extraerChoferIdDeRequest
};
