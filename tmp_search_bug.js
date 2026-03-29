const fs = require('fs');
const path = 'src/produccion/controllers/mantenimiento.js';
const code = fs.readFileSync(path, 'utf8');

const matchIndex = code.indexOf('const getStockMantenimiento');
if (matchIndex !== -1) {
    const fnBody = code.substring(matchIndex, matchIndex + 2500);
    console.log(fnBody.split('} catch')[0]);
}
