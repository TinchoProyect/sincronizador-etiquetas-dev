const pool = require('../../usuarios/pool');

/**
 * Agrega stock de un ingrediente a un usuario específico
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
async function agregarStockUsuario(req, res) {
    try {
        const { usuario_id, ingrediente_id, cantidad, origen_carro_id } = req.body;

        // Validar datos requeridos
        if (!usuario_id || !ingrediente_id || cantidad === undefined || cantidad === null) {
            return res.status(400).json({
                error: 'Se requieren usuario_id, ingrediente_id y cantidad'
            });
        }

        // Validar que la cantidad sea un número válido
        const cantidadNumerica = parseFloat(cantidad);
        if (isNaN(cantidadNumerica)) {
            return res.status(400).json({
                error: 'La cantidad debe ser un número válido'
            });
        }

        // Insertar en la tabla ingredientes_stock_usuarios
        const query = `
            INSERT INTO ingredientes_stock_usuarios 
            (ingrediente_id, usuario_id, cantidad, origen_carro_id, fecha_registro)
            VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
            RETURNING id
        `;

        const result = await pool.query(query, [
            ingrediente_id,
            usuario_id,
            cantidadNumerica,
            origen_carro_id || null
        ]);

        console.log(`✅ Stock agregado: Usuario ${usuario_id}, Ingrediente ${ingrediente_id}, Cantidad ${cantidadNumerica}`);

        res.status(201).json({
            message: 'Stock agregado correctamente',
            id: result.rows[0].id
        });

    } catch (error) {
        console.error('Error al agregar stock de usuario:', error);
        res.status(500).json({
            error: 'Error interno del servidor al agregar stock'
        });
    }
}

module.exports = {
    agregarStockUsuario
};
