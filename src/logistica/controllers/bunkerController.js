const BunkerService = require('../services/bunkerService');

console.log('📦 [BUNKER-CONTROLLER] Cargando controlador del Búnker...');

exports.getListas = async (req, res) => {
    try {
        const listas = await BunkerService.getListasActivas(req.db);
        res.json({ success: true, data: listas });
    } catch (error) {
        console.error('❌ [BUNKER] Error obteniendo listas:', error);
        res.status(500).json({ success: false, error: 'Error interno obteniendo listas' });
    }
};

exports.obtenerPlantillaPorTermino = async (req, res) => {
    try {
        const { termino } = req.query;
        if (!termino) {
            return res.status(400).json({ success: false, error: 'Falta el término principal.' });
        }

        const db = req.db;
        
        const sqlPlantilla = `
            SELECT jsonb_object_keys(propiedades_dinamicas) as categoria, count(*) as uso
            FROM public.bunker_articulos
            WHERE descripcion ILIKE $1 OR descripcion_generada ILIKE $1
            GROUP BY categoria
            ORDER BY uso DESC
        `;
        const resultPlantilla = await db.query(sqlPlantilla, [`%${termino}%`]);
        const categoriasUsadas = resultPlantilla.rows.map(r => r.categoria);

        const sqlDict = `
            SELECT categoria, termino, abreviatura 
            FROM public.bunker_diccionario 
            WHERE categoria NOT IN ('general', 'articulo_principal', '')
            ORDER BY categoria, termino
        `;
        const resultDict = await db.query(sqlDict);
        
        res.json({
            success: true,
            categorias_sugeridas: categoriasUsadas,
            diccionario_categorizado: resultDict.rows
        });
    } catch (error) {
        console.error('❌ [BUNKER] Error obteniendo plantilla:', error);
        res.status(500).json({ success: false, error: 'Error obteniendo plantilla inteligente' });
    }
};

exports.buscarDiccionario = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) {
            return res.status(400).json({ success: false, error: 'Falta parámetro de búsqueda (q)' });
        }
        const terminos = await BunkerService.buscarDiccionario(req.db, q);
        res.json({ success: true, data: terminos });
    } catch (error) {
        console.error('❌ [BUNKER] Error buscando en diccionario:', error);
        res.status(500).json({ success: false, error: 'Error interno consultando diccionario' });
    }
};

exports.buscarConsolidado = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) {
            return res.status(400).json({ success: false, error: 'Falta parámetro de búsqueda (q)' });
        }
        const articulos = await BunkerService.buscarConsolidado(req.db, q);
        res.json({ success: true, data: articulos });
    } catch (error) {
        console.error('❌ [BUNKER] Error buscando consolidado:', error);
        res.status(500).json({ success: false, error: 'Error interno buscando stock consolidado' });
    }
};

exports.obtenerArticulo = async (req, res) => {
    try {
        const { id } = req.params;
        const articulo = await BunkerService.obtenerArticulo(req.db, id);
        if (!articulo) {
            return res.status(404).json({ success: false, error: 'Artículo no encontrado' });
        }
        res.json({ success: true, data: articulo });
    } catch (error) {
        console.error('❌ [BUNKER] Error obteniendo artículo:', error);
        res.status(500).json({ success: false, error: 'Error interno obteniendo artículo' });
    }
};

