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
            console.log('\n🔍 ===== DIAGNÓSTICO DETALLADO - CARRO EXTERNO =====');
            console.log(`📋 CARRO ID: ${carroId}`);
            console.log(`👤 USUARIO ID: ${usuarioId}`);
            console.log(`📦 TIPO CARRO: ${carro.tipo_carro}`);
            console.log(`⏰ FECHA PREPARADO: ${carro.fecha_preparado}`);
            console.log(`⏰ FECHA CONFIRMACION: ${carro.fecha_confirmacion}`);

            // LOG 1: Antes de la consulta SQL a articulos_produccion_externa_relacion
            console.log('\n🔍 LOG 1: ANTES DE CONSULTA SQL - articulos_produccion_externa_relacion');
            console.log('==========================================');
            console.log(`Query a ejecutar:`);
            console.log(`SELECT rel.articulo_kilo_codigo, a.codigo_barras, a.nombre, ca.cantidad, rel.multiplicador_ingredientes`);
            console.log(`FROM carros_articulos ca`);
            console.log(`INNER JOIN articulos_produccion_externa_relacion rel ON ca.articulo_numero = rel.articulo_produccion_codigo`);
            console.log(`LEFT JOIN articulos a ON a.numero = rel.articulo_kilo_codigo`);
            console.log(`WHERE ca.carro_id = ${carroId}`);

            // VERIFICACIÓN TÉCNICA ADICIONAL: Obtener artículos exactos del carro
            console.log('\n🔍 VERIFICACIÓN TÉCNICA: Artículos exactos en el carro');
            console.log('==========================================');
            const { rows: articulosExactos } = await db.query(`
                SELECT 
                    ca.articulo_numero,
                    ca.cantidad,
                    LENGTH(ca.articulo_numero) as longitud_codigo,
                    ASCII(SUBSTRING(ca.articulo_numero, 1, 1)) as primer_caracter_ascii,
                    ASCII(SUBSTRING(ca.articulo_numero, LENGTH(ca.articulo_numero), 1)) as ultimo_caracter_ascii
                FROM carros_articulos ca
                WHERE ca.carro_id = $1
            `, [carroId]);

            console.log(`📦 Artículos encontrados en carros_articulos: ${articulosExactos.length}`);
            articulosExactos.forEach((art, index) => {
                console.log(`  ${index + 1}. Código: "${art.articulo_numero}"`);
                console.log(`     - Cantidad: ${art.cantidad}`);
                console.log(`     - Longitud: ${art.longitud_codigo} caracteres`);
                console.log(`     - Primer carácter ASCII: ${art.primer_caracter_ascii}`);
                console.log(`     - Último carácter ASCII: ${art.ultimo_caracter_ascii}`);
                console.log(`     - Representación hexadecimal: ${Buffer.from(art.articulo_numero, 'utf8').toString('hex')}`);
            });

            // VERIFICACIÓN TÉCNICA: Buscar vínculos exactos para cada artículo
            console.log('\n🔍 VERIFICACIÓN TÉCNICA: Búsqueda directa de vínculos');
            console.log('==========================================');
            for (const artExacto of articulosExactos) {
                console.log(`\n🔎 Buscando vínculos para: "${artExacto.articulo_numero}"`);

                // Búsqueda exacta
                const { rows: vinculosExactos } = await db.query(`
                    SELECT 
                        articulo_produccion_codigo,
                        articulo_kilo_codigo,
                        multiplicador_ingredientes,
                        LENGTH(articulo_produccion_codigo) as longitud_produccion,
                        ASCII(SUBSTRING(articulo_produccion_codigo, 1, 1)) as primer_ascii_produccion,
                        ASCII(SUBSTRING(articulo_produccion_codigo, LENGTH(articulo_produccion_codigo), 1)) as ultimo_ascii_produccion
                    FROM articulos_produccion_externa_relacion
                    WHERE articulo_produccion_codigo = $1
                `, [artExacto.articulo_numero]);

                console.log(`   📊 Vínculos encontrados con búsqueda exacta: ${vinculosExactos.length}`);
                if (vinculosExactos.length > 0) {
                    vinculosExactos.forEach((vinculo, idx) => {
                        console.log(`     ${idx + 1}. Producción: "${vinculo.articulo_produccion_codigo}"`);
                        console.log(`        - Kilo: "${vinculo.articulo_kilo_codigo}"`);
                        console.log(`        - Multiplicador: ${vinculo.multiplicador_ingredientes}`);
                        console.log(`        - Longitud producción: ${vinculo.longitud_produccion}`);
                        console.log(`        - Primer ASCII producción: ${vinculo.primer_ascii_produccion}`);
                        console.log(`        - Último ASCII producción: ${vinculo.ultimo_ascii_produccion}`);
                    });
                } else {
                    console.log(`   ⚠️ NO se encontraron vínculos exactos`);

                    // Búsqueda con LIKE para detectar problemas de espacios o caracteres
                    const { rows: vinculosLike } = await db.query(`
                        SELECT 
                            articulo_produccion_codigo,
                            articulo_kilo_codigo,
                            LENGTH(articulo_produccion_codigo) as longitud,
                            TRIM(articulo_produccion_codigo) as codigo_trimmed
                        FROM articulos_produccion_externa_relacion
                        WHERE articulo_produccion_codigo LIKE $1
                           OR TRIM(articulo_produccion_codigo) = $2
                           OR UPPER(articulo_produccion_codigo) = UPPER($3)
                    `, [`%${artExacto.articulo_numero}%`, artExacto.articulo_numero.trim(), artExacto.articulo_numero]);

                    console.log(`   🔍 Búsqueda con LIKE/TRIM/UPPER: ${vinculosLike.length} resultados`);
                    vinculosLike.forEach((vinculo, idx) => {
                        console.log(`     ${idx + 1}. Código BD: "${vinculo.articulo_produccion_codigo}"`);
                        console.log(`        - Código trimmed: "${vinculo.codigo_trimmed}"`);
                        console.log(`        - Longitud: ${vinculo.longitud}`);
                        console.log(`        - ¿Coincide exacto?: ${vinculo.articulo_produccion_codigo === artExacto.articulo_numero}`);
                        console.log(`        - ¿Coincide trimmed?: ${vinculo.codigo_trimmed === artExacto.articulo_numero.trim()}`);
                    });
                }
            }

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

            // LOG 2: Después de la consulta SQL
            console.log('\n🔍 LOG 2: DESPUÉS DE CONSULTA SQL - RESULTADOS');
            console.log('==========================================');
            console.log(`📊 Número de artículos vinculados encontrados: ${articulosVinculados.length}`);

            if (articulosVinculados.length > 0) {
                console.log('📋 DETALLE DE ARTÍCULOS VINCULADOS:');
                articulosVinculados.forEach((art, index) => {
                    console.log(`  ${index + 1}. Artículo kilo: ${art.articulo_numero}`);
                    console.log(`     - Descripción: ${art.descripcion || 'Sin descripción'}`);
                    console.log(`     - Cantidad: ${art.cantidad}`);
                    console.log(`     - Código barras: ${art.codigo_barras || 'Sin código'}`);
                    console.log(`     - Multiplicador: ${art.multiplicador_ingredientes || 1}`);
                });
            } else {
                console.log('⚠️ NO SE ENCONTRARON ARTÍCULOS VINCULADOS');

                // Diagnóstico adicional: verificar si existen artículos en el carro
                const { rows: articulosEnCarro } = await db.query(`
                    SELECT ca.articulo_numero, ca.cantidad
                    FROM carros_articulos ca
                    WHERE ca.carro_id = $1
                `, [carroId]);

                console.log(`📦 Artículos en el carro (sin vínculos): ${articulosEnCarro.length}`);
                articulosEnCarro.forEach((art, index) => {
                    console.log(`  ${index + 1}. ${art.articulo_numero} - Cantidad: ${art.cantidad}`);
                });

                // Verificar si existen vínculos para estos artículos
                if (articulosEnCarro.length > 0) {
                    for (const artCarro of articulosEnCarro) {
                        const { rows: vinculos } = await db.query(`
                            SELECT * FROM articulos_produccion_externa_relacion
                            WHERE articulo_produccion_codigo = $1
                        `, [artCarro.articulo_numero]);

                        console.log(`🔗 Vínculos para ${artCarro.articulo_numero}: ${vinculos.length}`);
                        if (vinculos.length > 0) {
                            vinculos.forEach((vinculo, idx) => {
                                console.log(`    ${idx + 1}. Código producción: ${vinculo.articulo_produccion_codigo}`);
                                console.log(`       Código kilo: ${vinculo.articulo_kilo_codigo}`);
                                console.log(`       Multiplicador: ${vinculo.multiplicador_ingredientes}`);
                            });
                        }
                    }
                }
            }

            articulosCarro = articulosVinculados;
            console.log('🔗 Usando artículos vinculados para carro externo');
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

        // LOG 3: Justo antes del chequeo de articulosCarro.length === 0
        console.log('\n🔍 LOG 3: ANTES DEL CHEQUEO DE LONGITUD DE ARTÍCULOS');
        console.log('==========================================');
        console.log(`📊 articulosCarro.length: ${articulosCarro.length}`);
        console.log(`🔍 Contenido de articulosCarro:`, JSON.stringify(articulosCarro, null, 2));

        if (articulosCarro.length === 0) {
            console.log('❌ ERROR: El carro no tiene artículos para finalizar');
            console.log('🔍 DIAGNÓSTICO FINAL: El flujo se detiene aquí - no se ejecutarán los siguientes pasos:');
            console.log('   - Registro en produccion_externa_historial');
            console.log('   - Registro de movimiento "ingreso por produccion externa"');
            console.log('   - Actualización de stock_consolidado');
            throw new Error('El carro no tiene artículos para finalizar');
        }

        console.log('✅ VALIDACIÓN EXITOSA: El carro tiene artículos para procesar');

        // 4. Registrar en produccion_externa_historial PRIMERO (solo para carros externos)
        let historialData = null;
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
            console.log(`🔍 DEBUG - Artículo padre obtenido:`, {
                codigo: articuloPadre.articulo_numero,
                descripcion: articuloPadre.descripcion,
                cantidad: articuloPadre.cantidad
            });

            // El artículo fraccionado ya lo tenemos en articulosCarro[0] (que son los vinculados)
            const articuloFraccionadoCodigo = articulosCarro[0]?.articulo_numero || null;
            console.log(`✅ DEBUG - Artículo fraccionado: ${articuloFraccionadoCodigo}`);

            // Calcular ingredientes_sumados: obtener ingredientes del artículo vinculado
            let ingredientesSumados = 0;
            if (articuloFraccionadoCodigo) {
                console.log(`\n🧮 CALCULANDO INGREDIENTES SUMADOS PARA: ${articuloFraccionadoCodigo}`);
                console.log('==========================================');

                // Obtener ingredientes vinculados usando la función existente
                const { obtenerIngredientesArticulosVinculados } = require('./carroIngredientes');
                const ingredientesVinculados = await obtenerIngredientesArticulosVinculados(carroId, usuarioId);

                console.log(`🔍 Ingredientes vinculados obtenidos: ${ingredientesVinculados.length}`);

                // Sumar todas las cantidades de ingredientes vinculados
                ingredientesSumados = ingredientesVinculados.reduce((suma, ingrediente) => {
                    const cantidad = parseFloat(ingrediente.cantidad) || 0;
                    console.log(`- ${ingrediente.nombre}: ${cantidad} ${ingrediente.unidad_medida || 'kg'}`);
                    return suma + cantidad;
                }, 0);

                // Redondear a 2 decimales para evitar problemas de precisión
                ingredientesSumados = Number(ingredientesSumados.toFixed(2));

                console.log(`\n📊 TOTAL INGREDIENTES SUMADOS: ${ingredientesSumados} kg`);
                console.log('==========================================');
            } else {
                console.log(`⚠️ No se encontró artículo vinculado, ingredientes_sumados = 0`);
            }

            // Preparar datos para inserción (usando códigos alfanuméricos como TEXT)
            const datosHistorial = [
                carroId,                              // carro_id (integer)
                usuarioId,                            // usuario_id (integer)
                articuloPadre.articulo_numero,        // articulo_padre_id (text) - código alfanumérico
                articuloFraccionadoCodigo,            // articulo_fraccionado_id (text) - código alfanumérico o null
                kilos_producidos,                     // kilos_producidos (numeric)
                ingredientesSumados                   // ingredientes_sumados (numeric)
            ];

            console.log(`🔍 DEBUG - Datos para insertar en historial:`, {
                carro_id: carroId,
                usuario_id: usuarioId,
                articulo_padre_id: articuloPadre.articulo_numero,
                articulo_fraccionado_id: articuloFraccionadoCodigo,
                kilos_producidos: kilos_producidos,
                ingredientes_sumados: ingredientesSumados
            });

            // Insertar en historial usando códigos alfanuméricos
            await db.query(`
                INSERT INTO produccion_externa_historial (
                    carro_id,
                    usuario_id,
                    articulo_padre_id,
                    articulo_fraccionado_id,
                    kilos_producidos,
                    ingredientes_sumados,
                    fecha_registro
                ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
            `, datosHistorial);

            console.log(`✅ Registro en historial creado para carro ${carroId}`);
            console.log(`- Artículo padre (código): ${articuloPadre.articulo_numero}`);
            console.log(`- Artículo fraccionado (código): ${articuloFraccionadoCodigo || 'No definido'}`);
            console.log(`- Kilos producidos: ${kilos_producidos}`);

            // Guardar datos para usar en el registro de movimientos
            historialData = {
                articulo_fraccionado_id: articuloFraccionadoCodigo,
                kilos_producidos: kilos_producidos,
                ingredientes_sumados: ingredientesSumados
            };
        }

        // 5. Registrar movimientos según el tipo de carro
        for (const articulo of articulosCarro) {
            console.log(`\n🔄 Procesando artículo ${articulo.articulo_numero}:`);
            console.log(`- Descripción: ${articulo.descripcion}`);
            console.log(`- Cantidad: ${articulo.cantidad}`);
            console.log(`- Código de barras: ${articulo.codigo_barras}`);

            if (carro.tipo_carro === 'externa') {
                // Para carros externos: usar datos del historial ya creado
                const cantidadTotal = parseFloat(historialData.kilos_producidos) + parseFloat(historialData.ingredientes_sumados);

                console.log(`🔍 Datos del historial para carro ${carroId}:`);
                console.log(`- Artículo vinculado: ${historialData.articulo_fraccionado_id}`);
                console.log(`- Kilos producidos: ${historialData.kilos_producidos}`);
                console.log(`- Ingredientes sumados: ${historialData.ingredientes_sumados}`);
                console.log(`- Cantidad total calculada: ${cantidadTotal}`);

                // ✅ CORRECCIÓN CRÍTICA: Los ingredientes vinculados se descontarán AQUÍ
                // en finalizarProduccion.js, NO en marcarCarroPreparado.js
                console.log('\n🔍 INGREDIENTES VINCULADOS: Procesando descuento en asentado');
                console.log('==========================================');

                // Obtener y descontar ingredientes vinculados del stock general
                const { obtenerIngredientesArticulosVinculados } = require('./carroIngredientes');
                const { registrarMovimientoIngrediente } = require('./ingredientesMovimientos');

                try {
                    const ingredientesVinculados = await obtenerIngredientesArticulosVinculados(carroId, usuarioId);
                    console.log(`🔗 Ingredientes vinculados a descontar: ${ingredientesVinculados?.length || 0}`);

                    if (ingredientesVinculados && ingredientesVinculados.length > 0) {
                        for (const ing of ingredientesVinculados) {
                            console.log(`\n🔄 DESCONTANDO INGREDIENTE VINCULADO: ${ing.nombre}`);
                            console.log(`- Cantidad: ${ing.cantidad} ${ing.unidad_medida}`);
                            console.log(`- Stock disponible: ${ing.stock_actual}`);

                            // Validar stock suficiente
                            const stockGeneral = parseFloat(ing.stock_actual) || 0;
                            const cantidadRequerida = Number(ing.cantidad.toFixed(4));

                            if (stockGeneral < cantidadRequerida) {
                                throw new Error(`Stock general insuficiente para ingrediente vinculado "${ing.nombre}". Disponible: ${stockGeneral}, Requerido: ${cantidadRequerida}`);
                            }

                            // Registrar movimiento de egreso
                            const movimientoData = {
                                ingrediente_id: ing.id,
                                kilos: -cantidadRequerida, // Negativo para egreso
                                tipo: 'egreso',
                                carro_id: parseInt(carroId),
                                observaciones: `Egreso por asentado carro externo #${carroId} - Ingrediente vinculado (stock general)`,
                                stock_anterior: stockGeneral // 📸 SNAPSHOT: Guardar stock antes del movimiento
                            };

                            console.log(`📝 REGISTRANDO MOVIMIENTO DE EGRESO:`, JSON.stringify(movimientoData, null, 2));
                            await registrarMovimientoIngrediente(movimientoData, db);
                            console.log(`✅ Ingrediente vinculado ${ing.nombre} descontado correctamente`);
                        }
                    } else {
                        console.log('ℹ️ No hay ingredientes vinculados para descontar');
                    }
                } catch (error) {
                    console.error('❌ Error procesando ingredientes vinculados:', error);
                    throw new Error(`Error al descontar ingredientes vinculados: ${error.message}`);
                }


                // LOG 4: Justo antes del registro del movimiento 'ingreso por producción externa'
                console.log('\n🔍 LOG 4: ANTES DEL REGISTRO DE MOVIMIENTO - ingreso por produccion externa');
                console.log('==========================================');
                console.log(`📝 Parámetros para INSERT en stock_ventas_movimientos:`);
                console.log(`   - articulo_numero: ${historialData.articulo_fraccionado_id}`);
                console.log(`   - codigo_barras: ${articulo.codigo_barras || 'Sin código'}`);
                console.log(`   - kilos: 1`);
                console.log(`   - cantidad: ${cantidadTotal}`);
                console.log(`   - carro_id: ${carroId}`);
                console.log(`   - usuario_id: ${usuarioId}`);
                console.log(`   - tipo: 'ingreso por produccion externa'`);

                // Registrar ingreso del artículo vinculado con cantidad calculada
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
                    ) VALUES ($1, $2, 1, $3, $4, $5, NOW(), 'ingreso por produccion externa')
                `, [
                    historialData.articulo_fraccionado_id,  // Artículo vinculado desde historial
                    articulo.codigo_barras || '',
                    cantidadTotal,     // kilos_producidos + ingredientes_sumados
                    carroId,
                    usuarioId
                ]);

                console.log('✅ LOG 4: MOVIMIENTO REGISTRADO EN stock_ventas_movimientos');

                // Actualizar stock_movimientos para ingreso
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
                    historialData.articulo_fraccionado_id,
                    cantidadTotal // Sumar la cantidad total calculada a stock_movimientos
                ]);

                console.log('✅ Movimiento de ingreso por producción externa registrado correctamente');
                console.log(`✅ Cantidad registrada: ${cantidadTotal} (${historialData.kilos_producidos} + ${historialData.ingredientes_sumados})`);
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
