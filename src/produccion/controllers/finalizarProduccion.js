const { registrarMovimientoStockVentas } = require('./stockVentasMovimientos');
const CuentaCorrienteService = require('../../logistica/services/cuentaCorrienteService');

/**
 * Finaliza la producción de un carro y registra los movimientos de stock de ventas
 */
async function
    finalizarProduccion(req, res) {
    const db = req.db;
    const { id: carroId } = req.params;
    const { usuarioId, kilos_producidos, unidades_producidas, kilos_entrada } = req.body;

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

            // Para carros externos, obtener artículos vinculados (con deduplicación defensiva)
            const { rows: articulosVinculados } = await db.query(`
                SELECT DISTINCT ON (rel.articulo_kilo_codigo)
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

                // Sumar únicamente ingredientes agregados POST-COCCIÓN (en caliente)
                ingredientesSumados = ingredientesVinculadosCalculados.reduce((suma, ingrediente) => {
                    if (ingrediente.es_post_coccion === true) {
                        const cantidad = parseFloat(ingrediente.cantidad) || 0;
                        console.log(`  - [POST-COCCIÓN] ${ingrediente.nombre}: ${cantidad} ${ingrediente.unidad_medida || 'kg'}`);
                        return suma + cantidad;
                    }
                    console.log(`  - [PRE-COCCIÓN / SATÉLITE] ${ingrediente.nombre}: ${ingrediente.cantidad} ${ingrediente.unidad_medida || 'kg'} (descontado de stock del colaborador, no suma a kilos liquidables de salida)`);
                    return suma;
                }, 0);

                // Redondear a 2 decimales para evitar problemas de precisión
                ingredientesSumados = Number(ingredientesSumados.toFixed(2));

                console.log(`📊 TOTAL INGREDIENTES SUMADOS: ${ingredientesSumados} kg`);
            } else {
                console.log(`⚠️ No se encontró artículo vinculado, ingredientes_sumados = 0`);
            }

            // Detección de Línea de Negocio Externa (Flujos 4, 5 y 6)
            let lineaNegocio = 4;
            let nombreLineaNegocio = 'Línea de Negocio 4: Tostadero (UP Externa Simple)';
            const padreUpper = (articuloPadre.articulo_numero || '').toUpperCase();
            const descUpper = (articuloPadre.descripcion || '').toUpperCase();
            const fraccUpper = (articuloFraccionadoCodigo || '').toUpperCase();

            if (padreUpper.startsWith('BF') || descUpper.includes('BARRA') || fraccUpper.startsWith('BF')) {
                lineaNegocio = 5;
                nombreLineaNegocio = 'Línea de Negocio 5: Barritas (Mezcla Interna + UP Externa)';
            } else if (padreUpper.includes('GN') || descUpper.includes('GRANA') || descUpper.includes('GRANOLA') || fraccUpper.includes('GN')) {
                lineaNegocio = 6;
                nombreLineaNegocio = 'Línea de Negocio 6: Granolas (Doble Mezcla / UP Externa)';
            }

            let inputKilos = (kilos_entrada && !isNaN(parseFloat(kilos_entrada)) && parseFloat(kilos_entrada) > 0) 
                ? parseFloat(kilos_entrada) 
                : null;

            // 🛡️ SALVAGUARDA ESTRUCTURAL: Si inputKilos no llegó o vino en 0, calcularlo desde el egreso real del carro o la receta
            if (!inputKilos || inputKilos <= 0) {
                console.log('⚠️ [FINALIZAR PRODUCCIÓN] kilos_entrada no proporcionado o en 0. Calculando desde egresos de stock...');
                const { rows: egresosStock } = await db.query(`
                    SELECT 
                        svm.articulo_numero,
                        ABS(CAST(svm.cantidad AS DECIMAL(20,10))) AS cantidad,
                        COALESCE(CAST(src.kilos_unidad AS DECIMAL(20,10)), ba.kilos_unidad, 1.0000) AS kilos_unidad
                    FROM public.stock_ventas_movimientos svm
                    LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = svm.articulo_numero
                    LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = svm.articulo_numero
                    WHERE svm.carro_id = $1 AND (LOWER(svm.tipo) LIKE '%egreso%' OR CAST(svm.cantidad AS TEXT) LIKE '-%')
                `, [carroId]);

                if (egresosStock.length > 0) {
                    inputKilos = egresosStock.reduce((acc, row) => acc + (parseFloat(row.cantidad) * parseFloat(row.kilos_unidad)), 0);
                    console.log(`✅ [FINALIZAR PRODUCCIÓN] Entrada calculada desde egresos de stock: ${inputKilos} kg`);
                }

                if (!inputKilos || inputKilos <= 0) {
                    const { rows: recetaUP } = await db.query(`
                        SELECT 
                            SUM(CAST(ra.cantidad AS DECIMAL(20, 10)) * COALESCE(CAST(src.kilos_unidad AS DECIMAL(20, 10)), ba.kilos_unidad, 1.0000)) * COALESCE(ca.cantidad, 1.0) AS masa_receta
                        FROM public.carros_articulos ca
                        JOIN public.recetas r ON r.articulo_numero = ca.articulo_numero
                        JOIN public.receta_articulos ra ON ra.receta_id = r.id
                        LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = ra.articulo_numero
                        LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = ra.articulo_numero
                        WHERE ca.carro_id = $1
                        GROUP BY ca.cantidad
                        LIMIT 1
                    `, [carroId]);

                    if (recetaUP.length > 0 && parseFloat(recetaUP[0].masa_receta) > 0) {
                        inputKilos = parseFloat(recetaUP[0].masa_receta);
                        console.log(`✅ [FINALIZAR PRODUCCIÓN] Entrada calculada desde receta de UP: ${inputKilos} kg`);
                    }
                }
            }
            inputKilos = (inputKilos && inputKilos > 0) ? Number(inputKilos.toFixed(4)) : null;

            const outputKilos = parseFloat(kilos_producidos);
            const mermaPercent = (inputKilos && inputKilos > 0) ? Number((((inputKilos - outputKilos) / inputKilos) * 100).toFixed(2)) : 0;

            // Insertar en historial con trazabilidad de Línea de Negocio
            await db.query(`
                INSERT INTO produccion_externa_historial (
                    carro_id, usuario_id, articulo_padre_id, articulo_fraccionado_id,
                    kilos_producidos, ingredientes_sumados, fecha_registro,
                    kilos_entrada, kilos_salida, porcentaje_merma,
                    linea_negocio, nombre_linea_negocio
                ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, $10, $11)
            `, [
                carroId, 
                usuarioId, 
                articuloPadre.articulo_numero, 
                articuloFraccionadoCodigo, 
                kilos_producidos, 
                ingredientesSumados,
                inputKilos,
                outputKilos,
                mermaPercent,
                lineaNegocio,
                nombreLineaNegocio
            ]);

            console.log(`✅ Historial creado: [LDN ${lineaNegocio}] padre=${articuloPadre.articulo_numero}, fraccionado=${articuloFraccionadoCodigo}, kilos=${kilos_producidos}, ingredientes=${ingredientesSumados}, entrada=${inputKilos}, merma=${mermaPercent}%`);

            // Guardar datos para usar en el registro de movimientos
            historialData = {
                articulo_fraccionado_id: articuloFraccionadoCodigo,
                kilos_producidos: kilos_producidos,
                ingredientes_sumados: ingredientesSumados
            };
        }

        // 5. Registrar movimientos según el tipo de carro
        if (carro.tipo_carro === 'externa') {
            console.log(`\n🏭 PROCESANDO ASENTADO EXTERNO PARA ARTÍCULO ${historialData.articulo_fraccionado_id}`);
            const cantidadTotal = parseFloat(historialData.kilos_producidos) + parseFloat(historialData.ingredientes_sumados);
            console.log(`📊 Cantidad total: ${cantidadTotal} (${historialData.kilos_producidos} + ${historialData.ingredientes_sumados})`);

            // ✅ DESCUENTO DE INGREDIENTES VINCULADOS del stock general (se ejecuta una única vez por carro)
            console.log('\n🔍 INGREDIENTES VINCULADOS: Procesando descuento en asentado');
            console.log('==========================================');

            const { registrarMovimientoIngrediente } = require('./ingredientesMovimientos');

            try {
                const ingredientesVinculados = ingredientesVinculadosCalculados || [];
                console.log(`🔗 Ingredientes vinculados a descontar: ${ingredientesVinculados.length}`);

                if (ingredientesVinculados.length > 0) {
                    for (const ing of ingredientesVinculados) {
                        const cantidadRequerida = Number(ing.cantidad.toFixed(4));
                        const fase = ing.fase_produccion || 'externa';

                        if (fase === 'interna') {
                            // Descuento de stock central
                            const stockGeneral = parseFloat(ing.stock_actual) || 0;
                            console.log(`🔄 DESCUENTO CENTRAL (Fase Interna): ${ing.nombre} | Requerido: ${cantidadRequerida} | Stock Central: ${stockGeneral}`);

                            if (stockGeneral < cantidadRequerida) {
                                console.warn(`⚠️ ALERTA: Stock general insuficiente para ingrediente vinculado "${ing.nombre}". Quedará en negativo. Disponible: ${stockGeneral}, Requerido: ${cantidadRequerida}`);
                            }

                            await registrarMovimientoIngrediente({
                                ingrediente_id: ing.id,
                                kilos: -cantidadRequerida,
                                tipo: 'egreso',
                                carro_id: parseInt(carroId),
                                observaciones: `Egreso por asentado carro externo #${carroId} - Ingrediente vinculado (stock general - Fase Interna)`,
                                stock_anterior: stockGeneral
                            }, db);
                            console.log(`✅ ${ing.nombre} descontado de Stock Central: -${cantidadRequerida}`);
                        } else {
                            // Descuento de stock satélite del colaborador (Fase Externa)
                            console.log(`🔄 DESCUENTO SATÉLITE (Fase Externa): ${ing.nombre} | Requerido: ${cantidadRequerida} | Colaborador ID: ${usuarioId}`);

                            const satStockRes = await db.query(
                                'SELECT stock_actual FROM public.colaborador_stock_satelite WHERE usuario_id = $1 AND ingrediente_id = $2',
                                [usuarioId, ing.id]
                            );
                            const stockSateliteAnterior = satStockRes.rows.length > 0 ? parseFloat(satStockRes.rows[0].stock_actual) : 0;

                            await db.query(
                                `INSERT INTO public.colaborador_stock_satelite_movimientos 
                                    (usuario_id, ingrediente_id, kilos, tipo, carro_id, observaciones)
                                 VALUES ($1, $2, $3, $4, $5, $6)`,
                                [
                                    usuarioId,
                                    ing.id,
                                    -cantidadRequerida,
                                    'egreso_produccion',
                                    parseInt(carroId),
                                    `Egreso por asentado carro externo #${carroId} - Insumo consumido en cocción (stock satélite)`
                                ]
                            );
                            console.log(`✅ ${ing.nombre} descontado de Stock Satélite: -${cantidadRequerida} (Stock anterior: ${stockSateliteAnterior})`);
                        }
                    }
                } else {
                    console.log('ℹ️ No hay ingredientes vinculados para descontar');
                }
            } catch (error) {
                console.error('❌ Error procesando ingredientes vinculados:', error);
                throw new Error(`Error al descontar ingredientes vinculados: ${error.message}`);
            }

            // Obtener código de barras correspondiente al artículo fraccionado
            const fraccArtRes = await db.query(
                'SELECT codigo_barras FROM articulos WHERE numero = $1',
                [historialData.articulo_fraccionado_id]
            );
            const codigoBarrasFraccionado = fraccArtRes.rows[0]?.codigo_barras || '';

            // Registrar ingreso del artículo fraccionado
            console.log(`\n📝 Registrando movimiento: ${historialData.articulo_fraccionado_id} | cantidad: ${cantidadTotal}`);
            await db.query(`
                INSERT INTO stock_ventas_movimientos (
                    articulo_numero, codigo_barras, kilos, cantidad,
                    carro_id, usuario_id, fecha, tipo
                ) VALUES ($1, $2, 1, $3, $4, $5, NOW(), 'ingreso por produccion externa')
            `, [
                historialData.articulo_fraccionado_id,
                codigoBarrasFraccionado,
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

            // Agregar a la lista de artículos para recalcular stock consolidado
            if (!articulosAfectados.includes(historialData.articulo_fraccionado_id)) {
                articulosAfectados.push(historialData.articulo_fraccionado_id);
            }
        } else {
            // Para carros internos: registrar salida a ventas de cada artículo producido
            for (const articulo of articulosCarro) {
                console.log(`\n🔄 Procesando artículo ${articulo.articulo_numero}: ${articulo.descripcion} (cant: ${articulo.cantidad})`);
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

                if (!articulosAfectados.includes(articulo.articulo_numero)) {
                    articulosAfectados.push(articulo.articulo_numero);
                }
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

        // 7. Liquidar crédito por rendimiento en Cuenta Corriente (solo para carros externos)
        if (carro.tipo_carro === 'externa') {
            console.log('\n💳 INICIANDO LIQUIDACIÓN DE CRÉDITO POR RENDIMIENTO');
            console.log('==================================================');
            
            // Obtener el artículo fraccionado/producido
            const articuloFraccionadoCodigo = articulosCarro[0]?.articulo_numero || null;
            
            if (articuloFraccionadoCodigo) {
                // Buscar tarifa de rendimiento activa
                const { rows: tarifas } = await db.query(`
                    SELECT valor_por_unidad, unidad_medida 
                    FROM public.colaboradores_tarifas_rendimiento 
                    WHERE usuario_id = $1 AND articulo_numero = $2 AND activo = true
                    LIMIT 1
                `, [usuarioId, articuloFraccionadoCodigo]);

                if (tarifas.length > 0) {
                    const tarifa = tarifas[0];
                    let v_cantidad_liquidar = 0;
                    
                    if (tarifa.unidad_medida === 'un') {
                        if (unidades_producidas !== undefined && unidades_producidas !== null && !isNaN(unidades_producidas)) {
                            v_cantidad_liquidar = parseFloat(unidades_producidas);
                        } else {
                            // Fallback: 20 unidades por kilo
                            v_cantidad_liquidar = parseFloat(kilos_producidos) * 20;
                        }
                    } else {
                        v_cantidad_liquidar = parseFloat(kilos_producidos) + parseFloat((historialData && historialData.ingredientes_sumados) || 0);
                    }

                    const creditoMonto = Number((v_cantidad_liquidar * parseFloat(tarifa.valor_por_unidad)).toFixed(2));
                    console.log(`💰 Tarifa activa encontrada: $${tarifa.valor_por_unidad} por ${tarifa.unidad_medida}`);
                    console.log(`💰 Cantidad a liquidar: ${v_cantidad_liquidar} ${tarifa.unidad_medida} | Crédito calculado: $${creditoMonto}`);

                    if (creditoMonto > 0) {
                        // Buscar cuenta corriente del colaborador (bunker_clientes)
                        const { rows: clientes } = await db.query(`
                            SELECT bc.codigo_bunker_cliente, cc.id as cuenta_corriente_id
                            FROM public.bunker_clientes bc
                            JOIN public.factura_cuentas_corrientes cc ON bc.codigo_bunker_cliente = cc.codigo_bunker_cliente
                            WHERE bc.usuario_id = $1 AND cc.estado = 'ACTIVA'
                            LIMIT 1
                        `, [usuarioId]);

                        if (clientes.length > 0) {
                            const cliente = clientes[0];
                            console.log(`🏦 Cuenta Corriente encontrada: ID ${cliente.cuenta_corriente_id} para Cliente ${cliente.codigo_bunker_cliente}`);

                            const metadatosRendimiento = {
                                origen: 'LIQUIDACION_RENDIMIENTO_CARRO_EXTERNO',
                                carro_id: carroId,
                                articulo_codigo: articuloFraccionadoCodigo,
                                cantidad: v_cantidad_liquidar,
                                unidad_medida: tarifa.unidad_medida,
                                tarifa_unitaria: parseFloat(tarifa.valor_por_unidad),
                                productor_usuario_id: usuarioId,
                                liquidado_en: new Date().toISOString()
                            };

                            // Insertar movimiento (saldo_resultante temporal que será recalculado cronológicamente)
                            const desc = `Crédito por rendimiento carro externo #${carroId} (${v_cantidad_liquidar} ${tarifa.unidad_medida} de ${articuloFraccionadoCodigo})`;
                            await db.query(`
                                INSERT INTO public.factura_cuenta_corriente_movimientos 
                                    (cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante, 
                                     tipo_comprobante, comprobante_id, descripcion, fecha_movimiento, creado_en, metadatos)
                                VALUES 
                                    ($1, 'CREDITO', $2, 0.00, 'CREDITO_RENDIMIENTO', NULL, $3, NOW(), NOW(), $4)
                            `, [
                                cliente.cuenta_corriente_id,
                                creditoMonto,
                                desc,
                                JSON.stringify(metadatosRendimiento)
                            ]);

                            // Recalcular saldo y movimientos formalmente de forma transaccional
                            await CuentaCorrienteService.recalcularSaldos(cliente.cuenta_corriente_id, db);
                            console.log(`✅ Movimiento de crédito por rendimiento registrado y CC recalculada con éxito.`);
                        } else {
                            console.warn(`⚠️ ADVERTENCIA: El colaborador con usuario_id ${usuarioId} no posee una Cuenta Corriente activa vinculada en bunker_clientes.`);
                        }
                    }
                } else {
                    console.log(`ℹ️ No se encontró tarifa de rendimiento activa para usuario_id ${usuarioId} y artículo ${articuloFraccionadoCodigo}. No se acreditará saldo.`);
                }
            }
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

        // 🔄 Sondeo y Reconciliación automática post-confirmación de carro/producción externa
        try {
            const { reconciliarFaltantesConStock } = require('../services/reconciliacionStock');
            await reconciliarFaltantesConStock(db);
        } catch (errReconcil) {
            console.warn('⚠️ [PRODUCCION-CONFIRMADA] Sondeo post-producción omitido:', errReconcil.message);
        }

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
