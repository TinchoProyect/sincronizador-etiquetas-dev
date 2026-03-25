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
