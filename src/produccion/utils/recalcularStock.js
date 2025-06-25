const pool = require('../config/database');

/**
 * Recalcula el stock_consolidado para uno o más artículos usando la fórmula:
 * stock_consolidado = stock_lomasoft + stock_movimientos + stock_ajustes
 * 
 * @param {Object} db - Conexión a la base de datos (para usar dentro de una transacción existente)
 * @param {number|number[]} articuloNumeros - Número de artículo o array de números a recalcular
 * @returns {Promise<void>}
 */
async function recalcularStockConsolidado(db, articuloNumeros) {
    try {
        // Convertir a array si se recibe un solo número
        const articulos = Array.isArray(articuloNumeros) ? articuloNumeros : [articuloNumeros];
        
        // Query para actualizar el stock_consolidado usando la fórmula correcta
        const query = `
            UPDATE stock_real_consolidado
            SET 
                stock_consolidado = COALESCE(stock_lomasoft, 0) + 
                                  COALESCE(stock_movimientos, 0) + 
                                  COALESCE(stock_ajustes, 0),
                ultima_actualizacion = NOW()
            WHERE articulo_numero = ANY($1)
        `;

        await db.query(query, [articulos]);
        
        console.log(`✅ Stock consolidado recalculado para ${articulos.length} artículo(s)`);

    } catch (error) {
        console.error('Error al recalcular stock consolidado:', error);
        throw error;
    }
}

module.exports = {
    recalcularStockConsolidado
};
