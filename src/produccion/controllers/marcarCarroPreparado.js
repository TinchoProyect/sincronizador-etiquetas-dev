const { obtenerIngredientesBaseCarro } = require('./carroIngredientes');
const { registrarMovimientoIngrediente } = require('./ingredientesMovimientos');

/**
 * Marca un carro como preparado y registra los movimientos de ingredientes
 */
async function marcarCarroPreparado(req, res) {
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

        // 1. Verificar que el carro exista y pertenezca al usuario
        const { rows: [carro] } = await db.query(
            'SELECT * FROM carros_produccion WHERE id = $1 AND usuario_id = $2',
            [carroId, usuarioId]
        );

        if (!carro) {
            throw new Error('Carro no encontrado o no pertenece al usuario');
        }

        // 2. Verificar que no esté ya preparado
        if (carro.fecha_preparado) {
            return res.json({
                mensaje: 'El carro ya fue marcado como preparado anteriormente',
                fecha: carro.fecha_preparado
            });
        }

        // 3. Obtener ingredientes primarios consolidados usando la misma función que usa el sistema
        const ingredientesConsolidados = await obtenerIngredientesBaseCarro(carroId, usuarioId);

        if (!ingredientesConsolidados || ingredientesConsolidados.length === 0) {
            throw new Error('No se encontraron ingredientes para los artículos del carro');
        }

        console.log('\n📦 REGISTRANDO MOVIMIENTOS DE INGREDIENTES');
        console.log('==========================================');

        // 4. Registrar movimientos de egreso para cada ingrediente primario
        for (const ing of ingredientesConsolidados) {
            console.log(`\n🔄 Procesando ${ing.nombre}:`);
            console.log(`- Cantidad: ${ing.cantidad} ${ing.unidad_medida}`);
            console.log(`- ID: ${ing.id}`);
            
            await registrarMovimientoIngrediente({
                ingrediente_id: ing.id,
                kilos: -ing.cantidad, // Negativo porque es un egreso
                tipo: 'egreso',
                carro_id: carroId,
                observaciones: `Preparación de carro #${carroId}`
            });
            
            console.log('✅ Movimiento registrado correctamente');
        }

        // 5. Actualizar fecha_preparado del carro
        await db.query(
            'UPDATE carros_produccion SET fecha_preparado = NOW() WHERE id = $1',
            [carroId]
        );

        console.log('\n✅ PROCESO COMPLETADO');
        console.log('==========================================');

        // Confirmar transacción
        await db.query('COMMIT');

        return res.json({
            mensaje: 'Carro marcado como preparado correctamente',
            ingredientes: ingredientesConsolidados.length
        });

    } catch (error) {
        await db.query('ROLLBACK');
        console.error('Error al marcar carro como preparado:', error);
        return res.status(500).json({ 
            error: 'Error al marcar el carro como preparado',
            detalle: error.message 
        });
    }
}

module.exports = {
    marcarCarroPreparado
};
