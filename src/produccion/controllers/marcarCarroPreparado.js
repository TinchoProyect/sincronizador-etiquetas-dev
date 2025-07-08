const { obtenerIngredientesBaseCarro } = require('./carroIngredientes');
const { registrarMovimientoIngrediente } = require('./ingredientesMovimientos');
const { registrarMovimientoStockUsuarioFIFO } = require('./ingredientesStockUsuarios');

/**
 * Marca un carro como preparado y registra los movimientos de ingredientes
 * Para carros internos: usa ingredientes_movimientos
 * Para carros externos: usa ingredientes_stock_usuarios con lógica FIFO
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

        console.log('\n🔍 DEPURACIÓN - INGREDIENTES OBTENIDOS:');
        console.log('=====================================');
        ingredientesConsolidados.forEach((ing, index) => {
            console.log(`${index + 1}. ${ing.nombre} (ID: ${ing.id})`);
            console.log(`   - Cantidad: ${ing.cantidad}`);
            console.log(`   - Stock actual: ${ing.stock_actual}`);
            console.log(`   - Origen Mix ID: ${ing.origen_mix_id || 'NULL'}`);
            
            // Verificar si es un mix
            if (ing.id) {
                db.query('SELECT COUNT(*)::integer as count FROM ingrediente_composicion WHERE mix_id = $1', [ing.id])
                    .then(result => {
                        const esMix = result.rows[0].count > 0;
                        console.log(`   - Es mix: ${esMix ? 'SÍ' : 'NO'}`);
                    })
                    .catch(err => console.log(`   - Error verificando mix: ${err.message}`));
            }
        });

        // Filtrar ingredientes que tengan ID válido
        const ingredientesValidos = ingredientesConsolidados.filter(ing => {
            if (!ing.id) {
                console.warn(`⚠️ Ingrediente sin ID omitido: ${ing.nombre}`);
                return false;
            }
            return true;
        });

        if (ingredientesValidos.length === 0) {
            throw new Error('No se encontraron ingredientes válidos para registrar movimientos');
        }

        console.log(`\n📊 RESUMEN DE INGREDIENTES:`);
        console.log(`- Total obtenidos: ${ingredientesConsolidados.length}`);
        console.log(`- Válidos: ${ingredientesValidos.length}`);
        console.log(`- Omitidos (sin ID): ${ingredientesConsolidados.length - ingredientesValidos.length}`);

        // 4. Registrar movimientos de egreso según tipo de carro
        if (carro.tipo_carro === 'externa') {
            console.log('\n🏠 PROCESANDO CARRO EXTERNO');
            console.log('==========================================');
            
            // Para carros externos, usar ingredientes_stock_usuarios con FIFO
            for (const ing of ingredientesValidos) {
                console.log(`\n🔄 Procesando ${ing.nombre}:`);
                console.log(`- Cantidad: ${ing.cantidad} ${ing.unidad_medida}`);
                console.log(`- ID: ${ing.id}`);
                
                console.log(`\n🔍 ORIGEN MIX ID:`, ing.origen_mix_id);
                // Redondear cantidad a 4 decimales para evitar problemas de precisión
                const cantidadRedondeada = Number(ing.cantidad.toFixed(4));
                
                await registrarMovimientoStockUsuarioFIFO({
                    usuario_id: parseInt(usuarioId),
                    ingrediente_id: ing.id,
                    cantidad: -cantidadRedondeada, // Negativo para consumo
                    carro_id: parseInt(carroId),
                    origen_mix_id: ing.origen_mix_id // Pasar el origen_mix_id del ingrediente
                }, db);
                
                console.log('✅ Movimiento FIFO registrado correctamente');
            }

            // NUEVO: Obtener artículos de recetas y registrar movimientos en stock_ventas_movimientos
            const { obtenerArticulosDeRecetas } = require('./carroIngredientes');
            const articulosRecetas = await obtenerArticulosDeRecetas(carroId, usuarioId);

            for (const articulo of articulosRecetas) {
                console.log(`\n🔄 Procesando artículo ${articulo.articulo_numero}:`);
                console.log(`- Cantidad: ${articulo.cantidad}`);
                
                await db.query(`
                    INSERT INTO stock_ventas_movimientos (
                        articulo_numero, cantidad, carro_id, usuario_id, fecha, tipo, kilos, codigo_barras
                    ) VALUES ($1, $2, $3, $4, NOW(), 'egreso por receta externa', 0, '')
                `, [articulo.articulo_numero, -articulo.cantidad, carroId, usuarioId]);

                // Actualizar stock consolidado para el artículo
                const { recalcularStockConsolidado } = require('../utils/recalcularStock');
                await recalcularStockConsolidado(db, articulo.articulo_numero);

                console.log('✅ Movimiento de stock de ventas registrado correctamente');
            }
        } else {
            console.log('\n🏭 PROCESANDO CARRO INTERNO');
            console.log('==========================================');
            
            // Para carros internos, mantener el flujo original con ingredientes_movimientos
            for (const ing of ingredientesValidos) {
                console.log(`\n🔄 Procesando ${ing.nombre}:`);
                console.log(`- Cantidad: ${ing.cantidad} ${ing.unidad_medida}`);
                console.log(`- ID: ${ing.id}`);
                
                const movimientoData = {
                    ingrediente_id: ing.id,
                    kilos: -ing.cantidad, // Negativo porque es un egreso
                    tipo: 'egreso',
                    carro_id: parseInt(carroId),
                    observaciones: `Preparación de carro #${carroId}`
                };
                
                console.log('🔍 Datos del movimiento a enviar:', movimientoData);
                await registrarMovimientoIngrediente(movimientoData, db);
                console.log('✅ Movimiento registrado correctamente');
            }
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
            ingredientes: ingredientesValidos.length,
            ingredientes_totales: ingredientesConsolidados.length
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
