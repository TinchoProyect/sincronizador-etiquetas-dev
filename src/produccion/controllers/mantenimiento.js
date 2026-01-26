const pool = require('../config/database');

/**
 * Obtener stock actual en mantenimiento (Cuarentena)
 * Fuente: public.stock_real_consolidado
 */
async function getStockMantenimiento(req, res) {
    try {
        console.log('🔍 [MANTENIMIENTO] Consultando stock en cuartena...');

        const query = `
            SELECT 
                s.articulo_numero,
                s.stock_mantenimiento,
                s.stock_lomasoft,
                s.stock_movimientos,
                s.stock_ajustes,
                s.ultima_actualizacion,
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
        res.json(result.rows);

    } catch (error) {
        console.error('❌ [MANTENIMIENTO] Error al obtener stock:', error.message);
        res.status(500).json({ error: error.message });
    }
}

/**
 * Obtener historial de movimientos de mantenimiento
 */
async function getHistorialMantenimiento(req, res) {
    try {
        const limit = req.query.limit || 50;
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

/**
 * Conciliar devolución con API Externa (Tunnel)
 * Endpoint: https://api.lamdaser.com/devoluciones
 */
async function conciliarDevolucion(req, res) {
    const debugLog = [];

    try {
        const { cliente, articulo, cantidad, fecha } = req.query;
        // Normalizar fecha
        const fechaRef = fecha || new Date().toISOString().split('T')[0];

        // LOG
        console.log(`🔍 [MANTENIMIENTO] Conciliando devolución (Tunnel): Cliente=${cliente}, Art=${articulo}`);
        debugLog.push(`Inicio: ${new Date().toISOString()}`);
        debugLog.push(`Input: Cliente=${cliente}, Art=${articulo}, Cant=${cantidad}, Fecha=${fechaRef}`);

        if (!cliente || !articulo) {
            debugLog.push('❌ Error: Faltan parámetros requeridos');
            return res.status(400).json({
                error: 'Faltan parámetros requeridos',
                debug: { log: debugLog }
            });
        }

        // --- URL DEL TÚNEL (CORRECTA) ---
        const baseUrl = 'https://api.lamdaser.com/devoluciones';

        const url = new URL(baseUrl);
        url.searchParams.append('cliente', cliente);
        url.searchParams.append('articulo', articulo);
        url.searchParams.append('cantidad', cantidad || 0);
        url.searchParams.append('fecha', fechaRef);

        debugLog.push(`Target API: ${baseUrl}`);
        debugLog.push(`Params: ${decodeURIComponent(url.search)}`);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        debugLog.push('📤 Enviando petición HTTP...');

        const response = await fetch(url.toString(), {
            signal: controller.signal,
            headers: { 'Accept': 'application/json' }
        });

        clearTimeout(timeout);

        debugLog.push(`📥 Respuesta HTTP: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            const errText = await response.text();
            debugLog.push(`❌ Body Error: ${errText.substring(0, 150)}`);
            throw new Error(`Tunnel respondió ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        const resultados = Array.isArray(data) ? data : (data.data || []);

        debugLog.push(`✅ Registros recibidos: ${resultados.length}`);

        // MAPPING
        const mappedData = resultados.map(r => ({
            tipo_comprobante: r.tipo_comprobante || 'N/C',
            pto_vta: r.punto_venta || 0,
            numero_comprobante: r.numero_comprobante || 0,
            imp_neto: r.importe_neto || r.imp_neto || 0,
            fecha_emision: r.fecha || r.fecha_emision,
            item_descripcion: r.articulo || r.item_descripcion,
            item_cantidad: r.cantidad || r.item_cantidad
        }));

        res.json({
            success: true,
            data: mappedData,
            debug: {
                log: debugLog,
                source: baseUrl
            }
        });

    } catch (error) {
        console.error('❌ [MANTENIMIENTO] Error conciliarDevolucion:', error.message);
        debugLog.push(`❌ EXCEPCIÓN: ${error.message}`);

        res.status(200).json({
            success: false,
            error: 'Error conectando con Facturación (Tunnel)',
            message: error.message,
            debug: { log: debugLog }
        });
    }
}

module.exports = {
    getStockMantenimiento,
    getHistorialMantenimiento,
    conciliarDevolucion
};
