const pool = require('../config/database');

/**
 * Obtiene todas las relaciones de artículos para un carro y usuario
 * @param {number} carroId 
 * @param {number} usuarioId 
 * @returns {Promise<Array>}
 */
async function obtenerRelacionesCarro(carroId, usuarioId) {
    try {
        const query = `
            SELECT 
                aper.id, 
                aper.articulo_produccion_codigo, 
                aper.articulo_kilo_codigo, 
                COALESCE(aper.multiplicador_ingredientes, 1) as multiplicador_ingredientes,
                a.nombre as articulo_kilo_nombre,
                a.codigo_barras as articulo_kilo_codigo_barras
            FROM articulos_produccion_externa_relacion aper
            LEFT JOIN articulos a ON a.numero = aper.articulo_kilo_codigo
            WHERE aper.articulo_produccion_codigo IN (
                SELECT articulo_numero FROM carros_articulos WHERE carro_id = $1
            )
        `;
        const result = await pool.query(query, [carroId]);
        return result.rows;
    } catch (error) {
        console.error('Error al obtener relaciones de carro:', error);
        throw error;
    }
}

/**
 * Obtiene una relación por código de artículo de producción
 * @param {string} articuloCodigo
 * @returns {Promise<Object|null>}
 */
async function obtenerRelacionPorArticulo(articuloCodigo) {
    try {
        const query = `
            SELECT
                aper.id,
                aper.articulo_produccion_codigo,
                aper.articulo_kilo_codigo,
                COALESCE(aper.multiplicador_ingredientes, 1) as multiplicador_ingredientes,
                a.nombre as articulo_kilo_nombre,
                a.codigo_barras as articulo_kilo_codigo_barras
            FROM articulos_produccion_externa_relacion aper
            LEFT JOIN articulos a ON a.numero = aper.articulo_kilo_codigo
            WHERE aper.articulo_produccion_codigo = $1
            LIMIT 1
        `;
        const result = await pool.query(query, [articuloCodigo]);
        return result.rows[0] || null;
    } catch (error) {
        console.error('Error al obtener relación por artículo:', error);
        throw error;
    }
}

/**
 * Obtiene relaciones para múltiples códigos de artículos de producción
 * @param {Array<string>} articuloCodigos - Array de códigos de artículos de producción
 * @returns {Promise<Array>}
 */
async function obtenerRelacionesPorArticulos(articuloCodigos) {
    try {
        const query = `
            SELECT
                aper.id,
                aper.articulo_produccion_codigo,
                aper.articulo_kilo_codigo,
                COALESCE(aper.multiplicador_ingredientes, 1) as multiplicador_ingredientes,
                a.nombre as articulo_kilo_nombre,
                a.codigo_barras as articulo_kilo_codigo_barras
            FROM articulos_produccion_externa_relacion aper
            LEFT JOIN articulos a ON a.numero = aper.articulo_kilo_codigo
            WHERE aper.articulo_produccion_codigo = ANY($1)
        `;
        const result = await pool.query(query, [articuloCodigos]);
        return result.rows;
    } catch (error) {
        console.error('Error al obtener relaciones por artículos:', error);
        throw error;
    }
}

/**
 * Crea una nueva relación artículo_produccion -> articulo_kilo
 * @param {string} articuloProduccionCodigo 
 * @param {string} articuloKiloCodigo 
 * @param {number} multiplicadorIngredientes - Multiplicador para ingredientes (default: 1)
 * @param {Array} ingredientesCustom - Ingredientes personalizados (opcional)
 * @returns {Promise<Object>}
 */
async function crearRelacion(articuloProduccionCodigo, articuloKiloCodigo, multiplicadorIngredientes = 1, ingredientesCustom = null) {
    try {
        console.log(`🔗 Creando relación: ${articuloProduccionCodigo} -> ${articuloKiloCodigo} (multiplicador: ${multiplicadorIngredientes})`);
        
        // 🛡️ ROBUSTEZ: Limpiar cualquier relación previa para garantizar 1 a 1
        console.log(`🧹 Limpiando relaciones previas para ${articuloProduccionCodigo}...`);
        const deleteQuery = `
            DELETE FROM articulos_produccion_externa_relacion 
            WHERE articulo_produccion_codigo = $1
        `;
        const deleteResult = await pool.query(deleteQuery, [articuloProduccionCodigo]);
        console.log(`✅ Relaciones previas eliminadas: ${deleteResult.rowCount}`);

        // Insertar nueva relación limpia
        const insertQuery = `
            INSERT INTO articulos_produccion_externa_relacion
            (articulo_produccion_codigo, articulo_kilo_codigo, multiplicador_ingredientes, ingredientes_custom)
            VALUES ($1, $2, $3, $4)
            RETURNING id, articulo_produccion_codigo, articulo_kilo_codigo, 
                     COALESCE(multiplicador_ingredientes, 1) as multiplicador_ingredientes,
                     ingredientes_custom
        `;
        const result = await pool.query(insertQuery, [articuloProduccionCodigo, articuloKiloCodigo, multiplicadorIngredientes, ingredientesCustom ? JSON.stringify(ingredientesCustom) : null]);
        console.log(`✅ Relación creada con ID: ${result.rows[0].id}`);
        return result.rows[0];
    } catch (error) {
        console.error('Error al crear relación:', error);
        throw error;
    }
}

