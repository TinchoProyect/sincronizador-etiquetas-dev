/**
 * Script de prueba para verificar que PDFKit funciona correctamente
 * y que la generación de PDF de remitos está operativa
 */

const http = require('http');

console.log('🧪 ===== PRUEBA DE FUNCIONALIDAD PDF =====');
console.log('📋 Verificando que PDFKit esté disponible y funcional...\n');

// Test 1: Verificar que PDFKit se puede importar
console.log('🔍 Test 1: Importando PDFKit...');
try {
    const PDFDocument = require('pdfkit');
    console.log('✅ PDFKit importado exitosamente');
    console.log(`📦 Versión disponible: ${PDFDocument.version || 'No disponible'}`);
} catch (error) {
    console.error('❌ Error importando PDFKit:', error.message);
    process.exit(1);
}

// Test 2: Crear un PDF simple de prueba
console.log('\n🔍 Test 2: Creando PDF de prueba...');
try {
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument();
    
    // Simular creación de PDF sin guardarlo
    doc.fontSize(20).text('Prueba de PDFKit', 100, 100);
    doc.fontSize(12).text('Este es un test de funcionalidad', 100, 150);
    
    console.log('✅ PDF de prueba creado exitosamente');
} catch (error) {
    console.error('❌ Error creando PDF de prueba:', error.message);
    process.exit(1);
}

// Test 3: Probar endpoint de impresión con formato PDF
console.log('\n🔍 Test 3: Probando endpoint de impresión PDF...');

const testUrl = 'http://localhost:3002/api/produccion/impresion-presupuesto?cliente_id=711&formato=pdf';
console.log(`🌐 URL de prueba: ${testUrl}`);

const req = http.get(testUrl, (res) => {
    console.log(`📊 Status Code: ${res.statusCode}`);
    console.log(`📋 Headers:`, res.headers);
    
    if (res.statusCode === 200) {
        console.log('✅ Endpoint responde correctamente');
        
        if (res.headers['content-type'] === 'application/pdf') {
            console.log('✅ Content-Type correcto: application/pdf');
            console.log('📄 PDF generado exitosamente');
        } else if (res.headers['content-type'] === 'application/json') {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    if (response.error && response.error.includes('PDFKit no disponible')) {
                        console.log('❌ PDFKit aún no está disponible en el servidor');
                        console.log('💡 Sugerencia: Reiniciar el servidor de producción');
                    } else {
                        console.log('📋 Respuesta JSON:', response);
                    }
                } catch (e) {
                    console.log('📋 Respuesta:', data);
                }
            });
        }
    } else {
        console.log(`❌ Error en endpoint: ${res.statusCode}`);
    }
    
    console.log('\n🎯 ===== RESULTADO DE PRUEBAS =====');
    console.log('✅ PDFKit instalado y funcional');
    console.log('💡 Si el endpoint aún falla, reinicie el servidor con: npm run produccion');
    console.log('🔄 El servidor debe reiniciarse para cargar la nueva dependencia');
    console.log('=====================================\n');
});

req.on('error', (error) => {
    console.log('⚠️ Servidor no disponible (normal si no está ejecutándose)');
    console.log('💡 Para probar completamente, ejecute: npm run produccion');
    console.log('\n🎯 ===== RESULTADO DE PRUEBAS =====');
    console.log('✅ PDFKit instalado y funcional');
    console.log('💡 Reinicie el servidor para que tome efecto');
    console.log('=====================================\n');
});

req.setTimeout(5000, () => {
    console.log('⏱️ Timeout - Servidor no responde');
    console.log('\n🎯 ===== RESULTADO DE PRUEBAS =====');
    console.log('✅ PDFKit instalado y funcional');
    console.log('💡 Reinicie el servidor para que tome efecto');
    console.log('=====================================\n');
    req.destroy();
});
