const fs = require('fs');
const html = fs.readFileSync('src/produccion/pages/gestion-mantenimiento.html', 'utf8');

const regex = /liberarStock\(/g;
let match;
const result = [];
while ((match = regex.exec(html)) !== null) {
  result.push(html.substring(match.index - 100, match.index + 200).trim());
}

if(result.length > 0) {
  fs.writeFileSync('tmp_diag_liberarStock_HTML.txt', result.join('\n\n=========\n\n'));
} else {
  console.log("No se encontro liberarStock(");
}