exports.crearArticulo = async (req, res) => {
    try {
        const db = req.db;
        const { articuloData, listasMargenes, nuevos_terminos_diccionario } = req.body;

        if (!articuloData || !articuloData.descripcion) {
            return res.status(400).json({ success: false, error: 'Datos de artículo inválidos o faltantes' });
        }

        // Lógica QA Backend (Fase 3): Autodetectar pack
        const kilos = Number(articuloData.kilos_unidad) || 0;
        const cantidad = Number(articuloData.pack_unidades) || 1;
        articuloData.es_pack = (cantidad > 1 && kilos > 0);

        // Generar IDs locales SI NO VIENEN en el payload (Fase 3 Upsert)
        let articulo_id = articuloData.articulo_id;
        let codigo_barras = articuloData.codigo_barras;

        if (!articulo_id) {
            const timestamp = Date.now().toString().slice(-6); 
            const rnd = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
            articulo_id = `LAMDA-${timestamp}${rnd}`;
            if (!codigo_barras) codigo_barras = `LAMDCB${timestamp}${rnd}`;
        }

        articuloData.articulo_id = articulo_id;
        articuloData.codigo_barras = codigo_barras || articulo_id;

        // PARCHE CRÍTICO: Asegurar que el Artículo Principal se registre SIEMPRE en el diccionario (categoria = 'general')
        // Si el usuario grabó tan rápido que evadió el Swal.fire del OnBlur, lo forzamos silenciosamente en backend
        let terminosAsegurados = nuevos_terminos_diccionario || [];
        const terminoPrimarioStr = articuloData.descripcion_abreviada || articuloData.descripcion;
        if (terminoPrimarioStr) {
             let baseNombre = terminoPrimarioStr.split('.')[0].trim();
             // Limpiar sufijos genericos de empaque que ensucian el diccionario raiz
             baseNombre = baseNombre.replace(/\s*\d*\s*[xX]\s*\d+(\.\d+)?[kK]?[gG]?/g, '').trim();
             if (baseNombre && !terminosAsegurados.some(t => t.termino.toLowerCase() === baseNombre.toLowerCase())) {
                  terminosAsegurados.push({
                      termino: baseNombre,
                      abreviatura: baseNombre.substring(0, 3).toUpperCase(),
                      categoria: 'general'
                  });
             }
        }

        const resultado = await BunkerService.crearArticuloTransaccional(db, articuloData, listasMargenes, terminosAsegurados);

        res.status(201).json({
            success: true,
            data: resultado,
            message: 'Artículo creado en el Búnker exitosamente.'
        });
    } catch (error) {
        console.error('❌ [BUNKER] Error creando artículo:', error);
        res.status(500).json({ success: false, error: error.message || 'Error interno al crear artículo' });
    }
};

exports.obtenerArticulo = async (req, res) => {
    try {
        const { id } = req.params;
        const articulo = await BunkerService.obtenerArticulo(req.db, id);
        
        if (!articulo) {
            return res.status(200).json({ success: true, data: null, message: 'Artículo no encontrado en el Búnker' });
        }

        res.json({ success: true, data: articulo });
    } catch (error) {
        console.error(`❌ [BUNKER] Error obteniendo artículo ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: 'Error interno obteniendo artículo' });
    }
};

exports.eliminarArticulo = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await BunkerService.eliminarArticuloTransaccional(req.db, id);
        if (result) {
            res.json({ success: true, message: 'Artículo eliminado del Búnker exitosamente' });
        } else {
            res.status(404).json({ success: false, error: 'Artículo no encontrado en el Búnker' });
        }
    } catch (error) {
        console.error(`❌ [BUNKER] Error eliminando artículo ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: 'Error interno eliminando artículo' });
    }
};

exports.obtenerTodosLosArticulos = async (req, res) => {
    try {
        const filtros = { search: req.query.search };
        const data = await BunkerService.obtenerTodosLosArticulos(req.db, filtros);
        res.json({ success: true, data });
    } catch (error) {
        console.error('❌ [BUNKER] Error obteniendo grid:', error);
        res.status(500).json({ success: false, error: 'Error interno obteniendo listado' });
    }
};

exports.actualizarArticulo = async (req, res) => {
    try {
        const { id } = req.params;
        const { articuloData, listasMargenes } = req.body;

        await BunkerService.actualizarArticuloTransaccional(req.db, id, articuloData, listasMargenes);

        res.json({ success: true, message: 'Artículo actualizado exitosamente' });
    } catch (error) {
        console.error(`❌ [BUNKER] Error actualizando artículo ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: error.message || 'Error interno al actualizar artículo' });
    }
};

console.log('✅ [BUNKER-CONTROLLER] Controlador de búnker configurado');
