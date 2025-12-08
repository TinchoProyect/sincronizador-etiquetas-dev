/**
 * Ruta de diagnóstico para verificar valores de secuencia
 */

const express = require('express');
const router = express.Router();

/**
 * GET /api/logistica/diagnostico/secuencia
 * Muestra todos los valores distintos de secuencia
 */
router.get('/secuencia', async (req, res) => {
    try {
        const { pool } = req.db;
        
        // Consulta 1: Todos los valores de secuencia
        const query1 = `
            SELECT DISTINCT 
                secuencia,
                COUNT(*) as cantidad
            FROM presupuestos
            WHERE activo = true
            GROUP BY secuencia
            ORDER BY secuencia;
        `;
        
        const result1 = await pool.query(query1);
        
        // Consulta 2: Presupuestos con secuencia que contenga "Pedido"
        const query2 = `
            SELECT 
                id,
                secuencia,
                estado,
                estado_logistico,
                id_ruta,
                activo
            FROM presupuestos
            WHERE secuencia LIKE '%Pedido%'
              AND activo = true
            ORDER BY id DESC
            LIMIT 10;
        `;
        
        const result2 = await pool.query(query2);
        
        res.json({
            success: true,
            data: {
                valores_secuencia: result1.rows,
                presupuestos_con_pedido: result2.rows
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
