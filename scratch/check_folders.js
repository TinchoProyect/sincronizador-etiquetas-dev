const fs = require('fs');
const path = require('path');

const pathOriginal = 'C:/Users/Martin/Documents/sincronizador-etiquetas/src/produccion/controllers/mantenimiento.js';
const pathCopia = 'C:/Users/Martin/Documents/sincronizador-etiquetas - copia/src/produccion/controllers/mantenimiento.js';

console.log('--- COMPARING FILE EXISTENCE ---');
console.log('Original exists:', fs.existsSync(pathOriginal));
console.log('Copia exists:', fs.existsSync(pathCopia));

if (fs.existsSync(pathOriginal) && fs.existsSync(pathCopia)) {
    const contentOriginal = fs.readFileSync(pathOriginal, 'utf-8');
    const contentCopia = fs.readFileSync(pathCopia, 'utf-8');
    console.log('--- FILE SIZES ---');
    console.log('Original size:', contentOriginal.length);
    console.log('Copia size:', contentCopia.length);

    console.log('--- CHECKSUM OR EQUALITY ---');
    console.log('Are they identical?', contentOriginal === contentCopia);
}
