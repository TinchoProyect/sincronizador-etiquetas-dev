const fs = require('fs');
const js = fs.readFileSync('src/produccion/routes/produccion.js', 'utf8');
const start = js.indexOf("router.get('/sectores'");
const block = js.substring(start, start + 800);
console.log(block);
