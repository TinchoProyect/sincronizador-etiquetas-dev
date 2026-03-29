const fs = require('fs');
const html = fs.readFileSync('src/produccion/pages/gestion-mantenimiento.html', 'utf8');

const tIdx = html.indexOf('const htmlRow = `');
if(tIdx !== -1) {
    fs.writeFileSync('tmp_front_row.txt', html.substring(tIdx - 100, tIdx + 1500));
}
