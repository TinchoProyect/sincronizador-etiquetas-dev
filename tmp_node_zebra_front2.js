const fs = require('fs');
const html = fs.readFileSync('src/produccion/pages/gestion-mantenimiento.html', 'utf8');

const tIdx = html.indexOf("const resImp = await fetch('http://localhost:3000/api/imprimir'");
if(tIdx > -1) {
    fs.writeFileSync('tmp_diag_zebra_front2.js', html.substring(Math.max(0, tIdx-600), tIdx+1000));
}
