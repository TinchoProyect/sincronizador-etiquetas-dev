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
                COALESCE(NULLIF(BTRIM(ba.descripcion_generada), ''), NULLIF(BTRIM(ba.descripcion), ''), a.nombre) as articulo_kilo_nombre,
                COALESCE(NULLIF(BTRIM(a.codigo_barras), ''), NULLIF(BTRIM(ba.codigo_barras), '')) as articulo_kilo_codigo_barras
            FROM articulos_produccion_externa_relacion aper
            LEFT JOIN articulos a ON UPPER(BTRIM(a.numero)) = UPPER(BTRIM(aper.articulo_kilo_codigo))
            LEFT JOIN bunker_articulos ba ON UPPER(BTRIM(ba.articulo_id)) = UPPER(BTRIM(aper.articulo_kilo_codigo))
            WHERE UPPER(BTRIM(aper.articulo_produccion_codigo)) IN (
                SELECT UPPER(BTRIM(articulo_numero)) FROM carros_articulos WHERE carro_id = $1
            )
              AND UPPER(BTRIM(aper.articulo_produccion_codigo)) <> UPPER(BTRIM(aper.articulo_kilo_codigo))
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
                COALESCE(NULLIF(BTRIM(ba.descripcion_generada), ''), NULLIF(BTRIM(ba.descripcion), ''), a.nombre) as articulo_kilo_nombre,
                COALESCE(NULLIF(BTRIM(a.codigo_barras), ''), NULLIF(BTRIM(ba.codigo_barras), '')) as articulo_kilo_codigo_barras
            FROM articulos_produccion_externa_relacion aper
            LEFT JOIN articulos a ON UPPER(BTRIM(a.numero)) = UPPER(BTRIM(aper.articulo_kilo_codigo))
            LEFT JOIN bunker_articulos ba ON UPPER(BTRIM(ba.articulo_id)) = UPPER(BTRIM(aper.articulo_kilo_codigo))
            WHERE UPPER(BTRIM(aper.articulo_produccion_codigo)) = UPPER(BTRIM($1))
              AND UPPER(BTRIM(aper.articulo_produccion_codigo)) <> UPPER(BTRIM(aper.articulo_kilo_codigo))
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
        const codigosNorm = (Array.isArray(articuloCodigos) ? articuloCodigos : [])
            .map(c => String(c || '').trim().toUpperCase())
            .filter(Boolean);
        if (codigosNorm.length === 0) return [];

        const query = `
            SELECT
                aper.id,
                aper.articulo_produccion_codigo,
                aper.articulo_kilo_codigo,
                COALESCE(aper.multiplicador_ingredientes, 1) as multiplicador_ingredientes,
                COALESCE(NULLIF(BTRIM(ba.descripcion_generada), ''), NULLIF(BTRIM(ba.descripcion), ''), a.nombre) as articulo_kilo_nombre,
                COALESCE(NULLIF(BTRIM(a.codigo_barras), ''), NULLIF(BTRIM(ba.codigo_barras), '')) as articulo_kilo_codigo_barras
            FROM articulos_produccion_externa_relacion aper
            LEFT JOIN articulos a ON UPPER(BTRIM(a.numero)) = UPPER(BTRIM(aper.articulo_kilo_codigo))
            LEFT JOIN bunker_articulos ba ON UPPER(BTRIM(ba.articulo_id)) = UPPER(BTRIM(aper.articulo_kilo_codigo))
            WHERE UPPER(BTRIM(aper.articulo_produccion_codigo)) = ANY($1)
              AND UPPER(BTRIM(aper.articulo_produccion_codigo)) <> UPPER(BTRIM(aper.articulo_kilo_codigo))
        `;
        const result = await pool.query(query, [codigosNorm]);
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
        const upClean = String(articuloProduccionCodigo || '').trim();
        const apClean = String(articuloKiloCodigo || '').trim();
        if (!upClean || !apClean) {
            const err = new Error('Debe especificar tanto el código de la Unidad Productiva (UP) como el del Artículo Puente (AP).');
            err.statusCode = 400;
            throw err;
        }
        if (upClean.toUpperCase() === apClean.toUpperCase()) {
            const err = new Error(`Auto-vínculo inválido: la Unidad Productiva (${upClean}) no puede apuntar a sí misma como Artículo Puente (${apClean}).`);
            err.statusCode = 400;
            throw err;
        }
        console.log(`🔗 Creando relación: ${upClean} -> ${apClean} (multiplicador: ${multiplicadorIngredientes})`);
        
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
        const apClean = String(articuloKiloCodigo || '').trim();
        if (!apClean) {
            const err = new Error('Debe especificar el código del Artículo Puente (AP).');
            err.statusCode = 400;
            throw err;
        }
        const prevRes = await pool.query(
            'SELECT id, articulo_produccion_codigo FROM articulos_produccion_externa_relacion WHERE id = $1 LIMIT 1',
            [relacionId]
        );
        if (prevRes.rows.length === 0) {
            const err = new Error('Relación no encontrada');
            err.statusCode = 404;
            throw err;
        }
        const upExistente = String(prevRes.rows[0].articulo_produccion_codigo || '').trim();
        if (upExistente.toUpperCase() === apClean.toUpperCase()) {
            const err = new Error(`Auto-vínculo inválido: la Unidad Productiva (${upExistente}) no puede apuntar a sí misma como Artículo Puente (${apClean}).`);
            err.statusCode = 400;
            throw err;
        }
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