/**
 * Actualiza una relación existente
 * @param {number} relacionId 
 * @param {string} articuloKiloCodigo 
 * @param {number} multiplicadorIngredientes - Multiplicador para ingredientes (opcional)
 * @param {Array} ingredientesCustom - Ingredientes personalizados (opcional)
 * @returns {Promise<Object>}
 */
async function actualizarRelacion(relacionId, articuloKiloCodigo, multiplicadorIngredientes = null, ingredientesCustom = null) {
    try {
        console.log(`✏️ Actualizando relación ${relacionId}: ${articuloKiloCodigo} (multiplicador: ${multiplicadorIngredientes})`);
        
        let updateQuery, params;
        
        if (multiplicadorIngredientes !== null) {
            updateQuery = `
                UPDATE articulos_produccion_externa_relacion
                SET articulo_kilo_codigo = $1, multiplicador_ingredientes = $2, ingredientes_custom = COALESCE($4, ingredientes_custom)
                WHERE id = $3
                RETURNING id, articulo_produccion_codigo, articulo_kilo_codigo,
                         COALESCE(multiplicador_ingredientes, 1) as multiplicador_ingredientes,
                         ingredientes_custom
            `;
            params = [articuloKiloCodigo, multiplicadorIngredientes, relacionId, ingredientesCustom ? JSON.stringify(ingredientesCustom) : null];
        } else {
        if (ingredientesCustom !== null) {
            updateQuery = `
                UPDATE articulos_produccion_externa_relacion
                SET articulo_kilo_codigo = $1, ingredientes_custom = $3
                WHERE id = $2
                RETURNING id, articulo_produccion_codigo, articulo_kilo_codigo,
                         COALESCE(multiplicador_ingredientes, 1) as multiplicador_ingredientes,
                         ingredientes_custom
            `;
            params = [articuloKiloCodigo, relacionId, JSON.stringify(ingredientesCustom)];
        } else {
            updateQuery = `
                UPDATE articulos_produccion_externa_relacion
                SET articulo_kilo_codigo = $1
                WHERE id = $2
                RETURNING id, articulo_produccion_codigo, articulo_kilo_codigo,
                         COALESCE(multiplicador_ingredientes, 1) as multiplicador_ingredientes
            `;
            params = [articuloKiloCodigo, relacionId];
        }
        }
        
        const result = await pool.query(updateQuery, params);
        if (result.rows.length === 0) {
            throw new Error('Relación no encontrada');
        }
        console.log(`✅ Relación actualizada: ${result.rows[0].id}`);
        return result.rows[0];
    } catch (error) {
        console.error('Error al actualizar relación:', error);
        throw error;
    }
}

/**
 * Elimina una relación por ID
 * @param {number} relacionId 
 * @returns {Promise<void>}
 */
async function eliminarRelacion(relacionId) {
    try {
        const deleteQuery = `
            DELETE FROM articulos_produccion_externa_relacion
            WHERE id = $1
        `;
        await pool.query(deleteQuery, [relacionId]);
    } catch (error) {
        console.error('Error al eliminar relación:', error);
        throw error;
    }
}

/**
 * Elimina una relación por código de artículo de producción
 * @param {string} articuloCodigo 
 * @returns {Promise<void>}
 */
async function eliminarRelacionPorArticulo(articuloCodigo) {
    try {
        const deleteQuery = `
            DELETE FROM articulos_produccion_externa_relacion
            WHERE articulo_produccion_codigo = $1
        `;
        await pool.query(deleteQuery, [articuloCodigo]);
    } catch (error) {
        console.error('Error al eliminar relación por artículo:', error);
        throw error;
    }
}

module.exports = {
    obtenerRelacionesCarro,
    obtenerRelacionPorArticulo,
    obtenerRelacionesPorArticulos,
    crearRelacion,
    actualizarRelacion,
    eliminarRelacion,
    eliminarRelacionPorArticulo
};
