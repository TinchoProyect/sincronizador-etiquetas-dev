const fs = require('fs');
const code = fs.readFileSync('src/produccion/controllers/mantenimiento.js', 'utf8');

const regex = /async function \w*finalizar\w*\s*\([^)]*\)\s*{[\s\S]{0,4000}/;
const match = regex.exec(code);
if(match) {
    fs.writeFileSync('tmp_diag_finalizar_func.txt', match[0]);
}
