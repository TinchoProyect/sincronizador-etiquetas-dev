const pool = require('../config/database');

/**
 * Controlador especializado para la eliminación segura de carros de producción
 * Maneja la eliminación en cascada de todos los registros relacionados
 */

/**
 * Cuenta los registros relacionados con un carro en las tablas de movimientos
 * @param {number} carroId - ID del carro a analizar
 * @returns {Promise<Object>} Objeto con conteos de registros relacionados
 */
async function contarRegistrosRelacionados(carroId) {
    try {
        // Primero obtener el tipo de carro
        const tipoCarroQuery = `
            SELECT tipo_carro FROM carros_produccion WHERE id = $1
        `;
        const tipoCarroResult = await pool.query(tipoCarroQuery, [carroId]);
        const tipoCarro = tipoCarroResult.rows[0]?.tipo_carro || 'interna';

        // Queries base que siempre se ejecutan
        const countStockQuery = `
            SELECT COUNT(*) as count FROM stock_ventas_movimientos 
            WHERE carro_id = $1
        `;
        const countArticulosQuery = `
            SELECT COUNT(*) as count FROM carros_articulos 
            WHERE carro_id = $1
        `;

        // Query condicional según tipo de carro
        const countMovimientosQuery = tipoCarro === 'externa' 
            ? `SELECT COUNT(*) as count FROM ingredientes_stock_usuarios WHERE origen_carro_id = $1`
            : `SELECT COUNT(*) as count FROM ingredientes_movimientos WHERE carro_id = $1`;

        // Query para historial de producción externa
        const countHistorialQuery = tipoCarro === 'externa' 
            ? `SELECT COUNT(*) as count FROM produccion_externa_historial WHERE carro_id = $1`
            : `SELECT 0 as count`;

        // Ejecutar queries con parámetros apropiados según tipo de carro
        const [movimientosResult, stockResult, articulosResult, historialResult] = await Promise.all([
            pool.query(countMovimientosQuery, [carroId]),
            pool.query(countStockQuery, [carroId]),
            pool.query(countArticulosQuery, [carroId]),
            tipoCarro === 'externa' 
                ? pool.query(countHistorialQuery, [carroId])  // ✅ CON parámetro para externos
                : pool.query(countHistorialQuery)             // ✅ SIN parámetro para internos
        ]);

        return {
            tipoCarro,
            ingredientes: parseInt(movimientosResult.rows[0].count),
            stockVentas: parseInt(stockResult.rows[0].count),
            articulos: parseInt(articulosResult.rows[0].count),
            historial: parseInt(historialResult.rows[0].count)
        };
    } catch (error) {
        console.error('Error al contar registros relacionados:', error);
        throw new Error('No se pudo verificar los registros relacionados del carro');
    }
}

/**
 * Valida si un carro pertenece a un usuario específico
 * @param {number} carroId - ID del carro
 * @param {number} usuarioId - ID del usuario
 * @returns {Promise<boolean>}
 */
async function validarPropiedadCarro(carroId, usuarioId) {
    try {
        const query = `
            SELECT COUNT(*)::integer AS count 
            FROM carros_produccion 
            WHERE id = $1 AND usuario_id = $2
        `;
        const result = await pool.query(query, [carroId, usuarioId]);
        return result.rows[0].count > 0;
    } catch (error) {
        console.error('Error al validar propiedad del carro:', error);
        return false;
    }
}

/**
 * Elimina todos los registros relacionados con un carro en el orden correcto
 * @param {number} carroId - ID del carro a eliminar
 * @returns {Promise<Object>} Resultado de la eliminación con conteos
 */
