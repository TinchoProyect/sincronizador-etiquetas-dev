const fs = require('fs');
const html = fs.readFileSync('src/produccion/pages/gestion-mantenimiento.html', 'utf8');

const tIdx = html.indexOf('function poblarGridStock');
if(tIdx !== -1) {
    console.log(html.substring(tIdx, html.indexOf('}', tIdx + 1500)));
}
