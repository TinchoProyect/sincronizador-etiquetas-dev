#!/usr/bin/env node
/**
 * Saneamiento determinista e idempotente del Stock Domiciliario de Matías (`usuario_id = 5`)
 * para alinear los carros externos abiertos del 18/11/2026 (`#3039`, `#3040`, `#3044`)
 * con el nuevo ciclo donde el descuento ocurre al confirmar y NO al preparar.
 *
 * Uso:
 *   node scripts/sanearStockDomiciliarioMatias_2026_11_18.js --dry-run
 *   node scripts/sanearStockDomiciliarioMatias_2026_11_18.js --ejecutar
 *
 * Garantías:
 *   1. NO modifica ningún registro en `public.stock_ventas_movimientos` ni `public.ingredientes`.
 *   2. Verifica que cada carro (`#3039`, `#3040`, `#3044`) siga con `fecha_confirmacion IS NULL`
 *      antes de retirar su descuento prematuro.
 *   3. Es 100% idempotente: una segunda ejecución detecta el estado ya saneado y hace 0 cambios.
 */

require('dotenv').config();
const db = require('../src/produccion/config/database');
const { asegurarEsquemaStockDomiciliario } = require('../src/produccion/migrations/saneamientoStockDomiciliario');
const { obtenerCompromisosCarrosExternos } = require('../src/produccion/utils/stockDomiciliarioHelper');

