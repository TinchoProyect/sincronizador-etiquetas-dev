exports.obtenerDiccionario = async (req, res) => {
    try {
        const query = `
            SELECT id, termino, abreviatura, categoria 
            FROM public.bunker_diccionario 
            ORDER BY categoria ASC, termino ASC
        `;
        const result = await req.db.query(query);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('❌ [DICCIONARIO] Error obteniendo diccionario:', error);
        res.status(500).json({ success: false, error: 'Error conectando a la base de datos' });
    }
};

exports.actualizarTermino = async (req, res) => {
    try {
        const { id } = req.params;
        const { termino, abreviatura, categoria } = req.body;
        
        const query = `
            UPDATE public.bunker_diccionario 
            SET termino = $1, abreviatura = $2, categoria = $3
            WHERE id = $4
            RETURNING *
        `;
        const result = await req.db.query(query, [termino, abreviatura, categoria, id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Término no localizado' });
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error(`❌ [DICCIONARIO] Error actualizando término ID ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: 'Fallo interno al actualizar término' });
    }
};

exports.eliminarTermino = async (req, res) => {
    try {
        const { id } = req.params;
        const query = `DELETE FROM public.bunker_diccionario WHERE id = $1 RETURNING id`;
        const result = await req.db.query(query, [id]);
        
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Término no localizado' });
        }
        res.json({ success: true, message: 'Término eliminado existosamente' });
    } catch (error) {
        console.error(`❌ [DICCIONARIO] Error eliminando término ID ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: 'Fallo interno al procesar baja' });
    }
};

exports.obtenerArticulosPrincipales = async (req, res) => {
    try {
        const query = `
            SELECT id, termino, abreviatura
            FROM public.bunker_diccionario 
            WHERE categoria IN ('general', 'articulo_principal')
            ORDER BY termino ASC
        `;
        const result = await req.db.query(query);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('❌ [DICCIONARIO] Error obteniendo artículos principales:', error);
        res.status(500).json({ success: false, error: 'Error interno obteniendo listado principal' });
    }
};

exports.obtenerJerarquiaPorPrincipal = async (req, res) => {
    try {
        const { terminoPrincipal } = req.params;
        const db = req.db;

        // 1. Descubrir qué Familias (categorías) usan los artículos que contienen este término
        const sqlFamilias = `
            SELECT jsonb_object_keys(propiedades_dinamicas) as categoria
            FROM public.bunker_articulos
            WHERE descripcion ILIKE $1 OR descripcion_generada ILIKE $1
            GROUP BY categoria
        `;
        const resFamilias = await db.query(sqlFamilias, [`%${terminoPrincipal}%`]);
        const categoriasUsadas = resFamilias.rows.map(r => r.categoria);

        // Si este término no tiene artículos o no tiene propiedades, devolvemos un diccionario vacío.
        if (categoriasUsadas.length === 0) {
            return res.json({ success: true, data: {} });
        }

        // 2. Extraer todo el diccionario (términos) únicamente para las familias encontradas
        const sqlDict = `
            SELECT id, termino, abreviatura, categoria 
            FROM public.bunker_diccionario 
            WHERE categoria = ANY($1::text[])
            ORDER BY categoria ASC, termino ASC
        `;
        const resDict = await db.query(sqlDict, [categoriasUsadas]);

        // 3. Agrupar la respuesta en formato Acordeón (Jerárquico) { "color": [...], "variedad": [...] }
        const jerarquia = {};
        resDict.rows.forEach(item => {
            if (!jerarquia[item.categoria]) jerarquia[item.categoria] = [];
            jerarquia[item.categoria].push(item);
        });

        res.json({ success: true, data: jerarquia });

    } catch (error) {
        console.error(`❌ [DICCIONARIO] Error obteniendo jerarquia principal ${req.params.terminoPrincipal}:`, error);
        res.status(500).json({ success: false, error: 'Error ensamblando árbol de jerarquías' });
    }
};
