const fs = require('fs');
const code = fs.readFileSync('src/app-etiquetas/server.js', 'utf8');

const tIdx = code.indexOf('/api/imprimir');
if(tIdx > -1) {
    fs.writeFileSync('tmp_diag_server_zebra.js', code.substring(Math.max(0, tIdx-500), tIdx+1500));
} else {
    fs.writeFileSync('tmp_diag_server_zebra.js', 'No /api/imprimir found in server.js');
}
