exports.obtenerPlantillaPorTermino = async (req, res) => {
    try {
        const { termino, familia_id, articulo_principal_id } = req.query;
        const db = req.db;

        const famIdNum = parseInt(familia_id) || null;
        const princIdNum = parseInt(articulo_principal_id) || null;

        // 1. Consulta Relacional Determinista por IDs Primarios y Foráneos (Sin cadenas ni LOWER)
        const sqlRelacional = `
            SELECT DISTINCT ON (d.id)
                d.id,
                d.categoria,
                d.termino,
                d.abreviatura,
                COALESCE(d.en_revision, false) AS en_revision,
                CASE 
                    WHEN r.id IS NOT NULL THEN true 
                    ELSE false 
                END AS relacional
            FROM public.bunker_diccionario d
            LEFT JOIN public.bunker_relacion_atributo_principal r 
                ON r.termino_id = d.id
               AND (r.familia_id = $1 OR $1 IS NULL)
               AND (r.articulo_principal_id = $2 OR $2 IS NULL)
            WHERE d.obsoleto IS NOT TRUE
              AND d.categoria NOT LIKE 'asistente_%'
              AND d.categoria NOT LIKE 'rendimiento_%'
              AND d.termino IS NOT NULL AND TRIM(d.termino) != ''
            ORDER BY d.id, relacional DESC, d.termino ASC;
        `;
        const resRel = await db.query(sqlRelacional, [famIdNum, princIdNum]);
        const resultDictRows = resRel.rows;

        let categoriasUsadas = [];
        if (termino && termino.trim() !== '') {
            const cleanTerm = termino.trim();
            const sqlPlantilla = `
                SELECT categoria, count(*) as uso
                FROM (
                    SELECT jsonb_object_keys(propiedades_dinamicas->'posiciones') as categoria
                    FROM public.bunker_articulos
                    WHERE (propiedades_dinamicas->>'articulo_principal') ILIKE $1 
                       OR descripcion ILIKE $1 
                       OR descripcion_generada ILIKE $1
                ) sub
                WHERE categoria IS NOT NULL 
                  AND categoria NOT LIKE 'asistente_%'
                  AND categoria NOT LIKE 'rendimiento_%'
                  AND categoria != 'codigo_barras_local'
                GROUP BY categoria
                ORDER BY uso DESC
            `;
            const resultPlantilla = await db.query(sqlPlantilla, [`%${cleanTerm}%`]);
            categoriasUsadas = resultPlantilla.rows.map(r => r.categoria);
        }

        console.log(`🚨 [VIGÍA SERVIDOR - PLANTILLA API POR IDs]: Registros devueltos = ${resultDictRows.length}`);

        res.json({
            success: true,
            categorias_sugeridas: categoriasUsadas,
            diccionario_categorizado: resultDictRows
        });
    } catch (error) {
        console.error('❌ [BUNKER] Error obteniendo plantilla inteligente:', error);
        res.status(500).json({ success: false, error: 'Error obteniendo plantilla inteligente' });
    }
};
