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

        // 3. Obtener ingredientes según el tipo de carro
        let ingredientesConsolidados;
        let ingredientesVinculados = [];
        let ingredientesBase = [];

        if (carro.tipo_carro === 'externa') {
            console.log('🚚 CARRO EXTERNO: Verificando ingredientes...');
            
            // Para carros externos: obtener AMBOS tipos de ingredientes por separado
            const { obtenerIngredientesArticulosVinculados } = require('./carroIngredientes');
            
            // 1. Obtener ingredientes vinculados (artículo hijo - stock general)
            try {
                ingredientesVinculados = await obtenerIngredientesArticulosVinculados(carroId, usuarioId);
                console.log(`🔗 Ingredientes de artículos vinculados: ${ingredientesVinculados?.length || 0}`);
                
                // Marcar ingredientes vinculados con contexto
                if (ingredientesVinculados && ingredientesVinculados.length > 0) {
                    ingredientesVinculados = ingredientesVinculados.map(ing => ({
                        ...ing,
                        _contexto_origen: 'vinculado' // Marcador para identificar origen
                    }));
                }
            } catch (error) {
                console.log('⚠️ Error obteniendo ingredientes vinculados:', error.message);
                ingredientesVinculados = [];
            }
            
            // 2. Obtener ingredientes base (artículo padre - pueden ser personales)
            try {
                ingredientesBase = await obtenerIngredientesBaseCarro(carroId, usuarioId);
                console.log(`📦 Ingredientes base: ${ingredientesBase?.length || 0}`);
                
                // Marcar ingredientes base con contexto
                if (ingredientesBase && ingredientesBase.length > 0) {
                    ingredientesBase = ingredientesBase.map(ing => ({
                        ...ing,
                        _contexto_origen: 'base' // Marcador para identificar origen
                    }));
                }
            } catch (error) {
                console.log('⚠️ Error obteniendo ingredientes base:', error.message);
                ingredientesBase = [];
            }
            
            // 3. Combinar ambos tipos de ingredientes
            ingredientesConsolidados = [...ingredientesBase, ...ingredientesVinculados];
            console.log(`📊 Total ingredientes combinados: ${ingredientesConsolidados.length} (Base: ${ingredientesBase.length}, Vinculados: ${ingredientesVinculados.length})`);
            
        } else {
            console.log('🏭 CARRO INTERNO: Obteniendo ingredientes base...');
            // Para carros internos: usar lógica original
            ingredientesConsolidados = await obtenerIngredientesBaseCarro(carroId, usuarioId);
        }

        // Validación mejorada para carros externos
        if (!ingredientesConsolidados || ingredientesConsolidados.length === 0) {
            if (carro.tipo_carro === 'externa') {
                console.log('⚠️ Carro externo sin ingredientes - verificando si tiene artículos vinculados...');
                
                // Verificar si hay artículos vinculados configurados
                const { obtenerRelacionesCarro } = require('./relacionesArticulos');
                const relaciones = await obtenerRelacionesCarro(carroId, usuarioId);
                
                if (relaciones && relaciones.length > 0) {
                    console.log('✅ Carro externo con vínculos pero sin ingredientes - permitir continuar');
                    console.log(`🔗 Relaciones encontradas: ${relaciones.length}`);
                    // Para carros externos con vínculos pero sin ingredientes, crear array vacío
                    ingredientesConsolidados = [];
                } else {
                    throw new Error('Carro de producción externa sin artículos vinculados configurados');
                }
            } else {
                throw new Error('No se encontraron ingredientes para los artículos del carro');
            }
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

        // ✅ MODIFICACIÓN CLAVE: Permitir continuar con 0 ingredientes válidos para carros externos con vínculos
        if (ingredientesValidos.length === 0) {
            if (carro.tipo_carro === 'externa') {
                console.log('✅ Carro externo sin ingredientes válidos - verificando vínculos...');
                const { obtenerRelacionesCarro } = require('./relacionesArticulos');
                const relaciones = await obtenerRelacionesCarro(carroId, usuarioId);
                
                if (relaciones && relaciones.length > 0) {
                    console.log('✅ Carro externo con vínculos - saltando movimientos de ingredientes');
                } else {
                    throw new Error('No se encontraron ingredientes válidos ni vínculos configurados');
                }
            } else {
                throw new Error('No se encontraron ingredientes válidos para registrar movimientos');
            }
        }

        console.log(`\n📊 RESUMEN DE INGREDIENTES:`);
        console.log(`- Total obtenidos: ${ingredientesConsolidados.length}`);
        console.log(`- Válidos: ${ingredientesValidos.length}`);
        console.log(`- Omitidos (sin ID): ${ingredientesConsolidados.length - ingredientesValidos.length}`);

        // 4. Registrar movimientos de egreso según tipo de carro
        if (carro.tipo_carro === 'externa') {
            console.log('\n🏠 PROCESANDO CARRO EXTERNO');
            console.log('==========================================');
            
            // 🔍 DIAGNÓSTICO DETALLADO: Verificar ingredientes válidos
            console.log('\n🔍 ===== DIAGNÓSTICO DETALLADO - INGREDIENTES VÁLIDOS =====');
            console.log(`📊 Total ingredientes válidos: ${ingredientesValidos.length}`);
            
            if (ingredientesValidos.length > 0) {
                console.log('📋 DETALLE DE INGREDIENTES VÁLIDOS:');
                ingredientesValidos.forEach((ing, index) => {
                    console.log(`  ${index + 1}. Ingrediente: "${ing.nombre}"`);
                    console.log(`     - ID: ${ing.id} (tipo: ${typeof ing.id})`);
                    console.log(`     - Cantidad: ${ing.cantidad} (tipo: ${typeof ing.cantidad})`);
                    console.log(`     - Unidad: ${ing.unidad_medida}`);
                    console.log(`     - Stock actual: ${ing.stock_actual}`);
                    console.log(`     - Origen Mix ID: ${ing.origen_mix_id || 'NULL'}`);
                });
            }
            
            // Solo procesar ingredientes si hay ingredientes válidos
            if (ingredientesValidos.length > 0) {
                console.log('\n🔄 INICIANDO PROCESAMIENTO DE INGREDIENTES VÁLIDOS');
                console.log('================================================');
                
                // 🔧 CORRECCIÓN CRÍTICA: Distinguir entre ingredientes de usuario vs ingredientes vinculados
                for (let i = 0; i < ingredientesValidos.length; i++) {
                    const ing = ingredientesValidos[i];
                    
                    try {
                        console.log(`\n🔄 PROCESANDO INGREDIENTE ${i + 1}/${ingredientesValidos.length}: ${ing.nombre}`);
                        console.log(`- Cantidad: ${ing.cantidad} ${ing.unidad_medida}`);
                        console.log(`- ID: ${ing.id}`);
                        console.log(`- Stock actual: ${ing.stock_actual}`);
                        
                        // 🔍 VALIDACIONES CRÍTICAS
                        if (!ing.id) {
                            throw new Error(`Ingrediente "${ing.nombre}" no tiene ID válido`);
                        }
                        
                        if (ing.cantidad === undefined || ing.cantidad === null || isNaN(ing.cantidad)) {
                            throw new Error(`Ingrediente "${ing.nombre}" no tiene cantidad válida: ${ing.cantidad}`);
                        }
                        
                        console.log(`\n🔍 ORIGEN MIX ID:`, ing.origen_mix_id);
                        
                        // Redondear cantidad a 4 decimales para evitar problemas de precisión
                        const cantidadRedondeada = Number(ing.cantidad.toFixed(4));
                        console.log(`📊 Cantidad redondeada: ${cantidadRedondeada}`);
                        
                        // 🔧 LÓGICA CORREGIDA: Considerar el contexto de origen del ingrediente
                        console.log(`\n🔍 DETERMINANDO TIPO DE INGREDIENTE: ${ing.nombre}`);
                        console.log(`==========================================`);
                        console.log(`🏷️ CONTEXTO DE ORIGEN: ${ing._contexto_origen || 'no definido'}`);
                        
                        // 🔍 LOG CRÍTICO: Verificar si el ingrediente tiene contexto de origen
                        if (!ing._contexto_origen) {
                            console.log(`⚠️ PROBLEMA CRÍTICO: Ingrediente "${ing.nombre}" NO tiene contexto de origen definido`);
                            console.log(`🔍 Propiedades del ingrediente:`, Object.keys(ing));
                            console.log(`🔍 Contenido completo del ingrediente:`, JSON.stringify(ing, null, 2));
                        }
                        
                        // Verificar si el usuario tiene stock personal para este ingrediente
                        const stockPersonalQuery = `
                            SELECT SUM(cantidad) as stock_personal
                            FROM ingredientes_stock_usuarios
                            WHERE usuario_id = $1 AND ingrediente_id = $2 AND cantidad > 0
                        `;
                        const stockPersonalResult = await db.query(stockPersonalQuery, [usuarioId, ing.id]);
                        const stockPersonal = parseFloat(stockPersonalResult.rows[0]?.stock_personal) || 0;
                        
                        // También obtener el stock general para comparación
                        const stockGeneral = parseFloat(ing.stock_actual) || 0;
                        
                        console.log(`📊 ANÁLISIS DE STOCK:`);
                        console.log(`- Stock personal del usuario: ${stockPersonal}`);
                        console.log(`- Stock general (ingredientes.stock_actual): ${stockGeneral}`);
                        console.log(`- Cantidad requerida: ${cantidadRedondeada}`);
                        
                        // 🔍 LOG CRÍTICO: Punto de decisión para ingredientes vinculados
                        console.log(`\n🔍 PUNTO DE DECISIÓN CRÍTICO:`);
                        console.log(`==========================================`);
                        console.log(`❓ ¿Es ingrediente vinculado? ${ing._contexto_origen === 'vinculado' ? 'SÍ ✅' : 'NO ❌'}`);
                        console.log(`❓ ¿Tiene stock general suficiente? ${stockGeneral >= cantidadRedondeada ? 'SÍ ✅' : 'NO ❌'}`);
                        console.log(`❓ ¿Se ejecutará movimiento de egreso? ${ing._contexto_origen === 'vinculado' && stockGeneral >= cantidadRedondeada ? 'SÍ ✅' : 'NO ❌'}`);
                        
                        // 🎯 CRITERIO CORREGIDO: Los ingredientes vinculados NO se descontarán en preparación
                        if (ing._contexto_origen === 'vinculado') {
                            console.log(`🔧 INGREDIENTE VINCULADO DETECTADO - VALIDANDO STOCK SIN DESCONTAR`);
                            console.log(`📊 Stock general disponible: ${stockGeneral}`);
                            
                            // 🛡️ FLEXIBILIDAD: Permitir stock negativo con advertencia clara
                            if (stockGeneral < cantidadRedondeada) {
                                const faltante = cantidadRedondeada - stockGeneral;
                                console.log(`⚠️ WARNING: Stock general insuficiente (permitiendo continuar)`);
                                console.log(`   - Disponible: ${stockGeneral}`);
                                console.log(`   - Requerido: ${cantidadRedondeada}`);
                                console.log(`   - Faltante: ${faltante.toFixed(2)} kg`);
                                console.log(`   - El stock quedará en negativo al finalizar producción`);
                                console.log(`\n💡 RECOMENDACIÓN: Realizar ingreso manual de ${faltante.toFixed(2)} kg de "${ing.nombre}" antes de finalizar`);
                            }
                            
                            // ✅ CORRECCIÓN CRÍTICA: Solo validar stock, NO registrar movimiento
                            // Los ingredientes vinculados se descontarán en finalizarProduccion.js
                            console.log(`\n🔍 INGREDIENTE VINCULADO - SOLO VALIDACIÓN`);
                            console.log(`==========================================`);
                            console.log(`✅ Validación completada para ingrediente vinculado ${ing.nombre}`);
                            console.log(`📝 MOVIMIENTO DIFERIDO: Se registrará en finalizarProduccion.js`);
                            console.log(`📊 Stock disponible: ${stockGeneral}, Requerido: ${cantidadRedondeada}`);
                            
                        } else if (ing._contexto_origen === 'base' && stockPersonal > 0) {
                            console.log(`🔧 INGREDIENTE BASE CON STOCK PERSONAL DETECTADO - Usando FIFO`);
                            console.log(`📊 Stock personal disponible: ${stockPersonal}`);
                            
                            if (stockPersonal < cantidadRedondeada) {
                                throw new Error(`Stock personal insuficiente para ingrediente base "${ing.nombre}". Disponible: ${stockPersonal}, Requerido: ${cantidadRedondeada}`);
                            }
                            
                            // Para ingredientes base con stock personal: usar FIFO
                            const datosMovimiento = {
                                usuario_id: parseInt(usuarioId),
                                ingrediente_id: ing.id,
                                cantidad: -cantidadRedondeada, // Negativo para consumo
                                carro_id: parseInt(carroId),
                                origen_mix_id: ing.origen_mix_id
                            };
                            
                            console.log('📝 DATOS PARA MOVIMIENTO FIFO - INGREDIENTE BASE PERSONAL:', JSON.stringify(datosMovimiento, null, 2));
                            await registrarMovimientoStockUsuarioFIFO(datosMovimiento, db);
                            console.log(`✅ Movimiento FIFO registrado correctamente para ingrediente base personal ${ing.nombre}`);
                            
                        } else if (stockGeneral > 0) {
                            console.log(`🔧 INGREDIENTE BASE SIN STOCK PERSONAL - Usando stock general como fallback`);
                            console.log(`📊 Stock general disponible: ${stockGeneral}`);
                            
                            if (stockGeneral < cantidadRedondeada) {
                                throw new Error(`Stock general insuficiente para ingrediente "${ing.nombre}". Disponible: ${stockGeneral}, Requerido: ${cantidadRedondeada}`);
                            }
                            
                            // Para ingredientes base sin stock personal: usar stock general
                            const movimientoData = {
                                ingrediente_id: ing.id,
                                kilos: -cantidadRedondeada, // ✅ NEGATIVO para egreso (se resta del stock)
                                tipo: 'egreso',
                                carro_id: parseInt(carroId),
                                observaciones: `Egreso por carro externo #${carroId} - Ingrediente base (stock general fallback)`
                            };
                            
                            console.log('📝 REGISTRANDO MOVIMIENTO DIRECTO - INGREDIENTE BASE GENERAL (ingredientes_movimientos):', JSON.stringify(movimientoData, null, 2));
                            await registrarMovimientoIngrediente(movimientoData, db);
                            console.log(`✅ Movimiento directo registrado correctamente para ingrediente base general ${ing.nombre}`);
                            
                        } else {
                            throw new Error(`Sin stock disponible para ingrediente "${ing.nombre}". Stock personal: ${stockPersonal}, Stock general: ${stockGeneral}, Requerido: ${cantidadRedondeada}`);
                        }
                        
                        console.log(`==========================================\n`);
                        
                    } catch (error) {
                        console.error(`❌ ERROR PROCESANDO INGREDIENTE "${ing.nombre}":`, error);
                        console.error(`❌ Stack trace:`, error.stack);
                        throw new Error(`Error procesando ingrediente "${ing.nombre}": ${error.message}`);
                    }
                }
                
                console.log('\n✅ TODOS LOS INGREDIENTES PROCESADOS EXITOSAMENTE');
                
            } else {
                console.log('⚠️ Sin ingredientes válidos - saltando movimientos de ingredientes');
            }

            // NUEVO: Obtener artículos de recetas y registrar movimientos en stock_ventas_movimientos
            const { obtenerArticulosDeRecetas } = require('./carroIngredientes');
            const articulosRecetas = await obtenerArticulosDeRecetas(carroId, usuarioId);

            console.log('\n🔍 ===== DIAGNÓSTICO TÉCNICO - EGRESO POR RECETA EXTERNA =====');
            console.log(`📋 CARRO ID: ${carroId}`);
            console.log(`👤 USUARIO ID: ${usuarioId}`);
            console.log(`📦 ARTÍCULOS DE RECETAS ENCONTRADOS: ${articulosRecetas.length}`);
            
            if (articulosRecetas.length > 0) {
                console.log('📋 DETALLE DE ARTÍCULOS DE RECETAS:');
                articulosRecetas.forEach((art, index) => {
                    console.log(`  ${index + 1}. Código: "${art.articulo_numero}"`);
                    console.log(`     - Descripción: ${art.descripcion || 'Sin descripción'}`);
                    console.log(`     - Cantidad: ${art.cantidad}`);
                    console.log(`     - Código barras: ${art.codigo_barras || 'Sin código'}`);
                    console.log(`     - Longitud código: ${art.articulo_numero.length} caracteres`);
                    console.log(`     - Representación hex: ${Buffer.from(art.articulo_numero, 'utf8').toString('hex')}`);
                });
            }

            for (const articulo of articulosRecetas) {
                console.log(`\n🔄 PROCESANDO ARTÍCULO: ${articulo.articulo_numero}`);
                console.log(`- Cantidad: ${articulo.cantidad}`);
                
                // LOG TÉCNICO: Antes del INSERT en stock_ventas_movimientos
                console.log('\n🔍 LOG TÉCNICO: ANTES DEL INSERT - stock_ventas_movimientos');
                console.log('==========================================');
                console.log(`📝 Parámetros para INSERT:`);
                console.log(`   - articulo_numero: "${articulo.articulo_numero}"`);
                console.log(`   - cantidad: ${-articulo.cantidad} (negativo para egreso)`);
                console.log(`   - carro_id: ${carroId}`);
                console.log(`   - usuario_id: ${usuarioId}`);
                console.log(`   - tipo: 'egreso por receta externa'`);
                console.log(`   - codigo_barras: "${articulo.codigo_barras || ''}"`);
                
                // Verificar stock ANTES del movimiento
                const { rows: stockAntes } = await db.query(`
                    SELECT stock_lomasoft, stock_movimientos, stock_ajustes, stock_consolidado, ultima_actualizacion
                    FROM stock_real_consolidado 
                    WHERE articulo_numero = $1
                `, [articulo.articulo_numero]);
                
                console.log('\n📊 STOCK ANTES DEL MOVIMIENTO:');
                if (stockAntes.length > 0) {
                    const stock = stockAntes[0];
                    console.log(`   - stock_lomasoft: ${stock.stock_lomasoft || 0}`);
                    console.log(`   - stock_movimientos: ${stock.stock_movimientos || 0}`);
                    console.log(`   - stock_ajustes: ${stock.stock_ajustes || 0}`);
                    console.log(`   - stock_consolidado: ${stock.stock_consolidado || 0}`);
                    console.log(`   - ultima_actualizacion: ${stock.ultima_actualizacion}`);
                } else {
                    console.log(`   ⚠️ No existe registro en stock_real_consolidado para ${articulo.articulo_numero}`);
                }
                
                // Registrar movimiento
                await db.query(`
                    INSERT INTO stock_ventas_movimientos (
                        articulo_numero, cantidad, carro_id, usuario_id, fecha, tipo, kilos, codigo_barras
                    ) VALUES ($1, $2, $3, $4, NOW(), 'egreso por receta externa', 0, $5)
                `, [articulo.articulo_numero, -articulo.cantidad, carroId, usuarioId, articulo.codigo_barras || '']);

                console.log('✅ LOG TÉCNICO: MOVIMIENTO REGISTRADO EN stock_ventas_movimientos');
                
                // 🔧 SOLUCIÓN QUIRÚRGICA: Actualizar stock_movimientos en stock_real_consolidado
                console.log('\n🔍 LOG TÉCNICO: ACTUALIZANDO stock_movimientos EN stock_real_consolidado');
                console.log('==========================================');
                console.log(`📊 Artículo: "${articulo.articulo_numero}"`);
                console.log(`📊 Cantidad del movimiento: ${-articulo.cantidad}`);
                
                await db.query(`
                    INSERT INTO stock_real_consolidado (articulo_numero, stock_movimientos, ultima_actualizacion)
                    VALUES ($1, $2, NOW())
                    ON CONFLICT (articulo_numero) 
                    DO UPDATE SET 
                        stock_movimientos = COALESCE(stock_real_consolidado.stock_movimientos, 0) + $2,
                        ultima_actualizacion = NOW()
                `, [articulo.articulo_numero, -articulo.cantidad]);
                
                console.log('✅ LOG TÉCNICO: stock_movimientos ACTUALIZADO EN stock_real_consolidado');
                
                // LOG TÉCNICO: Antes de recalcularStockConsolidado
                console.log('\n🔍 LOG TÉCNICO: ANTES DE RECALCULAR STOCK CONSOLIDADO');
                console.log('==========================================');
                console.log(`📊 Artículo a recalcular: "${articulo.articulo_numero}"`);
                console.log(`🔄 Ejecutando recalcularStockConsolidado()...`);
                
                // Actualizar stock consolidado para el artículo (CORRECCIÓN: pasar array)
                const { recalcularStockConsolidado } = require('../utils/recalcularStock');
                await recalcularStockConsolidado(db, [articulo.articulo_numero]);
                
                console.log('✅ LOG TÉCNICO: recalcularStockConsolidado() EJECUTADO');
                
                // Verificar stock DESPUÉS del recálculo
                const { rows: stockDespues } = await db.query(`
                    SELECT stock_lomasoft, stock_movimientos, stock_ajustes, stock_consolidado, ultima_actualizacion
                    FROM stock_real_consolidado 
                    WHERE articulo_numero = $1
                `, [articulo.articulo_numero]);
                
                console.log('\n📊 STOCK DESPUÉS DEL RECÁLCULO:');
                if (stockDespues.length > 0) {
                    const stock = stockDespues[0];
                    console.log(`   - stock_lomasoft: ${stock.stock_lomasoft || 0}`);
                    console.log(`   - stock_movimientos: ${stock.stock_movimientos || 0}`);
                    console.log(`   - stock_ajustes: ${stock.stock_ajustes || 0}`);
                    console.log(`   - stock_consolidado: ${stock.stock_consolidado || 0}`);
                    console.log(`   - ultima_actualizacion: ${stock.ultima_actualizacion}`);
                    
                    // Comparar cambios
                    if (stockAntes.length > 0) {
                        const stockAnt = stockAntes[0];
                        const cambioMovimientos = (stock.stock_movimientos || 0) - (stockAnt.stock_movimientos || 0);
                        const cambioConsolidado = (stock.stock_consolidado || 0) - (stockAnt.stock_consolidado || 0);
                        
                        console.log('\n🔍 ANÁLISIS DE CAMBIOS:');
                        console.log(`   - Cambio en stock_movimientos: ${cambioMovimientos}`);
                        console.log(`   - Cambio en stock_consolidado: ${cambioConsolidado}`);
                        console.log(`   - ¿Se actualizó correctamente?: ${cambioMovimientos !== 0 ? 'SÍ ✅' : 'NO ❌'}`);
                    }
                } else {
                    console.log(`   ⚠️ PROBLEMA: Aún no existe registro en stock_real_consolidado para ${articulo.articulo_numero}`);
                }

                console.log('✅ Movimiento de stock de ventas registrado correctamente');
                console.log('===============================================\n');
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
