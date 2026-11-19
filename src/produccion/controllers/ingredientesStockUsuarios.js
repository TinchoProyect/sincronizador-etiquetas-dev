const pool = require('../../usuarios/pool');

/**
 * Registra movimientos de consumo negativo en el stock domiciliario del colaborador
 * al confirmar la producción de un carro externo.
 *
 * Regla dura: `origen_carro_id` se utiliza ÚNICAMENTE en egresos negativos (`consumo_produccion`).
 */
async function registrarMovimientoStockUsuarioFIFO(params, db) {
    try {
        console.log(`\n🚀 INICIANDO REGISTRO CONSUMO DOMICILIARIO`);
        console.log(`============================`);
        console.log(`Parámetros recibidos:`, params);

        const {
            usuario_id,
            ingrediente_id,
            cantidad,
            carro_id,
            tipo_movimiento = 'consumo_produccion',
            observaciones = null
        } = params;

        if (cantidad >= 0) {
            throw new Error('La cantidad debe ser negativa para consumo FIFO');
        }

        const obsFinal = observaciones || (carro_id ? `Consumo por producción confirmada — Carro #${carro_id}` : 'Consumo de producción externa');

        let cantidadRestante = Number(Math.abs(cantidad).toFixed(4));
        const tramosAProcesar = [];

        if (params.origen_mix_id) {
            const stockMixResult = await db.query(
                `SELECT COALESCE(SUM(cantidad), 0) AS saldo_neto
                   FROM ingredientes_stock_usuarios
                  WHERE usuario_id = $1
                    AND ingrediente_id = $2
                    AND origen_mix_id = $3`,
                [usuario_id, ingrediente_id, params.origen_mix_id]
            );
            const saldoMixNeto = Number((parseFloat(stockMixResult.rows[0]?.saldo_neto) || 0).toFixed(4));
            if (saldoMixNeto > 0) {
                tramosAProcesar.push({
                    origen_mix_id: params.origen_mix_id,
                    saldo_disponible: saldoMixNeto
                });
            }
        }

        const acumuladoTramos = tramosAProcesar.reduce((sum, t) => sum + t.saldo_disponible, 0);
        if (cantidadRestante > acumuladoTramos + 0.0001) {
            const stockSimpleResult = await db.query(
                `SELECT COALESCE(SUM(cantidad), 0) AS saldo_neto
                   FROM ingredientes_stock_usuarios
                  WHERE usuario_id = $1
                    AND ingrediente_id = $2
                    AND origen_mix_id IS NULL`,
                [usuario_id, ingrediente_id]
            );
            const saldoSimpleNeto = Number((parseFloat(stockSimpleResult.rows[0]?.saldo_neto) || 0).toFixed(4));
            if (saldoSimpleNeto > 0) {
                tramosAProcesar.push({
                    origen_mix_id: null,
                    saldo_disponible: saldoSimpleNeto
                });
            }
        }

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

        const permitirSaldoNegativo = Boolean(params.permitir_saldo_negativo);
        if (!permitirSaldoNegativo && (saldoTotalNeto + 0.0001 < cantidadRestante || stockTotalDisponible + 0.0001 < cantidadRestante)) {
            const error = `Saldo insuficiente en stock domiciliario para ingrediente #${ingrediente_id}. Disponible neto: ${saldoTotalNeto.toFixed(2)}, Requerido: ${cantidadRestante.toFixed(2)}`;
            const errInsuf = new Error(error);
            errInsuf.statusCode = 400;
            throw errInsuf;
        }

        for (const tramo of tramosAProcesar) {
            if (cantidadRestante <= 0.0001) break;

            const cantidadADescontar = Number(Math.min(tramo.saldo_disponible, cantidadRestante).toFixed(4));
            if (cantidadADescontar <= 0) continue;

            await db.query(
                `INSERT INTO ingredientes_stock_usuarios
                    (ingrediente_id, usuario_id, cantidad, origen_carro_id, fecha_registro, origen_mix_id, tipo_movimiento, observaciones)
                 VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5, $6, $7)`,
                [
                    ingrediente_id,
                    usuario_id,
                    -cantidadADescontar,
                    carro_id,
                    tramo.origen_mix_id,
                    tipo_movimiento,
                    obsFinal
                ]
            );
            cantidadRestante = Number((cantidadRestante - cantidadADescontar).toFixed(4));
        }

        if (permitirSaldoNegativo && cantidadRestante > 0.0001) {
            const remanenteNegativo = -Number(cantidadRestante.toFixed(4));
            await db.query(
                `INSERT INTO ingredientes_stock_usuarios
                    (ingrediente_id, usuario_id, cantidad, origen_carro_id, fecha_registro, origen_mix_id, tipo_movimiento, observaciones)
                 VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5, $6, $7)`,
                [
                    ingrediente_id,
                    usuario_id,
                    remanenteNegativo,
                    carro_id,
                    params.origen_mix_id || null,
                    tipo_movimiento,
                    obsFinal
                ]
            );
            cantidadRestante = 0;
        }

        console.log(`✅ REGISTRO CONSUMO DOMICILIARIO COMPLETADO EXITOSAMENTE`);
    } catch (error) {
        console.error(`❌ ERROR EN REGISTRO FIFO:`, error);
        throw error;
    }
}

/**
 * Agrega stock positivo de un ingrediente al domicilio de un colaborador.
 * Regla dura: Todo ingreso positivo graba `origen_carro_id = NULL` y preserva
 * `carro_referencia_id` solo como referencia informativa.
 */
async function agregarStockUsuario(req, res) {
    try {
        const {
            usuario_id,
            ingrediente_id,
            cantidad,
            origen_carro_id,
            carro_referencia_id,
            origen_mix_id,
            tipo_movimiento,
            observaciones,
            articulo_origen_numero
        } = req.body;

        if (!usuario_id || !ingrediente_id || cantidad === undefined || cantidad === null) {
            return res.status(400).json({
                error: 'Se requieren usuario_id, ingrediente_id y cantidad'
            });
        }

        const cantidadNumerica = parseFloat(cantidad);
        if (isNaN(cantidadNumerica)) {
            return res.status(400).json({
                error: 'La cantidad debe ser un número válido'
            });
        }

        const esEgresoConsumo = cantidadNumerica < 0 && tipo_movimiento === 'consumo_produccion';
        const origenCarroFinal = esEgresoConsumo ? (origen_carro_id || null) : null;
        const carroRefFinal = !esEgresoConsumo ? (carro_referencia_id || origen_carro_id || null) : null;
        const tipoFinal = tipo_movimiento || (cantidadNumerica >= 0 ? 'compra_externa' : 'ajuste_inventario');

        const query = `
            INSERT INTO ingredientes_stock_usuarios
                (ingrediente_id, usuario_id, cantidad, origen_carro_id, carro_referencia_id, fecha_registro, origen_mix_id, tipo_movimiento, observaciones, articulo_origen_numero)
            VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6, $7, $8, $9)
            RETURNING id
        `;

        const result = await pool.query(query, [
            ingrediente_id,
            usuario_id,
            cantidadNumerica,
            origenCarroFinal,
            carroRefFinal,
            origen_mix_id || null,
            tipoFinal,
            observaciones || null,
            articulo_origen_numero || null
        ]);

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
