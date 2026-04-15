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
                    ingrediente_id: ingrediente.ingrediente_id,
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
        const numero_articulo = req.params.numero_articulo || req.query.codigo;
        
        // 🔧 CORRECCIÓN: Verificar primero si el artículo existe en la base de datos
        const articuloQuery = `
            SELECT numero, nombre 
            FROM articulos 
            WHERE numero = $1
        `;
        const articuloResult = await pool.query(articuloQuery, [numero_articulo]);
        
        // Si el artículo no existe en absoluto, devolver 404
        if (articuloResult.rows.length === 0) {
            return res.status(404).json({ 
                error: 'Artículo no encontrado' 
            });
        }
        
        // El artículo existe, intentar expandir ingredientes
        const ingredientes = await expandirIngredientes(numero_articulo);
        
        // 🔧 CORRECCIÓN: Si el artículo existe pero no tiene ingredientes, devolver array vacío
        // Esto es válido para artículos como almendras tostadas que no se combinan con otros insumos
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

/**
 * ============================================
 * MÓDULO DE SUGERENCIAS DE PRODUCCIÓN
 * ============================================
 */

/**
 * Obtiene la sugerencia de producción configurada para un artículo
 * GET /api/produccion/recetas/:numero_articulo/sugerencia
 */
async function obtenerSugerencia(req, res) {
    const client = await pool.connect();
    
    try {
        const { numero_articulo } = req.params;
        
        console.log(`[SUGERENCIAS] Obteniendo sugerencia para artículo: ${numero_articulo}`);

        if (!numero_articulo) {
            return res.status(400).json({ 
                error: 'El número de artículo es requerido' 
            });
        }

        // Consultar la sugerencia actual
        const query = `
            SELECT 
                r.articulo_numero,
                r.articulo_sugerido_numero,
                a.nombre as articulo_sugerido_nombre,
                a.codigo_barras as articulo_sugerido_codigo_barras
            FROM recetas r
            LEFT JOIN articulos a ON a.numero = r.articulo_sugerido_numero
            WHERE r.articulo_numero = $1
        `;
        
        const result = await client.query(query, [numero_articulo]);
        
        if (result.rows.length === 0) {
            // El artículo no tiene receta registrada
            console.log(`[SUGERENCIAS] Artículo ${numero_articulo} sin receta registrada`);
            return res.status(404).json({ 
                error: 'Receta no encontrada para este artículo',
                tiene_sugerencia: false
            });
        }

        const receta = result.rows[0];
        const tieneSugerencia = receta.articulo_sugerido_numero !== null;

        console.log(`[SUGERENCIAS] Sugerencia encontrada: ${tieneSugerencia ? receta.articulo_sugerido_numero : 'ninguna'}`);

        res.json({
            articulo_numero: receta.articulo_numero,
            tiene_sugerencia: tieneSugerencia,
            sugerencia: tieneSugerencia ? {
                articulo_numero: receta.articulo_sugerido_numero,
                nombre: receta.articulo_sugerido_nombre,
                codigo_barras: receta.articulo_sugerido_codigo_barras
            } : null
        });

    } catch (error) {
        console.error('[SUGERENCIAS] Error al obtener sugerencia:', error);
        res.status(500).json({ 
            error: 'Error al obtener sugerencia de producción' 
        });
    } finally {
        client.release();
    }
}

/**
 * Guarda o actualiza la sugerencia de producción para un artículo
 * PUT /api/produccion/recetas/:numero_articulo/sugerencia
 */
