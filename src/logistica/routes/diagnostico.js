/**
 * Ruta de Diagnóstico Temporal
 * Para verificar el estado de los presupuestos
 */

const express = require('express');
const router = express.Router();

/**
 * Diagnóstico de presupuestos
 */
router.get('/presupuestos', async (req, res) => {
    try {
        const pool = req.db;
        
        // 1. Total de presupuestos
        const total = await pool.query('SELECT COUNT(*) as total FROM presupuestos');
        
        // 2. Presupuestos por secuencia
        const porSecuencia = await pool.query(`
            SELECT secuencia, COUNT(*) as cantidad
            FROM presupuestos
            GROUP BY secuencia
            ORDER BY cantidad DESC
        `);
        
        // 3. Presupuestos con 'Pedido listo'
        const pedidosListos = await pool.query(`
            SELECT COUNT(*) as total
            FROM presupuestos
            WHERE secuencia = 'Pedido listo'
        `);
        
        // 4. Presupuestos con 'Pedido listo' y activos
        const pedidosListosActivos = await pool.query(`
            SELECT COUNT(*) as total
            FROM presupuestos
            WHERE secuencia = 'Pedido listo'
            AND activo = true
        `);
        
        // 5. Presupuestos con 'Pedido listo', activos y con domicilio
        const conDomicilio = await pool.query(`
            SELECT COUNT(*) as total
            FROM presupuestos
            WHERE secuencia = 'Pedido listo'
            AND activo = true
            AND id_domicilio_entrega IS NOT NULL
        `);
        
        // 6. Presupuestos con 'Pedido listo', activos, con domicilio y sin ruta
        const sinRuta = await pool.query(`
            SELECT COUNT(*) as total
            FROM presupuestos
            WHERE secuencia = 'Pedido listo'
            AND activo = true
            AND id_domicilio_entrega IS NOT NULL
            AND id_ruta IS NULL
        `);
        
        // 7. Muestra de 5 presupuestos con 'Pedido listo'
        const muestra = await pool.query(`
            SELECT 
                id,
                id_presupuesto_ext,
                secuencia,
                estado_logistico,
                id_ruta,
                id_domicilio_entrega,
                activo,
                id_cliente
            FROM presupuestos
            WHERE secuencia = 'Pedido listo'
            LIMIT 5
        `);
        
        res.json({
            success: true,
            diagnostico: {
                total_presupuestos: parseInt(total.rows[0].total),
                por_secuencia: porSecuencia.rows,
                pedidos_listos: parseInt(pedidosListos.rows[0].total),
                pedidos_listos_activos: parseInt(pedidosListosActivos.rows[0].total),
                con_domicilio: parseInt(conDomicilio.rows[0].total),
                sin_ruta: parseInt(sinRuta.rows[0].total),
                muestra_pedidos_listos: muestra.rows
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
