/**
 * Rutas para gestión de presupuestos en logística
 */

const express = require('express');
const router = express.Router();
const { validatePermissions } = require('../middleware/auth');

console.log('🔍 [PRESUPUESTOS-LOG] Configurando rutas de presupuestos...');

/**
 * PUT /api/logistica/presupuestos/:id/domicilio
 * Asignar domicilio de entrega a un presupuesto
 */
router.put('/:id/domicilio',
    validatePermissions('logistica.asignar_domicilio'),
    async (req, res) => {
        try {
            const { id } = req.params;
            const { id_domicilio_entrega } = req.body;
            
            console.log(`[PRESUPUESTOS-LOG] Asignando domicilio ${id_domicilio_entrega} a presupuesto ${id}`);
            
            // Validar que el domicilio existe
            const domicilioCheck = await req.db.query(
                'SELECT id, id_cliente FROM clientes_domicilios WHERE id = $1',
                [id_domicilio_entrega]
            );
            
            if (domicilioCheck.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Domicilio no encontrado'
                });
            }
            
            // Actualizar presupuesto
            const result = await req.db.query(
                `UPDATE presupuestos 
                 SET id_domicilio_entrega = $1
                 WHERE id = $2
                 RETURNING id, id_domicilio_entrega`,
                [id_domicilio_entrega, id]
            );
            
            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Presupuesto no encontrado'
                });
            }
            
            console.log(`[PRESUPUESTOS-LOG] ✅ Domicilio asignado correctamente`);
            
            res.json({
                success: true,
                message: 'Domicilio asignado correctamente',
                data: result.rows[0]
            });
            
        } catch (error) {
            console.error('[PRESUPUESTOS-LOG] Error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);

console.log('✅ [PRESUPUESTOS-LOG] Rutas de presupuestos configuradas');

module.exports = router;
