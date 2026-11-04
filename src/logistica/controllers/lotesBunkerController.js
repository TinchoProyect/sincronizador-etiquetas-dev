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

/**
 * Obtener auditoría y landed cost de un lote
 */
exports.obtenerAuditoriaCostos = async (req, res) => {
    try {
        const { loteId } = req.params;
        const url = "https://wofttcnpipozwupmpuul.supabase.co";
        const key = (process.env.SUPABASE_SERVICE_KEY || 'sb_secret_B29ym1JcTqTIe8dWnvpmZg_ByV_ZxcL').trim();
        
        const headers = {
            'apikey': key,
            'Authorization': `Bearer ${key}`
        };

        // 1. Consultar la vista vw_inventario_consolidado
        const viewUrl = `${url}/rest/v1/vw_inventario_consolidado?id=eq.${loteId}`;
        const resView = await fetch(viewUrl, { headers });
        let landedData = null;
        if (resView.ok) {
            const arr = await resView.json();
            if (arr && arr.length > 0) landedData = arr[0];
        }

        // 2. Consultar el detalle de auditoría / trazabilidad de fletes
        const auditUrl = `${url}/rest/v1/recepciones_fisicas_items?id=eq.${loteId}&select=id,costo_unitario,recepciones_fisicas_cabecera(id,numero_remito,envio_tipo,costo_logistico_estado,pedidos_b2b_cabecera(id,proveedor_id,proveedores(id,nombre))),pedidos_b2b_items(id,producto_descripcion),costos_adicionales_distribucion(id,tipo_costo,monto_adicional_asignado,facturas_raw(id,tipo_comprobante,punto_venta,numero_comprobante,importe_total,proveedores(id,nombre)))`;
        const resAudit = await fetch(auditUrl, { headers });
        let auditData = null;
        if (resAudit.ok) {
            const arr = await resAudit.json();
            if (arr && arr.length > 0) auditData = arr[0];
        }

        res.json({
            success: true,
            landedData,
            auditData
        });
    } catch (error) {
        console.error('❌ [BUNKER-LOTES] Error obteniendo auditoría de costos:', error);
        res.status(500).json({ success: false, error: 'Error interno obteniendo auditoría de costos.' });
    }
};

/**
 * Sincronizar costo local de lote con Landed Cost de Supabase
 */
exports.sincronizarCostoLote = async (req, res) => {
    try {
        const { loteId } = req.params;
        const url = "https://wofttcnpipozwupmpuul.supabase.co";
        const key = (process.env.SUPABASE_SERVICE_KEY || 'sb_secret_B29ym1JcTqTIe8dWnvpmZg_ByV_ZxcL').trim();
        
        const headers = {
            'apikey': key,
            'Authorization': `Bearer ${key}`
        };

        // 1. Obtener costo de vw_inventario_consolidado en Supabase
        const viewUrl = `${url}/rest/v1/vw_inventario_consolidado?id=eq.${loteId}`;
        const resView = await fetch(viewUrl, { headers });
        if (!resView.ok) {
            throw new Error(`Error en Supabase: ${await resView.text()}`);
        }
        const arr = await resView.json();
        if (!arr || arr.length === 0) {
            return res.status(404).json({ success: false, error: 'No se encontró el lote en Supabase.' });
        }
        
        const landed = arr[0];
        const nuevoCostoKilo = parseFloat(landed.costo_total_unitario);
        if (isNaN(nuevoCostoKilo)) {
            return res.status(400).json({ success: false, error: 'El costo total unitario en Supabase no es válido.' });
        }

        // 2. Realizar la actualización en la BD local de forma transaccional
        const client = await req.db.connect();
        try {
            await client.query('BEGIN');

            // A. Buscar el vínculo local para recalcular costo bruto
            const vinRes = await client.query(
                'SELECT id, cantidad_total_lote FROM public.bunker_lotes_vinculos WHERE lote_id_supabase = $1',
                [loteId]
            );
            if (vinRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, error: 'No existe vinculación local para este lote.' });
            }

            const vinculo = vinRes.rows[0];
            const vinculoId = vinculo.id;
            const cantTotal = parseFloat(vinculo.cantidad_total_lote || 0);
            const nuevoCostoBruto = nuevoCostoKilo * cantTotal;

            // B. Actualizar cabecera local
            await client.query(
                `UPDATE public.bunker_lotes_vinculos 
                 SET costo_kilo_calculado = $1, costo_bruto_ingresado = $2
                 WHERE id = $3`,
                [nuevoCostoKilo, nuevoCostoBruto, vinculoId]
            );

            // C. Actualizar destinos locales
            await client.query(
                `UPDATE public.bunker_lotes_destinos 
                 SET costo_kilo_al_momento = $1
                 WHERE vinculo_id = $2`,
                [nuevoCostoKilo, vinculoId]
            );

            // D. Si hay destinos tipo ingrediente, actualizar su costo_patron en ingredientes
            const destRes = await client.query(
                `SELECT destino_id FROM public.bunker_lotes_destinos 
                 WHERE vinculo_id = $1 AND tipo_destino = 'INGREDIENTE_PRODUCCION'`,
                [vinculoId]
            );
            
            for (const row of destRes.rows) {
                const ingredienteId = parseInt(row.destino_id, 10);
                if (!isNaN(ingredienteId)) {
                    await client.query(
                        `UPDATE public.ingredientes 
                         SET costo_patron = $1 
                         WHERE id = $2`,
                        [nuevoCostoKilo, ingredienteId]
                    );
                }
            }

            await client.query('COMMIT');
            res.json({
                success: true,
                message: 'Costo de lote y costo patrón de ingredientes actualizados con éxito.',
                nuevoCostoKilo,
                nuevoCostoBruto
            });
        } catch(e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }

    } catch(error) {
        console.error('❌ [BUNKER-LOTES] Error sincronizando costo:', error);
        res.status(500).json({ success: false, error: error.message || 'Error interno sincronizando costo.' });
    }
};
