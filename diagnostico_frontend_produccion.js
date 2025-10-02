// Script de diagnóstico para verificar qué archivo JavaScript se está cargando

const fs = require('fs');
const path = require('path');

console.log('🔍 Diagnóstico de archivos JavaScript de producción\n');

// Verificar archivo en public/js/produccion.js
const publicPath = path.join(__dirname, 'public', 'js', 'produccion.js');
console.log('📁 Ruta del archivo:', publicPath);
console.log('📄 ¿Existe?:', fs.existsSync(publicPath));

if (fs.existsSync(publicPath)) {
    const content = fs.readFileSync(publicPath, 'utf8');
    const lines = content.split('\n');
    
    console.log('\n📊 Estadísticas del archivo:');
    console.log('   - Total de líneas:', lines.length);
    console.log('   - Tamaño:', (content.length / 1024).toFixed(2), 'KB');
    
    // Buscar la función renderizarPedidosPorCliente
    const renderFunctionLine = lines.findIndex(line => line.includes('function renderizarPedidosPorCliente'));
    console.log('\n🔍 Función renderizarPedidosPorCliente encontrada en línea:', renderFunctionLine + 1);
    
    // Buscar logs de DEBUG
    const debugLogs = lines.filter(line => line.includes('DEBUG Cliente'));
    console.log('🐛 Logs de DEBUG encontrados:', debugLogs.length);
    
    if (debugLogs.length > 0) {
        console.log('\n✅ El archivo TIENE los logs de DEBUG');
        console.log('📝 Ejemplo de log encontrado:');
        debugLogs.slice(0, 2).forEach(log => {
            console.log('   ', log.trim());
        });
    } else {
        console.log('\n❌ El archivo NO TIENE los logs de DEBUG');
        console.log('⚠️ El navegador está cargando una versión antigua del archivo');
    }
    
    // Buscar la lógica de agrupación por presupuesto
    const presupuestosMapLines = lines.filter(line => line.includes('presupuestosMap'));
    console.log('\n🗺️ Referencias a presupuestosMap:', presupuestosMapLines.length);
    
    if (presupuestosMapLines.length > 0) {
        console.log('✅ El archivo TIENE la lógica de agrupación por presupuesto');
    } else {
        console.log('❌ El archivo NO TIENE la lógica de agrupación por presupuesto');
    }
    
    // Mostrar las primeras líneas de la función renderizarPedidosPorCliente
    if (renderFunctionLine >= 0) {
        console.log('\n📄 Primeras 20 líneas de renderizarPedidosPorCliente:');
        console.log('─'.repeat(80));
        lines.slice(renderFunctionLine, renderFunctionLine + 20).forEach((line, idx) => {
            console.log(`${renderFunctionLine + idx + 1}:`, line);
        });
        console.log('─'.repeat(80));
    }
}

console.log('\n💡 Solución sugerida:');
console.log('   1. El navegador tiene el archivo en caché');
console.log('   2. Agregá un parámetro de versión al HTML');
console.log('   3. O cambiá el nombre del archivo temporalmente');
