/**
 * Genera PDF de una factura CON CAE para probar QR y código de barras
 */

require('dotenv').config({ path: './src/facturacion/.env' });

const { pool } = require('./src/facturacion/config/database');
const { generarPDF } = require('./src/facturacion/pdf/generador');
const fs = require('fs').promises;

async function generarPDFConCAE() {
    try {
        console.log('🧪 Generando PDF de factura con CAE...\n');
        
        // Usar factura ID 25 que tiene CAE
        const facturaId = 25;
        
        console.log(`📄 Obteniendo factura ID ${facturaId}...`);
        const result = await pool.query(`
            SELECT 
                f.*,
                TRIM(COALESCE(c.nombre, '') || ' ' || COALESCE(c.apellido, '')) as razon_social
            FROM factura_facturas f
            LEFT JOIN clientes c ON f.cliente_id = c.cliente_id
            WHERE f.id = $1
        `, [facturaId]);
        
        if (result.rows.length === 0) {
            console.error(`❌ No se encontró la factura ID ${facturaId}`);
            process.exit(1);
        }
        
        const factura = result.rows[0];
        console.log('✅ Factura obtenida');
        console.log('   - ID:', factura.id);
        console.log('   - Cliente:', factura.razon_social || 'Sin nombre');
        console.log('   - Estado:', factura.estado);
        console.log('   - CAE:', factura.cae);
        console.log('   - CAE Vto:', factura.cae_vto);
        console.log('   - Total: $', factura.imp_total);
        console.log('');
        
        // Obtener items
        console.log('📦 Obteniendo items...');
        const itemsResult = await pool.query(`
            SELECT * FROM factura_factura_items
            WHERE factura_id = $1
            ORDER BY orden ASC
        `, [facturaId]);
        
        console.log(`✅ ${itemsResult.rows.length} items obtenidos\n`);
        
        // Generar PDF
        console.log('📄 Generando PDF con QR y código de barras...');
        const pdfBuffer = await generarPDF(factura, itemsResult.rows);
        
        // Guardar PDF
        const nombreArchivo = `factura-con-cae-${facturaId}-${Date.now()}.pdf`;
        await fs.writeFile(nombreArchivo, pdfBuffer);
        
        console.log('\n✅ ¡PDF generado exitosamente!');
        console.log(`📁 Archivo: ${nombreArchivo}`);
        console.log(`📊 Tamaño: ${(pdfBuffer.length / 1024).toFixed(2)} KB`);
        console.log('\n🎉 Abre el PDF para ver:');
        console.log('   ✅ QR oficial de AFIP (escaneable)');
        console.log('   ✅ Código de barras Code128');
        console.log('   ✅ Leyenda de autorización con CAE');
        console.log('   ✅ Datos de empresa LAMDA');
        console.log('   ✅ Nombre del cliente completo');
        
        await pool.end();
        process.exit(0);
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

generarPDFConCAE();
