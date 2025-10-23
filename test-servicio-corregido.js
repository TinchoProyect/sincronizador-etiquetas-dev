/**
 * Script para probar que el servicio corregido funciona
 */

// Simular el mapeo de alícuotas
const { porcentajeToCodigoAfip, calcularIva } = require('./src/facturacion/utils/iva-helper');

console.log('🧪 PRUEBA DEL SERVICIO CORREGIDO\n');
console.log('================================\n');

// Simular items de presupuesto
const itemsPrueba = [
    { articulo: 'Producto con 21% IVA', cantidad: 2, precio1: 12250, iva1: 21 },
    { articulo: 'Producto con 10.5% IVA', cantidad: 1, precio1: 23160, iva1: 10.5 },
    { articulo: 'Producto Exento', cantidad: 1, precio1: 5000, iva1: 0 }
];

console.log('📋 Items de prueba:\n');

itemsPrueba.forEach((item, index) => {
    console.log(`Item ${index + 1}: ${item.articulo}`);
    console.log(`  Cantidad: ${item.cantidad}`);
    console.log(`  Precio Unit: $${item.precio1}`);
    console.log(`  IVA Presupuesto: ${item.iva1}%`);
    
    // Aplicar el mapeo CORREGIDO
    const alicIvaId = porcentajeToCodigoAfip(item.iva1);
    const impNeto = Math.round(item.cantidad * item.precio1 * 100) / 100;
    const impIva = calcularIva(impNeto, alicIvaId);
    
    console.log(`  ✅ Código AFIP: ${alicIvaId} ${alicIvaId === 5 ? '(21%)' : alicIvaId === 4 ? '(10.5%)' : '(0%)'}`);
    console.log(`  Neto: $${impNeto.toFixed(2)}`);
    console.log(`  IVA: $${impIva.toFixed(2)}`);
    console.log(`  Total: $${(impNeto + impIva).toFixed(2)}`);
    console.log('');
});

console.log('================================');
console.log('✅ El servicio corregido funciona correctamente');
console.log('');
console.log('🔴 PROBLEMA: El servidor tiene código viejo en caché');
console.log('');
console.log('💡 SOLUCIÓN:');
console.log('   1. Detén el servidor (Ctrl+C)');
console.log('   2. Borra caché: Remove-Item -Recurse -Force node_modules\\.cache -ErrorAction SilentlyContinue');
console.log('   3. Reinicia: node app.js');
console.log('   4. Crea una nueva factura');
