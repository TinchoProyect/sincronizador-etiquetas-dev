const fs = require('fs');
const text = fs.readFileSync('src/produccion/pages/gestion-mantenimiento.html', 'utf8').split('\n');

const res = text.findIndex(l => l.includes('function cargarReparto'));
if (res !== -1) {
    fs.writeFileSync('diag_reparto.txt', text.slice(res, res + 50).join('\n'));
}
