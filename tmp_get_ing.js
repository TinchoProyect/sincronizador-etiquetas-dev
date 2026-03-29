const fs = require('fs');
const content = fs.readFileSync('src/produccion/controllers/ingredientes.js', 'utf8');
const lines = content.split('\n');

const res = lines.findIndex(l => l.includes('function obtenerIngredientes'));
if (res !== -1) {
    fs.writeFileSync('tmp_ing_utf8.txt', lines.slice(res, res + 60).join('\n'));
} else {
    fs.writeFileSync('tmp_ing_utf8.txt', 'Not found');
}
