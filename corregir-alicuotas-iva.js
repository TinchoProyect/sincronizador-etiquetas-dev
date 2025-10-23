/**
 * Script para corregir alícuotas de IVA en facturas existentes
 * Convierte códigos incorrectos (1, 2) a códigos AFIP correctos (5, 4)
 */

require('dotenv').config({ path: './src/facturacion/.env' });
const { pool } = require('./src/facturacion/config/database');
const { porcentajeToCodigoAfip, calcularIva, obtenerPorcentaje } = require('./src/facturacion/utils/iva-helper');

console.log('🔧 [CORRECCION-IVA] Iniciando corrección de alícuotas IVA...\n');

/**
 * Mapeo de códigos INCORRECTOS a códigos CORRECTOS AFIP
 */
const MAPEO_CORRECCION = {
    1: 5,  // 1 (incorrecto 21%) → 5 (correcto 21%)
    2: 4   // 2 (incorrecto 10.5%) → 4 (correcto 10.5%)
    // 3 ya es correcto (0%)
};

async function corregirAlicuotas() {
    const client = await pool.connect();
    
    try {
        console.log('🔍 Buscando items con alícuotas incorrectas (1, 2)...\n');
        
        // Buscar items con alícuotas incorrectas
        const queryBuscar = `
            SELECT 
                fi.id,
                fi.factura_id,
                fi.descripcion,
                fi.qty,
                fi.p_unit,
                fi.alic_iva_id,
                fi.imp_neto,
                fi.imp_iva,
                f.estado
            FROM factura_factura_items fi
            JOIN factura_facturas f ON f.id = fi.factura_id
            WHERE fi.alic_iva_id IN (1, 2)
            ORDER BY fi.factura_id, fi.id
        `;
        
        const result = await client.query(queryBuscar);
        
        if (result.rows.length === 0) {
            console.log('✅ No se encontraron items con alícuotas incorrectas.\n');
            return;
        }
        
        console.log(`📋 Encontrados ${result.rows.length} items para corregir:\n`);
        
        // Mostrar resumen
        const porFactura = {};
        result.rows.forEach(item => {
            if (!porFactura[item.factura_id]) {
                porFactura[item.factura_id] = [];
            }
            porFactura[item.factura_id].push(item);
        });
        
        console.log('Facturas afectadas:');
        Object.keys(porFactura).forEach(facturaId => {
            const items = porFactura[facturaId];
            const estado = items[0].estado;
            console.log(`  - Factura ID ${facturaId} (${estado}): ${items.length} items`);
        });
        console.log('');
        
        // Confirmar
        console.log('⚠️  IMPORTANTE:');
        console.log('   - Se corregirán los códigos de alícuota IVA');
        console.log('   - Se recalcularán los montos de IVA por ítem');
        console.log('   - Se actualizarán los totales de cada factura');
        console.log('');
        
        // Iniciar corrección
        await client.query('BEGIN');
        console.log('🔄 Transacción iniciada\n');
        
        let itemsCorregidos = 0;
        let facturasActualizadas = new Set();
        
        for (const item of result.rows) {
            const codigoCorrecto = MAPEO_CORRECCION[item.alic_iva_id];
            
            if (!codigoCorrecto) {
                console.warn(`⚠️  Item ${item.id}: alícuota ${item.alic_iva_id} no tiene mapeo (skip)`);
                continue;
            }
            
            // Recalcular IVA
            const ivaRecalculado = calcularIva(item.imp_neto, codigoCorrecto);
            const pctNuevo = obtenerPorcentaje(codigoCorrecto);
            
            console.log(`✏️  Item ${item.id} (Factura ${item.factura_id}):`);
            console.log(`   Alícuota: ${item.alic_iva_id} → ${codigoCorrecto} (${pctNuevo}%)`);
            console.log(`   IVA: $${item.imp_iva.toFixed(2)} → $${ivaRecalculado.toFixed(2)}`);
            
            // Actualizar item
            const updateItemQuery = `
                UPDATE factura_factura_items
                SET alic_iva_id = $1,
                    imp_iva = $2,
                    updated_at = NOW()
                WHERE id = $3
            `;
            
            await client.query(updateItemQuery, [codigoCorrecto, ivaRecalculado, item.id]);
            
            itemsCorregidos++;
            facturasActualizadas.add(item.factura_id);
        }
        
        console.log(`\n✅ ${itemsCorregidos} items corregidos\n`);
        
        // Recalcular totales de facturas afectadas
        console.log('🧮 Recalculando totales de facturas...\n');
        
        for (const facturaId of facturasActualizadas) {
            const queryTotales = `
                SELECT 
                    SUM(imp_neto) as total_neto,
                    SUM(imp_iva) as total_iva
                FROM factura_factura_items
                WHERE factura_id = $1
            `;
            
            const totalesResult = await client.query(queryTotales, [facturaId]);
            const totales = totalesResult.rows[0];
            
            const impNeto = parseFloat(totales.total_neto) || 0;
            const impIva = parseFloat(totales.total_iva) || 0;
            const impTotal = impNeto + impIva;
            
            console.log(`💰 Factura ${facturaId}:`);
            console.log(`   Neto: $${impNeto.toFixed(2)}`);
            console.log(`   IVA: $${impIva.toFixed(2)}`);
            console.log(`   TOTAL: $${impTotal.toFixed(2)}`);
            
            // Actualizar factura
            const updateFacturaQuery = `
                UPDATE factura_facturas
                SET imp_neto = $1,
                    imp_iva = $2,
                    imp_total = $3,
                    updated_at = NOW()
                WHERE id = $4
            `;
            
            await client.query(updateFacturaQuery, [impNeto, impIva, impTotal, facturaId]);
        }
        
        console.log(`\n✅ ${facturasActualizadas.size} facturas actualizadas\n`);
        
        await client.query('COMMIT');
        console.log('✅ Transacción confirmada\n');
        
        console.log('🎉 Corrección completada exitosamente!');
        console.log(`   - ${itemsCorregidos} items corregidos`);
        console.log(`   - ${facturasActualizadas.size} facturas actualizadas`);
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('\n❌ Error durante la corrección:', error.message);
        console.error('Stack:', error.stack);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Ejecutar
corregirAlicuotas()
    .then(() => {
        console.log('\n✅ Script finalizado');
        process.exit(0);
    })
    .catch(error => {
        console.error('\n❌ Script falló:', error.message);
        process.exit(1);
    });