async function eliminarRegistrosRelacionados(carroId) {
    try {
        // Contar registros antes de eliminar para el reporte
        const conteos = await contarRegistrosRelacionados(carroId);

        // Eliminar en el orden correcto para mantener integridad referencial
        
        // 1. Eliminar movimientos de ingredientes según tipo de carro
        if (conteos.tipoCarro === 'externa') {
            // EXCEPCIÓN AL SISTEMA INMUTABLE: Solo para eliminación completa de carros
            await pool.query('DELETE FROM ingredientes_stock_usuarios WHERE origen_carro_id = $1', [carroId]);
            console.log(`Eliminados ${conteos.ingredientes} movimientos de stock de usuarios`);
        }
        
        // 🔧 CORRECCIÓN CRÍTICA: REVERTIR movimientos de ingredientes_movimientos antes de eliminar
        // NOTA: Los ingredientes vinculados ahora se descontarán en finalizarProduccion.js
        // Por lo tanto, solo necesitamos revertir si el carro fue asentado (tiene fecha_confirmacion)
        
        // Verificar si el carro fue asentado
        const carroQuery = `SELECT fecha_confirmacion FROM carros_produccion WHERE id = $1`;
        const carroResult = await pool.query(carroQuery, [carroId]);
        const carroAsentado = carroResult.rows[0]?.fecha_confirmacion !== null;
        
        console.log(`🔍 ESTADO DEL CARRO: ${carroAsentado ? 'ASENTADO' : 'SOLO PREPARADO'}`);
        
        if (carroAsentado) {
            // Solo revertir movimientos si el carro fue asentado
            const ingredientesMovimientosQuery = `
                SELECT id, ingrediente_id, kilos, tipo, observaciones
                FROM ingredientes_movimientos 
                WHERE carro_id = $1
            `;
            const ingredientesMovimientosResult = await pool.query(ingredientesMovimientosQuery, [carroId]);
            const movimientosIngredientes = ingredientesMovimientosResult.rows;
            
            console.log(`🔍 MOVIMIENTOS DE INGREDIENTES A REVERTIR: ${movimientosIngredientes.length}`);
            
            if (movimientosIngredientes.length > 0) {
                // Importar función para registrar movimientos
                const { registrarMovimientoIngrediente } = require('./ingredientesMovimientos');
                
                for (const mov of movimientosIngredientes) {
                    console.log(`\n🔄 REVIRTIENDO MOVIMIENTO DE INGREDIENTE:`);
                    console.log(`- Ingrediente ID: ${mov.ingrediente_id}`);
                    console.log(`- Movimiento original: ${mov.tipo} de ${mov.kilos}kg`);
                    console.log(`- Observaciones originales: ${mov.observaciones}`);
                    
                    // Calcular movimiento inverso
                    const tipoInverso = mov.tipo === 'egreso' ? 'ingreso' : 'egreso';
                    const cantidadInversa = -parseFloat(mov.kilos); // ✅ INVERTIR el signo
                    
                    console.log(`- Movimiento inverso: ${tipoInverso} de ${Math.abs(cantidadInversa)}kg`);
                    
                    // Registrar movimiento inverso
                    const movimientoInverso = {
                        ingrediente_id: mov.ingrediente_id,
                        kilos: cantidadInversa, // Cantidad con signo invertido
                        tipo: tipoInverso,
                        carro_id: parseInt(carroId),
                        observaciones: `REVERSIÓN: ${mov.observaciones} (eliminación carro #${carroId})`
                    };
                    
                    console.log(`📝 REGISTRANDO MOVIMIENTO INVERSO:`, JSON.stringify(movimientoInverso, null, 2));
                    await registrarMovimientoIngrediente(movimientoInverso, pool);
                    console.log(`✅ Movimiento inverso registrado para ingrediente ${mov.ingrediente_id}`);
                }
                
                // Ahora sí eliminar los movimientos originales
                await pool.query('DELETE FROM ingredientes_movimientos WHERE carro_id = $1', [carroId]);
                console.log(`✅ Eliminados ${movimientosIngredientes.length} movimientos originales de ingredientes después de revertir`);
            }
        } else {
            console.log(`ℹ️ Carro solo preparado - eliminando movimientos sin reversión (ingredientes vinculados no fueron descontados)`);
            // Para carros solo preparados, eliminar directamente sin reversión
            await pool.query('DELETE FROM ingredientes_movimientos WHERE carro_id = $1', [carroId]);
        }
        
        // 2. Obtener y procesar movimientos de stock de ventas antes de eliminarlos
        let movimientosQuery;
        if (conteos.tipoCarro === 'externa') {
            // Para carros externos: incluir movimientos de producción externa
            movimientosQuery = `
                SELECT articulo_numero, cantidad, tipo
                FROM stock_ventas_movimientos 
                WHERE carro_id = $1 AND tipo IN ('ingreso a producción', 'salida a ventas', 'ingreso por produccion externa', 'egreso por receta externa')
            `;
        } else {
            // Para carros internos: solo movimientos tradicionales
            movimientosQuery = `
                SELECT articulo_numero, cantidad, tipo
                FROM stock_ventas_movimientos 
                WHERE carro_id = $1 AND tipo IN ('ingreso a producción', 'salida a ventas')
            `;
        }
        
        const movimientosResult = await pool.query(movimientosQuery, [carroId]);
        
        const { recalcularStockConsolidado } = require('../utils/recalcularStock');
        
        // Actualizar stock_movimientos para cada movimiento según su tipo
        const articulosAfectados = [];
        
        for (const mov of movimientosResult.rows) {
            if (mov.tipo === 'ingreso a producción') {
                // Para ingreso a producción eliminado: SUMAR de vuelta la cantidad a stock_movimientos
                await pool.query(`
                    UPDATE stock_real_consolidado 
                    SET 
                        stock_movimientos = COALESCE(stock_movimientos, 0) + $1,
                        ultima_actualizacion = NOW()
                    WHERE articulo_numero = $2
                `, [mov.cantidad, mov.articulo_numero]);
                console.log(`Stock movimientos actualizado para artículo ${mov.articulo_numero}: +${mov.cantidad} (revertir ingreso a producción)`);
            } else if (mov.tipo === 'salida a ventas') {
                // Para salida a ventas eliminada: RESTAR la cantidad de stock_movimientos
                await pool.query(`
                    UPDATE stock_real_consolidado 
                    SET 
                        stock_movimientos = COALESCE(stock_movimientos, 0) - $1,
                        ultima_actualizacion = NOW()
                    WHERE articulo_numero = $2
                `, [mov.cantidad, mov.articulo_numero]);
                console.log(`Stock movimientos actualizado para artículo ${mov.articulo_numero}: -${mov.cantidad} (revertir salida a ventas)`);
            } else if (mov.tipo === 'ingreso por produccion externa') {
                // Para ingreso por producción externa eliminado: RESTAR la cantidad de stock_movimientos
                await pool.query(`
                    UPDATE stock_real_consolidado 
                    SET 
                        stock_movimientos = COALESCE(stock_movimientos, 0) - $1,
                        ultima_actualizacion = NOW()
                    WHERE articulo_numero = $2
                `, [mov.cantidad, mov.articulo_numero]);
                console.log(`Stock movimientos actualizado para artículo ${mov.articulo_numero}: -${mov.cantidad} (revertir ingreso por producción externa)`);
            } else if (mov.tipo === 'egreso por receta externa') {
                // Para egreso por receta externa eliminado: SUMAR de vuelta la cantidad a stock_movimientos
                await pool.query(`
                    UPDATE stock_real_consolidado 
                    SET 
                        stock_movimientos = COALESCE(stock_movimientos, 0) + $1,
                        ultima_actualizacion = NOW()
                    WHERE articulo_numero = $2
                `, [Math.abs(mov.cantidad), mov.articulo_numero]);
                console.log(`Stock movimientos actualizado para artículo ${mov.articulo_numero}: +${Math.abs(mov.cantidad)} (revertir egreso por receta externa)`);
            }
            
            // Agregar artículo a la lista para recalcular
            if (!articulosAfectados.includes(mov.articulo_numero)) {
                articulosAfectados.push(mov.articulo_numero);
            }
        }
        
        // Recalcular stock_consolidado para todos los artículos afectados
        if (articulosAfectados.length > 0) {
            await recalcularStockConsolidado(pool, articulosAfectados);
            console.log(`Stock consolidado recalculado para ${articulosAfectados.length} artículo(s)`);
        }

        // Eliminar los movimientos
        await pool.query('DELETE FROM stock_ventas_movimientos WHERE carro_id = $1', [carroId]);
        console.log(`Eliminados ${conteos.stockVentas} movimientos de stock de ventas`);
        
        // 3. Eliminar registros de historial de producción externa (solo para carros externos)
        if (conteos.tipoCarro === 'externa' && conteos.historial > 0) {
            await pool.query('DELETE FROM produccion_externa_historial WHERE carro_id = $1', [carroId]);
            console.log(`Eliminados ${conteos.historial} registros de historial de producción externa`);
        }
        
        // 4. Eliminar artículos del carro
        await pool.query('DELETE FROM carros_articulos WHERE carro_id = $1', [carroId]);
        console.log(`Eliminados ${conteos.articulos} artículos del carro`);
        
        // 5. Finalmente eliminar el carro
        await pool.query('DELETE FROM carros_produccion WHERE id = $1', [carroId]);
        console.log(`Carro ${carroId} eliminado de carros_produccion`);

        return conteos;
    } catch (error) {
        console.error('Error al eliminar registros relacionados:', error);
        throw error;
    }
}

