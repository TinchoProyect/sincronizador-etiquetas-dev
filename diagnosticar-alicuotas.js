/**
 * Script de diagnóstico para ver qué alícuotas se están guardando
 */

require('dotenv').config({ path: './src/facturacion/.env' });
const { pool } = require('./src/facturacion/config/database');

async function diagnosticar() {
    try {
        console.log('🔍 Diagnosticando alícuotas en facturas...\n');
        
        // Obtener las últimas 5 facturas con sus items
        const query = `
            SELECT 
                f.id as factura_id,
                f.created_at,
                f.presupuesto_id,
                fi.id as item_id,
                fi.descripcion,
                fi.qty,
                fi.p_unit,
                fi.alic_iva_id,
                fi.imp_neto,
                fi.imp_iva
            FROM factura_facturas f
            LEFT JOIN factura_factura_items fi ON fi.factura_id = f.id
            WHERE f.presupuesto_id IS NOT NULL
            ORDER BY f.id DESC
            LIMIT 5
        `;
        
        const result = await pool.query(query);
        
        if (result.rows.length === 0) {
            console.log('❌ No se encontraron facturas desde presupuestos\n');
            return;
        }
        
        console.log(`📋 Últimas ${result.rows.length} facturas desde presupuestos:\n`);
        
        const porFactura = {};
        result.rows.forEach(row => {
            if (!porFactura[row.factura_id]) {
                porFactura[row.factura_id] = {
                    factura_id: row.factura_id,
                    created_at: row.created_at,
                    presupuesto_id: row.presupuesto_id,
                    items: []
                };
            }
            if (row.item_id) {
                porFactura[row.factura_id].items.push({
                    item_id: row.item_id,
                    descripcion: row.descripcion,
                    qty: row.qty,
                    p_unit: row.p_unit,
                    alic_iva_id: row.alic_iva_id,
                    imp_neto: row.imp_neto,
                    imp_iva: row.imp_iva
                });
            }
        });
        
        Object.values(porFactura).forEach(factura => {
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            console.log(`📄 Factura ID: ${factura.factura_id}`);
            console.log(`   Presupuesto: #${factura.presupuesto_id}`);
            console.log(`   Creada: ${new Date(factura.created_at).toLocaleString('es-AR')}`);
            console.log(``);
            
            if (factura.items.length === 0) {
                console.log('   ⚠️  Sin items');
            } else {
                factura.items.forEach(item => {
                    console.log(`   📦 Item ${item.item_id}:`);
                    console.log(`      Desc: ${item.descripcion}`);
                    console.log(`      Cant: ${item.qty} x $${item.p_unit}`);
                    console.log(`      🔴 alic_iva_id: ${item.alic_iva_id} ${getAlicuotaInfo(item.alic_iva_id)}`);
                    console.log(`      Neto: $${item.imp_neto}`);
                    console.log(`      IVA: $${item.imp_iva}`);
                    console.log(``);
                });
            }
        });
        
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
        
        // Verificar si el helper se está cargando
        console.log('🔧 Verificando helper de IVA...\n');
        try {
            const ivaHelper = require('./src/facturacion/utils/iva-helper');
            console.log('✅ Helper cargado correctamente');
            console.log('   Probando conversiones:');
            console.log(`   21% → código ${ivaHelper.porcentajeToCodigoAfip(21)} (debería ser 5)`);
            console.log(`   10.5% → código ${ivaHelper.porcentajeToCodigoAfip(10.5)} (debería ser 4)`);
            console.log(`   0% → código ${ivaHelper.porcentajeToCodigoAfip(0)} (debería ser 3)`);
        } catch (error) {
            console.error('❌ Error cargando helper:', error.message);
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
    } finally {
        await pool.end();
    }
}

function getAlicuotaInfo(codigo) {
    const info = {
        1: '← ❌ INCORRECTO (debería ser 5 para 21%)',
        2: '← ❌ INCORRECTO (debería ser 4 para 10.5%)',
        3: '← ✅ CORRECTO (0%)',
        4: '← ✅ CORRECTO (10.5%)',
        5: '← ✅ CORRECTO (21%)',
        6: '← ✅ CORRECTO (27%)',
        8: '← ✅ CORRECTO (5%)',
        9: '← ✅ CORRECTO (2.5%)'
    };
    return info[codigo] || '';
}

diagnosticar();
