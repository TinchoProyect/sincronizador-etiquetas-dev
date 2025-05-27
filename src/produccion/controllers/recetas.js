const pool = require('../config/database');

/**
 * Obtiene el estado de las recetas para una lista de artículos
 * @param {Array<string>} articulos - Lista de números de artículos
 * @returns {Promise<Object>} Objeto con el estado de recetas por artículo
 */
async function obtenerEstadoRecetas(req, res) {
    try {
        const { articulos } = req.body;

        if (!Array.isArray(articulos) || articulos.length === 0) {
            return res.status(400).json({ 
                error: 'Debe proporcionar una lista de artículos' 
            });
        }

        // Consultar qué artículos tienen recetas
        const query = `
            SELECT DISTINCT articulo_numero 
            FROM recetas 
            WHERE articulo_numero = ANY($1)
        `;
        
        const result = await pool.query(query, [articulos]);
        
        // Crear un objeto con el estado de cada artículo
        const estadoRecetas = {};
        articulos.forEach(articulo => {
            estadoRecetas[articulo] = result.rows.some(row => row.articulo_numero === articulo);
        });

        console.log('Estado de recetas:', estadoRecetas);
        res.json(estadoRecetas);

    } catch (error) {
        console.error('Error al obtener estado de recetas:', error);
        res.status(500).json({ error: 'Error al obtener estado de recetas' });
    }
}

// Controlador para guardar una nueva receta
async function crearReceta(req, res) {
    const client = await pool.connect();
    
    try {
        const { articulo_numero, descripcion, ingredientes } = req.body;

        // Validaciones
        if (!articulo_numero) {
            return res.status(400).json({ error: 'El número de artículo es requerido' });
        }

        if (!Array.isArray(ingredientes) || ingredientes.length === 0) {
            return res.status(400).json({ error: 'Debe incluir al menos un ingrediente' });
        }

        // Validar que cada ingrediente tenga los campos requeridos
        const ingredientesValidos = ingredientes.every(ing => 
            ing.nombre_ingrediente && 
            ing.unidad_medida && 
            typeof ing.cantidad === 'number' && 
            ing.cantidad > 0
        );

        if (!ingredientesValidos) {
            return res.status(400).json({ 
                error: 'Todos los ingredientes deben tener nombre, unidad de medida y cantidad válida' 
            });
        }

        // Iniciar transacción
        await client.query('BEGIN');

        // Insertar la receta
        const recetaQuery = `
            INSERT INTO recetas (articulo_numero, descripcion, fecha_creacion)
            VALUES ($1, $2, NOW())
            RETURNING id
        `;
        const recetaResult = await client.query(recetaQuery, [articulo_numero, descripcion]);
        const recetaId = recetaResult.rows[0].id;

        // Insertar los ingredientes
        const ingredientesQuery = `
            INSERT INTO receta_ingredientes 
            (receta_id, nombre_ingrediente, unidad_medida, cantidad)
            VALUES ($1, $2, $3, $4)
        `;

        for (const ing of ingredientes) {
            await client.query(ingredientesQuery, [
                recetaId,
                ing.nombre_ingrediente,
                ing.unidad_medida,
                ing.cantidad
            ]);
        }

        // Confirmar transacción
        await client.query('COMMIT');

        res.status(201).json({
            message: 'Receta creada exitosamente',
            receta_id: recetaId
        });

    } catch (error) {
        // Revertir transacción en caso de error
        await client.query('ROLLBACK');
        console.error('Error al crear receta:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
        client.release();
    }
}

module.exports = {
    crearReceta,
    obtenerEstadoRecetas
};
