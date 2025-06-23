const pool = require('../../usuarios/pool');

/**
 * Registra un movimiento de stock de usuario siguiendo lógica FIFO inteligente
 * @param {Object} params - Parámetros del movimiento
 * @param {number} params.usuario_id - ID del usuario
 * @param {number} params.ingrediente_id - ID del ingrediente
 * @param {number} params.cantidad - Cantidad a descontar (debe ser negativa)
 * @param {number} params.carro_id - ID del carro que genera el movimiento
 * @param {number} params.origen_mix_id - ID del mix de origen (opcional, para priorizar stock)
 * @param {Object} db - Conexión a la base de datos para transacciones
 */
async function registrarMovimientoStockUsuarioFIFO(params, db) {
    const { usuario_id, ingrediente_id, cantidad, carro_id } = params;
    
    if (cantidad >= 0) {
        throw new Error('La cantidad debe ser negativa para consumo FIFO');
    }

    let cantidadRestante = Math.abs(cantidad); // Convertir a positivo para los cálculos
    let registrosAProcesar = [];

    // Si hay origen_mix_id, primero buscar stock con ese origen
    if (params.origen_mix_id) {
        console.log(`\n🔍 BUSCANDO STOCK CON ORIGEN MIX ID=${params.origen_mix_id}`);
        
        const queryStockMix = `
            SELECT id, cantidad, origen_mix_id
            FROM ingredientes_stock_usuarios
            WHERE usuario_id = $1 
            AND ingrediente_id = $2
            AND cantidad > 0
            AND origen_mix_id = $3
            ORDER BY fecha_registro ASC
        `;
        
        const stockMixResult = await db.query(queryStockMix, [usuario_id, ingrediente_id, params.origen_mix_id]);
        const stockMixDisponible = stockMixResult.rows.reduce((sum, row) => sum + row.cantidad, 0);
        
        console.log(`- Stock encontrado con origen_mix_id=${params.origen_mix_id}: ${stockMixDisponible}`);
        registrosAProcesar = registrosAProcesar.concat(stockMixResult.rows);
    }

    // Si aún necesitamos más stock, buscar registros sin origen_mix_id
    if (cantidadRestante > registrosAProcesar.reduce((sum, row) => sum + row.cantidad, 0)) {
        console.log('\n🔍 BUSCANDO STOCK SIN ORIGEN MIX (INGREDIENTES SIMPLES)');
        
        const queryStockSimple = `
            SELECT id, cantidad, origen_mix_id
            FROM ingredientes_stock_usuarios
            WHERE usuario_id = $1 
            AND ingrediente_id = $2
            AND cantidad > 0
            AND origen_mix_id IS NULL
            ORDER BY fecha_registro ASC
        `;
        
        const stockSimpleResult = await db.query(queryStockSimple, [usuario_id, ingrediente_id]);
        const stockSimpleDisponible = stockSimpleResult.rows.reduce((sum, row) => sum + row.cantidad, 0);
        
        console.log(`- Stock encontrado sin origen_mix_id: ${stockSimpleDisponible}`);
        registrosAProcesar = registrosAProcesar.concat(stockSimpleResult.rows);
    }

    // Verificar stock total disponible
    const stockTotalDisponible = registrosAProcesar.reduce((sum, row) => sum + row.cantidad, 0);
    console.log(`\n📊 RESUMEN DE STOCK:`);
    console.log(`- Cantidad requerida: ${cantidadRestante}`);
    console.log(`- Stock total disponible: ${stockTotalDisponible}`);

    if (stockTotalDisponible < cantidadRestante) {
        throw new Error(`Stock insuficiente para ingrediente ${ingrediente_id}. Disponible: ${stockTotalDisponible}, Requerido: ${cantidadRestante}`);
    }

    // Procesar registros FIFO (primero los del mix, luego los simples)
    console.log('\n🔄 PROCESANDO REGISTROS FIFO:');
    for (const registro of registrosAProcesar) {
        if (cantidadRestante <= 0) break;

        const cantidadADescontar = Math.min(registro.cantidad, cantidadRestante);
        const nuevaCantidad = registro.cantidad - cantidadADescontar;
        
        // Log detallado del procesamiento
        const tipoOrigen = registro.origen_mix_id ? `Mix ID=${registro.origen_mix_id}` : 'Ingrediente simple';
        console.log(`📦 Procesando registro ID=${registro.id} (${tipoOrigen})`);
        console.log(`   - Cantidad disponible: ${registro.cantidad}`);
        console.log(`   - Cantidad a descontar: ${cantidadADescontar}`);
        console.log(`   - Cantidad restante después: ${nuevaCantidad}`);

        // Actualizar o eliminar el registro según corresponda
        if (nuevaCantidad > 0) {
            await db.query(
                'UPDATE ingredientes_stock_usuarios SET cantidad = $1 WHERE id = $2',
                [nuevaCantidad, registro.id]
            );
            console.log(`   ✅ Registro actualizado con nueva cantidad: ${nuevaCantidad}`);
        } else {
            await db.query(
                'DELETE FROM ingredientes_stock_usuarios WHERE id = $1',
                [registro.id]
            );
            console.log(`   ✅ Registro eliminado (cantidad agotada)`);
        }

        // Registrar el movimiento negativo manteniendo origen_mix_id
        await db.query(`
            INSERT INTO ingredientes_stock_usuarios 
            (ingrediente_id, usuario_id, cantidad, origen_carro_id, fecha_registro, origen_mix_id)
            VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5)
        `, [
            ingrediente_id,
            usuario_id,
            -cantidadADescontar,
            carro_id,
            registro.origen_mix_id // Mantener el mismo origen_mix_id del registro consumido
        ]);
        
        console.log(`   ✅ Movimiento negativo registrado: -${cantidadADescontar}`);

        cantidadRestante -= cantidadADescontar;
        console.log(`   📊 Cantidad pendiente: ${cantidadRestante}`);
    }
}

