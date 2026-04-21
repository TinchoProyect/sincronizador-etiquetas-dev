const fs = require('fs');
const html = fs.readFileSync('c:/Users/Martin/Documents/sincronizador-etiquetas - copia/src/produccion/pages/gestion-mantenimiento.html', 'utf8');

const regex = /<script>([\s\S]*?)<\/script>/gi;
let match;
let scriptContent = '';
while ((match = regex.exec(html)) !== null) {
    scriptContent += match[1] + '\n';
}

fs.writeFileSync('c:/Users/Martin/Documents/sincronizador-etiquetas - copia/scratch-check.js', scriptContent, 'utf8');
console.log('Script extracted to scratch-check.js');
