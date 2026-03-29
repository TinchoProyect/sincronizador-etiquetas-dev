const fs = require('fs');
const code = fs.readFileSync('src/produccion/controllers/mantenimiento.js', 'utf8');

const regex = /exports\.(\w+)[\s=]/g;
let match;
console.log('--- EXPORTS EN MANTENIMIENTO.JS ---');
while ((match = regex.exec(code)) !== null) {
  console.log(match[1]);
}
