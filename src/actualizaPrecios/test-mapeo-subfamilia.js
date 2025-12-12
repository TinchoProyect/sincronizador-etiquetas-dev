// filepath: src/actualizaPrecios/test-mapeo-subfamilia.js
'use strict';

/**
 * Script de prueba rápida para verificar el mapeo de 'Subfamilia'
 */

// Función pick (copiada del script original)
const pick = (row, ...keys) => {
  for (const k of keys) if (row[k] !== undefined && row[k] !== null) return row[k];
  return null;
};

// Mapeo actualizado
const K = {
  rubro:     ['familia', 'rubro', 'Familia', 'Rubro'],
  sub_rubro: ['subfamilia', 'sub_rubro', 'Subfamilia', 'SubFamilia', 'Sub Rubro'],
};

// Datos de prueba simulando lo que viene de la API
const articuloAPI = {
  'Artículo': '12345',
  'Descripción': 'PRODUCTO TEST',
  'Familia': 'LACTEOS',
  'Subfamilia': 'QUESOS DUROS'  // ← Exactamente como viene de la API
};

console.log('═══════════════════════════════════════════════════════');
console.log('🧪 TEST DE MAPEO - Subfamilia');
console.log('═══════════════════════════════════════════════════════\n');

console.log('📥 Datos de entrada (simulando API):');
console.log(JSON.stringify(articuloAPI, null, 2));
console.log();

// Probar mapeo
const rubro = pick(articuloAPI, ...K.rubro);
const sub_rubro = pick(articuloAPI, ...K.sub_rubro);

console.log('🔄 Resultado del mapeo:');
console.log(`   rubro: "${rubro}" ${rubro ? '✅' : '❌'}`);
console.log(`   sub_rubro: "${sub_rubro}" ${sub_rubro ? '✅' : '❌'}`);
console.log();

if (rubro && sub_rubro) {
  console.log('✅ ÉXITO: Ambos campos se mapearon correctamente');
  console.log(`   rubro = "${rubro}"`);
  console.log(`   sub_rubro = "${sub_rubro}"`);
} else {
  console.log('❌ ERROR: Uno o ambos campos NO se mapearon');
  if (!rubro) console.log('   ❌ rubro está vacío');
  if (!sub_rubro) console.log('   ❌ sub_rubro está vacío');
}

console.log('\n═══════════════════════════════════════════════════════\n');
