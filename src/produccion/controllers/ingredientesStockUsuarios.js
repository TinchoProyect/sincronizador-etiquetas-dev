const pool = require('../../usuarios/pool');

/**
 * Registra un movimiento de stock de usuario siguiendo lógica FIFO
 * @param {Object} params - Parámetros del movimiento
 * @param {number} params.usuario_id - ID del usuario
 * @param {number} params.ingrediente_id - ID del ingrediente
 * @param {number} params.cantidad - Cantidad a descontar (debe ser negativa)
 * @param {number} params.carro_id - ID del carro que genera el movimiento
 * @param {Object} db - Conexión a la base de datos para transacciones
 */
async function registrarMovimientoStockUsuarioFIFO(params, db) {
    const { usuario_id, ingrediente_id, cantidad, carro_id } = params;
    
    if (cantidad >= 0) {
        throw new Error('La cantidad debe ser negativa para consumo FIFO');
    }

    // Obtener registros ordenados por fecha (FIFO)
    const queryStock = `
        SELECT id, cantidad
        FROM ingredientes_stock_usuarios
        WHERE usuario_id = $1 
        AND ingrediente_id = $2
        AND cantidad > 0
        ORDER BY fecha_registro ASC
    `;
    
    const stockResult = await db.query(queryStock, [usuario_id, ingrediente_id]);
    
    let cantidadRestante = Math.abs(cantidad); // Convertir a positivo para los cálculos
    let stockDisponible = stockResult.rows.reduce((sum, row) => sum + row.cantidad, 0);

    if (stockDisponible < cantidadRestante) {
        throw new Error(`Stock insuficiente para ingrediente ${ingrediente_id}. Disponible: ${stockDisponible}, Requerido: ${cantidadRestante}`);
    }

    // Procesar registros FIFO
    for (const registro of stockResult.rows) {
        if (cantidadRestante <= 0) break;

        const cantidadADescontar = Math.min(registro.cantidad, cantidadRestante);
        const nuevaCantidad = registro.cantidad - cantidadADescontar;

        // Actualizar o eliminar el registro según corresponda
        if (nuevaCantidad > 0) {
            await db.query(
                'UPDATE ingredientes_stock_usuarios SET cantidad = $1 WHERE id = $2',
                [nuevaCantidad, registro.id]
            );
        } else {
            await db.query(
                'DELETE FROM ingredientes_stock_usuarios WHERE id = $1',
                [registro.id]
            );
        }

        // Registrar el movimiento negativo
        await db.query(`
            INSERT INTO ingredientes_stock_usuarios 
            (ingrediente_id, usuario_id, cantidad, origen_carro_id, fecha_registro)
            VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
        `, [
            ingrediente_id,
            usuario_id,
            -cantidadADescontar,
            carro_id
        ]);

        cantidadRestante -= cantidadADescontar;
    }
}

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
    agregarStockUsuario,
    registrarMovimientoStockUsuarioFIFO
};
