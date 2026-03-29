const pool = require('../config/database');

/**
 * Obtiene la lista de todos los artículos disponibles
 * @param {string} tipoCarro - Tipo de carro ('interna', 'externa', o null para todos)
 * @param {string} codigoBarras - Código de barras para búsqueda específica (opcional)
 * @returns {Promise<Array>} Lista de artículos
 */
async function obtenerArticulos(tipoCarro = null, codigoBarras = null) {
    try {
        // Construir WHERE clause según los parámetros
        let whereClauses = [];
        let params = [];
        let paramIndex = 1;
        
        // Filtro por código de barras (tiene prioridad)
        if (codigoBarras) {
            whereClauses.push(`a.codigo_barras = $${paramIndex}`);
            params.push(codigoBarras);
            paramIndex++;
        }
        
        // Filtro por tipo de carro
        if (tipoCarro === 'externa') {
            whereClauses.push('COALESCE(src.solo_produccion_externa, false) = true');
        }
        
        const whereClause = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';
        
        // 🔧 CONSULTA MEJORADA: Incluir información del artículo base de la receta
        const query = `
            SELECT DISTINCT
                a.numero,
                a.nombre,
                a.codigo_barras,
                COALESCE(src.stock_consolidado, 0) as stock_consolidado,
                COALESCE(src.no_producido_por_lambda, false) as no_producido_por_lambda,
                COALESCE(src.solo_produccion_externa, false) as solo_produccion_externa,
                src.kilos_unidad,
                -- Información del artículo base de la receta (para UPs)
                ra.articulo_numero as articulo_base_codigo,
                a_base.nombre as articulo_base_nombre,
                COALESCE(src_base.stock_consolidado, 0) as articulo_base_stock
            FROM public.articulos a
            LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = a.numero
            -- Join con receta para obtener el artículo base (insumo)
            LEFT JOIN public.recetas r ON r.articulo_numero = a.numero
            LEFT JOIN public.receta_articulos ra ON ra.receta_id = r.id
            -- Join con artículos para obtener nombre del artículo base
            LEFT JOIN public.articulos a_base ON a_base.numero = ra.articulo_numero
            -- Join con stock del artículo base
            LEFT JOIN public.stock_real_consolidado src_base ON src_base.articulo_numero = ra.articulo_numero
            ${whereClause}
            ORDER BY a.nombre ASC
        `;
        
        const result = await pool.query(query, params);
        
        console.log(`📊 [ARTICULOS] Obtenidos ${result.rows.length} artículos${tipoCarro ? ` (tipo: ${tipoCarro})` : ''}`);
        if (result.rows.length > 0 && tipoCarro === 'externa') {
            console.log(`📋 [ARTICULOS] Ejemplo de datos con artículo base:`, {
                numero: result.rows[0].numero,
                nombre: result.rows[0].nombre,
                articulo_base_codigo: result.rows[0].articulo_base_codigo,
                articulo_base_nombre: result.rows[0].articulo_base_nombre,
                articulo_base_stock: result.rows[0].articulo_base_stock
            });
        }
        
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

/**
 * Actualiza el campo kilos_unidad de un artículo
 * @param {string} articuloNumero - Número del artículo
 * @param {number} kilosUnidad - Nuevo valor del campo (puede ser null)
 * @returns {Promise<Object>} Resultado de la actualización
 */
async function actualizarKilosUnidad(articuloNumero, kilosUnidad) {
    try {
        console.log('Actualizando kilos por unidad para artículo:', articuloNumero, 'Valor:', kilosUnidad);
        
        // Validar que kilosUnidad sea un número válido o null
        const kilosUnidadValido = kilosUnidad === null || kilosUnidad === '' ? null : parseFloat(kilosUnidad);
        if (kilosUnidadValido !== null && (isNaN(kilosUnidadValido) || kilosUnidadValido < 0)) {
            throw new Error('El valor de kilos por unidad debe ser un número positivo o null');
        }
        
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
                INSERT INTO public.stock_real_consolidado (articulo_numero, kilos_unidad)
                VALUES ($1, $2)
                ON CONFLICT (articulo_numero) 
                DO UPDATE SET kilos_unidad = $2
            `;
            await pool.query(insertQuery, [articuloNumero, kilosUnidadValido]);
        } else {
            // Actualizar el campo existente
            const updateQuery = `
                UPDATE public.stock_real_consolidado 
                SET kilos_unidad = $1
                WHERE articulo_numero = $2
            `;
            await pool.query(updateQuery, [kilosUnidadValido, articuloNumero]);
        }

        console.log('Campo kilos por unidad actualizado correctamente');
        return { 
            success: true, 
            message: 'Campo kilos por unidad actualizado correctamente',
            articulo_numero: articuloNumero,
            kilos_unidad: kilosUnidadValido
        };

    } catch (error) {
        console.error('Error al actualizar campo kilos por unidad:', error);
        throw new Error(`Error al actualizar campo kilos por unidad: ${error.message}`);
    }
}

/**
 * Busca artículos en stock_real_consolidado con búsqueda exacta o parcial
 * @param {Object} req - Request con query params: q (texto búsqueda), exact (true/false)
 * @param {Object} res - Response
 */
async function buscarArticulos(req, res) {
    try {
        const { q, exact } = req.query;
        
        console.log('🔍 [BUSCAR-ART] Parámetros:', { q, exact });
        
        if (!q || q.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'Se requiere el parámetro de búsqueda "q"'
            });
        }
        
        const busqueda = q.trim();
        const esExacta = exact === 'true';
        
        let query;
        let params;
        
        if (esExacta) {
            // Búsqueda EXACTA por código
            query = `
                SELECT 
                    src.articulo_numero as codigo,
                    src.descripcion,
                    src.codigo_barras,
                    src.stock_consolidado,
                    src.es_pack,
                    src.pack_hijo_codigo,
                    src.pack_unidades
                FROM stock_real_consolidado src
                WHERE src.articulo_numero = $1 
                   OR src.codigo_barras = $1
                LIMIT 1
            `;
            params = [busqueda];
        } else {
            // Búsqueda INTELIGENTE por tokens (grupos de palabras)
            const terminos = busqueda.split(' ').filter(t => t.trim() !== '');
            let whereConds = [];
            params = [];
            
            terminos.forEach((term, index) => {
                const paramIdx = index + 1;
                // El token debe estar en la descripcion o ser un match al codigo
                whereConds.push(`(src.descripcion ILIKE $${paramIdx} OR src.articulo_numero ILIKE $${paramIdx})`);
                params.push(`%${term}%`);
            });
            const filterSQL = whereConds.length > 0 ? whereConds.join(' AND ') : '1=1';

            query = `
                SELECT 
                    src.articulo_numero as codigo,
                    src.descripcion,
                    src.codigo_barras,
                    src.stock_consolidado,
                    src.es_pack,
                    src.pack_hijo_codigo,
                    src.pack_unidades
                FROM stock_real_consolidado src
                WHERE ${filterSQL}
                ORDER BY src.descripcion
                LIMIT 50
            `;
        }
        
        console.log('🔍 [BUSCAR-ART] Params:', params);
        
        const result = await pool.query(query, params);
        
        console.log(`✅ [BUSCAR-ART] Encontrados: ${result.rows.length} artículos`);
        
        res.json({
            success: true,
            articulos: result.rows,
            total: result.rows.length
        });
        
    } catch (error) {
        console.error('❌ [BUSCAR-ART] Error:', error);
        res.status(500).json({
            success: false,
            error: 'Error al buscar artículos',
            message: error.message
        });
    }
}

module.exports = {
    obtenerArticulos,
    buscarArticuloPorCodigo,
    actualizarProduccionLambda,
    actualizarProduccionExterna,
    actualizarKilosUnidad,
    buscarArticulos
};
