const fs = require('fs');

const bCode = fs.readFileSync('src/produccion/controllers/mantenimiento.js', 'utf8');
const tIdx = bCode.indexOf('async function transferirAIngredientes');
if (tIdx !== -1) {
    fs.writeFileSync('tmp_diag_ingi.txt', bCode.substring(tIdx, bCode.indexOf('async function', tIdx + 100)));
}

const fHtml = fs.readFileSync('src/produccion/pages/gestion-mantenimiento.html', 'utf8');
const regex = /async function \w*(liberar|retornar|transferir)\w*[({]([\s\S]{0,1500})/gi;
let match;
const result = [];
while ((match = regex.exec(fHtml)) !== null) {
  result.push('--- ' + match[0].substring(0, 50) + '... ---\n' + match[2]);
}
fs.writeFileSync('tmp_html_flujo_liberar.txt', result.join('\n\n==========================\n\n'));
