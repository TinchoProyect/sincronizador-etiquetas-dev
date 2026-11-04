/**
 * Controlador de Dashboard de Demanda No Satisfecha (Sin Stock / Faltantes)
 * Construye una respuesta analítica JSON cruzando stock faltante con información de cliente
 * y disponibilidad en tiempo real (stock consolidado y granel/insumos UP).
 */

const { obtenerDemandaFaltantes, cambiarEstadoFaltante } = require('../services/demandaFaltantesService');

const getDashboardFaltantesController = async (req, res) => {
    const requestId = `REQ-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const filtroEstado = req.query.estado || 'Pendiente'; // 'Pendiente', 'Cubierto', 'Desestimado', 'Todos'
    console.log(`\n🔍 [DASHBOARD-FALTANTES] ${requestId} - Solicitando datos de demanda no satisfecha (Filtro: ${filtroEstado})...`);

    try {
        const pool = req.db || require('../../usuarios/pool');
        const estadoParam = filtroEstado === 'Todos' ? null : filtroEstado;

        const items = await obtenerDemandaFaltantes(pool, {
            estado: estadoParam,
            soloConStock: req.query.solo_stock === 'true'
        });

        // Agrupar por artículo para la vista jerárquica / acordeón
        const grupos = {};
        items.forEach(item => {
            const artKey = item.articulo;
            if (!grupos[artKey]) {
                grupos[artKey] = {
                    articulo: artKey,
                    descripcion: item.descripcion,
                    cantidad_total: 0,
                    stock_consolidado: item.stock_consolidado,
                    stock_granel_disponible: item.stock_granel_disponible,
                    granel_codigo: item.granel_codigo,
                    disponibilidad: item.disponibilidad,
                    disponibilidad_texto: item.disponibilidad_texto,
                    tiene_stock: item.tiene_stock,
                    tiene_stock_suficiente: false,
                    detalles: []
                };
            }

            grupos[artKey].cantidad_total += item.cantidad;
            grupos[artKey].detalles.push({
                id: item.id,
                fecha: item.fecha_registro,
                cantidad: item.cantidad,
                motivo_falta: item.motivo_falta,
                estado: item.estado,
                fecha_resolucion: item.fecha_resolucion,
                motivo_resolucion: item.motivo_resolucion,
                presupuesto_ext: item.id_presupuesto_ext,
                cliente_id: item.cliente_id,
                cliente_nombre: item.cliente_nombre,
                telefono: item.telefono,
                celular: item.celular,
                bunker_cliente_id: item.bunker_cliente_id,
                codigo_bunker_cliente: item.codigo_bunker_cliente,
                whatsapp_facturas: item.whatsapp_facturas,
                email_facturas: item.email_facturas,
                contactos_whatsapp: item.contactos_whatsapp,
                contactos_email: item.contactos_email,
                articulo: item.articulo,
                descripcion: item.descripcion,
                whatsapp_url: item.whatsapp_url,
                disponibilidad: item.disponibilidad,
                disponibilidad_texto: item.disponibilidad_texto
            });
        });

        // Calcular si el stock total cubre la demanda acumulada
        const dataAgrupada = Object.values(grupos).map(g => {
            g.tiene_stock_suficiente = g.stock_consolidado >= g.cantidad_total || g.stock_granel_disponible > 0;
            return g;
        });

        // Ordenar: primero los que tienen stock disponible, luego por mayor demanda
        dataAgrupada.sort((a, b) => {
            if (a.tiene_stock && !b.tiene_stock) return -1;
            if (!a.tiene_stock && b.tiene_stock) return 1;
            return b.cantidad_total - a.cantidad_total;
        });

        console.log(`✅ [DASHBOARD-FALTANTES] ${requestId} - Éxito: Obtenidos ${dataAgrupada.length} grupos de artículos.`);

        return res.status(200).json({
            success: true,
            data: dataAgrupada,
            total_items: items.length,
            requestId,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error(`❌ [DASHBOARD-FALTANTES] ${requestId} - Error Crítico:`, err);
        return res.status(500).json({
            success: false,
            error: 'Ocurrió un error obteniendo el dashboard de faltantes.',
            message: err.message,
            requestId,
            timestamp: new Date().toISOString()
        });
    }
};

const cambiarEstadoFaltanteController = async (req, res) => {
    const requestId = `REQ-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const id = parseInt(req.params.id);
    const { nuevoEstado, motivo } = req.body;

    console.log(`\n🔄 [DASHBOARD-FALTANTES] ${requestId} - Modificando estado faltante #${id} a "${nuevoEstado}"...`);

    try {
        const pool = req.db || require('../../usuarios/pool');
        const actualizado = await cambiarEstadoFaltante(pool, {
            id,
            nuevoEstado,
            motivo,
            origen: 'dashboard_faltantes'
        });

        return res.status(200).json({
            success: true,
            data: actualizado,
            message: `Demanda faltante #${id} actualizada a ${nuevoEstado}`,
            requestId,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error(`❌ [DASHBOARD-FALTANTES] ${requestId} - Error modificando estado:`, err);
        return res.status(500).json({
            success: false,
            error: 'Error al actualizar estado del faltante',
            message: err.message,
            requestId,
            timestamp: new Date().toISOString()
        });
    }
};

module.exports = {
    getDashboardFaltantesController,
    cambiarEstadoFaltanteController
};
