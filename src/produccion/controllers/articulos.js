const pool = require('../config/database');

/**
 * Obtiene todos los artículos con su stock actual
 * @returns {Promise<Array>} Lista de artículos con sus campos
 */
async function obtenerArticulosConStock(req, res) {
    try {
        const query = `
            SELECT 
                numero,
                nombre,
                codigo_barras,
                stock_ventas
            FROM articulos
            ORDER BY nombre ASC
        `;
        
        const result = await pool.query(query);
        res.json(result.rows);

    } catch (error) {
        console.error('Error al obtener artículos:', error);
        res.status(500).json({ 
            error: 'Error al obtener la lista de artículos' 
        });
    }
}

module.exports = {
    obtenerArticulosConStock
};
