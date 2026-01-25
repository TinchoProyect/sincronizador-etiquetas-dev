const pool = require('../config/database');

/**
 * Obtener stock actual en mantenimiento (Cuarentena)
 * Fuente: public.stock_real_consolidado
 */
async function getStockMantenimiento(req, res) {
    try {
        console.log('🔍 [MANTENIMIENTO] Consultando stock en cuartena...');

        // Consultamos stock_real_consolidado filtrando por stock_mantenimiento > 0
        // Usamos articulo_numero como identificador principal
        const query = `
            SELECT 
                s.articulo_numero,
                s.stock_mantenimiento,
                s.stock_lomasoft,
                s.stock_movimientos,
                s.stock_ajustes,
                s.ultima_actualizacion,
                -- Datos de Trazabilidad (Cliente Origen)
                origin.cliente_id,
                origin.cliente_nombre
            FROM public.stock_real_consolidado s
            LEFT JOIN LATERAL (
                SELECT 
                    c.cliente_id,
                    COALESCE(c.nombre || ' ' || c.apellido, c.nombre, c.apellido, c.otros, 'Desconocido') as cliente_nombre
                FROM public.mantenimiento_movimientos mm
                JOIN public.presupuestos p ON mm.id_presupuesto_origen = p.id
                JOIN public.clientes c ON p.id_cliente::text = c.cliente_id::text
                WHERE mm.articulo_numero = s.articulo_numero
                  AND mm.tipo_movimiento = 'INGRESO'
                ORDER BY mm.fecha_movimiento DESC
                LIMIT 1
            ) origin ON true
            WHERE s.stock_mantenimiento > 0
            ORDER BY s.articulo_numero ASC
        `;

        const result = await pool.query(query);
        console.log(`✅ [MANTENIMIENTO] Encontrados ${result.rows.length} artículos en mantenimiento.`);

        res.json(result.rows);

    } catch (error) {
        console.error('❌ [MANTENIMIENTO] Error al obtener stock:', error.message);
        res.status(500).json({ error: error.message });
    }
}

/**
 * Obtener historial de movimientos de mantenimiento
 * Fuente: public.mantenimiento_movimientos
 */
async function getHistorialMantenimiento(req, res) {
    try {
        const limit = req.query.limit || 50;
        console.log(`🔍 [MANTENIMIENTO] Consultando últimos ${limit} movimientos...`);

        const query = `
            SELECT 
                id,
                articulo_numero,
                cantidad,
                usuario,
                tipo_movimiento,
                observaciones,
                fecha_movimiento,
                estado
            FROM public.mantenimiento_movimientos
            ORDER BY fecha_movimiento DESC
            LIMIT $1
        `;

        const result = await pool.query(query, [limit]);
        res.json(result.rows);

    } catch (error) {
        console.error('❌ [MANTENIMIENTO] Error al obtener historial:', error.message);
        res.status(500).json({ error: error.message });
    }
}

module.exports = {
    getStockMantenimiento,
    getHistorialMantenimiento
};
