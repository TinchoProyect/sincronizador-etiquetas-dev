const fs = require('fs');
const html = fs.readFileSync('src/produccion/pages/gestion-mantenimiento.html', 'utf8');

const tIdx = html.indexOf('function cargarStock()');
if(tIdx !== -1) {
    fs.writeFileSync('tmp_front_stock.txt', html.substring(tIdx, tIdx + 3000));
}
