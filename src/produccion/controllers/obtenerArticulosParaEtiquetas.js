/**
 * Obtiene los artículos de un carro con la información necesaria para imprimir etiquetas
 */
async function obtenerArticulosParaEtiquetas(req, res) {
    const { id: carroId } = req.params;

    if (!carroId) {
        return res.status(400).json({ 
            error: 'Falta el ID del carro' 
        });
    }

    try {
        // Obtener artículos del carro con su información completa
        const { rows: articulos } = await req.db.query(`
            SELECT 
                ca.articulo_numero,
                ca.cantidad,
                a.codigo_barras,
                a.nombre as descripcion
            FROM carros_articulos ca
            LEFT JOIN articulos a ON a.numero = ca.articulo_numero
            WHERE ca.carro_id = $1
        `, [carroId]);

        if (articulos.length === 0) {
            throw new Error('El carro no tiene artículos');
        }

        return res.json(articulos);

    } catch (error) {
        console.error('Error al obtener artículos para etiquetas:', error);
        return res.status(500).json({ 
            error: 'Error al obtener los artículos',
            detalle: error.message 
        });
    }
}

module.exports = {
    obtenerArticulosParaEtiquetas
};
