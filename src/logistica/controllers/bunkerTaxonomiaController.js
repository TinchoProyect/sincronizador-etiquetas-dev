exports.obtenerRubros = async (req, res) => {
    try {
        const query = `SELECT id, nombre FROM public.bunker_rubros ORDER BY nombre ASC`;
        const result = await req.db.query(query);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('❌ [TAXONOMIA] Error obteniendo rubros:', error);
        res.status(500).json({ success: false, error: 'Error de SQL o BD no inicializada.' });
    }
};

exports.crearRubro = async (req, res) => {
    try {
        const { nombre } = req.body;
        if (!nombre || !nombre.trim()) return res.status(400).json({ success: false, error: 'El nombre del Rubro es mandatorio.' });
        
        const query = `INSERT INTO public.bunker_rubros (nombre) VALUES ($1) RETURNING id, nombre`;
        const result = await req.db.query(query, [nombre.trim().toUpperCase()]);
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        if (error.code === '23505') { // Violación Constraints PGSQL
            return res.status(400).json({ success: false, error: 'Ese Rubro ya existe en el sistema.' });
        }
        console.error('❌ [TAXONOMIA] Error creando rubro en BD:', error);
        res.status(500).json({ success: false, error: 'Fallo guardando el Rubro.' });
    }
};

exports.obtenerSubrubros = async (req, res) => {
    try {
        const { rubroId } = req.params;
        const query = `SELECT id, rubro_id, nombre FROM public.bunker_subrubros WHERE rubro_id = $1 ORDER BY nombre ASC`;
        const result = await req.db.query(query, [rubroId]);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error(`❌ [TAXONOMIA] Error obteniendo subrubros (Rubro: ${req.params.rubroId}):`, error);
        res.status(500).json({ success: false, error: 'Error interno obteniendo dependencias.' });
    }
};

exports.crearSubrubro = async (req, res) => {
    try {
        const { rubroId } = req.params;
        const { nombre } = req.body;
        if (!nombre || !nombre.trim()) return res.status(400).json({ success: false, error: 'El nombre del Subrubro es mandatorio.' });
        
        const query = `INSERT INTO public.bunker_subrubros (rubro_id, nombre) VALUES ($1, $2) RETURNING id, rubro_id, nombre`;
        const result = await req.db.query(query, [rubroId, nombre.trim().toUpperCase()]);
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        if (error.code === '23505') { // Unique(rubro_id, nombre)
            return res.status(400).json({ success: false, error: 'Este Subrubro ya pertenece al Rubro actual.' });
        }
        console.error(`❌ [TAXONOMIA] Error creando subrubro (Rubro: ${req.params.rubroId}):`, error);
        res.status(500).json({ success: false, error: 'Fallo guardando el Subrubro.' });
    }
};
