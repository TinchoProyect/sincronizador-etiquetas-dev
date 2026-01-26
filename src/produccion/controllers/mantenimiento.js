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
                origin.estado,
                origin.cliente_nombre
            FROM public.stock_real_consolidado s
            LEFT JOIN LATERAL (
                SELECT 
                    c.cliente_id,
                    mm.estado, -- Necesario para saber si ya esta conciliado
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

/**
 * Confirmar y Guardar Conciliación
 * ACCIÓN ATÓMICA:
 * 1. Insertar Cabecera en mantenimiento_conciliaciones
 * 2. Insertar Detalle en mantenimiento_conciliacion_items
 * 3. Actualizar movimiento de origen a estado 'CONCILIADO'
 */
async function confirmarConciliacion(req, res) {
    const client = await pool.connect();

    try {
        const {
            articulo,
            cliente_id,
            cantidad,
            comprobante
        } = req.body;

        console.log(`💾 [MANTENIMIENTO] Iniciando Transacción de Conciliación (V2 - Strong Link) para Art: ${articulo}`);

        await client.query('BEGIN');

        // 1. Identificar Movimiento Pendiente (Lock Row)
        // Lo buscamos ANTES de insertar para obtener su ID y asegurar consistencia
        const findMovSql = `
            SELECT mm.id 
            FROM public.mantenimiento_movimientos mm
            JOIN public.presupuestos p ON mm.id_presupuesto_origen = p.id
            WHERE mm.articulo_numero = $1
              AND p.id_cliente = $2
              AND mm.tipo_movimiento = 'INGRESO'
              AND mm.estado != 'CONCILIADO'
            ORDER BY mm.fecha_movimiento DESC
            LIMIT 1
            FOR UPDATE
        `;
        const resMov = await client.query(findMovSql, [articulo, cliente_id]);

        if (resMov.rowCount === 0) {
            throw new Error('No se encontró movimiento pendiente para conciliar (o ya fue conciliado por otro usuario).');
        }

        const idMovimiento = resMov.rows[0].id;

        // 2. Insertar Cabecera de Conciliación
        const insertCabecera = `
            INSERT INTO public.mantenimiento_conciliaciones
            (id_cliente, nro_comprobante_externo, tipo_comprobante, fecha_comprobante, importe_neto, importe_iva, importe_total, usuario_consolidacion)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id
        `;

        const usuario = req.user ? req.user.username : 'SISTEMA';
        const neto = parseFloat(comprobante.imp_neto || 0);
        const iva = neto * 0.21;
        const total = neto + iva;

        const resCabecera = await client.query(insertCabecera, [
            cliente_id,
            `${comprobante.pto_vta}-${comprobante.numero_comprobante}`,
            comprobante.tipo_comprobante,
            comprobante.fecha_emision,
            neto,
            iva,
            total,
            usuario
        ]);

        const idConciliacion = resCabecera.rows[0].id;

        // 3. Insertar Item de Conciliación con Vínculo Fuerte (FK)
        const insertItem = `
            INSERT INTO public.mantenimiento_conciliacion_items
            (id_conciliacion, articulo_numero, cantidad_conciliada, id_movimiento_origen)
            VALUES ($1, $2, $3, $4)
        `;
        await client.query(insertItem, [idConciliacion, articulo, cantidad, idMovimiento]);

        // 4. Actualizar Estado del Movimiento
        const updateMov = `
            UPDATE public.mantenimiento_movimientos
            SET estado = 'CONCILIADO', 
                observaciones = observaciones || ' [Conciliado con NC ' || $1 || ']'
            WHERE id = $2
        `;

        await client.query(updateMov, [
            `${comprobante.pto_vta}-${comprobante.numero_comprobante}`,
            idMovimiento
        ]);

        await client.query('COMMIT');
        console.log(`✅ [MANTENIMIENTO] Conciliación Exitosa. Link V2: Conciliacion #${idConciliacion} <-> Movimiento #${idMovimiento}`);

        res.json({ success: true, id_conciliacion: idConciliacion });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ [MANTENIMIENTO] Error en transacción:', error.message);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
}

/**
 * Liberar Stock de Mantenimiento a Ventas
 * Ejecuta la función SQL de infraestructura que mueve el stock y audita.
 */
async function liberarStock(req, res) {
    try {
        const { articulo, cantidad, observaciones } = req.body;
        const usuario = req.user ? req.user.username : 'SISTEMA';

        console.log(`📦 [MANTENIMIENTO] Liberando stock para Art: ${articulo}, Cant: ${cantidad}`);

        const query = `SELECT public.liberar_stock_mantenimiento($1, $2, $3, $4) as resultado`;
        const values = [articulo, cantidad || 1, usuario, observaciones || 'Reintegro a Ventas tras Conciliación'];

        const result = await pool.query(query, values);
        const data = result.rows[0].resultado;

        if (data.success) {
            console.log(`✅ Stock liberado exitosamente: ${articulo}`);
            res.json(data);
        } else {
            console.warn(`⚠️ Falló liberación de stock: ${data.error}`);
            res.status(400).json(data);
        }

    } catch (error) {
        console.error('❌ [MANTENIMIENTO] Error al liberar stock:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
}

module.exports = {
    getStockMantenimiento,
    getHistorialMantenimiento,
    conciliarDevolucion,
    confirmarConciliacion,
    liberarStock
};
