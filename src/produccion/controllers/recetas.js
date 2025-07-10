const pool = require('../config/database');

/**
 * Busca un ingrediente por nombre y retorna su ID
 * @param {string} nombre - Nombre del ingrediente a buscar
 * @returns {Promise<number|null>} ID del ingrediente o null si no se encuentra
 */
async function buscarIngredientePorNombre(nombre) {
    try {
        const query = `
            SELECT id 
            FROM ingredientes 
            WHERE LOWER(nombre) = LOWER($1)
        `;
        const result = await pool.query(query, [nombre]);
        return result.rows[0]?.id || null;
    } catch (error) {
        console.error(`Error buscando ingrediente por nombre ${nombre}:`, error);
        return null;
    }
}

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

/**
 * Valida la integridad de las recetas para una lista de artículos
 * Verifica que todos los ingredientes referenciados en las recetas existan en la tabla ingredientes
 * @param {Array<string>} articulos - Lista de números de artículos
 * @returns {Promise<Object>} Objeto con el estado de integridad por artículo
 */
async function validarIntegridadRecetas(req, res) {
    try {
        const { articulos } = req.body;

        if (!Array.isArray(articulos) || articulos.length === 0) {
            return res.status(400).json({ 
                error: 'Debe proporcionar una lista de artículos' 
            });
        }

        // Consulta para verificar la integridad de las recetas
        const query = `
            SELECT 
                r.articulo_numero,
                COUNT(ri.id) as total_ingredientes,
                COUNT(i.id) as ingredientes_validos,
                CASE 
                    WHEN COUNT(ri.id) = COUNT(i.id) THEN true 
                    ELSE false 
                END as es_integra
            FROM recetas r
            LEFT JOIN receta_ingredientes ri ON r.id = ri.receta_id
            LEFT JOIN ingredientes i ON ri.ingrediente_id = i.id
            WHERE r.articulo_numero = ANY($1)
            GROUP BY r.articulo_numero
        `;
        
        const result = await pool.query(query, [articulos]);
        
        // Crear un objeto con el estado de integridad de cada artículo
        const integridadRecetas = {};
        articulos.forEach(articulo => {
            const recetaData = result.rows.find(row => row.articulo_numero === articulo);
            integridadRecetas[articulo] = recetaData ? recetaData.es_integra : true; // Si no tiene receta, se considera íntegra
        });

        console.log('Integridad de recetas:', integridadRecetas);
        res.json(integridadRecetas);

    } catch (error) {
        console.error('Error al validar integridad de recetas:', error);
        res.status(500).json({ error: 'Error al validar integridad de recetas' });
    }
}

