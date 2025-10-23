/**
 * Script para normalizar y limpiar facturas RECHAZADAS
 * Paso 1 del plan D + E
 */

const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
});

async function corregirFacturas() {
    console.log('🔧 CORRECCIÓN DE FACTURAS - Paso 1\n');
    console.log('='.repeat(80));
    
    try {
        // 1. Normalizar condicion_iva_id para Consumidores Finales
        console.log('\n📋 Normalizando condición IVA para Consumidores Finales...');
        const normalizacion = await pool.query(`
            UPDATE factura_facturas
            SET condicion_iva_id = 5
            WHERE doc_tipo = 99
              AND condicion_iva_id IS DISTINCT FROM 5
            RETURNING id, doc_tipo, condicion_iva_id
        `);
        
        if (normalizacion.rowCount > 0) {
            console.log(`✅ ${normalizacion.rowCount} facturas normalizadas:`);
            normalizacion.rows.forEach(f => {
                console.log(`   - Factura ID ${f.id}: condicion_iva_id → 5 (CF)`);
            });
        } else {
            console.log('✅ Todas las facturas CF ya tienen condicion_iva_id = 5');
        }
        
        // 2. Limpiar facturas RECHAZADAS para reproceso
        console.log('\n🧹 Limpiando facturas RECHAZADAS para reproceso...');
        const limpieza = await pool.query(`
            UPDATE factura_facturas
            SET cbte_nro = NULL,
                cae = NULL,
                cae_vto = NULL,
                resultado = NULL,
                estado = 'BORRADOR',
                updated_at = NOW()
            WHERE estado = 'RECHAZADA'
            RETURNING id, tipo_cbte, pto_vta, presupuesto_id
        `);
        
        if (limpieza.rowCount > 0) {
            console.log(`✅ ${limpieza.rowCount} facturas limpiadas y listas para reproceso:`);
            limpieza.rows.forEach(f => {
                console.log(`   - Factura ID ${f.id}: Tipo ${f.tipo_cbte}, PV ${f.pto_vta}, Presup ${f.presupuesto_id}`);
            });
        } else {
            console.log('✅ No hay facturas RECHAZADAS para limpiar');
        }
        
        // 3. Verificar estado final
        console.log('\n📊 Estado final de las facturas:');
        const estado = await pool.query(`
            SELECT estado, COUNT(*) as cantidad
            FROM factura_facturas
            GROUP BY estado
            ORDER BY estado
        `);
        
        console.table(estado.rows);
        
        // 4. Verificar consistencia doc_tipo / condicion_iva_id
        console.log('\n🔍 Verificando consistencia doc_tipo / condicion_iva_id:');
        const inconsistencias = await pool.query(`
            SELECT id, doc_tipo, condicion_iva_id
            FROM factura_facturas
            WHERE doc_tipo = 99 AND condicion_iva_id != 5
        `);
        
        if (inconsistencias.rowCount > 0) {
            console.log('⚠️ Facturas con inconsistencias:');
            console.table(inconsistencias.rows);
        } else {
            console.log('✅ Todas las facturas CF tienen condicion_iva_id = 5');
        }
        
        console.log('\n✅ Paso 1 completado exitosamente');
        console.log('='.repeat(80));
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('Stack:', error.stack);
        throw error;
    } finally {
        await pool.end();
    }
}

// Ejecutar
corregirFacturas()
    .then(() => process.exit(0))
    .catch(error => {
        console.error('❌ Error fatal:', error);
        process.exit(1);
    });
