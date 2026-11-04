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
        // Obtener artículos del carro con su información completa (con fallback a stock_real_consolidado y bunker_articulos)
        const { rows: articulos } = await req.db.query(`
            SELECT 
                ca.articulo_numero,
                ca.cantidad,
                COALESCE(
                    NULLIF(TRIM(a.codigo_barras), ''),
                    NULLIF(TRIM(src.codigo_barras), ''),
                    ca.articulo_numero
                ) as codigo_barras,
                COALESCE(
                    NULLIF(TRIM(a.nombre), ''),
                    NULLIF(TRIM(src.descripcion), ''),
                    NULLIF(TRIM(ba.descripcion_generada), ''),
                    NULLIF(TRIM(ba.descripcion), ''),
                    NULLIF(TRIM(ca.descripcion), ''),
                    ca.articulo_numero
                ) as descripcion
            FROM carros_articulos ca
            LEFT JOIN articulos a ON a.numero = ca.articulo_numero
            LEFT JOIN stock_real_consolidado src ON src.articulo_numero = ca.articulo_numero
            LEFT JOIN bunker_articulos ba ON ba.articulo_id = ca.articulo_numero
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
                COALESCE(src.articulo_numero, a_padre.numero, src.codigo_barras) as padre_articulo_numero,
                COALESCE(a_padre.nombre, src.descripcion, src.codigo_barras) as padre_descripcion,
                COALESCE(a_padre.codigo_barras, src.codigo_barras) as padre_codigo_barras,
                ca.articulo_numero as hijo_articulo_numero,
                COALESCE(
                    SUBSTRING(COALESCE(a_padre.nombre, src.descripcion) FROM '[0-9]+\\s*[xX]\\s*[0-9]+(?:\\s*(?:g|G|kg|Kg|KG))?'),
                    (src.pack_unidades || ' x ' || ROUND((src.kilos_unidad * 1000) / src.pack_unidades))
                ) as presentacion_padre
            FROM carros_articulos ca
            LEFT JOIN articulos a_hijo ON a_hijo.numero = ca.articulo_numero
            INNER JOIN stock_real_consolidado src 
                ON (src.pack_hijo_codigo = ca.articulo_numero 
                    OR src.pack_hijo_codigo = a_hijo.numero 
                    OR (a_hijo.codigo_barras IS NOT NULL AND src.pack_hijo_codigo = a_hijo.codigo_barras))
            LEFT JOIN articulos a_padre ON (a_padre.codigo_barras = src.codigo_barras OR a_padre.numero = src.articulo_numero)
            WHERE ca.carro_id = $1 AND src.es_pack = true
            ORDER BY presentacion_padre ASC, padre_articulo_numero ASC
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
