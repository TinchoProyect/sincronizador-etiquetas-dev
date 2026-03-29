const fs = require('fs');
const html = fs.readFileSync('src/produccion/pages/gestion-mantenimiento.html', 'utf8');

const lines = html.split('\n');
lines.forEach((l, i) => {
    if(l.toLowerCase().includes('tratamiento') && l.includes('function ')) {
        console.log(`Linea ${i}: ${l.trim()}`);
    }
});
