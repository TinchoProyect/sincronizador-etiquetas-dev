const fs = require('fs');

const modPath = 'C:/Users/Martin/Documents/sincronizador-etiquetas - copia/scratch/html_modifications.txt';
const content = fs.readFileSync(modPath, 'utf8');

const matches = content.split('-------------------------------------------------------------');
const m1 = matches[0];
console.log(m1);
