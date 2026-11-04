/**
 * Script de Backfill Histórico: Movimientos de Stock en Facturación (Puesto 32)
 * 
 * Uso:
 *   Ejecutar en modo simulación:
 *     node scratch/scratch-backfill-invoices-stock.js --dry-run
 *   Ejecutar en modo real:
 *     node scratch/scratch-backfill-invoices-stock.js
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

const { recalcularStockConsolidado } = require('../src/produccion/utils/recalcularStock');

const DRY_RUN = process.argv.includes('--dry-run');

async function run() {
    console.log('🏁 INICIANDO BACKFILL DE STOCK PARA FACTURACIÓN (PUESTO 32)');
    if (DRY_RUN) {
        console.log('⚠️ MODO SIMULACIÓN (DRY RUN): No se realizarán cambios en la base de datos.');
    } else {
        console.log('🔥 MODO REAL: Los cambios se guardarán en la base de datos.');
    }
    console.log('================================================================');

    const client = await pool.connect();

    try {
        // 1. Obtener todas las facturas y NC aprobadas para pto_vta = 32
        const facturasRes = await client.query(`
            SELECT id, tipo_cbte, pto_vta, cbte_nro, nro_interno, presupuesto_id, requiere_afip, estado, created_at
            FROM factura_facturas
            WHERE pto_vta = 32
              AND estado IN ('APROBADA', 'APROBADA_LOCAL')
            ORDER BY id ASC
        `);

        console.log(`Encontradas ${facturasRes.rows.length} facturas/N.C. aprobadas históricas.`);

        let facturasProcesadas = 0;
        let facturasOmitidas = 0;
        let errores = 0;

        for (const factura of facturasRes.rows) {
            const esNotaCredito = [3, 8, 13].includes(parseInt(factura.tipo_cbte));
            const esFactura = [1, 6, 11].includes(parseInt(factura.tipo_cbte));

            if (!esFactura && !esNotaCredito) {
                console.log(`ℹ️ [Factura ID: ${factura.id}] Comprobante tipo ${factura.tipo_cbte} no requiere stock, omitiendo.`);
                facturasOmitidas++;
                continue;
            }

            // Construir observaciones únicas para idempotencia
            let letra = 'A';
            if ([6, 7, 8].includes(parseInt(factura.tipo_cbte))) letra = 'B';
            if ([11, 12, 13].includes(parseInt(factura.tipo_cbte))) letra = 'C';

            const nroComprobante = factura.cbte_nro || factura.nro_interno || '';
            const esInterna = !factura.requiere_afip;
            
            let docDesc = '';
            if (esNotaCredito) {
                docDesc = esInterna ? 'Nota de Crédito Interna' : `Nota de Crédito ${letra}`;
            } else {
                docDesc = esInterna ? 'Factura Interna' : `Factura ${letra}`;
            }
            const obsUnique = `${docDesc} #32-${nroComprobante}`;

            // Verificar idempotencia
            const checkExistente = await client.query(`
                SELECT id FROM public.stock_ventas_movimientos 
                WHERE observaciones = $1
                LIMIT 1
            `, [obsUnique]);

            if (checkExistente.rows.length > 0) {
                console.log(`ℹ️ [Factura ID: ${factura.id}] Ya tiene movimientos registrados en stock_ventas_movimientos (${obsUnique}), omitiendo.`);
                facturasOmitidas++;
                continue;
            }

            console.log(`\n⚙️ Procesando Factura ID: ${factura.id} (${obsUnique}) - Presupuesto: ${factura.presupuesto_id}`);

            // Cargar items
            const itemsRes = await client.query(`
                SELECT id, descripcion, qty, p_unit, orden
                FROM factura_factura_items
                WHERE factura_id = $1
                ORDER BY orden ASC
            `, [factura.id]);

            if (itemsRes.rows.length === 0) {
                console.log(`  ⚠️ No tiene ítems asociados, omitiendo.`);
                facturasOmitidas++;
                continue;
            }

            // Cargar detalles del presupuesto si existe
            let budgetDetails = [];
            if (factura.presupuesto_id) {
                const budgetRes = await client.query(`
                    SELECT pd.articulo as barcode, a.numero as articulo_numero, a.nombre as articulo_nombre, pd.cantidad, pd.valor1
                    FROM public.presupuestos_detalles pd
                    LEFT JOIN public.articulos a ON a.codigo_barras = pd.articulo OR a.numero = pd.articulo
                    WHERE pd.id_presupuesto = $1
                `, [factura.presupuesto_id]);
                budgetDetails = budgetRes.rows;
            }

            // Iniciar transacción para este comprobante específico
            if (!DRY_RUN) {
                await client.query('BEGIN');
            }

            try {
                const articulosRecalcular = [];

                for (const item of itemsRes.rows) {
                    let resolvedArt = null;

                    // 1. Coincidencia exacta por nombre
                    const artByName = await client.query(`
                        SELECT numero, nombre, codigo_barras 
                        FROM public.articulos 
                        WHERE UPPER(TRIM(nombre)) = UPPER(TRIM($1))
                        LIMIT 1
                    `, [item.descripcion]);

                    if (artByName.rows.length > 0) {
                        resolvedArt = artByName.rows[0];
                    }

                    // 2. Coincidencia a través del presupuesto original
                    if (!resolvedArt && budgetDetails.length > 0) {
                        // Coincidir por nombre
                        let budgetMatch = budgetDetails.find(bd => 
                            bd.articulo_nombre && 
                            bd.articulo_nombre.toUpperCase().trim() === item.descripcion.toUpperCase().trim()
                        );

                        // Coincidir por precio y cantidad
                        if (!budgetMatch) {
                            budgetMatch = budgetDetails.find(bd => 
                                parseFloat(bd.cantidad) === parseFloat(item.qty) && 
                                parseFloat(bd.valor1) === parseFloat(item.p_unit)
                            );
                        }

                        if (budgetMatch && budgetMatch.articulo_numero) {
                            resolvedArt = {
                                numero: budgetMatch.articulo_numero,
                                codigo_barras: budgetMatch.barcode
                            };
                        }
                    }

                    // 3. Coincidencia parcial por ILIKE en nombre
                    if (!resolvedArt) {
                        const artByNameLike = await client.query(`
                            SELECT numero, nombre, codigo_barras 
                            FROM public.articulos 
                            WHERE nombre ILIKE $1 
                               OR nombre ILIKE $2
                            LIMIT 1
                        `, [item.descripcion, `%${item.descripcion}%`]);

                        if (artByNameLike.rows.length > 0) {
                            resolvedArt = artByNameLike.rows[0];
                        }
                    }

                    if (!resolvedArt) {
                        throw new Error(`No se pudo resolver el artículo para el ítem: "${item.descripcion}"`);
                    }

                    const articuloNumero = resolvedArt.numero || resolvedArt.articulo_numero;
                    const codigoBarras = resolvedArt.codigo_barras || null;
                    const qty = parseFloat(item.qty);
                    const tipoMov = esNotaCredito ? 'ingreso' : 'egreso';
                    const qtyDelta = esNotaCredito ? qty : -qty;

                    console.log(`  Match: "${item.descripcion}" -> Código: ${articuloNumero} (${codigoBarras}) | Qty: ${qty} | Mov: ${tipoMov}`);

                    if (!DRY_RUN) {
                        // Insertar movimiento
                        await client.query(`
                            INSERT INTO public.stock_ventas_movimientos (
                                articulo_numero, codigo_barras, kilos, cantidad,
                                carro_id, usuario_id, fecha, tipo, observaciones, origen_ingreso
                            ) VALUES ($1, $2, 0, $3, NULL, NULL, $4, $5, $6, 'facturacion')
                        `, [
                            articuloNumero,
                            codigoBarras,
                            qty,
                            factura.created_at, // Preservar la fecha original del comprobante
                            tipoMov,
                            obsUnique
                        ]);

                        // Actualizar consolidado
                        await client.query(`
                            INSERT INTO public.stock_real_consolidado (
                                articulo_numero, stock_movimientos, stock_ajustes, es_pack, ultima_actualizacion
                            )
                            VALUES ($1, $2, 0, FALSE, NOW())
                            ON CONFLICT (articulo_numero) 
                            DO UPDATE SET 
                                stock_movimientos = COALESCE(stock_real_consolidado.stock_movimientos, 0) + $2,
                                ultima_actualizacion = NOW()
                        `, [
                            articuloNumero,
                            qtyDelta
                        ]);

                        if (!articulosRecalcular.includes(articuloNumero)) {
                            articulosRecalcular.push(articuloNumero);
                        }
                    }
                }

                if (!DRY_RUN) {
                    // Recalcular stock consolidado para los artículos afectados
                    for (const artCode of articulosRecalcular) {
                        await recalcularStockConsolidado(client, artCode);
                    }
                    await client.query('COMMIT');
                    console.log(`  ✅ Transacción confirmada para factura ID ${factura.id}`);
                } else {
                    console.log(`  [SIMULACIÓN] Procesado con éxito.`);
                }

                facturasProcesadas++;

            } catch (errFact) {
                if (!DRY_RUN) {
                    await client.query('ROLLBACK');
                }
                console.error(`  ❌ Error al procesar factura ID ${factura.id}:`, errFact.message);
                errores++;
            }
        }

        console.log('\n================================================================');
        console.log('🏁 BACKFILL COMPLETADO');
        console.log(`Total facturas procesadas/simuladas con éxito: ${facturasProcesadas}`);
        console.log(`Total facturas omitidas (ya procesadas o no requieren stock): ${facturasOmitidas}`);
        console.log(`Total errores: ${errores}`);
        console.log('================================================================');

    } catch (e) {
        console.error('❌ Error catastrófico en el script:', e);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
