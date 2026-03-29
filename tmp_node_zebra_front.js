const fs = require('fs');
const html = fs.readFileSync('src/produccion/pages/gestion-mantenimiento.html', 'utf8');

const tIdx = html.indexOf('/api/imprimir');
if(tIdx > -1) {
    fs.writeFileSync('tmp_diag_liberar_zebra.js', html.substring(Math.max(0, tIdx-1500), tIdx+1500));
} else {
    // try searching for '/imprimir'
    const oIdx = html.indexOf('/imprimir');
    if(oIdx > -1) {
        fs.writeFileSync('tmp_diag_liberar_zebra.js', html.substring(Math.max(0, oIdx-1500), oIdx+1500));
    }
}
