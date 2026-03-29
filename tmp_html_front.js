const fs = require('fs');
const html = fs.readFileSync('src/produccion/pages/gestion-mantenimiento.html', 'utf8');

const tIdx = html.indexOf('filteredData.forEach');
if (tIdx !== -1) {
    fs.writeFileSync('tmp_front_render.txt', html.substring(tIdx - 200, tIdx + 2000));
}
