const fs = require('fs');
const html = fs.readFileSync('src/produccion/pages/produccion.html', 'utf8');

// Busquemos "imprimir(" o "Zebra" o "Etiqueta"
const indexPrint = html.indexOf('function imprimir');
if (indexPrint > -1) {
    fs.writeFileSync('tmp_prod_zebra.js', html.substring(Math.max(0, indexPrint-500), indexPrint+3000));
} else {
    // Si no está global, busquemos algo sobre fetch a imprimir
    const indexFetch = html.indexOf('/imprimir');
    if (indexFetch > -1) {
        fs.writeFileSync('tmp_prod_zebra.js', html.substring(Math.max(0, indexFetch-500), indexFetch+3000));
    } else {
        // Buscamos cualquier funcion q invoque ZPL
        const zplIdx = html.indexOf('ZPL');
        if (zplIdx > -1) {
             fs.writeFileSync('tmp_prod_zebra.js', html.substring(Math.max(0, zplIdx-500), zplIdx+3000));
        }
    }
}
