const fs = require('fs');
const html = fs.readFileSync('src/produccion/pages/produccion.html', 'utf8');

const tIdx = html.indexOf('/api/imprimir');
if(tIdx > -1) {
    fs.writeFileSync('tmp_diag_prod_zebra.js', html.substring(Math.max(0, tIdx-500), tIdx+1500));
} else {
    fs.writeFileSync('tmp_diag_prod_zebra.js', 'No /api/imprimir found in produccion.html');
}
