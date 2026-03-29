const fs = require('fs');
const html = fs.readFileSync('src/produccion/pages/gestion-mantenimiento.html', 'utf8');

const lines = html.split('\n');
const chunk = lines.slice(1275, 1295).join('\n');
fs.writeFileSync('tmp_front_row_detail.txt', chunk);