async function ejecutarSaneamientoMatias({ dryRun = true, poolOverride = null } = {}) {
    const poolRef = poolOverride || db;
    const client = await poolRef.connect();

    try {
        await client.query('BEGIN');

        // 0. Asegurar columnas aditivas e integridad de origen_carro_id
        const resEsquema = await asegurarEsquemaStockDomiciliario(client);

        // Snapshot de control de stock_ventas_movimientos para demostrar 0 modificaciones
        const { rows: [svmAntes] } = await client.query(
            `SELECT COUNT(*)::int AS total_filas,
                    COALESCE(ROUND(SUM(cantidad)::numeric, 4), 0) AS suma_cantidad
               FROM public.stock_ventas_movimientos
              WHERE usuario_id = 5`
        );

        // 1. Relevar estado actual de los 3 carros externos objetivo (#3039, #3040, #3044)
        const { rows: carrosRows } = await client.query(
            `SELECT id, usuario_id, tipo_carro, fecha_preparado, fecha_confirmacion
               FROM public.carros_produccion
              WHERE id = ANY($1::int[])
                AND usuario_id = 5
              ORDER BY id ASC`,
            [[3039, 3040, 3044]]
        );
        const mapaCarros = new Map(carrosRows.map(c => [Number(c.id), c]));

        const carrosSinConfirmar = [3039, 3040, 3044].filter(id => {
            const c = mapaCarros.get(id);
            return c && !c.fecha_confirmacion;
        });

        // 2. Eliminar únicamente los descuentos prematuros de los carros que sigan SIN confirmar
        let descuentosEliminados = [];
        if (carrosSinConfirmar.length > 0) {
            const { rows: delRows } = await client.query(
                `DELETE FROM public.ingredientes_stock_usuarios
                  WHERE usuario_id = 5
                    AND id = ANY($1::int[])
                    AND origen_carro_id = ANY($2::int[])
                    AND cantidad < 0
              RETURNING id, ingrediente_id, cantidad, origen_carro_id`,
                [[1418, 1419, 1420, 1421, 1430, 1431], carrosSinConfirmar]
            );
            descuentosEliminados = delRows;
        }

        // Calcular cuánto de los ajustes compensatorios (#1427 Aceite +1.02 y #1428 Miel +4.60)
        // correspondía a descuentos prematuros eliminados de #3039 y #3040:
        const seLimpio3039 = carrosSinConfirmar.includes(3039);
        const seLimpio3040 = carrosSinConfirmar.includes(3040);

        const excesoAceiteCompensado = Number(((seLimpio3039 ? 0.48 : 0) + (seLimpio3040 ? 0.48 : 0)).toFixed(4));
        const excesoMielCompensada = Number(((seLimpio3039 ? 2.30 : 0) + (seLimpio3040 ? 2.30 : 0)).toFixed(4));

        // 3. Recalibrar #1427 (Aceite de Coco +1.02 -> +0.06 si ambos #3039 y #3040 siguen sin confirmar)
        let ajuste1427 = null;
        if (excesoAceiteCompensado > 0) {
            const { rows: [row1427] } = await client.query(
                `SELECT id, cantidad FROM public.ingredientes_stock_usuarios
                  WHERE id = 1427 AND usuario_id = 5 AND ingrediente_id = 135`,
                []
            );
            if (row1427 && Math.abs(parseFloat(row1427.cantidad) - 1.02) < 0.001) {
                const nuevoValor1427 = Number((parseFloat(row1427.cantidad) - excesoAceiteCompensado).toFixed(4));
                const { rows: [upd] } = await client.query(
                    `UPDATE public.ingredientes_stock_usuarios
                        SET cantidad = $1,
                            origen_carro_id = NULL,
                            tipo_movimiento = 'ajuste_inventario',
                            observaciones = 'Puesta en 0 de Aceite de Coco en domicilio (normalizado sin descuentos prematuros de carros abiertos)'
                      WHERE id = 1427
                  RETURNING id, cantidad`,
                    [nuevoValor1427]
                );
                ajuste1427 = { antes: parseFloat(row1427.cantidad), despues: parseFloat(upd.cantidad) };
            }
        }

        // 4. Normalizar/bajar #1428 (Miel +4.60 compensatorio de #3039 y #3040)
        let ajuste1428 = null;
        if (excesoMielCompensada > 0) {
            const { rows: [row1428] } = await client.query(
                `SELECT id, cantidad FROM public.ingredientes_stock_usuarios
                  WHERE id = 1428 AND usuario_id = 5 AND ingrediente_id = 136`,
                []
            );
            if (row1428 && Math.abs(parseFloat(row1428.cantidad) - 4.60) < 0.001) {
                const remanente1428 = Number((parseFloat(row1428.cantidad) - excesoMielCompensada).toFixed(4));
                if (Math.abs(remanente1428) < 0.0005) {
                    await client.query('DELETE FROM public.ingredientes_stock_usuarios WHERE id = 1428');
                    ajuste1428 = { antes: parseFloat(row1428.cantidad), despues: null, accion: 'eliminado' };
                } else {
                    await client.query(
                        `UPDATE public.ingredientes_stock_usuarios
                            SET cantidad = $1,
                                origen_carro_id = NULL,
                                tipo_movimiento = 'ajuste_inventario',
                                observaciones = 'Ajuste parcial normalizado de Miel en domicilio'
                          WHERE id = 1428`,
                        [remanente1428]
                    );
                    ajuste1428 = { antes: parseFloat(row1428.cantidad), despues: remanente1428, accion: 'actualizado' };
                }
            }
        }

        // 5. Desacoplar #1429 (+10.00 kg Miel de 2 bidones EMB-P2VF21) con metadatos completos
        const { rows: [upd1429] } = await client.query(
            `UPDATE public.ingredientes_stock_usuarios
                SET carro_referencia_id = COALESCE(carro_referencia_id, origen_carro_id, 3044),
                    origen_carro_id = NULL,
                    tipo_movimiento = 'abastecimiento_deposito',
                    articulo_origen_numero = COALESCE(articulo_origen_numero, 'EMB-P2VF21'),
                    observaciones = COALESCE(observaciones, 'Retiro abastecimiento domicilio: 2 u. de [EMB-P2VF21] Miel Pura x 5kg (10.00 kg) [ref carro #3044]')
              WHERE id = 1429
                AND usuario_id = 5
                AND ingrediente_id = 136
          RETURNING id, cantidad, origen_carro_id, carro_referencia_id, tipo_movimiento, articulo_origen_numero`
        );

        // Etiquetar también #1415 (-7.00 puesta en 0 de las 16:30) para claridad en el Kardex
        await client.query(
            `UPDATE public.ingredientes_stock_usuarios
                SET tipo_movimiento = 'ajuste_inventario',
                    observaciones = COALESCE(observaciones, 'Puesta en 0 inicial de Miel en domicilio')
              WHERE id = 1415 AND usuario_id = 5 AND ingrediente_id = 136`
        );

        // 6. Verificar saldos resultantes y compromisos abiertos dentro de la transacción
        const { rows: saldosRows } = await client.query(
            `SELECT i.id AS ingrediente_id,
                    i.nombre,
                    COALESCE(ROUND(SUM(isu.cantidad)::numeric, 4), 0) AS stock_en_casa
               FROM public.ingredientes i
               LEFT JOIN public.ingredientes_stock_usuarios isu
                 ON isu.ingrediente_id = i.id AND isu.usuario_id = 5
              WHERE i.id IN (135, 136)
              GROUP BY i.id, i.nombre
              ORDER BY i.id ASC`
        );

        const compromisosMap = await obtenerCompromisosCarrosExternos(client, 5);

        const estadoFinal = saldosRows.map(r => {
            const comp = compromisosMap.get(Number(r.ingrediente_id));
            const enCasa = Number(parseFloat(r.stock_en_casa || 0).toFixed(4));
            const comprometido = Number((comp?.kilos_comprometidos || 0).toFixed(4));
            return {
                ingrediente_id: r.ingrediente_id,
                nombre: r.nombre,
                stock_en_casa: enCasa,
                comprometido_abiertos: comprometido,
                carros_abiertos_count: comp?.carros_count || 0,
                proyectado_post_coccion: Number((enCasa - comprometido).toFixed(4))
            };
        });

        const { rows: [svmDespues] } = await client.query(
            `SELECT COUNT(*)::int AS total_filas,
                    COALESCE(ROUND(SUM(cantidad)::numeric, 4), 0) AS suma_cantidad
               FROM public.stock_ventas_movimientos
              WHERE usuario_id = 5`
        );

        const svmIntacto =
            svmAntes.total_filas === svmDespues.total_filas &&
            Number(svmAntes.suma_cantidad) === Number(svmDespues.suma_cantidad);

        if (!svmIntacto) {
            throw new Error('Invariante violada: stock_ventas_movimientos habría cambiado (abortando).');
        }

        if (dryRun) {
            await client.query('ROLLBACK');
        } else {
            await client.query('COMMIT');
        }

        return {
            modo: dryRun ? 'DRY_RUN (ROLLBACK)' : 'EJECUTADO (COMMIT)',
            esquema: resEsquema,
            carros_sin_confirmar: carrosSinConfirmar,
            descuentos_prematuros_eliminados: descuentosEliminados,
            ajuste_1427_aceite: ajuste1427,
            ajuste_1428_miel: ajuste1428,
            retiro_1429_miel: upd1429 || null,
            stock_ventas_movimientos_intacto: svmIntacto,
            estado_final_matias: estadoFinal
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

if (require.main === module) {
    const ejecutarReal = process.argv.includes('--ejecutar');
    ejecutarSaneamientoMatias({ dryRun: !ejecutarReal })
        .then(resultado => {
            console.log(JSON.stringify(resultado, null, 2));
            process.exit(0);
        })
        .catch(err => {
            console.error('❌ Error en saneamiento de Matías:', err);
            process.exit(1);
        });
}

module.exports = {
    ejecutarSaneamientoMatias
};
