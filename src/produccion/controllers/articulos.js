const pool = require('../config/database');

/**
 * Obtiene la lista de todos los artículos disponibles
 * @returns {Promise<Array>} Lista de artículos
 */
async function obtenerArticulos() {
    try {
        console.log('Iniciando obtención de artículos...');
        
        const query = `
            SELECT 
                a.numero,
                a.nombre,
                a.codigo_barras,
                COALESCE(src.stock_consolidado, 0) as stock_ventas
            FROM public.articulos a
            LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = a.numero
            ORDER BY a.nombre ASC
        `;
        
        console.log('Ejecutando query:', query);
        const result = await pool.query(query);
        
        console.log(`Se encontraron ${result.rows.length} artículos`);
        if (result.rows.length === 0) {
            console.log('La consulta no retornó resultados. Verificar la tabla articulos.');
        } else {
            console.log('Muestra del primer artículo:', result.rows[0]);
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

module.exports = {
    obtenerArticulos
};
