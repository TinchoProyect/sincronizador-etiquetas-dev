const pool = require('../config/database');

/**
 * Elimina físicamente un ingreso manual y sus movimientos asociados
 * 🔧 CORRECCIÓN CRÍTICA: Simplificado para evitar duplicación de lógica
 */
async function eliminarIngresoManual(req, res) {
    const client = await pool.connect();
    
    try {
        const { carroId, ingresoId } = req.params;
        
        console.log(`🗑️ ELIMINANDO INGRESO MANUAL ${ingresoId} DEL CARRO ${carroId}`);
        console.log('================================================================');
        
        // Iniciar transacción
        await client.query('BEGIN');

        // 🔍 PASO 1: Buscar el ingreso en stock_ventas_movimientos (fuente principal del ID)
        const stockQuery = `
            SELECT 
                svm.*,
                cp.tipo_carro,
                a.nombre as articulo_nombre
            FROM stock_ventas_movimientos svm
            LEFT JOIN carros_produccion cp ON cp.id = svm.carro_id
            LEFT JOIN articulos a ON a.numero = svm.articulo_numero
            WHERE svm.id = $1 AND svm.carro_id = $2 AND svm.tipo = 'ingreso a producción'
        `;
        const stockResult = await client.query(stockQuery, [ingresoId, carroId]);
        
        if (stockResult.rows.length === 0) {
            throw new Error(`Ingreso manual ${ingresoId} no encontrado`);
        }
        
        const stockIngreso = stockResult.rows[0];
        const tipoCarro = stockIngreso.tipo_carro || 'interna';
        
        console.log('📋 Ingreso encontrado:', {
            id: stockIngreso.id,
            articulo_numero: stockIngreso.articulo_numero,
            articulo_nombre: stockIngreso.articulo_nombre,
            kilos: stockIngreso.kilos,
            tipo_carro: tipoCarro
        });

        // 🔍 PASO 2: Buscar registro relacionado en ingredientes_movimientos
        const ingresoQuery = `
            SELECT im.*, i.nombre as ingrediente_nombre
            FROM ingredientes_movimientos im
            LEFT JOIN ingredientes i ON i.id = im.ingrediente_id
            WHERE im.carro_id = $1 
            AND im.tipo = 'ingreso'
            AND im.observaciones = $2
            ORDER BY im.fecha DESC
            LIMIT 1
        `;
        
        const ingresoResult = await client.query(ingresoQuery, [
            carroId, 
            stockIngreso.articulo_numero
        ]);
        
        let ingresoIngrediente = null;
        if (ingresoResult.rows.length > 0) {
            ingresoIngrediente = ingresoResult.rows[0];
            console.log('📋 Registro relacionado encontrado en ingredientes_movimientos:', {
                id: ingresoIngrediente.id,
                ingrediente_id: ingresoIngrediente.ingrediente_id,
                ingrediente_nombre: ingresoIngrediente.ingrediente_nombre,
                kilos: ingresoIngrediente.kilos
            });
        } else {
            console.log('⚠️ No se encontró registro relacionado en ingredientes_movimientos');
        }

        // 🔧 PASO 3: Eliminar registro de ingredientes_movimientos (si existe)
        // El trigger se encargará automáticamente de revertir el stock_actual
        if (ingresoIngrediente) {
            console.log('🗑️ Eliminando de ingredientes_movimientos...');
            
            // 🔍 LOG: Stock antes de eliminar
            const stockAntesQuery = `SELECT stock_actual, nombre FROM ingredientes WHERE id = $1`;
            const stockAntesResult = await client.query(stockAntesQuery, [ingresoIngrediente.ingrediente_id]);
            const stockAntes = stockAntesResult.rows[0]?.stock_actual || 0;
            const nombreIngrediente = stockAntesResult.rows[0]?.nombre || 'Desconocido';

            console.log(`\n🔍 ===== ELIMINACIÓN INGRESO MANUAL - INGREDIENTE ID ${ingresoIngrediente.ingrediente_id} =====`);
            console.log(`📋 INGREDIENTE: "${nombreIngrediente}"`);
            console.log(`📊 STOCK ANTES: ${stockAntes}`);
            console.log(`⚡ El trigger revertirá automáticamente el stock al eliminar el registro`);
            
            const deleteIngresoQuery = `
                DELETE FROM ingredientes_movimientos 
                WHERE id = $1 AND carro_id = $2 AND tipo = 'ingreso'
            `;
            const deleteIngresoResult = await client.query(deleteIngresoQuery, [ingresoIngrediente.id, carroId]);
            
            if (deleteIngresoResult.rowCount > 0) {
                console.log(`✅ Eliminado de ingredientes_movimientos (ID: ${ingresoIngrediente.id})`);
                
                // 🔍 LOG: Stock después de eliminar (trigger ya actuó)
                const stockDespuesResult = await client.query(stockAntesQuery, [ingresoIngrediente.ingrediente_id]);
                const stockDespues = stockDespuesResult.rows[0]?.stock_actual || 0;
                console.log(`📊 STOCK DESPUÉS: ${stockDespues}`);
                console.log(`✅ CAMBIO POR TRIGGER: ${stockAntes} → ${stockDespues} (${stockDespues - stockAntes >= 0 ? '+' : ''}${stockDespues - stockAntes})`);
                
                // 🔍 LOG ESPECIAL para Grana de Flor
                if (ingresoIngrediente.ingrediente_id === 122 || nombreIngrediente.toLowerCase().includes('grana')) {
                    console.log(`\n🌸 ===== GRANA DE FLOR - MONITOREO ESPECIAL ELIMINACIÓN =====`);
                    console.log(`🆔 ID: ${ingresoIngrediente.ingrediente_id}`);
                    console.log(`📛 NOMBRE: ${nombreIngrediente}`);
                    console.log(`📊 STOCK ANTERIOR: ${stockAntes}`);
                    console.log(`📊 STOCK NUEVO: ${stockDespues}`);
                    console.log(`🔄 DIFERENCIA: ${stockDespues - stockAntes}`);
                    console.log(`⏰ TIMESTAMP: ${new Date().toISOString()}`);
                    console.log(`===============================================\n`);
                }
            } else {
                console.warn('⚠️ No se pudo eliminar el registro de ingredientes_movimientos');
            }
            console.log(`========================================================\n`);
        }

        // 🔧 PASO 4: Eliminar de stock_ventas_movimientos y revertir stock_movimientos correctamente
        console.log('🔄 Eliminando de stock_ventas_movimientos y revirtiendo stock_movimientos...');
        
        // 🔍 LOG: Obtener estado actual antes de la eliminación
        const stockAntesQuery = `
            SELECT stock_lomasoft, stock_movimientos, stock_ajustes, stock_consolidado, ultima_actualizacion
            FROM stock_real_consolidado 
            WHERE articulo_numero = $1
        `;
        const stockAntesResult = await client.query(stockAntesQuery, [stockIngreso.articulo_numero]);
        const stockAntes = stockAntesResult.rows[0] || {};
        
        console.log(`\n🔍 ===== ESTADO ANTES DE ELIMINACIÓN - ARTÍCULO ${stockIngreso.articulo_numero} =====`);
        console.log(`📋 ARTÍCULO: "${stockIngreso.articulo_nombre}"`);
        console.log(`📊 stock_lomasoft: ${stockAntes.stock_lomasoft || 0}`);
        console.log(`📊 stock_movimientos: ${stockAntes.stock_movimientos || 0}`);
        console.log(`📊 stock_ajustes: ${stockAntes.stock_ajustes || 0}`);
        console.log(`📊 stock_consolidado: ${stockAntes.stock_consolidado || 0}`);
        console.log(`🗑️ Kilos a revertir: ${stockIngreso.kilos} (cantidad original del ingreso)`);
        console.log(`===============================================================`);
        
        // Eliminar de stock_ventas_movimientos
        const deleteStockQuery = `
            DELETE FROM stock_ventas_movimientos 
            WHERE id = $1 AND carro_id = $2
        `;
        const deleteStockResult = await client.query(deleteStockQuery, [ingresoId, carroId]);
        
        if (deleteStockResult.rowCount === 0) {
            throw new Error('No se pudo eliminar el registro de stock_ventas_movimientos');
        }
        
        console.log(`✅ Eliminado de stock_ventas_movimientos (ID: ${ingresoId})`);
        
        // 🔧 CORRECCIÓN CRÍTICA: Revertir correctamente el stock_movimientos usando CANTIDAD (no kilos)
        // Cuando se registró el ingreso, se RESTÓ la CANTIDAD de stock_movimientos
        // Al eliminar, debemos SUMAR la CANTIDAD para revertir el efecto
        const cantidadUnidadesARevertir = Math.abs(parseFloat(stockIngreso.cantidad) || 1);
        const kilosOriginales = Math.abs(parseFloat(stockIngreso.kilos) || 0);
        
        if (cantidadUnidadesARevertir > 0 && stockIngreso.articulo_numero) {
            console.log(`🔄 Revirtiendo stock_movimientos para artículo ${stockIngreso.articulo_numero}...`);
            
            // 🔍 LOG CRÍTICO: Mostrar claramente qué valores se están usando
            console.log(`\n🔍 ===== DEPURACIÓN CRÍTICA - REVERSIÓN DE STOCK_MOVIMIENTOS =====`);
            console.log(`📋 articulo_numero: ${stockIngreso.articulo_numero}`);
            console.log(`📊 cantidad (unidades): ${cantidadUnidadesARevertir} ← ESTE VALOR SE USA PARA stock_movimientos`);
            console.log(`📊 kilos: ${kilosOriginales} ← ESTE VALOR NO SE USA PARA stock_movimientos`);
            console.log(`✅ Valor aplicado a stock_movimientos: +${cantidadUnidadesARevertir} (unidades)`);
            console.log(`================================================================`);
            
            // Para carros internos: el ingreso original RESTÓ la CANTIDAD de stock_movimientos, 
            // por lo tanto al eliminar debemos SUMAR la CANTIDAD para revertir
            const revertirStockMovimientosQuery = `
                UPDATE stock_real_consolidado 
                SET 
                    stock_movimientos = COALESCE(stock_movimientos, 0) + $1,
                    ultima_actualizacion = NOW()
                WHERE articulo_numero = $2
            `;
            const revertirStockResult = await client.query(revertirStockMovimientosQuery, [cantidadUnidadesARevertir, stockIngreso.articulo_numero]);
            
            console.log(`📈 stock_movimientos revertido para artículo ${stockIngreso.articulo_numero}: +${cantidadUnidadesARevertir} unidades (filas afectadas: ${revertirStockResult.rowCount})`);
            
            // 🔍 LOG: Verificar estado después de la reversión manual
            const stockDespuesRevertirResult = await client.query(stockAntesQuery, [stockIngreso.articulo_numero]);
            const stockDespuesRevertir = stockDespuesRevertirResult.rows[0] || {};
            
            console.log(`\n🔍 ===== ESTADO DESPUÉS DE REVERTIR stock_movimientos =====`);
            console.log(`📊 stock_movimientos ANTES: ${stockAntes.stock_movimientos || 0}`);
            console.log(`📊 stock_movimientos DESPUÉS: ${stockDespuesRevertir.stock_movimientos || 0}`);
            console.log(`📊 Cambio en stock_movimientos: ${(stockDespuesRevertir.stock_movimientos || 0) - (stockAntes.stock_movimientos || 0)} (debe ser +${cantidadUnidadesARevertir})`);
            console.log(`📊 stock_consolidado (antes del recálculo): ${stockDespuesRevertir.stock_consolidado || 0}`);
            console.log(`✅ VERIFICACIÓN: ¿Cambio correcto? ${((stockDespuesRevertir.stock_movimientos || 0) - (stockAntes.stock_movimientos || 0)) === cantidadUnidadesARevertir ? 'SÍ ✅' : 'NO ❌'}`);
            console.log(`========================================================`);
        }

        // 🔧 PASO 5: Recalcular stock consolidado
        if (stockIngreso.articulo_numero) {
            try {
                const { recalcularStockConsolidado } = require('../utils/recalcularStock');
                await recalcularStockConsolidado(client, stockIngreso.articulo_numero);
                console.log('✅ Stock consolidado recalculado');
                
                // 🔍 LOG: Verificar estado final después del recálculo
                const stockFinalResult = await client.query(stockAntesQuery, [stockIngreso.articulo_numero]);
                const stockFinal = stockFinalResult.rows[0] || {};
                
                console.log(`\n🔍 ===== ESTADO FINAL DESPUÉS DEL RECÁLCULO =====`);
                console.log(`📊 stock_lomasoft: ${stockFinal.stock_lomasoft || 0}`);
                console.log(`📊 stock_movimientos: ${stockFinal.stock_movimientos || 0}`);
                console.log(`📊 stock_ajustes: ${stockFinal.stock_ajustes || 0}`);
                console.log(`📊 stock_consolidado FINAL: ${stockFinal.stock_consolidado || 0}`);
                console.log(`🔄 Cambio total en stock_consolidado: ${(stockFinal.stock_consolidado || 0) - (stockAntes.stock_consolidado || 0)}`);
                console.log(`⏰ Última actualización: ${stockFinal.ultima_actualizacion}`);
                console.log(`===============================================`);
                
            } catch (recalcError) {
                console.warn('⚠️ Error al recalcular stock consolidado:', recalcError.message);
            }
        }
        
        // Confirmar transacción
        await client.query('COMMIT');
        
        console.log('✅ INGRESO MANUAL ELIMINADO COMPLETAMENTE');
        console.log('================================================================');
        
        res.json({
            message: 'Ingreso manual eliminado correctamente',
            eliminados: {
                ingrediente_movimiento: ingresoIngrediente ? true : false,
                stock_movimiento: true,
                stock_revertido: true
            }
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ ERROR AL ELIMINAR INGRESO MANUAL:', error);
        console.error('❌ Stack trace:', error.stack);
        res.status(500).json({ 
            error: 'Error al eliminar ingreso manual',
            detalle: error.message 
        });
    } finally {
        client.release();
    }
}

async function eliminarIngresoManualPorUUID(req, res) {
    const client = await pool.connect();
    
    try {
        const { carroId, uuid } = req.params;
        
        console.log(`🗑️ ELIMINANDO INGRESO MANUAL UUID ${uuid} DEL CARRO ${carroId}`);
        console.log('================================================================');
        
        await client.query('BEGIN');

        // Borrar de ingredientes_movimientos
        const deleteIngresoQuery = `
            DELETE FROM ingredientes_movimientos 
            WHERE carro_id = $1 AND observaciones LIKE $2
            RETURNING ingrediente_id
        `;
        const uuidPattern = `%[UUID: ${uuid}]%`;
        await client.query(deleteIngresoQuery, [carroId, uuidPattern]);
        
        // Borrar de stock_ventas_movimientos (para revertir)
        const selectStockQuery = `
            SELECT articulo_numero, cantidad, kilos
            FROM stock_ventas_movimientos 
            WHERE carro_id = $1 AND observaciones LIKE $2
        `;
        const stockViejoRows = await client.query(selectStockQuery, [carroId, uuidPattern]);

        if (stockViejoRows.rows.length > 0) {
            for (const stockViejo of stockViejoRows.rows) {
                const cantidadUnidadesARevertir = Math.abs(parseFloat(stockViejo.cantidad) || 1);
                
                const revertirStockMovimientosQuery = `
                    UPDATE stock_real_consolidado 
                    SET 
                        stock_movimientos = COALESCE(stock_movimientos, 0) + $1,
                        ultima_actualizacion = NOW()
                    WHERE articulo_numero = $2
                `;
                await client.query(revertirStockMovimientosQuery, [cantidadUnidadesARevertir, stockViejo.articulo_numero]);
                
                await client.query(`DELETE FROM stock_ventas_movimientos WHERE carro_id = $1 AND observaciones LIKE $2`, [carroId, uuidPattern]);
                
                const { recalcularStockConsolidado } = require('../utils/recalcularStock');
                await recalcularStockConsolidado(client, stockViejo.articulo_numero);
            }
        }
        
        await client.query('COMMIT');
        
        res.json({
            message: 'Ingreso manual eliminado por UUID correctamente'
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ ERROR AL ELIMINAR INGRESO MANUAL POR UUID:', error);
        res.status(500).json({ error: 'Error al eliminar ingreso manual' });
    } finally {
        client.release();
    }
}

module.exports = {
    eliminarIngresoManual,
    eliminarIngresoManualPorUUID
};
