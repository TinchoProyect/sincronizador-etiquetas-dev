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
/**
 * Obtiene los artículos Padre (Packs) vinculados a los artículos de un carro para impresión de etiquetas
 */
async function obtenerPadresParaImpresion(req, res) {
    const { id: carroId } = req.params;

    if (!carroId) {
        return res.status(400).json({ 
            error: 'Falta el ID del carro' 
        });
    }

    try {
        // Buscar los padres de los artículos del carro usando la tabla de relaciones
        const { rows: padres } = await req.db.query(`
            SELECT DISTINCT
                src.codigo_barras as padre_articulo_numero,
                COALESCE(a_padre.nombre, src.descripcion, src.codigo_barras) as padre_descripcion,
                src.codigo_barras as padre_codigo_barras,
                ca.articulo_numero as hijo_articulo_numero,
                COALESCE(
                    SUBSTRING(COALESCE(a_padre.nombre, src.descripcion) FROM '[0-9]+\\s*[xX]\\s*[0-9]+(?:\\s*(?:g|G|kg|Kg|KG))?'),
                    (src.pack_unidades || ' x ' || ROUND((src.kilos_unidad * 1000) / src.pack_unidades))
                ) as presentacion_padre
            FROM carros_articulos ca
            LEFT JOIN articulos a_hijo ON a_hijo.numero = ca.articulo_numero
            INNER JOIN stock_real_consolidado src 
                ON src.pack_hijo_codigo = COALESCE(a_hijo.codigo_barras, ca.articulo_numero)
            LEFT JOIN articulos a_padre ON a_padre.codigo_barras = src.codigo_barras
            WHERE ca.carro_id = $1 AND src.es_pack = true
        `, [carroId]);

        return res.json(padres);

    } catch (error) {
        console.error('Error al obtener padres para impresión de etiquetas:', error);
        return res.status(500).json({ 
            error: 'Error al obtener los padres vinculados',
            detalle: error.message 
        });
    }
}

module.exports = {
    obtenerArticulosParaEtiquetas,
    obtenerPadresParaImpresion
};
