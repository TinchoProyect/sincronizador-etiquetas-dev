const fs = require('fs');
const path = require('path');

const bundlePath = path.join(__dirname, '../b2b-portal/dist/assets');
const files = fs.readdirSync(bundlePath);
const indexFile = files.find(f => f.startsWith('index-') && f.endsWith('.js'));

console.log('📦 ARCHIVO BUNDLE ACTUAL EN DIST:', indexFile);

const content = fs.readFileSync(path.join(bundlePath, indexFile), 'utf8');

console.log('🔍 ¿Tiene "telemetria_accesos"?:', content.includes('telemetria_accesos'));
console.log('🔍 ¿Tiene "b2b_cliente_nombre"?:', content.includes('b2b_cliente_nombre'));
console.log('🔍 ¿Tiene "b2b_cached_profile"?:', content.includes('b2b_cached_profile'));
console.log('🔍 ¿Tiene "realNombre"?:', content.includes('realNombre'));

const idxTele = content.indexOf('telemetria_accesos');
if (idxTele !== -1) {
  console.log('\n🔍 CÓDIGO MINIFICADO ALREDEDOR DE TELEMETRÍA ACCESOS:');
  console.log(content.slice(Math.max(0, idxTele - 200), idxTele + 300));
}
