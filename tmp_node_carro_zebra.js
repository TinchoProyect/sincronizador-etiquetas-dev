const fs = require('fs');
const code = fs.readFileSync('src/produccion/js/carroPreparado.js', 'utf8');

const tIdx = code.indexOf('/imprimir');
if(tIdx > -1) {
    fs.writeFileSync('tmp_diag_carro_zebra.js', code.substring(Math.max(0, tIdx-500), tIdx+1500));
} else {
    fs.writeFileSync('tmp_diag_carro_zebra.js', 'No /imprimir found in carroPreparado.js');
}
