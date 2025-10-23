/**
 * Script de diagnóstico para verificar generación de PDF
 * Revisa si la factura tiene CAE y prueba la generación
 */

require('dotenv').config({ path: './src/facturacion/.env' });

const { pool } = require('./src/facturacion/config/database');

async function diagnosticar() {
    try {
        console.log('🔍 DIAGNÓSTICO DE PDF - Iniciando...\n');
        
        // 1. Verificar conexión a BD
        console.log('📊 1. Verificando conexión a base de datos...');
        await pool.query('SELECT NOW()');
        console.log('✅ Conexión a BD exitosa\n');
        
        // 2. Obtener factura de prueba
        console.log('📄 2. Obteniendo factura ID 26...');
        const result = await pool.query(`
            SELECT 
                f.*,
                TRIM(COALESCE(c.nombre, '') || ' ' || COALESCE(c.apellido, '')) as razon_social
            FROM factura_facturas f
            LEFT JOIN clientes c ON f.cliente_id = c.cliente_id
            WHERE f.id = 26
        `);
        
        if (result.rows.length === 0) {
            console.error('❌ No se encontró la factura ID 26');
            process.exit(1);
        }
        
        const factura = result.rows[0];
        console.log('✅ Factura encontrada');
        console.log('   - ID:', factura.id);
        console.log('   - Cliente:', factura.razon_social || 'Sin nombre');
        console.log('   - Estado:', factura.estado);
        console.log('   - CAE:', factura.cae || 'NO TIENE CAE');
        console.log('   - CAE Vto:', factura.cae_vto || 'N/A');
        console.log('   - Tipo Cbte:', factura.tipo_cbte);
        console.log('   - Pto Vta:', factura.pto_vta);
        console.log('   - Nro Cbte:', factura.cbte_nro);
        console.log('');
        
        // 3. Verificar si tiene CAE
        if (!factura.cae) {
            console.log('⚠️  PROBLEMA IDENTIFICADO:');
            console.log('   La factura ID 26 NO tiene CAE asignado.');
            console.log('   El QR y código de barras solo se muestran en facturas con CAE.\n');
            
            console.log('💡 SOLUCIÓN:');
            console.log('   1. Emitir la factura a AFIP para obtener CAE, o');
            console.log('   2. Usar una factura que ya tenga CAE\n');
            
            // Buscar facturas con CAE
            console.log('🔎 Buscando facturas con CAE...');
            const conCAE = await pool.query(`
                SELECT id, cae, estado, cbte_nro
                FROM factura_facturas
                WHERE cae IS NOT NULL
                ORDER BY id DESC
                LIMIT 5
            `);
            
            if (conCAE.rows.length > 0) {
                console.log('✅ Facturas con CAE disponibles:');
                conCAE.rows.forEach(f => {
                    console.log(`   - ID ${f.id}: CAE ${f.cae}, Estado: ${f.estado}`);
                });
                console.log('\n💡 Prueba con alguna de estas facturas');
            } else {
                console.log('❌ No hay facturas con CAE en la base de datos');
                console.log('   Debes emitir una factura a AFIP primero');
            }
        } else {
            console.log('✅ La factura tiene CAE, debería mostrar QR y código de barras\n');
            
            // 4. Probar generación de PDF
            console.log('🧪 3. Probando generación de PDF...');
            const { generarPDF } = require('./src/facturacion/pdf/generador');
            
            // Obtener items
            const itemsResult = await pool.query(`
                SELECT * FROM factura_factura_items
                WHERE factura_id = 26
                ORDER BY orden ASC
            `);
            
            const pdfBuffer = await generarPDF(factura, itemsResult.rows);
            
            // Guardar PDF
            const fs = require('fs').promises;
            const nombreArchivo = `diagnostico-factura-26-${Date.now()}.pdf`;
            await fs.writeFile(nombreArchivo, pdfBuffer);
            
            console.log('✅ PDF generado exitosamente');
            console.log('📁 Archivo:', nombreArchivo);
            console.log('📊 Tamaño:', (pdfBuffer.length / 1024).toFixed(2), 'KB');
            console.log('\n🎉 Revisa el PDF para ver si aparecen QR y código de barras');
        }
        
        await pool.end();
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

diagnosticar();
