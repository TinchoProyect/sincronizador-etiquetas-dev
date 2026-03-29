const fs = require('fs');
const html = fs.readFileSync('src/produccion/pages/gestion-mantenimiento.html', 'utf8');

const tIdx = html.indexOf('/api/produccion/mantenimiento');
if(tIdx !== -1) {
    fs.writeFileSync('tmp_front_mantenimiento.txt', html.substring(tIdx - 1000, tIdx + 3000));
}
