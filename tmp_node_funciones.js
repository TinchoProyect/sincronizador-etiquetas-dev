const fs = require('fs');
const code = fs.readFileSync('src/produccion/controllers/mantenimiento.js', 'utf8');

const regex = /^(?:async\s+)?function\s+(\w+)\s*\(/gm;
let match;
console.log('--- FUNCIONES EN MANTENIMIENTO.JS ---');
while ((match = regex.exec(code)) !== null) {
  console.log(match[1]);
}
