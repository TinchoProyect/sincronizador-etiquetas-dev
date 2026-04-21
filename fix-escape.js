const fs = require('fs');
const filePath = 'c:/Users/Martin/Documents/sincronizador-etiquetas - copia/src/produccion/pages/gestion-mantenimiento.html';
let content = fs.readFileSync(filePath, 'utf8');

// The multi_replace inserted "\`" and "\$" as literal strings in the JS code instead of just "`" and "$".
// We need to replace literal backslash followed by backtick with just backtick.
content = content.replace(/\\\`/g, '`');
content = content.replace(/\\\$/g, '$');

fs.writeFileSync(filePath, content, 'utf8');
console.log('Fixed escaping in gestion-mantenimiento.html');
