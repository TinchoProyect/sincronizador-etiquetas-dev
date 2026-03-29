const fs = require('fs');
const code = fs.readFileSync('src/produccion/controllers/mantenimiento.js', 'utf8');

const tIdx = code.indexOf('async function liberarStock');
if (tIdx !== -1) {
    fs.writeFileSync('tmp_diag_liberar.txt', code.substring(tIdx, code.indexOf('async function', tIdx + 100)));
}
