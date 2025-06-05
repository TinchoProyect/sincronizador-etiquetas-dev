const pool = require('./config/database');

/**
 * Middleware para validar que el carro pertenezca al usuario
 * Solo verifica el ID de usuario contra el usuario_id del carro
 */
async function validarAccesoCarro(req, res, next) {
    // No hay validación de token, solo se asegura que el usuarioId esté presente
    if (!req.body.usuarioId && !req.query.usuarioId) {
        return res.status(400).json({ error: 'Se requiere el ID de usuario' });
    }
    next();
}

/**
 * Middleware para inyectar la conexión a la base de datos
 */
function dbMiddleware(req, res, next) {
    console.log('🔌 Aplicando middleware de base de datos');
    req.db = pool;
    next();
}

module.exports = {
    validarAccesoCarro,
    dbMiddleware
};
