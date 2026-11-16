const pool = require('../../usuarios/pool');

/**
 * Registra movimientos de stock de usuario siguiendo lógica FIFO inteligente
 * Sistema de movimientos inmutables: solo inserta registros negativos, preserva historial completo
 * @param {Object} params - Parámetros del movimiento
 * @param {number} params.usuario_id - ID del usuario
 * @param {number} params.ingrediente_id - ID del ingrediente
 * @param {number} params.cantidad - Cantidad a descontar (debe ser negativa)
 * @param {number} params.carro_id - ID del carro que genera el movimiento
 * @param {number} params.origen_mix_id - ID del mix de origen (opcional, para priorizar stock)
 * @param {Object} db - Conexión a la base de datos para transacciones
 */
async function registrarMovimientoStockUsuarioFIFO(params, db) {
    try {
        console.log(`\n🚀 INICIANDO REGISTRO FIFO`);
        console.log(`============================`);
        console.log(`Parámetros recibidos:`, params);
        
        const { usuario_id, ingrediente_id, cantidad, carro_id } = params;
        
        if (cantidad >= 0) {
            throw new Error('La cantidad debe ser negativa para consumo FIFO');
        }

        // Redondear cantidad a 4 decimales para mantener consistencia
        let cantidadRestante = Number(Math.abs(cantidad).toFixed(4));
        let tramosAProcesar = [];

        // Calcular saldo neto real (SUM(cantidad) = ingresos positivos - consumos negativos, NUNCA WHERE cantidad > 0)
        if (params.origen_mix_id) {
            console.log(`\n🔍 CALCULANDO SALDO NETO DOMICILIARIO CON ORIGEN MIX ID=${params.origen_mix_id}`);
            const stockMixResult = await db.query(
                `SELECT COALESCE(SUM(cantidad), 0) AS saldo_neto
                 FROM ingredientes_stock_usuarios
                 WHERE usuario_id = $1
                   AND ingrediente_id = $2
                   AND origen_mix_id = $3`,
                [usuario_id, ingrediente_id, params.origen_mix_id]
            );
            const saldoMixNeto = Number((parseFloat(stockMixResult.rows[0]?.saldo_neto) || 0).toFixed(4));
            console.log(`- Saldo neto con origen_mix_id=${params.origen_mix_id}: ${saldoMixNeto}`);
            if (saldoMixNeto > 0) {
                tramosAProcesar.push({
                    origen_mix_id: params.origen_mix_id,
                    saldo_disponible: saldoMixNeto
                });
            }
        }

        const acumuladoTramos = tramosAProcesar.reduce((sum, t) => sum + t.saldo_disponible, 0);
        if (cantidadRestante > acumuladoTramos + 0.0001) {
            console.log('\n🔍 CALCULANDO SALDO NETO DOMICILIARIO SIMPLE (SIN ORIGEN MIX)');
            const stockSimpleResult = await db.query(
                `SELECT COALESCE(SUM(cantidad), 0) AS saldo_neto
                 FROM ingredientes_stock_usuarios
                 WHERE usuario_id = $1
                   AND ingrediente_id = $2
                   AND origen_mix_id IS NULL`,
                [usuario_id, ingrediente_id]
            );
            const saldoSimpleNeto = Number((parseFloat(stockSimpleResult.rows[0]?.saldo_neto) || 0).toFixed(4));
            console.log(`- Saldo neto simple sin origen_mix_id: ${saldoSimpleNeto}`);
            if (saldoSimpleNeto > 0) {
                tramosAProcesar.push({
                    origen_mix_id: null,
                    saldo_disponible: saldoSimpleNeto
                });
            }
        }

        // Verificar también saldo neto global del ingrediente en el domicilio del usuario
        const totalNetoRes = await db.query(
            `SELECT COALESCE(SUM(cantidad), 0) AS saldo_total
             FROM ingredientes_stock_usuarios
             WHERE usuario_id = $1
               AND ingrediente_id = $2`,
            [usuario_id, ingrediente_id]
        );
        const saldoTotalNeto = Number((parseFloat(totalNetoRes.rows[0]?.saldo_total) || 0).toFixed(4));
        const stockTotalDisponible = Math.min(
            saldoTotalNeto,
            Number(tramosAProcesar.reduce((sum, t) => sum + t.saldo_disponible, 0).toFixed(4))
        );

        console.log(`\n📊 RESUMEN DE SALDO NETO DOMICILIARIO:`);
        console.log(`- Cantidad requerida: ${cantidadRestante}`);
        console.log(`- Saldo neto total del colaborador: ${saldoTotalNeto}`);
        console.log(`- Stock neto disponible para consumo: ${stockTotalDisponible}`);

        if (saldoTotalNeto + 0.0001 < cantidadRestante || stockTotalDisponible + 0.0001 < cantidadRestante) {
            const error = `Saldo insuficiente en stock domiciliario para ingrediente #${ingrediente_id}. Disponible neto: ${saldoTotalNeto.toFixed(2)}, Requerido: ${cantidadRestante.toFixed(2)}`;
            console.error(`❌ ERROR: ${error}`);
            const errInsuf = new Error(error);
            errInsuf.statusCode = 400;
            throw errInsuf;
        }

        // Registrar movimientos negativos inmutables respetando origen_mix_id si corresponde
        console.log('\n🔄 REGISTRANDO CONSUMO SOBRE SALDO NETO:');
        for (const tramo of tramosAProcesar) {
            if (cantidadRestante <= 0.0001) break;

            const cantidadADescontar = Number(Math.min(tramo.saldo_disponible, cantidadRestante).toFixed(4));
            if (cantidadADescontar <= 0) continue;

            try {
                await db.query(`
                    INSERT INTO ingredientes_stock_usuarios 
                    (ingrediente_id, usuario_id, cantidad, origen_carro_id, fecha_registro, origen_mix_id)
                    VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5)
                `, [
                    ingrediente_id,
                    usuario_id,
                    -cantidadADescontar,
                    carro_id,
                    tramo.origen_mix_id
                ]);

                console.log(`   ✅ Consumo domiciliario registrado: -${cantidadADescontar} (origen_mix_id=${tramo.origen_mix_id})`);
                cantidadRestante = Number((cantidadRestante - cantidadADescontar).toFixed(4));
            } catch (dbError) {
                console.error(`❌ ERROR en operación de base de datos:`, dbError);
                throw new Error(`Error en base de datos: ${dbError.message}`);
            }
        }
        
        console.log(`\n✅ REGISTRO FIFO COMPLETADO EXITOSAMENTE`);
        console.log(`============================`);
        
    } catch (error) {
        console.error(`❌ ERROR EN REGISTRO FIFO:`, error);
        throw error;
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