// Controlador para guardar una nueva receta
async function crearReceta(req, res) {
    const client = await pool.connect();
    
    try {
        console.log('📥 crearReceta - Body recibido:', req.body);
        const { articulo_numero, descripcion, ingredientes, articulos, esProduccionExternaConArticuloPrincipal } = req.body;

        console.log('📋 esProduccionExternaConArticuloPrincipal:', esProduccionExternaConArticuloPrincipal);

        // Validaciones
        if (!articulo_numero) {
            return res.status(400).json({ error: 'El número de artículo es requerido' });
        }

        // Validar que haya al menos ingredientes O artículos (excepto para producción externa con artículo principal)
        const tieneIngredientes = Array.isArray(ingredientes) && ingredientes.length > 0;
        const tieneArticulos = Array.isArray(articulos) && articulos.length > 0;

        if (!tieneIngredientes && !tieneArticulos && !esProduccionExternaConArticuloPrincipal) {
            return res.status(400).json({ error: 'Debe incluir al menos un ingrediente o artículo, excepto para producción externa con artículo principal' });
        }

        // Validar ingredientes si existen
        if (tieneIngredientes) {
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
        }

        // Validar artículos si existen
        if (tieneArticulos) {
            const articulosValidos = articulos.every(art => 
                art.articulo_numero && 
                typeof art.cantidad === 'number' && 
                art.cantidad > 0
            );

            if (!articulosValidos) {
                return res.status(400).json({ 
                    error: 'Todos los artículos deben tener número de artículo y cantidad válida' 
                });
            }
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

        // Insertar los ingredientes si existen
        if (tieneIngredientes) {
            const ingredientesQuery = `
                INSERT INTO receta_ingredientes 
                (receta_id, ingrediente_id, nombre_ingrediente, unidad_medida, cantidad)
                VALUES ($1, $2, $3, $4, $5)
            `;

            for (const ing of ingredientes) {
                // Usar el ingrediente_id que viene del frontend si está disponible
                let ingredienteId = ing.ingrediente_id;
                
                // Si no viene el ID, buscar por nombre como fallback
                if (!ingredienteId) {
                    ingredienteId = await buscarIngredientePorNombre(ing.nombre_ingrediente);
                }

                // Normalizar el nombre del ingrediente eliminando espacios extras
                const nombreNormalizado = ing.nombre_ingrediente.trim();
                
                await client.query(ingredientesQuery, [
                    recetaId,
                    ingredienteId,
                    nombreNormalizado,
                    ing.unidad_medida,
                    ing.cantidad
                ]);
            }
        }

        // Insertar los artículos si existen
        if (tieneArticulos) {
            const articulosQuery = `
                INSERT INTO receta_articulos 
                (receta_id, articulo_numero, cantidad)
                VALUES ($1, $2, $3)
            `;

            for (const art of articulos) {
                await client.query(articulosQuery, [
                    recetaId,
                    art.articulo_numero,
                    art.cantidad
                ]);
            }
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
        
        // Manejar específicamente el error de clave duplicada
        if (error.code === '23505' && error.constraint === 'recetas_articulo_numero_key') {
            return res.status(400).json({ 
                error: 'Ya existe una receta para este artículo. Por favor edítela en lugar de crear una nueva.'
            });
        }
        
        // Para cualquier otro error, mantener el status 500
        res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
        client.release();
    }
}

/**
 * Obtiene una receta específica por número de artículo
 */
async function obtenerReceta(numero_articulo) {
    const client = await pool.connect();
    
    try {
        // Obtener la receta base
        const recetaBaseQuery = `
            SELECT id, articulo_numero, descripcion, fecha_creacion
            FROM recetas
            WHERE articulo_numero = $1
        `;
        
        const recetaResult = await client.query(recetaBaseQuery, [numero_articulo]);
        
        if (recetaResult.rows.length === 0) {
            throw new Error('Receta no encontrada');
        }

        const recetaBase = recetaResult.rows[0];

        // Obtener ingredientes de la receta
        const ingredientesQuery = `
            SELECT nombre_ingrediente, unidad_medida, cantidad
            FROM receta_ingredientes
            WHERE receta_id = $1
            ORDER BY id
        `;
        
        const ingredientesResult = await client.query(ingredientesQuery, [recetaBase.id]);

        // Obtener artículos de la receta
        const articulosQuery = `
            SELECT ra.articulo_numero, ra.cantidad, a.nombre as descripcion
            FROM receta_articulos ra
            LEFT JOIN articulos a ON a.numero = ra.articulo_numero
            WHERE ra.receta_id = $1
            ORDER BY ra.id
        `;
        
        const articulosResult = await client.query(articulosQuery, [recetaBase.id]);

        // Estructurar la respuesta
        const receta = {
            articulo_numero: recetaBase.articulo_numero,
            descripcion: recetaBase.descripcion,
            fecha_creacion: recetaBase.fecha_creacion,
            ingredientes: ingredientesResult.rows.map(row => ({
                nombre_ingrediente: row.nombre_ingrediente,
                unidad_medida: row.unidad_medida,
                cantidad: row.cantidad
            })),
            articulos: articulosResult.rows.map(row => ({
                articulo_numero: row.articulo_numero,
                cantidad: row.cantidad,
                descripcion: row.descripcion
            }))
        };

        return receta;

    } finally {
        client.release();
    }
}

// Controlador para actualizar una receta existente
async function actualizarReceta(req, res) {
    const client = await pool.connect();
    
    try {
        console.log('📥 actualizarReceta - Body recibido:', req.body);
        const { numero_articulo } = req.params;
        const { descripcion, ingredientes, articulos, esProduccionExternaConArticuloPrincipal } = req.body;

        console.log('📋 esProduccionExternaConArticuloPrincipal:', esProduccionExternaConArticuloPrincipal);

        // Validar que haya al menos ingredientes O artículos (excepto para producción externa con artículo principal)
        const tieneIngredientes = Array.isArray(ingredientes) && ingredientes.length > 0;
        const tieneArticulos = Array.isArray(articulos) && articulos.length > 0;

        if (!tieneIngredientes && !tieneArticulos && !esProduccionExternaConArticuloPrincipal) {
            return res.status(400).json({ error: 'Debe incluir al menos un ingrediente o artículo, excepto para producción externa con artículo principal' });
        }

        // Validar ingredientes si existen
        if (tieneIngredientes) {
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
        }

        // Validar artículos si existen
        if (tieneArticulos) {
            const articulosValidos = articulos.every(art => 
                art.articulo_numero && 
                typeof art.cantidad === 'number' && 
                art.cantidad > 0
            );

            if (!articulosValidos) {
                return res.status(400).json({ 
                    error: 'Todos los artículos deben tener número de artículo y cantidad válida' 
                });
            }
        }

        // Iniciar transacción
        await client.query('BEGIN');

        // Verificar si la receta existe
        const recetaQuery = `
            SELECT id FROM recetas 
            WHERE articulo_numero = $1
        `;
        const recetaResult = await client.query(recetaQuery, [numero_articulo]);
        
        if (recetaResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Receta no encontrada' });
        }

        const recetaId = recetaResult.rows[0].id;

        // Eliminar ingredientes y artículos actuales
        await client.query('DELETE FROM receta_ingredientes WHERE receta_id = $1', [recetaId]);
        await client.query('DELETE FROM receta_articulos WHERE receta_id = $1', [recetaId]);

        // Actualizar descripción
        await client.query('UPDATE recetas SET descripcion = $1 WHERE id = $2', [descripcion, recetaId]);

        // Insertar nuevos ingredientes si existen
        if (tieneIngredientes) {
            const ingredientesQuery = `
                INSERT INTO receta_ingredientes 
                (receta_id, ingrediente_id, nombre_ingrediente, unidad_medida, cantidad)
                VALUES ($1, $2, $3, $4, $5)
            `;

            for (const ing of ingredientes) {
                // Usar el ingrediente_id que viene del frontend si está disponible
                let ingredienteId = ing.ingrediente_id;
                
                // Si no viene el ID, buscar por nombre como fallback
                if (!ingredienteId) {
                    ingredienteId = await buscarIngredientePorNombre(ing.nombre_ingrediente);
                }

                // Normalizar el nombre del ingrediente eliminando espacios extras
                const nombreNormalizado = ing.nombre_ingrediente.trim();
                
                await client.query(ingredientesQuery, [
                    recetaId,
                    ingredienteId,
                    nombreNormalizado,
                    ing.unidad_medida,
                    ing.cantidad
                ]);
            }
        }

        // Insertar nuevos artículos si existen
        if (tieneArticulos) {
            const articulosQuery = `
                INSERT INTO receta_articulos 
                (receta_id, articulo_numero, cantidad)
                VALUES ($1, $2, $3)
            `;

            for (const art of articulos) {
                await client.query(articulosQuery, [
                    recetaId,
                    art.articulo_numero,
                    art.cantidad
                ]);
            }
        }

        // Confirmar transacción
        await client.query('COMMIT');

        res.json({
            message: 'Receta actualizada exitosamente'
        });

    } catch (error) {
        // Revertir transacción en caso de error
        await client.query('ROLLBACK');
        console.error('Error al actualizar receta:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
        client.release();
    }
}

/**
 * Expande recursivamente los ingredientes de un artículo, consolidando cantidades
 * @param {string} numeroArticulo - Número del artículo a expandir
 * @param {number} cantidadBase - Cantidad base para multiplicar (por defecto 1)
 * @param {Set} procesados - Set de artículos ya procesados para evitar ciclos
 * @returns {Promise<Array>} Lista de ingredientes expandidos con cantidades
 */
async function expandirIngredientes(numeroArticulo, cantidadBase = 1, procesados = new Set()) {
    // Evitar ciclos infinitos
    if (procesados.has(numeroArticulo)) {
        return [];
    }
    procesados.add(numeroArticulo);

    try {
        const receta = await obtenerReceta(numeroArticulo);
        let ingredientesExpandidos = [];

        for (const ingrediente of receta.ingredientes) {
            const cantidadTotal = ingrediente.cantidad * cantidadBase;

            try {
                // Verificar si el ingrediente es un mix (tiene su propia receta)
                const subReceta = await obtenerReceta(ingrediente.nombre_ingrediente);
                
                // Si es un mix, expandir recursivamente
                const subIngredientes = await expandirIngredientes(
                    ingrediente.nombre_ingrediente,
                    cantidadTotal,
                    procesados
                );
                ingredientesExpandidos = ingredientesExpandidos.concat(subIngredientes);
            } catch (error) {
                // Si no es un mix, agregar como ingrediente base
                ingredientesExpandidos.push({
                    nombre: ingrediente.nombre_ingrediente,
                    cantidad: cantidadTotal,
                    unidad_medida: ingrediente.unidad_medida
                });
            }
        }

        // Consolidar ingredientes duplicados sumando cantidades
        const consolidados = {};
        ingredientesExpandidos.forEach(ing => {
            const key = `${ing.nombre}-${ing.unidad_medida}`;
            if (consolidados[key]) {
                consolidados[key].cantidad += ing.cantidad;
            } else {
                consolidados[key] = { ...ing };
            }
        });

        return Object.values(consolidados);
    } catch (error) {
        console.error(`Error expandiendo ingredientes para ${numeroArticulo}:`, error);
        return [];
    }
}

/**
 * Obtiene los ingredientes expandidos de un artículo
 */
async function obtenerIngredientesExpandidos(req, res) {
    try {
        const { numero_articulo } = req.params;
        const ingredientes = await expandirIngredientes(numero_articulo);
        
        if (ingredientes.length === 0) {
            return res.status(404).json({ 
                error: 'No se encontraron ingredientes para este artículo' 
            });
        }

        res.json(ingredientes);
    } catch (error) {
        console.error('Error al obtener ingredientes expandidos:', error);
        res.status(500).json({ 
            error: 'Error al procesar los ingredientes expandidos' 
        });
    }
}

/**
 * Elimina una receta y todos sus ingredientes asociados
 */
async function eliminarReceta(req, res) {
    const client = await pool.connect();
    
    try {
        const { numero_articulo } = req.params;

        if (!numero_articulo) {
            return res.status(400).json({ error: 'El número de artículo es requerido' });
        }

        // Iniciar transacción
        await client.query('BEGIN');

        // Verificar si la receta existe
        const recetaQuery = `
            SELECT id FROM recetas 
            WHERE articulo_numero = $1
        `;
        const recetaResult = await client.query(recetaQuery, [numero_articulo]);
        
        if (recetaResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Receta no encontrada' });
        }

        const recetaId = recetaResult.rows[0].id;

        // Eliminar ingredientes y artículos de la receta
        await client.query('DELETE FROM receta_ingredientes WHERE receta_id = $1', [recetaId]);
        await client.query('DELETE FROM receta_articulos WHERE receta_id = $1', [recetaId]);

        // Eliminar la receta
        await client.query('DELETE FROM recetas WHERE id = $1', [recetaId]);

        // Confirmar transacción
        await client.query('COMMIT');

        res.json({
            message: 'Receta eliminada exitosamente'
        });

    } catch (error) {
        // Revertir transacción en caso de error
        await client.query('ROLLBACK');
        console.error('Error al eliminar receta:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
        client.release();
    }
}

module.exports = {
    crearReceta,
    obtenerEstadoRecetas,
    validarIntegridadRecetas,
    obtenerReceta,
    actualizarReceta,
    obtenerIngredientesExpandidos,
    eliminarReceta
};
