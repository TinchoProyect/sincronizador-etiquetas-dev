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
            WHERE im.id = $1 AND im.carro_id = $2
        `;
        const ingresoResult = await client.query(ingresoQuery, [ingresoId, carroId]);
        
        if (ingresoResult.rows.length === 0) {
            throw new Error('Ingreso manual no encontrado');
        }
        
        const ingreso = ingresoResult.rows[0];
        
        // 2. Eliminar el movimiento de stock_ventas_movimientos si existe
        if (ingreso.observaciones) { // observaciones contiene el articulo_numero
            const deleteStockQuery = `
                DELETE FROM stock_ventas_movimientos 
                WHERE articulo_numero = $1 
                AND carro_id = $2 
                AND fecha = $3
            `;
            await client.query(deleteStockQuery, [
                ingreso.observaciones,
                carroId,
                ingreso.fecha
            ]);
        }
        
        // 3. Eliminar el movimiento de ingredientes
        const deleteIngresoQuery = `
            DELETE FROM ingredientes_movimientos 
            WHERE id = $1 AND carro_id = $2
        `;
        await client.query(deleteIngresoQuery, [ingresoId, carroId]);
        
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
