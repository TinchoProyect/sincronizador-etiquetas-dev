const { registrarMovimientoStockVentas } = require('./stockVentasMovimientos');

/**
 * Finaliza la producción de un carro y registra los movimientos de stock de ventas
 */
async function finalizarProduccion(req, res) {
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

        if (articulosCarro.length === 0) {
            throw new Error('El carro no tiene artículos para finalizar');
        }

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

        // Recalcular stock_consolidado para todos los artículos afectados
        if (articulosAfectados.length > 0) {
            await recalcularStockConsolidado(db, articulosAfectados);
            console.log(`Stock consolidado recalculado para ${articulosAfectados.length} artículo(s)`);
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
