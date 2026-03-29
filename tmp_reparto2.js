const fs = require('fs');

function findRoute() {
    const text = fs.readFileSync('src/produccion/routes/mantenimiento.js', 'utf8');
    const idx = text.indexOf('/retiros/ruta');
    if (idx !== -1) {
        console.log(text.substring(idx - 100, Math.min(text.length, idx + 200)));
    } else {
        console.log("No está en maintenance.js");
    }
}
findRoute();
