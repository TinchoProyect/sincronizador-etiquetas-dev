const fs = require('fs');
const html = fs.readFileSync('src/produccion/pages/gestion-mantenimiento.html', 'utf8');

const tIdx = html.indexOf('async function liberarStock');
if (tIdx !== -1) {
    fs.writeFileSync('tmp_diag_liberarStock_Full.txt', html.substring(tIdx - 100, tIdx + 4500));
}

const tIdx2 = html.indexOf('async function retornarAIngredientes');
if (tIdx2 !== -1) {
    fs.writeFileSync('tmp_diag_ingi_Full.txt', html.substring(tIdx2 - 100, tIdx2 + 4500));
}
