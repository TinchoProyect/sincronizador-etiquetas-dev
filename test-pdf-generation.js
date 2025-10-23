/**
 * Script de prueba para generación de PDF
 * Prueba el nuevo diseño con datos de empresa
 */

// Cargar dotenv PRIMERO
require('dotenv').config({ path: './src/facturacion/.env' });

const { pool } = require('./src/facturacion/config/database');
const { generarPDF } = require('./src/facturacion/pdf/generador');
const fs = require('fs').promises;

async function testPDFGeneration() {
    try {
        console.log('🧪 Iniciando prueba de generación de PDF...\n');
        
        // Obtener una factura de prueba (la más reciente)
        const facturaQuery = `
            SELECT 
                f.*,
                TRIM(COALESCE(c.nombre, '') || ' ' || COALESCE(c.apellido, '')) as razon_social
            FROM factura_facturas f
            LEFT JOIN clientes c ON f.cliente_id = c.cliente_id
            ORDER BY f.id DESC
            LIMIT 1
        `;
        
        const facturaResult = await pool.query(facturaQuery);
        
        if (facturaResult.rows.length === 0) {
            console.error('❌ No se encontraron facturas en la base de datos');
            process.exit(1);
        }
        
        const factura = facturaResult.rows[0];
        console.log(`✅ Factura obtenida: ID ${factura.id}`);
        console.log(`   - Cliente: ${factura.razon_social || 'Sin nombre'}`);
        console.log(`   - Total: $${factura.imp_total}`);
        console.log('');
        
        // Obtener items
        const itemsQuery = `
            SELECT * FROM factura_factura_items
            WHERE factura_id = $1
            ORDER BY orden ASC
        `;
        
        const itemsResult = await pool.query(itemsQuery, [factura.id]);
        const items = itemsResult.rows;
        
        console.log(`✅ ${items.length} items obtenidos\n`);
        
        // Generar PDF
        console.log('📄 Generando PDF...');
        const pdfBuffer = await generarPDF(factura, items);
        
        // Guardar PDF
        const nombreArchivo = `test-factura-${factura.id}-${Date.now()}.pdf`;
        await fs.writeFile(nombreArchivo, pdfBuffer);
        
        console.log(`\n✅ ¡PDF generado exitosamente!`);
        console.log(`📁 Archivo: ${nombreArchivo}`);
        console.log(`📊 Tamaño: ${(pdfBuffer.length / 1024).toFixed(2)} KB`);
        console.log(`\n🎉 Prueba completada con éxito`);
        
        await pool.end();
        process.exit(0);
        
    } catch (error) {
        console.error('\n❌ Error en la prueba:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

testPDFGeneration();
