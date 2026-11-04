const { Pool } = require('pg');
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
});

const { calcularCostoIntegradoArticulo } = require('../src/facturacion/services/costoIntegradoService');

async function migrateAllInvoiceCosts() {
    console.log('=== MIGRACIÓN RETROACTIVA DE COSTOS INTEGRADOS BÚNKER ===\n');

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Obtener todas las facturas
        const resFacts = await client.query(`
            SELECT f.id, f.presupuesto_id, f.cliente_id, c.lista_precios
            FROM factura_facturas f
            LEFT JOIN clientes c ON c.cliente_id = f.cliente_id
            ORDER BY f.id ASC
        `);

        console.log(`Procesando ${resFacts.rows.length} facturas...`);

        let facturasActualizadas = 0;
        let itemsActualizados = 0;

        for (const f of resFacts.rows) {
            const facturaId = f.id;
            const presupuestoId = f.presupuesto_id;
            const listaId = f.lista_precios ? parseInt(f.lista_precios) : 1;

            let costoFacturaTotal = 0;

            // 1.1 Si tiene items en factura_factura_items, actualizarlos
            const resItems = await client.query(`
                SELECT id, descripcion, qty, costo_unitario, costo_total
                FROM factura_factura_items
                WHERE factura_id = $1
                ORDER BY orden ASC, id ASC
            `, [facturaId]);

            if (resItems.rows.length > 0) {
                // Si la factura tiene presupuesto_id, buscar la correspondencia con presupuestos_detalles
                let mapCodigos = [];
                if (presupuestoId) {
                    const resPd = await client.query(`
                        SELECT articulo, cantidad
                        FROM presupuestos_detalles
                        WHERE id_presupuesto = $1
                        ORDER BY id ASC
                    `, [presupuestoId]);
                    mapCodigos = resPd.rows;
                }

                for (let i = 0; i < resItems.rows.length; i++) {
                    const item = resItems.rows[i];
                    const qty = parseFloat(item.qty) || 1;
                    let targetCode = item.descripcion;

                    if (mapCodigos[i] && mapCodigos[i].articulo) {
                        targetCode = mapCodigos[i].articulo;
                    }

                    const resCosto = await calcularCostoIntegradoArticulo(client, targetCode, listaId);
                    const costoUnit = resCosto.costo_unitario;
                    const costoTot = Math.round(qty * costoUnit * 100) / 100;

                    await client.query(`
                        UPDATE factura_factura_items
                        SET costo_unitario = $1, costo_total = $2
                        WHERE id = $3
                    `, [costoUnit, costoTot, item.id]);

                    costoFacturaTotal += costoTot;
                    itemsActualizados++;
                }
            } else if (presupuestoId) {
                // Si no tiene factura_factura_items pero tiene presupuesto_id
                const resPd = await client.query(`
                    SELECT articulo, cantidad
                    FROM presupuestos_detalles
                    WHERE id_presupuesto = $1
                    ORDER BY id ASC
                `, [presupuestoId]);

                for (const pd of resPd.rows) {
                    const qty = parseFloat(pd.cantidad) || 0;
                    const resCosto = await calcularCostoIntegradoArticulo(client, pd.articulo, listaId);
                    costoFacturaTotal += Math.round(qty * resCosto.costo_unitario * 100) / 100;
                }
            }

            costoFacturaTotal = Math.round(costoFacturaTotal * 100) / 100;

            await client.query(`
                UPDATE factura_facturas
                SET costo_estimado_total = $1
                WHERE id = $2
            `, [costoFacturaTotal, facturaId]);

            facturasActualizadas++;
        }

        await client.query('COMMIT');
        console.log(`\n✅ MIGRACIÓN COMPLETADA EXITOSAMENTE`);
        console.log(`   - Facturas actualizadas con costo integrado: ${facturasActualizadas}`);
        console.log(`   - Items actualizados con costo integrado: ${itemsActualizados}`);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error en migración:', err);
    } finally {
        client.release();
        pool.end();
    }
}

migrateAllInvoiceCosts();
