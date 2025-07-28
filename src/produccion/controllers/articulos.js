const pool = require('../config/database');

/**
 * Obtiene la lista de todos los artículos disponibles
 * @param {string} tipoCarro - Tipo de carro ('interna', 'externa', o null para todos)
 * @returns {Promise<Array>} Lista de artículos
 */
async function obtenerArticulos(tipoCarro = null) {
    try {
        // Construir WHERE clause según el tipo de carro
        let whereClause = '';
        let params = [];
        
        if (tipoCarro === 'externa') {
            whereClause = 'WHERE COALESCE(src.solo_produccion_externa, false) = true';
        }
        
        const query = `
            SELECT DISTINCT
                a.numero,
                a.nombre,
                a.codigo_barras,
                COALESCE(src.stock_consolidado, 0) as stock_consolidado,
                COALESCE(src.no_producido_por_lambda, false) as no_producido_por_lambda,
                COALESCE(src.solo_produccion_externa, false) as solo_produccion_externa
            FROM public.articulos a
            LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = a.numero
            ${whereClause}
            ORDER BY a.nombre ASC
        `;
        
        const result = await pool.query(query, params);
        
        return result.rows;
    } catch (error) {
        console.error('Error detallado al obtener artículos:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });
        
        if (error.code === '42P01') {
            throw new Error('La tabla articulos no existe en la base de datos');
        }
        
        throw new Error(`No se pudo obtener la lista de artículos: ${error.message}`);
    }
}

/**
 * Busca un artículo por código de barras
 * @param {string} codigoBarras - Código de barras del artículo
 * @returns {Promise<Object>} Artículo encontrado
 */
async function buscarArticuloPorCodigo(codigoBarras) {
    try {
        console.log('Buscando artículo por código de barras:', codigoBarras);
        
        const query = `
            SELECT 
                a.numero,
                a.nombre,
                a.codigo_barras,
                COALESCE(src.stock_consolidado, 0) as stock_ventas,
                COALESCE(src.stock_consolidado, 0) as stock_consolidado,
                COALESCE(src.no_producido_por_lambda, false) as no_producido_por_lambda
            FROM public.articulos a
            LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = a.numero
            WHERE a.codigo_barras = $1
        `;
        
        const result = await pool.query(query, [codigoBarras]);
        
        if (result.rows.length === 0) {
            throw new Error('Artículo no encontrado');
        }
        
        console.log('Artículo encontrado:', result.rows[0]);
        return result.rows[0];
    } catch (error) {
        console.error('Error al buscar artículo por código:', error);
        throw error;
    }
}

/**
 * Actualiza el campo no_producido_por_lambda de un artículo
 * @param {string} articuloNumero - Número del artículo
 * @param {boolean} noProducidoPorLambda - Nuevo valor del campo
 * @returns {Promise<Object>} Resultado de la actualización
 */
async function actualizarProduccionLambda(articuloNumero, noProducidoPorLambda) {
    try {
        console.log('Actualizando producción LAMBDA para artículo:', articuloNumero, 'Valor:', noProducidoPorLambda);
        
        // Verificar que el artículo existe
        const checkQuery = `
            SELECT articulo_numero 
            FROM public.stock_real_consolidado 
            WHERE articulo_numero = $1
        `;
        const checkResult = await pool.query(checkQuery, [articuloNumero]);
        
        if (checkResult.rows.length === 0) {
            // Si no existe en stock_real_consolidado, crear el registro
            const insertQuery = `
                INSERT INTO public.stock_real_consolidado (articulo_numero, no_producido_por_lambda)
                VALUES ($1, $2)
                ON CONFLICT (articulo_numero) 
                DO UPDATE SET no_producido_por_lambda = $2
            `;
            await pool.query(insertQuery, [articuloNumero, noProducidoPorLambda]);
        } else {
            // Actualizar el campo existente
            const updateQuery = `
                UPDATE public.stock_real_consolidado 
                SET no_producido_por_lambda = $1
                WHERE articulo_numero = $2
            `;
            await pool.query(updateQuery, [noProducidoPorLambda, articuloNumero]);
        }

        console.log('Campo actualizado correctamente');
        return { 
            success: true, 
            message: 'Campo actualizado correctamente',
            articulo_numero: articuloNumero,
            no_producido_por_lambda: noProducidoPorLambda
        };

    } catch (error) {
        console.error('Error al actualizar campo de producción:', error);
        throw new Error(`Error al actualizar campo de producción: ${error.message}`);
    }
}

/**
 * Actualiza el campo solo_produccion_externa de un artículo
 * @param {string} articuloNumero - Número del artículo
 * @param {boolean} soloProduccionExterna - Nuevo valor del campo
 * @returns {Promise<Object>} Resultado de la actualización
 */
async function actualizarProduccionExterna(articuloNumero, soloProduccionExterna) {
    try {
        console.log('Actualizando producción externa para artículo:', articuloNumero, 'Valor:', soloProduccionExterna);
        
        // Verificar que el artículo existe
        const checkQuery = `
            SELECT articulo_numero 
            FROM public.stock_real_consolidado 
            WHERE articulo_numero = $1
        `;
        const checkResult = await pool.query(checkQuery, [articuloNumero]);
        
        if (checkResult.rows.length === 0) {
            // Si no existe en stock_real_consolidado, crear el registro
            const insertQuery = `
                INSERT INTO public.stock_real_consolidado (articulo_numero, solo_produccion_externa)
                VALUES ($1, $2)
                ON CONFLICT (articulo_numero) 
                DO UPDATE SET solo_produccion_externa = $2
            `;
            await pool.query(insertQuery, [articuloNumero, soloProduccionExterna]);
        } else {
            // Actualizar el campo existente
            const updateQuery = `
                UPDATE public.stock_real_consolidado 
                SET solo_produccion_externa = $1
                WHERE articulo_numero = $2
            `;
            await pool.query(updateQuery, [soloProduccionExterna, articuloNumero]);
        }

        console.log('Campo de producción externa actualizado correctamente');
        return { 
            success: true, 
            message: 'Campo de producción externa actualizado correctamente',
            articulo_numero: articuloNumero,
            solo_produccion_externa: soloProduccionExterna
        };

    } catch (error) {
        console.error('Error al actualizar campo de producción externa:', error);
        throw new Error(`Error al actualizar campo de producción externa: ${error.message}`);
    }
}

module.exports = {
    obtenerArticulos,
    buscarArticuloPorCodigo,
    actualizarProduccionLambda,
    actualizarProduccionExterna
};
