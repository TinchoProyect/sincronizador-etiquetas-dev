const pool = require('../config/database');

/**
 * Elimina físicamente un ingreso manual y sus movimientos asociados
 */
async function eliminarIngresoManual(req, res) {
    const client = await pool.connect();
    
    try {
        const { carroId, ingresoId } = req.params;
        
        console.log(`🗑️ Eliminando ingreso manual ${ingresoId} del carro ${carroId}`);
        
        // Iniciar transacción
        await client.query('BEGIN');

        // 1. Obtener datos del ingreso antes de eliminarlo
        const ingresoQuery = `
            SELECT im.*, a.codigo_barras 
            FROM ingredientes_movimientos im
            LEFT JOIN articulos a ON a.numero = im.observaciones
            WHERE im.id = $1 AND im.carro_id = $2 AND im.tipo = 'ingreso'
        `;
        const ingresoResult = await client.query(ingresoQuery, [ingresoId, carroId]);
        
        if (ingresoResult.rows.length === 0) {
            throw new Error('Ingreso manual no encontrado');
        }
        
        const ingreso = ingresoResult.rows[0];
        
        // 2. Obtener y procesar movimientos de stock de ventas antes de eliminarlos
        let deleteStockResult = { rowCount: 0 };
        if (ingreso.observaciones) { // observaciones contiene el articulo_numero
            // Primero obtener los movimientos que vamos a eliminar
            const movimientosQuery = `
                SELECT articulo_numero, cantidad, tipo
                FROM stock_ventas_movimientos 
                WHERE articulo_numero = $1 
                AND carro_id = $2 
                AND tipo = 'ingreso a producción'
            `;
            const movimientosResult = await client.query(movimientosQuery, [
                ingreso.observaciones,
                carroId
            ]);
            
            // Revertir el efecto en stock_movimientos antes de eliminar
            for (const mov of movimientosResult.rows) {
                if (mov.tipo === 'ingreso a producción') {
                    // Para ingreso a producción eliminado: SUMAR de vuelta la cantidad a stock_movimientos
                    await client.query(`
                        UPDATE stock_real_consolidado 
                        SET 
                            stock_movimientos = COALESCE(stock_movimientos, 0) + $1,
                            ultima_actualizacion = NOW()
                        WHERE articulo_numero = $2
                    `, [mov.cantidad, mov.articulo_numero]);
                    console.log(`Stock movimientos actualizado para artículo ${mov.articulo_numero}: +${mov.cantidad} (revertir ingreso a producción)`);
                }
            }
            
            // Ahora eliminar los movimientos
            const deleteStockQuery = `
                DELETE FROM stock_ventas_movimientos 
                WHERE articulo_numero = $1 
                AND carro_id = $2 
                AND tipo = 'ingreso a producción'
            `;
            
            deleteStockResult = await client.query(deleteStockQuery, [
                ingreso.observaciones,
                carroId
            ]);
            
            console.log(`✅ Eliminados ${deleteStockResult.rowCount} movimientos de stock_ventas_movimientos`);
        }
        
        // 3. Eliminar el movimiento de ingredientes
        const deleteIngresoQuery = `
            DELETE FROM ingredientes_movimientos 
            WHERE id = $1 AND carro_id = $2 AND tipo = 'ingreso'
        `;
        const deleteIngresoResult = await client.query(deleteIngresoQuery, [ingresoId, carroId]);
        
        if (deleteIngresoResult.rowCount === 0) {
            throw new Error('No se pudo eliminar el ingreso de ingredientes_movimientos');
        }
        
        console.log('✅ Eliminado de ingredientes_movimientos');
        
        // 4. Recalcular el stock consolidado
        if (ingreso.observaciones) {
            const { recalcularStockConsolidado } = require('../utils/recalcularStock');
            await recalcularStockConsolidado(client, ingreso.observaciones);
        }
        
        // Confirmar transacción
        await client.query('COMMIT');
        
        console.log('✅ Ingreso manual eliminado correctamente');
        
        res.json({
            message: 'Ingreso manual eliminado correctamente',
            eliminados: {
                ingrediente_movimiento: true,
                stock_movimiento: ingreso.observaciones ? true : false
            }
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error al eliminar ingreso manual:', error);
        res.status(500).json({ 
            error: 'Error al eliminar ingreso manual',
            detalle: error.message 
        });
    } finally {
        client.release();
    }
}

module.exports = {
    eliminarIngresoManual
};
