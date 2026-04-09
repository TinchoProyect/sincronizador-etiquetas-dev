/**
 * Controlador de Dashboard de Demanda No Satisfecha (Sin Stock / Faltantes)
 * Construye una respuesta analítica JSON cruzando stock faltante con información de cliente.
 */

const getDashboardFaltantesController = async (req, res) => {
    const requestId = `REQ-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    console.log(`\n🔍 [DASHBOARD-FALTANTES] ${requestId} - Solicitando datos de demanda no satisfecha...`);

    let client;
    try {
        client = await req.db.connect();

        const sql = `
            SELECT 
                s.articulo,
                MAX(s.descripcion) as descripcion,
                SUM(s.cantidad) as cantidad_total,
                json_agg(
                    json_build_object(
                        'id', s.id,
                        'fecha', p.fecha,
                        'cantidad', s.cantidad,
                        'motivo_falta', s.motivo_falta,
                        'presupuesto_ext', p.id_presupuesto_ext,
                        'cliente_nombre', COALESCE(c.nombre || ' ' || c.apellido, c.nombre, c.apellido, c.otros, 'Consumidor Final')
                    ) ORDER BY p.fecha DESC
                ) as detalles
            FROM presupuestos_articulos_sin_stock s
            JOIN presupuestos p ON s.id_presupuesto = p.id
            LEFT JOIN clientes c ON CAST(NULLIF(TRIM(p.id_cliente), '') AS integer) = c.cliente_id
            GROUP BY s.articulo
            ORDER BY cantidad_total DESC;
        `;

        const result = await client.query(sql);
        console.log(`✅ [DASHBOARD-FALTANTES] ${requestId} - Éxito: Obtenidos ${result.rows.length} registros maestros.`);

        return res.status(200).json({
            success: true,
            data: result.rows || [],
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
    } finally {
        if (client) {
            client.release();
        }
    }
};

module.exports = {
    getDashboardFaltantesController
};
