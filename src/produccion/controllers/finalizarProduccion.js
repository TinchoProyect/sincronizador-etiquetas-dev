const { registrarMovimientoStockVentas } = require('./stockVentasMovimientos');

/**
 * Finaliza la producción de un carro y registra los movimientos de stock de ventas
 */
async function
    finalizarProduccion(req, res) {
    const db = req.db;
    const { id: carroId } = req.params;
    const { usuarioId, kilos_producidos } = req.body;

    if (!carroId || !usuarioId) {
        return res.status(400).json({
            error: 'Faltan datos obligatorios (carroId o usuarioId)'
        });
    }

    // Validar kilos_producidos solo si se proporciona (será requerido para carros externos)
    if (kilos_producidos !== undefined && kilos_producidos !== null && (isNaN(kilos_producidos) || kilos_producidos <= 0)) {
        return res.status(400).json({
            error: 'Si se proporciona kilos_producidos, debe ser un valor numérico válido mayor a cero'
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

        console.log('\n📦 REGISTRANDO MOVIMIENTOS DE STOCK DE VENTAS');
        console.log('==========================================');

        const { recalcularStockConsolidado } = require('../utils/recalcularStock');
        const articulosAfectados = [];
        let articulosCarro = [];

        // 3. Obtener artículos según el tipo de carro
        if (carro.tipo_carro === 'externa') {
            console.log('\n🚚 ===== CARRO EXTERNO - ASENTADO =====');
            console.log(`📋 Carro: ${carroId} | Usuario: ${usuarioId} | Kilos declarados: ${kilos_producidos}`);

            // Obtener artículos del carro para verificación
            const { rows: articulosEnCarro } = await db.query(`
                SELECT ca.articulo_numero, ca.cantidad
                FROM carros_articulos ca
                WHERE ca.carro_id = $1
            `, [carroId]);
            console.log(`📦 Artículos en el carro: ${articulosEnCarro.length}`);
            articulosEnCarro.forEach((art, i) => console.log(`  ${i + 1}. "${art.articulo_numero}" (cant: ${art.cantidad})`));

            // Para carros externos, obtener artículos vinculados
            const { rows: articulosVinculados } = await db.query(`
                SELECT 
                    rel.articulo_kilo_codigo as articulo_numero,
                    a.codigo_barras,
                    a.nombre as descripcion,
                    ca.cantidad,
                    rel.multiplicador_ingredientes
                FROM carros_articulos ca
                INNER JOIN articulos_produccion_externa_relacion rel 
                    ON ca.articulo_numero = rel.articulo_produccion_codigo
                LEFT JOIN articulos a ON a.numero = rel.articulo_kilo_codigo
                WHERE ca.carro_id = $1
            `, [carroId]);

            console.log(`🔗 Artículos vinculados encontrados: ${articulosVinculados.length}`);
            articulosVinculados.forEach((art, i) => {
                console.log(`  ${i + 1}. ${art.articulo_numero} - ${art.descripcion || 'Sin desc'} (mult: ${art.multiplicador_ingredientes || 1})`);
            });

            if (articulosVinculados.length === 0) {
                console.log('⚠️ NO SE ENCONTRARON ARTÍCULOS VINCULADOS - verificando vínculos...');
                for (const artCarro of articulosEnCarro) {
                    const { rows: vinculos } = await db.query(`
                        SELECT articulo_produccion_codigo, articulo_kilo_codigo, multiplicador_ingredientes
                        FROM articulos_produccion_externa_relacion
                        WHERE articulo_produccion_codigo = $1
                    `, [artCarro.articulo_numero]);
                    console.log(`  🔗 Vínculos para "${artCarro.articulo_numero}": ${vinculos.length}`);
                }
            }

            articulosCarro = articulosVinculados;
        } else {
            // Para carros internos, obtener artículos del carro normalmente
            const { rows: articulosInternos } = await db.query(`
                SELECT 
                    ca.articulo_numero,
                    ca.cantidad,
                    a.codigo_barras,
                    a.nombre as descripcion
                FROM carros_articulos ca
                LEFT JOIN articulos a ON a.numero = ca.articulo_numero
                WHERE ca.carro_id = $1
            `, [carroId]);

            articulosCarro = articulosInternos;
            console.log('🏭 Usando artículos del carro para carro interno');
        }

        console.log(`📊 articulosCarro.length: ${articulosCarro.length}`);

        if (articulosCarro.length === 0) {
            console.log('❌ ERROR: El carro no tiene artículos para finalizar');
            throw new Error('El carro no tiene artículos para finalizar');
        }

        console.log('✅ VALIDACIÓN EXITOSA: El carro tiene artículos para procesar');

        // 4. Registrar en produccion_externa_historial PRIMERO (solo para carros externos)
        let historialData = null;
        // 🎯 CORRECCIÓN CRÍTICA: Obtener ingredientes vinculados UNA SOLA VEZ con kilos reales
        // Esta variable se reutiliza tanto para el historial como para el descuento
        let ingredientesVinculadosCalculados = null;

        if (carro.tipo_carro === 'externa') {
            // Validar que se haya proporcionado kilos_producidos para carros externos
            if (kilos_producidos === undefined || kilos_producidos === null || isNaN(kilos_producidos) || kilos_producidos <= 0) {
                throw new Error('Para carros de producción externa es obligatorio ingresar los kilos producidos');
            }

            console.log('\n📝 REGISTRANDO EN HISTORIAL DE PRODUCCIÓN EXTERNA');
            console.log('==========================================');

            // Obtener artículos padre del carro (no los vinculados)
            const { rows: articulosPadre } = await db.query(`
                SELECT 
                    ca.articulo_numero,
                    ca.cantidad,
                    a.nombre as descripcion
                FROM carros_articulos ca
                LEFT JOIN articulos a ON a.numero = ca.articulo_numero
                WHERE ca.carro_id = $1
                LIMIT 1
            `, [carroId]);

            if (articulosPadre.length === 0) {
                throw new Error('No se encontraron artículos padre para el historial');
            }

            const articuloPadre = articulosPadre[0];
            console.log(`📋 Artículo padre: ${articuloPadre.articulo_numero} - ${articuloPadre.descripcion}`);

            // El artículo fraccionado ya lo tenemos en articulosCarro[0] (que son los vinculados)
            const articuloFraccionadoCodigo = articulosCarro[0]?.articulo_numero || null;
            console.log(`🔗 Artículo fraccionado: ${articuloFraccionadoCodigo}`);

            // 🎯 LLAMADA ÚNICA: Obtener ingredientes vinculados CON kilos reales declarados
            // Esto garantiza que el cálculo use: receta × kilos_reales × multiplicador
            let ingredientesSumados = 0;
            if (articuloFraccionadoCodigo) {
                console.log(`\n🧮 CALCULANDO INGREDIENTES CON KILOS REALES: ${kilos_producidos} kg`);
                console.log('==========================================');

                const { obtenerIngredientesArticulosVinculados } = require('./carroIngredientes');
                ingredientesVinculadosCalculados = await obtenerIngredientesArticulosVinculados(carroId, usuarioId, kilos_producidos);

                console.log(`📊 Ingredientes vinculados calculados: ${ingredientesVinculadosCalculados.length}`);

                // Sumar todas las cantidades de ingredientes vinculados
                ingredientesSumados = ingredientesVinculadosCalculados.reduce((suma, ingrediente) => {
                    const cantidad = parseFloat(ingrediente.cantidad) || 0;
                    console.log(`  - ${ingrediente.nombre}: ${cantidad} ${ingrediente.unidad_medida || 'kg'}`);
                    return suma + cantidad;
                }, 0);

                // Redondear a 2 decimales para evitar problemas de precisión
                ingredientesSumados = Number(ingredientesSumados.toFixed(2));

                console.log(`📊 TOTAL INGREDIENTES SUMADOS: ${ingredientesSumados} kg`);
            } else {
                console.log(`⚠️ No se encontró artículo vinculado, ingredientes_sumados = 0`);
            }

            // Insertar en historial
            await db.query(`
                INSERT INTO produccion_externa_historial (
                    carro_id, usuario_id, articulo_padre_id, articulo_fraccionado_id,
                    kilos_producidos, ingredientes_sumados, fecha_registro
                ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
            `, [carroId, usuarioId, articuloPadre.articulo_numero, articuloFraccionadoCodigo, kilos_producidos, ingredientesSumados]);

            console.log(`✅ Historial creado: padre=${articuloPadre.articulo_numero}, fraccionado=${articuloFraccionadoCodigo}, kilos=${kilos_producidos}, ingredientes=${ingredientesSumados}`);

            // Guardar datos para usar en el registro de movimientos
            historialData = {
                articulo_fraccionado_id: articuloFraccionadoCodigo,
                kilos_producidos: kilos_producidos,
                ingredientes_sumados: ingredientesSumados
            };
        }

        // 5. Registrar movimientos según el tipo de carro
        for (const articulo of articulosCarro) {
            console.log(`\n🔄 Procesando artículo ${articulo.articulo_numero}: ${articulo.descripcion} (cant: ${articulo.cantidad})`);

            if (carro.tipo_carro === 'externa') {
                // Para carros externos: usar datos del historial ya creado
                const cantidadTotal = parseFloat(historialData.kilos_producidos) + parseFloat(historialData.ingredientes_sumados);

                console.log(`📊 Cantidad total: ${cantidadTotal} (${historialData.kilos_producidos} + ${historialData.ingredientes_sumados})`);

                // ✅ DESCUENTO DE INGREDIENTES VINCULADOS del stock general
                // Usa ingredientesVinculadosCalculados (ya calculados con kilos reales, sin llamada redundante)
                console.log('\n🔍 INGREDIENTES VINCULADOS: Procesando descuento en asentado');
                console.log('==========================================');

                const { registrarMovimientoIngrediente } = require('./ingredientesMovimientos');

                try {
                    // 🎯 REUTILIZACIÓN: Usar el resultado ya calculado con kilos reales
                    const ingredientesVinculados = ingredientesVinculadosCalculados || [];
                    console.log(`🔗 Ingredientes vinculados a descontar: ${ingredientesVinculados.length}`);

                    if (ingredientesVinculados.length > 0) {
                        for (const ing of ingredientesVinculados) {
                            // Validar stock suficiente
                            const stockGeneral = parseFloat(ing.stock_actual) || 0;
                            const cantidadRequerida = Number(ing.cantidad.toFixed(4));

                            console.log(`🔄 DESCUENTO: ${ing.nombre} | Requerido: ${cantidadRequerida} | Stock: ${stockGeneral}`);

                            if (stockGeneral < cantidadRequerida) {
                                throw new Error(`Stock general insuficiente para ingrediente vinculado "${ing.nombre}". Disponible: ${stockGeneral}, Requerido: ${cantidadRequerida}`);
                            }

                            // Registrar movimiento de egreso
                            await registrarMovimientoIngrediente({
                                ingrediente_id: ing.id,
                                kilos: -cantidadRequerida,
                                tipo: 'egreso',
                                carro_id: parseInt(carroId),
                                observaciones: `Egreso por asentado carro externo #${carroId} - Ingrediente vinculado (stock general)`,
                                stock_anterior: stockGeneral
                            }, db);
                            console.log(`✅ ${ing.nombre} descontado: -${cantidadRequerida}`);
                        }
                    } else {
                        console.log('ℹ️ No hay ingredientes vinculados para descontar');
                    }
                } catch (error) {
                    console.error('❌ Error procesando ingredientes vinculados:', error);
                    throw new Error(`Error al descontar ingredientes vinculados: ${error.message}`);
                }

                // Registrar ingreso del artículo vinculado con cantidad calculada
                console.log(`\n📝 Registrando movimiento: ${historialData.articulo_fraccionado_id} | cantidad: ${cantidadTotal}`);
                await db.query(`
                    INSERT INTO stock_ventas_movimientos (
                        articulo_numero, codigo_barras, kilos, cantidad,
                        carro_id, usuario_id, fecha, tipo
                    ) VALUES ($1, $2, 1, $3, $4, $5, NOW(), 'ingreso por produccion externa')
                `, [
                    historialData.articulo_fraccionado_id,
                    articulo.codigo_barras || '',
                    cantidadTotal,
                    carroId,
                    usuarioId
                ]);

                // Actualizar stock_movimientos para ingreso
                await db.query(`
                    INSERT INTO stock_real_consolidado (
                        articulo_numero, stock_movimientos, stock_ajustes, ultima_actualizacion
                    )
                    VALUES ($1, $2, 0, NOW())
                    ON CONFLICT (articulo_numero) 
                    DO UPDATE SET 
                        stock_movimientos = COALESCE(stock_real_consolidado.stock_movimientos, 0) + $2,
                        ultima_actualizacion = NOW()
                `, [
                    historialData.articulo_fraccionado_id,
                    cantidadTotal
                ]);

                console.log(`✅ Ingreso registrado: ${cantidadTotal} kg (${historialData.kilos_producidos} + ${historialData.ingredientes_sumados})`);
            } else {
                // Para carros internos: mantener lógica original
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
                    articulo.cantidad,
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
                    articulo.cantidad
                ]);

                console.log('✅ Movimiento de salida a ventas registrado correctamente');
            }

            // Agregar artículo a la lista para recalcular
            if (!articulosAfectados.includes(articulo.articulo_numero)) {
                articulosAfectados.push(articulo.articulo_numero);
            }
        }

        // LOG 5: Antes y después de recalcularStockConsolidado()
        console.log('\n🔍 LOG 5: ANTES DE RECALCULAR STOCK CONSOLIDADO');
        console.log('==========================================');
        console.log(`📊 Artículos afectados: ${articulosAfectados.length}`);
        console.log(`📋 Lista de artículos a recalcular:`, articulosAfectados);

        // Recalcular stock_consolidado para todos los artículos afectados
        if (articulosAfectados.length > 0) {
            console.log('🔄 Ejecutando recalcularStockConsolidado()...');
            await recalcularStockConsolidado(db, articulosAfectados);
            console.log(`✅ LOG 5: Stock consolidado recalculado para ${articulosAfectados.length} artículo(s)`);

            // Verificar el resultado final
            for (const articulo of articulosAfectados) {
                const { rows: stockFinal } = await db.query(`
                    SELECT stock_lomasoft, stock_movimientos, stock_ajustes, stock_consolidado, ultima_actualizacion
                    FROM stock_real_consolidado 
                    WHERE articulo_numero = $1
                `, [articulo]);

                if (stockFinal.length > 0) {
                    const stock = stockFinal[0];
                    console.log(`📊 STOCK FINAL para ${articulo}:`);
                    console.log(`   - stock_lomasoft: ${stock.stock_lomasoft || 0}`);
                    console.log(`   - stock_movimientos: ${stock.stock_movimientos || 0}`);
                    console.log(`   - stock_ajustes: ${stock.stock_ajustes || 0}`);
                    console.log(`   - stock_consolidado: ${stock.stock_consolidado || 0}`);
                    console.log(`   - ultima_actualizacion: ${stock.ultima_actualizacion}`);
                } else {
                    console.log(`⚠️ No se encontró registro en stock_real_consolidado para ${articulo}`);
                }
            }
        } else {
            console.log('⚠️ No hay artículos para recalcular');
        }

        // 6. Actualizar fecha_confirmacion del carro
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
