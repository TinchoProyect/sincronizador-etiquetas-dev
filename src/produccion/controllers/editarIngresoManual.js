const pool = require('../config/database');

/**
 * Edita de forma atómica un ingreso manual y sus movimientos asociados
 * usando el principio de inmutabilidad (DELETE viejo + INSERT nuevo)
 */
async function editarIngresoManual(req, res) {
    const client = await pool.connect();
    
    try {
        const { carroId, uuid } = req.params;
        const { movimientoIngrediente, movimientoStock, stockUsuario } = req.body;
        
        console.log(`✏️ EDITANDO INGRESO MANUAL UUID ${uuid} DEL CARRO ${carroId}`);
        console.log('================================================================');
        
        // Iniciar transacción
        await client.query('BEGIN');

        // 🔍 PASO 1: Eliminar el ingreso viejo usando el UUID

        // Borrar de ingredientes_movimientos
        const deleteIngresoQuery = `
            DELETE FROM ingredientes_movimientos 
            WHERE carro_id = $1 AND observaciones LIKE $2
            RETURNING ingrediente_id
        `;
        const uuidPattern = `%[UUID: ${uuid}]%`;
        const deletedIngredientes = await client.query(deleteIngresoQuery, [carroId, uuidPattern]);
        
        // Borrar de stock_ventas_movimientos (para revertir)
        // NOTA: stock_ventas_movimientos usa triggers si los tuviera, pero según el código actual
        // revertimos a mano el stock_movimientos antes de eliminar.
        const selectStockQuery = `
            SELECT articulo_numero, cantidad, kilos
            FROM stock_ventas_movimientos 
            WHERE carro_id = $1 AND observaciones LIKE $2
        `;
        const stockViejoRows = await client.query(selectStockQuery, [carroId, uuidPattern]);

        const { recalcularStockConsolidado } = require('../utils/recalcularStock');
        const { calcularUnidadesMovimientoIngresoProduccion } = require('../utils/articuloPuenteHelper');

        if (stockViejoRows.rows.length > 0) {
            for (const stockViejo of stockViejoRows.rows) {
                const cantidadUnidadesARevertir = await calcularUnidadesMovimientoIngresoProduccion(
                    client,
                    stockViejo.articulo_numero,
                    stockViejo.cantidad,
                    stockViejo.kilos
                );
                
                const revertirStockMovimientosQuery = `
                    UPDATE stock_real_consolidado 
                    SET 
                        stock_movimientos = COALESCE(stock_movimientos, 0) + $1,
                        ultima_actualizacion = NOW()
                    WHERE articulo_numero = $2
                `;
                await client.query(revertirStockMovimientosQuery, [cantidadUnidadesARevertir, stockViejo.articulo_numero]);
                
                // Borramos la fila
                await client.query(`DELETE FROM stock_ventas_movimientos WHERE carro_id = $1 AND observaciones LIKE $2`, [carroId, uuidPattern]);
                
                // Recalcular consolidado del artículo viejo
                await recalcularStockConsolidado(client, stockViejo.articulo_numero);
            }
        }

        console.log(`✅ Movimientos anteriores eliminados para UUID: ${uuid}`);

        // 🔍 PASO 2: Insertar el nuevo movimiento

        // A. Insertar Stock Usuario (si existe) — Regla dura: ingresos positivos jamás llevan origen_carro_id
        if (stockUsuario) {
            const cantUsr = parseFloat(stockUsuario.cantidad) || 0;
            const esEgresoConsumo = cantUsr < 0;
            const updateStockUsuario = `
                INSERT INTO ingredientes_stock_usuarios
                    (usuario_id, ingrediente_id, cantidad, origen_carro_id, carro_referencia_id, origen_mix_id, tipo_movimiento)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `;
            await client.query(updateStockUsuario, [
                stockUsuario.usuario_id,
                stockUsuario.ingrediente_id,
                cantUsr,
                esEgresoConsumo ? (stockUsuario.origen_carro_id || null) : null,
                !esEgresoConsumo ? (stockUsuario.origen_carro_id || null) : null,
                stockUsuario.origen_mix_id || null,
                esEgresoConsumo ? 'consumo_produccion' : 'abastecimiento_deposito'
            ]);
        }

        // B. Insertar Movimiento Stock Ventas
        if (movimientoStock) {
            const insertStock = `
                INSERT INTO stock_ventas_movimientos 
                    (articulo_numero, codigo_barras, kilos, carro_id, usuario_id, fecha, cantidad, tipo, origen_ingreso, observaciones)
                VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9)
            `;
            await client.query(insertStock, [
                movimientoStock.articulo_numero,
                movimientoStock.codigo_barras,
                movimientoStock.kilos,
                movimientoStock.carro_id,
                movimientoStock.usuario_id,
                movimientoStock.cantidad || 1,
                movimientoStock.tipo,
                movimientoStock.origen_ingreso || 'simple',
                movimientoStock.observaciones
            ]);

            // Actualizar stock movimientos para el nuevo ingreso
            if (movimientoStock.tipo === 'ingreso a producción') {
                const unidadesADescontarNuevo = await calcularUnidadesMovimientoIngresoProduccion(
                    client,
                    movimientoStock.articulo_numero,
                    movimientoStock.cantidad || 1,
                    movimientoStock.kilos
                );
                const updateStockNuevo = `
                    UPDATE stock_real_consolidado 
                    SET 
                    stock_movimientos = COALESCE(stock_movimientos, 0) - $1,
                    ultima_actualizacion = NOW()
                    WHERE articulo_numero = $2
                `;
                await client.query(updateStockNuevo, [
                    unidadesADescontarNuevo,
                    movimientoStock.articulo_numero
                ]);
                
                // Recalcular consolidado del nuevo artículo
                await recalcularStockConsolidado(client, movimientoStock.articulo_numero);
            }
        }

        // C. Insertar Movimiento Ingrediente (Solo si es simple y no viene de mix, según logica original)
        if (movimientoIngrediente) {
            const insertIngrediente = `
                INSERT INTO ingredientes_movimientos 
                    (ingrediente_id, kilos, tipo, carro_id, observaciones, fecha, stock_anterior)
                VALUES ($1, $2, $3, $4, $5, NOW(), 0)
            `;
            await client.query(insertIngrediente, [
                movimientoIngrediente.ingrediente_id,
                movimientoIngrediente.kilos,
                movimientoIngrediente.tipo || 'ingreso',
                movimientoIngrediente.carro_id,
                movimientoIngrediente.observaciones
            ]);
        }

        // Confirmar transacción
        await client.query('COMMIT');
        
        console.log('✅ EDICIÓN DE INGRESO MANUAL COMPLETADA ATÓMICAMENTE');
        console.log('================================================================');
        
        res.json({
            message: 'Ingreso manual editado correctamente',
            editado: true
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ ERROR AL EDITAR INGRESO MANUAL:', error);
        res.status(500).json({ 
            error: 'Error al editar ingreso manual',
            detalle: error.message 
        });
    } finally {
        client.release();
    }
}

module.exports = {
    editarIngresoManual
};
