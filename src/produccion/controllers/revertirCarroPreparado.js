const pool = require('../config/database');
const { recalcularStockConsolidado } = require('../utils/recalcularStock');

/**
 * Reversión quirúrgica de la preparación de un carro.
 * Aísla las transacciones de egreso por preparación y las deshace, 
 * devolviendo el carro al estado de edición.
 */
async function revertirCarroPreparado(req, res) {
    const db = req.db || pool;
    const { id: carroId } = req.params;
    const { usuarioId } = req.body;

    if (!carroId || !usuarioId) {
        return res.status(400).json({ error: 'Faltan datos obligatorios (carroId o usuarioId)' });
    }

    try {
        await db.query('BEGIN');

        // 1. Validar propiedad y que el carro esté en estado "preparado"
        const { rows: carro } = await db.query(
            'SELECT fecha_preparado, fecha_confirmacion FROM carros_produccion WHERE id = $1 AND usuario_id = $2', 
            [carroId, usuarioId]
        );

        if (carro.length === 0) {
            throw new Error('Carro no encontrado o no pertenece al usuario');
        }

        if (!carro[0].fecha_preparado) {
            throw new Error('El carro no está en estado Preparado (no se puede revertir).');
        }

        if (carro[0].fecha_confirmacion) {
            throw new Error('El carro ya ha sido Asentado. No se puede revertir su preparación.');
        }

        console.log(`\n🔙 INICIANDO ROLLBACK PARCIAL (Revertir Preparación) - Carro #${carroId}`);
        console.log('===================================================================');

        // 2. Borrar egresos de ingredientes_movimientos
        // Nota: Al borrar en ingredientes_movimientos, el trigger nativo "actualizar_stock_ingrediente" 
        // de PostgreSQL recalcula y devuelve el stock al total.
        const resMovimientos = await db.query(`
            DELETE FROM ingredientes_movimientos 
            WHERE carro_id = $1 
            AND tipo = 'egreso' 
            AND (observaciones LIKE 'Preparación de carro #%' OR observaciones LIKE 'Egreso por carro externo #%')
        `, [carroId]);
        console.log(`✅ Eliminados ${resMovimientos.rowCount} movimientos de ingredientes (trigger nativo restaurará stock general).`);

        // 3. Borrar egresos FIFO de ingredientes_stock_usuarios
        const resStockUsuarios = await db.query(`
            DELETE FROM ingredientes_stock_usuarios 
            WHERE origen_carro_id = $1 AND cantidad < 0
        `, [carroId]);
        console.log(`✅ Eliminados ${resStockUsuarios.rowCount} movimientos FIFO negativos de ingredientes de usuario.`);

        // 4. Revertir egresos de stock_ventas_movimientos (Para recetas externas)
        const ventasRows = await db.query(`
            SELECT articulo_numero, cantidad 
            FROM stock_ventas_movimientos 
            WHERE carro_id = $1 AND tipo = 'egreso por receta externa'
        `, [carroId]);

        if (ventasRows.rows.length > 0) {
            console.log(`🔄 Revirtiendo ${ventasRows.rows.length} movimientos de stock de ventas (receta externa)...`);
            const articulosAfectados = [];
            
            for (const mov of ventasRows.rows) {
                // Cantidad es negativa en la base, por tanto tomamos Math.abs() para sumar de vuelta
                await db.query(`
                    UPDATE stock_real_consolidado 
                    SET 
                        stock_movimientos = COALESCE(stock_movimientos, 0) + $1, 
                        ultima_actualizacion = NOW() 
                    WHERE articulo_numero = $2
                `, [Math.abs(mov.cantidad), mov.articulo_numero]);
                
                if (!articulosAfectados.includes(mov.articulo_numero)) {
                    articulosAfectados.push(mov.articulo_numero);
                }
            }

            // Recalcular consolidado
            await recalcularStockConsolidado(db, articulosAfectados);
            console.log(`✅ Stock consolidado recalculado para ${articulosAfectados.length} artículos afectados.`);

            // Eliminar los registros en stock_ventas_movimientos
            const resVentas = await db.query(`
                DELETE FROM stock_ventas_movimientos 
                WHERE carro_id = $1 AND tipo = 'egreso por receta externa'
            `, [carroId]);
            console.log(`✅ Eliminados ${resVentas.rowCount} movimientos de stock_ventas_movimientos.`);
        }

        // 5. Limpiar fecha_preparado de la cabecera
        await db.query(`
            UPDATE carros_produccion 
            SET fecha_preparado = NULL 
            WHERE id = $1
        `, [carroId]);
        console.log(`✅ Cabecera del carro restaurada a estado de edición (fecha_preparado = NULL).`);

        await db.query('COMMIT');
        
        console.log('===================================================================');
        console.log(`✅ ROLLBACK PARCIAL COMPLETADO CON ÉXITO\n`);

        return res.json({
            mensaje: 'Preparación revertida exitosamente. El carro vuelve a estar en edición.',
            success: true
        });

    } catch (error) {
        await db.query('ROLLBACK');
        console.error('❌ Error al revertir la preparación del carro:', error);
        return res.status(500).json({
            error: 'Error al revertir la preparación del carro',
            detalle: error.message
        });
    }
}

module.exports = {
    revertirCarroPreparado
};
