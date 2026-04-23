require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/lamda_dev' });

async function checkQuery() {
    try {
        const result = await pool.query(`
            WITH saldos_clientes AS (
                SELECT 
                    mm.id as id_movimiento,
                    mm.id_presupuesto_origen,
                    CASE 
                        WHEN p.comprobante_lomasoft IS NOT NULL AND TRIM(p.comprobante_lomasoft) != '' THEN 'LOMASOFT'
                        ELSE p.origen_facturacion
                    END as origen_facturacion,
                    mm.articulo_numero,
                    mm.ingrediente_id,
                    mm.id_orden_tratamiento,
                    COALESCE(p.id_cliente::text, ot.id_cliente::text) AS cliente_id,
                    COALESCE(c.nombre || ' ' || c.apellido, c.nombre, c.apellido, c.otros, 'Desconocido') as cliente_nombre,
                    p.id_ruta AS origen_ruta_id,
                    p.comprobante_lomasoft AS presup_comprobante_lomasoft,
                    p.fecha AS presup_fecha,
                    p.estado AS estado_presupuesto,
                    mm.cantidad AS stock_mantenimiento,
                    mm.fecha_movimiento as ultima_actualizacion,
                    mm.usuario AS usuario,
                    mm.tipo_movimiento,
                    mm.observaciones,
                    mm.historial_tratamientos::text AS historial_tratamientos,
                    mm.estado as transaccion_estado,
                    ot.codigo_qr_hash as hash
                FROM public.mantenimiento_movimientos mm
                LEFT JOIN public.presupuestos p ON mm.id_presupuesto_origen = p.id
                LEFT JOIN public.ordenes_tratamiento ot ON mm.id_orden_tratamiento = ot.id
                LEFT JOIN public.clientes c ON COALESCE(p.id_cliente::text, ot.id_cliente::text) = c.cliente_id::text
                WHERE mm.estado IN ('PENDIENTE', 'CONCILIADO', 'BORRADOR', 'EN_TRATAMIENTO')
                  AND mm.tipo_movimiento IN ('INGRESO', 'TRASLADO_INTERNO_VENTAS', 'TRASLADO_INTERNO_INGREDIENTES', 'RETORNO_TRATAMIENTO', 'RETIRO_TRATAMIENTO')
                  AND mm.cantidad > 0
            )
            SELECT 
                sc.id_movimiento AS id,
                sc.id_presupuesto_origen,
                or_retiro.id_orden_retiro
            FROM saldos_clientes sc
            LEFT JOIN LATERAL (
                SELECT id AS id_orden_retiro
                FROM public.presupuestos p_retiro
                WHERE p_retiro.origen_numero_factura = sc.id_presupuesto_origen::text
                  AND p_retiro.tipo_comprobante = 'Orden de Retiro'
                ORDER BY p_retiro.id DESC
                LIMIT 1
            ) or_retiro ON true
            ORDER BY sc.ultima_actualizacion DESC
            LIMIT 1;
        `);
        console.log('Query OK:', result.rows);
    } catch (e) {
        console.error('QUERY ERROR:', e.message);
    } finally {
        pool.end();
    }
}
checkQuery();
