const express = require('express');
const router = express.Router();

/**
 * Endpoint de diagnóstico para verificar presupuestos con Pedido_Listo
 */
router.get('/presupuestos-pedido-listo', async (req, res) => {
    try {
        console.log('[DIAGNOSTICO] Verificando presupuestos con Pedido_Listo...');
        
        const pool = req.db;
        
        // Query 1: Contar presupuestos con Pedido_Listo
        const countQuery = `
            SELECT COUNT(*) as total
            FROM presupuestos p
            WHERE p.secuencia = 'Pedido_Listo'
              AND p.activo = true
        `;
        
        const countResult = await pool.query(countQuery);
        
        // Query 2: Obtener detalles de presupuestos con Pedido_Listo
        const detailsQuery = `
            SELECT 
                p.id,
                p.id_presupuesto_ext,
                p.fecha,
                p.estado,
                p.estado_logistico,
                p.secuencia,
                p.id_domicilio_entrega,
                p.id_ruta,
                p.id_cliente,
                p.activo,
                c.nombre as cliente_nombre
            FROM presupuestos p
            LEFT JOIN clientes c ON p.id_cliente = c.cliente_id::text
            WHERE p.secuencia = 'Pedido_Listo'
              AND p.activo = true
            ORDER BY p.fecha DESC
            LIMIT 10
        `;
        
        const detailsResult = await pool.query(detailsQuery);
        
        // Query 3: Verificar con todos los filtros (la query real)
        const fullQuery = `
            SELECT 
                p.id,
                p.id_presupuesto_ext,
                p.fecha,
                p.estado,
                p.estado_logistico,
                p.secuencia,
                p.id_domicilio_entrega,
                p.id_ruta,
                p.id_cliente,
                c.nombre as cliente_nombre
            FROM presupuestos p
            INNER JOIN clientes c ON p.id_cliente = c.cliente_id::text
            WHERE 
                p.secuencia = 'Pedido_Listo'
                AND p.activo = true
                AND REPLACE(LOWER(TRIM(p.estado)), ' ', '') = 'presupuesto/orden'
                AND (p.estado_logistico IS NULL OR p.estado_logistico = 'PENDIENTE_ASIGNAR')
                AND p.id_ruta IS NULL
            ORDER BY p.fecha DESC
        `;
        
        const fullResult = await pool.query(fullQuery);
        
        res.json({
            success: true,
            diagnostico: {
                total_con_pedido_listo: parseInt(countResult.rows[0].total),
                primeros_10: detailsResult.rows,
                con_todos_los_filtros: fullResult.rows,
                filtros_aplicados: {
                    secuencia: 'Pedido_Listo',
                    activo: true,
                    estado_normalizado: 'presupuesto/orden',
                    estado_logistico: 'NULL o PENDIENTE_ASIGNAR',
                    id_ruta: 'NULL'
                }
            }
        });
        
    } catch (error) {
        console.error('[DIAGNOSTICO] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
