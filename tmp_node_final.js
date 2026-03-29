const fs = require('fs');
const code = fs.readFileSync('src/produccion/controllers/mantenimiento.js', 'utf8');

const tIdx = code.indexOf('public.mantenimiento_tratamientos_items');
if (tIdx !== -1) {
    fs.writeFileSync('tmp_diag_final.txt', code.substring(Math.max(0, tIdx-200), tIdx + 4500));
}