/**
 * Agrega stock de un ingrediente a un usuario específico
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
async function agregarStockUsuario(req, res) {
    try {
        const { usuario_id, ingrediente_id, cantidad, origen_carro_id, origen_mix_id } = req.body;

        // Validar datos requeridos
        if (!usuario_id || !ingrediente_id || cantidad === undefined || cantidad === null) {
            return res.status(400).json({
                error: 'Se requieren usuario_id, ingrediente_id y cantidad'
            });
        }

        // Validar que la cantidad sea un número válido
        const cantidadNumerica = parseFloat(cantidad);
        if (isNaN(cantidadNumerica)) {
            return res.status(400).json({
                error: 'La cantidad debe ser un número válido'
            });
        }

        // Insertar en la tabla ingredientes_stock_usuarios incluyendo origen_mix_id
        const query = `
            INSERT INTO ingredientes_stock_usuarios 
            (ingrediente_id, usuario_id, cantidad, origen_carro_id, fecha_registro, origen_mix_id)
            VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5)
            RETURNING id
        `;

        const result = await pool.query(query, [
            ingrediente_id,
            usuario_id,
            cantidadNumerica,
            origen_carro_id || null,
            origen_mix_id || null
        ]);

        // Log detallado con origen_mix_id
        console.log(`🧾 Registro de stock agregado: ingrediente_id=${ingrediente_id}, cantidad=${cantidadNumerica}, origen_mix_id=${origen_mix_id || 'NULL'}`);

        res.status(201).json({
            message: 'Stock agregado correctamente',
            id: result.rows[0].id
        });

    } catch (error) {
        console.error('Error al agregar stock de usuario:', error);
        res.status(500).json({
            error: 'Error interno del servidor al agregar stock'
        });
    }
}

module.exports = {
    agregarStockUsuario,
    registrarMovimientoStockUsuarioFIFO
};
