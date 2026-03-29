const fs = require('fs');
const html = fs.readFileSync('src/produccion/pages/gestion-mantenimiento.html', 'utf8');

const lines = html.split('\n');
lines.forEach((l, i) => {
    if(l.includes('chk-item-stock') && l.includes('<input')) {
        console.log(`Línea ${i+1}: ${l.trim()}`);
    }
});
