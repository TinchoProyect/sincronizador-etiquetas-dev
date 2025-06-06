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

        // 4. Registrar movimientos de ingreso en stock de ventas para cada artículo
        for (const articulo of articulosCarro) {
            console.log(`\n🔄 Procesando artículo ${articulo.articulo_numero}:`);
            console.log(`- Descripción: ${articulo.descripcion}`);
            console.log(`- Cantidad: ${articulo.cantidad}`);
            console.log(`- Código de barras: ${articulo.codigo_barras}`);
            
            // Registrar movimiento en stock de ventas usando la función directamente
            await db.query(`
                INSERT INTO stock_ventas_movimientos (
                    articulo_numero, 
                    codigo_barras, 
                    kilos,
                    cantidad,
                    carro_id, 
                    usuario_id, 
                    fecha
                ) VALUES ($1, $2, 0, $3, $4, $5, NOW())
            `, [
                articulo.articulo_numero,
                articulo.codigo_barras || '',
                articulo.cantidad,  // La cantidad va en la columna cantidad
                carroId,
                usuarioId
            ]);
            
            console.log('✅ Movimiento de stock registrado correctamente');
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