async function guardarSugerencia(req, res) {
    const client = await pool.connect();
    
    try {
        const { numero_articulo } = req.params;
        const { articulo_sugerido_numero } = req.body;

        console.log(`[SUGERENCIAS] Guardando sugerencia para ${numero_articulo} → ${articulo_sugerido_numero}`);

        if (!numero_articulo) {
            return res.status(400).json({ 
                error: 'El número de artículo es requerido' 
            });
        }

        if (!articulo_sugerido_numero) {
            return res.status(400).json({ 
                error: 'El artículo sugerido es requerido' 
            });
        }

        // Verificar que el artículo sugerido existe
        const verificarArticuloQuery = `
            SELECT numero, nombre 
            FROM articulos 
            WHERE numero = $1
        `;
        const articuloResult = await client.query(verificarArticuloQuery, [articulo_sugerido_numero]);
        
        if (articuloResult.rows.length === 0) {
            return res.status(404).json({ 
                error: 'El artículo sugerido no existe en el sistema' 
            });
        }

        // Verificar que la receta existe
        const verificarRecetaQuery = `
            SELECT id 
            FROM recetas 
            WHERE articulo_numero = $1
        `;
        const recetaResult = await client.query(verificarRecetaQuery, [numero_articulo]);
        
        if (recetaResult.rows.length === 0) {
            return res.status(404).json({ 
                error: 'No existe receta para este artículo. Debe crear la receta primero.' 
            });
        }

        // Actualizar la sugerencia
        const updateQuery = `
            UPDATE recetas 
            SET articulo_sugerido_numero = $1
            WHERE articulo_numero = $2
            RETURNING articulo_numero, articulo_sugerido_numero
        `;
        
        const updateResult = await client.query(updateQuery, [articulo_sugerido_numero, numero_articulo]);

        console.log(`[SUGERENCIAS] ✅ Sugerencia guardada: ${numero_articulo} → ${articulo_sugerido_numero}`);

        res.json({
            message: 'Sugerencia guardada exitosamente',
            articulo_numero: updateResult.rows[0].articulo_numero,
            articulo_sugerido_numero: updateResult.rows[0].articulo_sugerido_numero,
            articulo_sugerido_nombre: articuloResult.rows[0].nombre
        });

    } catch (error) {
        console.error('[SUGERENCIAS] Error al guardar sugerencia:', error);
        res.status(500).json({ 
            error: 'Error al guardar sugerencia de producción' 
        });
    } finally {
        client.release();
    }
}

/**
 * Elimina la sugerencia de producción para un artículo (establece en NULL)
 * DELETE /api/produccion/recetas/:numero_articulo/sugerencia
 */
async function eliminarSugerencia(req, res) {
    const client = await pool.connect();
    
    try {
        const { numero_articulo } = req.params;

        console.log(`[SUGERENCIAS] Eliminando sugerencia para artículo: ${numero_articulo}`);

        if (!numero_articulo) {
            return res.status(400).json({ 
                error: 'El número de artículo es requerido' 
            });
        }

        // Verificar que la receta existe
        const verificarRecetaQuery = `
            SELECT id, articulo_sugerido_numero 
            FROM recetas 
            WHERE articulo_numero = $1
        `;
        const recetaResult = await client.query(verificarRecetaQuery, [numero_articulo]);
        
        if (recetaResult.rows.length === 0) {
            return res.status(404).json({ 
                error: 'No existe receta para este artículo' 
            });
        }

        const receta = recetaResult.rows[0];
        
        if (!receta.articulo_sugerido_numero) {
            console.log(`[SUGERENCIAS] Artículo ${numero_articulo} no tiene sugerencia configurada`);
            return res.json({
                message: 'El artículo no tenía sugerencia configurada',
                articulo_numero: numero_articulo
            });
        }

        // Eliminar la sugerencia (establecer en NULL)
        const deleteQuery = `
            UPDATE recetas 
            SET articulo_sugerido_numero = NULL
            WHERE articulo_numero = $1
            RETURNING articulo_numero
        `;
        
        await client.query(deleteQuery, [numero_articulo]);

        console.log(`[SUGERENCIAS] ✅ Sugerencia eliminada para: ${numero_articulo}`);

        res.json({
            message: 'Sugerencia eliminada exitosamente',
            articulo_numero: numero_articulo
        });

    } catch (error) {
        console.error('[SUGERENCIAS] Error al eliminar sugerencia:', error);
        res.status(500).json({ 
            error: 'Error al eliminar sugerencia de producción' 
        });
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
    eliminarReceta,
    // Nuevos endpoints de sugerencias
    obtenerSugerencia,
    guardarSugerencia,
    eliminarSugerencia
};
