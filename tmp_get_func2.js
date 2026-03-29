const fs = require('fs');
const content = fs.readFileSync('src/produccion/pages/gestion-mantenimiento.html', 'utf8');
const lines = content.split('\n');

let out = '';
function findFunc(name) {
   const idx = lines.findIndex(l => l.indexOf('function ' + name) !== -1 || l.indexOf('const ' + name) !== -1);
   if (idx !== -1) {
       out += `=== Func: ${name} at ${idx}\n`;
       out += lines.slice(Math.max(0, idx - 2), idx + 80).join('\n') + '\n\n';
   } else {
       out += `Not found: ${name}\n\n`;
   }
}

findFunc('devolverIngrediente');
findFunc('ejecutarRetornoIngrediente');

fs.writeFileSync('tmp_out_utf8.txt', out, 'utf8');