/**
 * Función principal para eliminar un carro de producción de forma segura
 * Implementa eliminación en cascada con validaciones y transacciones
 * @param {number} carroId - ID del carro a eliminar
 * @param {number} usuarioId - ID del usuario que solicita la eliminación
 * @returns {Promise<Object>} Resultado de la operación
 */
async function eliminarCarroCompleto(carroId, usuarioId) {
    try {
        // Validar que el carro pertenezca al usuario
        const esValido = await validarPropiedadCarro(carroId, usuarioId);
        if (!esValido) {
            throw new Error('El carro no pertenece al usuario especificado');
        }

        // Contar registros relacionados para informar al usuario
        const conteos = await contarRegistrosRelacionados(carroId);
        const tieneRegistrosRelacionados = conteos.ingredientes > 0 || conteos.stockVentas > 0 || conteos.historial > 0;

        // Iniciar transacción para garantizar atomicidad
        await pool.query('BEGIN');

        try {
            // Eliminar todos los registros relacionados
            const conteosEliminados = await eliminarRegistrosRelacionados(carroId);

            // Confirmar transacción
            await pool.query('COMMIT');

            // Preparar mensaje de resultado
            let mensaje = `Carro ${carroId} (${conteos.tipoCarro}) eliminado exitosamente`;
            if (tieneRegistrosRelacionados) {
                mensaje += `\nRegistros eliminados:\n` +
                          `- ${conteosEliminados.ingredientes} ${conteos.tipoCarro === 'externa' ? 'movimientos de stock de usuarios' : 'movimientos de ingredientes'}\n` +
                          `- ${conteosEliminados.stockVentas} movimientos de stock de ventas\n` +
                          `- ${conteosEliminados.articulos} artículos`;
                
                if (conteos.tipoCarro === 'externa' && conteosEliminados.historial > 0) {
                    mensaje += `\n- ${conteosEliminados.historial} registros de historial de producción externa`;
                }
            }

            return {
                success: true,
                mensaje: mensaje,
                registrosEliminados: conteosEliminados
            };

        } catch (error) {
            // Revertir transacción en caso de error
            await pool.query('ROLLBACK');
            console.error('Error durante la eliminación, transacción revertida:', error);
            throw new Error('No se pudo completar la eliminación del carro');
        }

    } catch (error) {
        console.error('Error al eliminar carro completo:', error);
        throw error;
    }
}

