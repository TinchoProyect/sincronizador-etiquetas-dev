const { consolidarIngredientes } = require('./utils/ingredientes/consolidarIngredientes.js');

// Test data with normalization issues
const testIngredientes = [
    {nombre: 'Almendra', unidad_medida: 'Kilo', cantidad: 1},
    {nombre: 'ALMENDRA', unidad_medida: 'kilos', cantidad: 2},
    {nombre: 'Almendra ', unidad_medida: 'Kilo', cantidad: 1},
    {nombre: 'Maní', unidad_medida: 'kilo', cantidad: 1},
    {nombre: 'Mani', unidad_medida: 'Kilos', cantidad: 2}
];

console.log('🧪 TESTING NORMALIZATION:');
console.log('========================');
const resultado = consolidarIngredientes(testIngredientes);
console.log('\n📋 RESULTADO FINAL:');
resultado.forEach(ing => {
    console.log(`- ${ing.nombre} (${ing.unidad_medida}): ${ing.cantidad}`);
});
