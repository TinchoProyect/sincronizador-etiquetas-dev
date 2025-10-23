/**
 * Script para corregir códigos de alícuotas IVA en facturas existentes
 * Convierte códigos incorrectos (1, 2) a códigos correctos (5, 4, 3)
 */

require('dotenv').config({ path: './src/facturacion/.env' });
const { pool } = require('./src/facturacion/config/database');

console.log('🔧 CORRECCIÓN DE FACTURAS EXISTENTES\n');
console.log('====================================\n');

// Mapeo de códigos incorrectos a correctos
const CORRECCION_CODIGOS = {
    1: 5,  // 1 (incorrecto) → 5 (21% correcto)
    2: 4,  // 2 (incorrecto) → 4 (10.5% correcto)
    // 3, 4, 5, 6, 8, 9 ya son correctos, no los tocamos
};

async function corregirFacturas() {
    try {
        console.log('🔍 Conectando a base de datos...\n');
        
        // 1. Obtener items con códigos incorrectos
        const queryItems = `
            SELECT 
                id,
                factura_id,
                descripcion,
                alic_iva_id,
                imp_neto,
                imp_iva
            FROM factura_factura_items
            WHERE alic_iva_id IN (1, 2)
            ORDER BY factura_id, id
        `;
        
        const result = await pool.query(queryItems);
        const itemsIncorrectos = result.rows;
        
        if (itemsIncorrectos.length === 0) {
            console.log('✅ No hay facturas con códigos incorrectos. ¡Todo está bien!');
            return;
        }
        
        console.log(`📋 Encontrados ${itemsIncorrectos.length} items con códigos incorrectos:\n`);
        
        // Agrupar por factura
        const facturas = {};
        itemsIncorrectos.forEach(item => {
            if (!facturas[item.factura_id]) {
                facturas[item.factura_id] = [];
            }
            facturas[item.factura_id].push(item);
        });
        
        console.log(`📄 Afectadas ${Object.keys(facturas).length} facturas\n`);
        
        // Mostrar resumen
        for (const facturaId in facturas) {
            console.log(`Factura #${facturaId}:`);
            facturas[facturaId].forEach(item => {
                const codigoNuevo = CORRECCION_CODIGOS[item.alic_iva_id];
                console.log(`  Item ${item.id}: ${item.descripcion}`);
                console.log(`    Código actual: ${item.alic_iva_id} (incorrecto)`);
                console.log(`    Código nuevo:  ${codigoNuevo} (correcto)`);
            });
            console.log('');
        }
        
        // Pedir confirmación
        console.log('⚠️  ¿Deseas corregir estos items? (Presiona Ctrl+C para cancelar, Enter para continuar)');
        await new Promise(resolve => {
            process.stdin.once('data', resolve);
        });
        
        console.log('\n🔄 Corrigiendo items...\n');
        
        let corregidos = 0;
        
        // Corregir cada item
        for (const item of itemsIncorrectos) {
            const codigoNuevo = CORRECCION_CODIGOS[item.alic_iva_id];
            
            if (!codigoNuevo) {
                console.log(`⚠️  Item ${item.id}: Código ${item.alic_iva_id} no tiene mapeo definido, se omite`);
                continue;
            }
            
            // Recalcular IVA con el código correcto
            const porcentajes = {
                3: 0,      // 0%
                4: 0.105,  // 10.5%
                5: 0.21,   // 21%
                6: 0.27,   // 27%
                8: 0.05,   // 5%
                9: 0.025   // 2.5%
            };
            
            const factor = porcentajes[codigoNuevo] || 0.21;
            const impNeto = parseFloat(item.imp_neto);
            const impIvaNuevo = Math.round(impNeto * factor * 100) / 100;
            
            // Actualizar en BD
            const updateQuery = `
                UPDATE factura_factura_items
                SET alic_iva_id = $1,
                    imp_iva = $2
                WHERE id = $3
            `;
            
            await pool.query(updateQuery, [codigoNuevo, impIvaNuevo, item.id]);
            
            console.log(`✅ Item ${item.id}: ${item.alic_iva_id} → ${codigoNuevo}, IVA: $${item.imp_iva} → $${impIvaNuevo.toFixed(2)}`);
            corregidos++;
        }
        
        console.log(`\n✅ Se corrigieron ${corregidos} items exitosamente\n`);
        
        // Recalcular totales de facturas afectadas
        console.log('🔄 Recalculando totales de facturas...\n');
        
        for (const facturaId in facturas) {
            // Sumar totales de items
            const totalesQuery = `
                SELECT 
                    SUM(imp_neto) as total_neto,
                    SUM(imp_iva) as total_iva
                FROM factura_factura_items
                WHERE factura_id = $1
            `;
            
            const totalesResult = await pool.query(totalesQuery, [facturaId]);
            const { total_neto, total_iva } = totalesResult.rows[0];
            const total_general = parseFloat(total_neto) + parseFloat(total_iva);
            
            // Actualizar factura
            const updateFacturaQuery = `
                UPDATE factura_facturas
                SET imp_neto = $1,
                    imp_iva = $2,
                    imp_total = $3
                WHERE id = $4
            `;
            
            await pool.query(updateFacturaQuery, [total_neto, total_iva, total_general, facturaId]);
            
            console.log(`✅ Factura #${facturaId}: Neto=$${total_neto}, IVA=$${total_iva}, Total=$${total_general.toFixed(2)}`);
        }
        
        console.log('\n🎉 ¡CORRECCIÓN COMPLETADA EXITOSAMENTE!\n');
        console.log('📝 PRÓXIMOS PASOS:');
        console.log('   1. Abre cualquier factura corregida');
        console.log('   2. Verifica que muestre correctamente 21%, 10.5%, etc.');
        console.log('   3. Crea una nueva factura desde presupuesto');
        console.log('   4. Ejecuta: node diagnosticar-alicuotas.js\n');
        
    } catch (error) {
        console.error('\n❌ ERROR:', error.message);
        console.error(error.stack);
    } finally {
        await pool.end();
        console.log('\n🔌 Conexión cerrada');
        process.exit(0);
    }
}

corregirFacturas();
