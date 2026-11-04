/**
 * Script de Migración y Congelamiento de Fotos Contables Históricas (2026)
 * Sistema LAMDA - Facturación Búnker
 * 
 * Congela la foto contable en cada factura e item de 2026:
 * - Costo Mercadería
 * - Costo Mano de Obra (desglosado)
 * - Costo Insumos de Empaque
 * - Impuesto IIBB (4%)
 * - Ganancia Real
 * - foto_capturada = TRUE
 */

const { pool } = require('../src/facturacion/config/database');
const { calcularCostoIntegradoArticulo } = require('../src/facturacion/services/costoIntegradoService');

function round(val, dec = 2) {
    return Math.round(val * Math.pow(10, dec)) / Math.pow(10, dec);
}

async function runBackfill() {
    console.log('🚀 [BACKFILL-FOTO-COSTOS] Iniciando backfill histórico 2026...');
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const resFacturas = await client.query(`
            SELECT id, tipo_cbte, pto_vta, cbte_nro, imp_neto, imp_iva, imp_total, costo_estimado_total, fecha_emision
            FROM factura_facturas
            WHERE fecha_emision >= '2026-01-01'
              AND (foto_capturada IS NULL OR foto_capturada = false)
            ORDER BY fecha_emision ASC, id ASC
        `);

        console.log(`📋 Encontradas ${resFacturas.rows.length} facturas/comprobantes para procesar.`);

        let procesadas = 0;

        for (const f of resFacturas.rows) {
            const tipoCbte = parseInt(f.tipo_cbte);
            const impTotal = parseFloat(f.imp_total) || 0;
            const impNeto = parseFloat(f.imp_neto) || impTotal;
            const currentCostoSealed = parseFloat(f.costo_estimado_total) || 0;

            const resItems = await client.query(`
                SELECT id, descripcion, qty, p_unit, imp_neto, costo_total
                FROM factura_factura_items
                WHERE factura_id = $1
                ORDER BY orden ASC
            `, [f.id]);

            let itemSumCosto = 0;
            let itemSumMo = 0;
            let itemSumIns = 0;
            const itemsProcessed = [];

            for (const it of resItems.rows) {
                const qty = parseFloat(it.qty) > 0 ? parseFloat(it.qty) : 1;
                const c = await calcularCostoIntegradoArticulo(client, it.descripcion, 1);

                let targetCost = parseFloat(it.costo_total) || 0;
                if (targetCost === 0 && c.costo_unitario > 0) {
                    targetCost = round(qty * c.costo_unitario);
                }

                let rMo = 0, rIns = 0;
                if (c.costo_unitario > 0) {
                    rMo = c.c_tiempo / c.costo_unitario;
                    rIns = c.c_insumos / c.costo_unitario;
                }

                const mo = round(targetCost * rMo);
                const ins = round(targetCost * rIns);
                const merc = round(targetCost - mo - ins);

                itemSumCosto += targetCost;
                itemSumMo += mo;
                itemSumIns += ins;

                itemsProcessed.push({
                    id: it.id,
                    articulo_id: c.articulo_id,
                    qty: qty,
                    targetCost: targetCost,
                    costo_unit: round(targetCost / qty, 2),
                    merc: merc,
                    mo: mo,
                    ins: ins,
                    merc_unit: round(merc / qty, 2),
                    mo_unit: round(mo / qty, 2),
                    ins_unit: round(ins / qty, 2)
                });
            }

            // Distribuir el costo sellado en cabecera
            const targetInvoiceCost = currentCostoSealed > 0 ? currentCostoSealed : itemSumCosto;
            let invMo = 0;
            let invIns = 0;

            if (itemSumCosto > 0) {
                const scale = targetInvoiceCost / itemSumCosto;
                invMo = round(itemSumMo * scale);
                invIns = round(itemSumIns * scale);
            }
            let invMerc = round(targetInvoiceCost - invMo - invIns);

            const invIIBB = round(impTotal * 0.04);
            const invGanancia = round(impNeto - targetInvoiceCost - invIIBB);

            // 1. Actualizar cada item
            for (const itP of itemsProcessed) {
                await client.query(`
                    UPDATE factura_factura_items SET
                        articulo_id = $1,
                        costo_unitario = $2,
                        costo_total = $3,
                        costo_mercaderia_unitario = $4,
                        costo_mano_obra_unitario = $5,
                        costo_insumos_unitario = $6,
                        costo_mercaderia_total = $7,
                        costo_mano_obra_total = $8,
                        costo_insumos_total = $9
                    WHERE id = $10
                `, [
                    itP.articulo_id || null,
                    itP.costo_unit,
                    itP.targetCost,
                    itP.merc_unit,
                    itP.mo_unit,
                    itP.ins_unit,
                    itP.merc,
                    itP.mo,
                    itP.ins,
                    itP.id
                ]);
            }

            // 2. Actualizar cabecera con foto_capturada = true
            await client.query(`
                UPDATE factura_facturas SET
                    costo_estimado_total = $1,
                    costo_mercaderia_total = $2,
                    costo_mano_obra_total = $3,
                    costo_insumos_total = $4,
                    alicuota_iibb = 4.00,
                    imp_iibb = $5,
                    ganancia_real_total = $6,
                    foto_capturada = TRUE,
                    updated_at = NOW()
                WHERE id = $7
            `, [
                targetInvoiceCost,
                invMerc,
                invMo,
                invIns,
                invIIBB,
                invGanancia,
                f.id
            ]);

            procesadas++;
            if (procesadas % 25 === 0 || procesadas === resFacturas.rows.length) {
                console.log(`   Procesadas ${procesadas}/${resFacturas.rows.length} facturas...`);
            }
        }

        await client.query('COMMIT');
        console.log(`✅ [BACKFILL-FOTO-COSTOS] ¡Éxito total! ${procesadas} comprobantes actualizados con foto contable sellada.`);

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ [BACKFILL-FOTO-COSTOS] Error en migración:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

runBackfill().catch(console.error);