/**
 * Obtiene información detallada sobre los registros relacionados con un carro
 * Útil para mostrar al usuario qué se eliminará antes de confirmar
 * @param {number} carroId - ID del carro
 * @param {number} usuarioId - ID del usuario
 * @returns {Promise<Object>} Información detallada de registros relacionados
 */
async function obtenerInformacionEliminacion(carroId, usuarioId) {
    try {
        // Validar propiedad del carro
        const esValido = await validarPropiedadCarro(carroId, usuarioId);
        if (!esValido) {
            throw new Error('El carro no pertenece al usuario especificado');
        }

        // Obtener conteos
        const conteos = await contarRegistrosRelacionados(carroId);

        // Preparar mensaje informativo
        const tieneRegistros = conteos.ingredientes > 0 || conteos.stockVentas > 0 || conteos.articulos > 0 || conteos.historial > 0;
        
        let mensaje = `Información sobre el carro ${carroId} (${conteos.tipoCarro}):\n`;
        mensaje += `- ${conteos.articulos} artículos\n`;
        mensaje += `- ${conteos.ingredientes} ${conteos.tipoCarro === 'externa' ? 'movimientos de stock de usuarios' : 'movimientos de ingredientes'}\n`;
        mensaje += `- ${conteos.stockVentas} movimientos de stock de ventas\n`;
        
        if (conteos.tipoCarro === 'externa' && conteos.historial > 0) {
            mensaje += `- ${conteos.historial} registros de historial de producción externa\n`;
        }
        
        if (tieneRegistros) {
            mensaje += `\n⚠️ ATENCIÓN: Todos estos registros serán eliminados permanentemente.`;
        }

        return {
            carroId: carroId,
            conteos: conteos,
            tieneRegistrosRelacionados: tieneRegistros,
            mensaje: mensaje
        };

    } catch (error) {
        console.error('Error al obtener información de eliminación:', error);
        throw error;
    }
}

module.exports = {
    eliminarCarroCompleto,
    obtenerInformacionEliminacion,
    contarRegistrosRelacionados,
    validarPropiedadCarro
};
