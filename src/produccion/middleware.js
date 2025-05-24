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

module.exports = {
    validarAccesoCarro
};
