const fs = require('fs');
const code = fs.readFileSync('src/produccion/controllers/mantenimiento.js', 'utf8');

const lines = code.split('\n');
const chunk = lines.slice(2070, 2110).map((l, i) => `${2071 + i}: ${l}`).join('\n');
fs.writeFileSync('tmp_line2090.txt', chunk);
