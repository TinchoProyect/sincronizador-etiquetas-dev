const LotesBunkerService = require('../services/lotesBunkerService');

exports.buscarDestinos = async (req, res) => {
    console.log(`[VIGÍA BACKEND] -> Request recibido en /buscar. Query (q): "${req.query.q || ''}"`);
    try {
        const q = req.query.q !== undefined ? req.query.q : '';
        console.log(`[VIGÍA BACKEND] -> Llamando a LotesBunkerService.buscarDestinos con db...`);
        const destinos = await LotesBunkerService.buscarDestinos(req.db, q);
        console.log(`[VIGÍA BACKEND] -> Búsqueda exitosa. Se encontraron ${destinos.length} registros. Respondiendo al frontend...`);
        res.json({ success: true, data: destinos });
    } catch (error) {
        console.error('❌ [BUNKER-LOTES] Error buscando destinos:', error);
        res.status(500).json({ success: false, error: 'Error interno consultando destinos' });
    }
};

exports.vincularLote = async (req, res) => {
    try {
        const data = req.body;
        
        // Soporte para vinculación en lote (Batch Linking)
        if (data && data.lotes && Array.isArray(data.lotes)) {
            console.log(`🔗 [BUNKER-LOTES-BATCH] Solicitud de vinculación batch para ${data.lotes.length} lotes recibida.`);
            const resultado = await LotesBunkerService.vincularLotesBatch(req.db, data);
            return res.status(201).json({
                success: true,
                data: resultado,
                message: 'Múltiples lotes vinculados de forma atómica con éxito.'
            });
        }

        // Caso individual retrocompatible
        if (!data || !data.lote_id_supabase) {
            return res.status(400).json({ success: false, error: 'Datos de vinculación inválidos o faltantes' });
        }

        const resultado = await LotesBunkerService.vincularLote(req.db, data);

        res.status(201).json({
            success: true,
            data: resultado,
            message: 'Lote vinculado exitosamente en el entorno aislado (Shadow Mode).'
        });
    } catch (error) {
        console.error('❌ [BUNKER-LOTES] Error vinculando lote:', error);
        res.status(500).json({ success: false, error: error.message || 'Error interno al vincular lote' });
    }
};

exports.consultarEstadosLotes = async (req, res) => {
    try {
        const { lotes } = req.body;
        if (!lotes || !Array.isArray(lotes)) {
            return res.status(400).json({ success: false, error: 'Se requiere un array de IDs de lotes.' });
        }

        const estados = await LotesBunkerService.obtenerEstadosLotes(req.db, lotes);
        
        res.json({
            success: true,
            data: estados
        });
    } catch (error) {
        console.error('❌ [BUNKER-LOTES] Error consultando estados:', error);
        res.status(500).json({ success: false, error: 'Error interno consultando estados de lotes.' });
    }
};

exports.abrirCajaDestino = async (req, res) => {
    try {
        const { vinculo_id, destino_id, cantidad } = req.body;
        if (!vinculo_id || !destino_id) {
            return res.status(400).json({ success: false, error: 'Faltan parámetros requeridos (vinculo_id, destino_id)' });
        }

        const parsedCantidad = cantidad !== undefined ? parseInt(cantidad, 10) : 1;
        if (isNaN(parsedCantidad) || parsedCantidad <= 0) {
            return res.status(400).json({ success: false, error: 'La cantidad de cajas a abrir debe ser un número entero positivo.' });
        }
        
        console.log(`🔓 [ABRIR-CAJA] Solicitud recibida en controlador. Vinculo: ${vinculo_id} | Destino: ${destino_id} | Cantidad: ${parsedCantidad}`);
        const resultado = await LotesBunkerService.abrirCajaDestino(req.db, vinculo_id, destino_id, parsedCantidad);
        
        res.json({
            success: true,
            data: resultado,
            message: 'Caja abierta y stock compuesto de ingrediente actualizado exitosamente.'
        });
    } catch (error) {
        console.error('❌ [BUNKER-LOTES] Error al abrir caja:', error);
        res.status(500).json({ success: false, error: error.message || 'Error interno al abrir caja' });
    }
};

exports.desvincularLote = async (req, res) => {
    try {
        const { lote_id_supabase, revertir_stock } = req.body;
        if (!lote_id_supabase) {
            return res.status(400).json({ success: false, error: 'lote_id_supabase es requerido.' });
        }
        
        console.log(`🔗 [BUNKER-LOTES] Solicitud para desvincular/retrotraer lote ${lote_id_supabase} recibida. Revertir stock: ${revertir_stock}`);
        const resultado = await LotesBunkerService.desvincularLote(req.db, lote_id_supabase, revertir_stock === true);
        
        res.json({
            success: true,
            data: resultado,
            message: 'Vinculación de lote retrotraída exitosamente.'
        });
    } catch (error) {
        console.error('❌ [BUNKER-LOTES] Error desvinculando lote:', error);
        res.status(500).json({ success: false, error: error.message || 'Error interno al desvincular lote.' });
    }
};
