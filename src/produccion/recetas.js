const pool = require('../usuarios/pool');

/**
 * Verifica si un artículo tiene receta asociada
 * @param {string} articuloNumero - Número del artículo a verificar
 * @returns {Promise<boolean>} - true si tiene receta, false si no
 */
async function tieneReceta(articuloNumero) {
    const query = 'SELECT COUNT(*) FROM recetas WHERE articulo_numero = $1';
    const result = await pool.query(query, [articuloNumero]);
    return parseInt(result.rows[0].count) > 0;
}

/**
 * Obtiene el estado de recetas para múltiples artículos
 * @param {string[]} articulosNumeros - Array de números de artículos
 * @returns {Promise<Object>} - Objeto con artículo_numero como clave y boolean como valor
 */
async function obtenerEstadoRecetas(articulosNumeros) {
    const query = 'SELECT DISTINCT articulo_numero FROM recetas WHERE articulo_numero = ANY($1)';
    const result = await pool.query(query, [articulosNumeros]);
    
    // Crear un objeto con todos los artículos inicializados en false
    const estado = articulosNumeros.reduce((acc, num) => {
        acc[num] = false;
        return acc;
    }, {});
    
    // Marcar como true los que tienen receta
    result.rows.forEach(row => {
        estado[row.articulo_numero] = true;
    });
    
    return estado;
}

module.exports = {
    tieneReceta,
    obtenerEstadoRecetas
};
