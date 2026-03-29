const fs = require('fs');
const code = fs.readFileSync('src/produccion/controllers/mantenimiento.js', 'utf8');

const tIdx = code.indexOf('async function finalizarTratamiento');
if (tIdx !== -1) {
    fs.writeFileSync('tmp_diag_finalizar.txt', code.substring(tIdx, code.indexOf('async function', tIdx + 100)));
}
