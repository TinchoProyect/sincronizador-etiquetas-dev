const { registrarMovimientoStockVentas } = require('./stockVentasMovimientos');

/**
 * Finaliza la producción de un carro y registra los movimientos de stock de ventas
 */
async function finalizarProduccion(req, res) {
    const db = req.db;
    const { id: carroId } = req.params;
    const { usuarioId } = req.body;

    if (!carroId || !usuarioId) {
        return res.status(400).json({ 
            error: 'Faltan datos obligatorios (carroId o usuarioId)' 
        });
    }

    try {
        // Iniciar transacción
        await db.query('BEGIN');

        // 1. Verificar que el carro exista, pertenezca al usuario y esté preparado
        const { rows: [carro] } = await db.query(
            'SELECT * FROM carros_produccion WHERE id = $1 AND usuario_id = $2',
            [carroId, usuarioId]
        );

        if (!carro) {
            throw new Error('Carro no encontrado o no pertenece al usuario');
        }

        // 2. Verificar que esté preparado pero no confirmado
        if (!carro.fecha_preparado) {
            throw new Error('El carro debe estar marcado como preparado antes de finalizar la producción');
        }

        if (carro.fecha_confirmacion) {
            return res.json({
                mensaje: 'La producción de este carro ya fue confirmada anteriormente',
                fecha: carro.fecha_confirmacion
            });
        }

        // 3. Obtener artículos del carro para registrar en stock de ventas
        const { rows: articulosCarro } = await db.query(`
            SELECT 
                ca.articulo_numero,
                ca.cantidad,
                a.codigo_barras,
                a.nombre as descripcion
            FROM carros_articulos ca
            LEFT JOIN articulos a ON a.numero = ca.articulo_numero
            WHERE ca.carro_id = $1
        `, [carroId]);

        if (articulosCarro.length === 0) {
            throw new Error('El carro no tiene artículos para finalizar');
        }

        console.log('\n📦 REGISTRANDO MOVIMIENTOS DE STOCK DE VENTAS');
        console.log('==========================================');

        const { recalcularStockConsolidado } = require('../utils/recalcularStock');
        const articulosAfectados = [];

        // 4. Registrar movimientos de ingreso en stock de ventas para cada artículo
        for (const articulo of articulosCarro) {
            console.log(`\n🔄 Procesando artículo ${articulo.articulo_numero}:`);
            console.log(`- Descripción: ${articulo.descripcion}`);
            console.log(`- Cantidad: ${articulo.cantidad}`);
            console.log(`- Código de barras: ${articulo.codigo_barras}`);
            
            // Insertar movimiento en stock_ventas_movimientos
            await db.query(`
                INSERT INTO stock_ventas_movimientos (
                    articulo_numero, 
                    codigo_barras, 
                    kilos,
                    cantidad,
                    carro_id, 
                    usuario_id, 
                    fecha,
                    tipo
                ) VALUES ($1, $2, 0, $3, $4, $5, NOW(), 'salida a ventas')
            `, [
                articulo.articulo_numero,
                articulo.codigo_barras || '',
                articulo.cantidad,  // La cantidad va en la columna cantidad
                carroId,
                usuarioId
            ]);
            
            // Actualizar stock_movimientos para salida a ventas
            await db.query(`
                INSERT INTO stock_real_consolidado (
                    articulo_numero, 
                    stock_movimientos,
                    stock_ajustes, 
                    ultima_actualizacion
                )
                VALUES ($1, $2, 0, NOW())
                ON CONFLICT (articulo_numero) 
                DO UPDATE SET 
                    stock_movimientos = COALESCE(stock_real_consolidado.stock_movimientos, 0) + $2,
                    ultima_actualizacion = NOW()
            `, [
                articulo.articulo_numero,
                articulo.cantidad // Sumar la cantidad a stock_movimientos
            ]);
            
            // Agregar artículo a la lista para recalcular
            if (!articulosAfectados.includes(articulo.articulo_numero)) {
                articulosAfectados.push(articulo.articulo_numero);
            }
            
            console.log('✅ Movimiento de stock registrado y stock_movimientos actualizado correctamente');
        }

        // Recalcular stock_consolidado para todos los artículos afectados
        if (articulosAfectados.length > 0) {
            await recalcularStockConsolidado(db, articulosAfectados);
            console.log(`Stock consolidado recalculado para ${articulosAfectados.length} artículo(s)`);
        }

        // 5. Actualizar fecha_confirmacion del carro
        await db.query(
            'UPDATE carros_produccion SET fecha_confirmacion = NOW() WHERE id = $1',
            [carroId]
        );

        console.log('\n✅ PRODUCCIÓN CONFIRMADA');
        console.log('==========================================');

        // Confirmar transacción
        await db.query('COMMIT');

        return res.json({
            mensaje: 'Producción confirmada correctamente',
            articulos: articulosCarro.length
        });

    } catch (error) {
        await db.query('ROLLBACK');
        console.error('Error al confirmar producción:', error);
        return res.status(500).json({ 
            error: 'Error al confirmar la producción',
            detalle: error.message 
        });
    }
}

module.exports = {
    finalizarProduccion
};
