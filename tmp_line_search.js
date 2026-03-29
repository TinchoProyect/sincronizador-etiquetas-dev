const fs = require('fs');
const lines = fs.readFileSync('src/produccion/pages/gestion-mantenimiento.html', 'utf8').split('\n');
lines.forEach((l, i) => {
    if(l.toLowerCase().includes('esperando reparto')) {
        console.log('Linea: ', i + 1, ' => ', l.trim());
    }
});
