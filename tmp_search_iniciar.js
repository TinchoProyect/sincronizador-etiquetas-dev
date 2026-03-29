const fs = require('fs');
const code = fs.readFileSync('src/produccion/controllers/mantenimiento.js', 'utf8');

const mIdx = code.indexOf('const iniciarTratamiento');
if (mIdx !== -1) {
    let fnCode = code.substring(mIdx, code.indexOf('const abrirTratamiento =', mIdx));
    fs.writeFileSync('diag_iniciar.txt', fnCode);
}
