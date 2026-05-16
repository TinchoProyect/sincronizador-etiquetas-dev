const fs = require('fs');
const path = 'c:/Users/Martin/Documents/sincronizador-etiquetas - copia/src/produccion/pages/gestion-mantenimiento.html';
let content = fs.readFileSync(path, 'utf8');

// Buscamos .toFixed(x) pero evitamos reemplazar si ya tiene .replace('.', ',')
content = content.replace(/\.toFixed\((\d+)\)(?!\.replace)/g, ".toFixed($1).replace('.', ',')");

fs.writeFileSync(path, content, 'utf8');
console.log('Reemplazo exitoso.');
