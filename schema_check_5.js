const fs = require('fs'); 
const lines = fs.readFileSync('src/produccion/js/ingredientes.js', 'utf8').split('\n'); 
lines.forEach((l, i) => { 
    if (l.includes('checkbox-ajuste')) console.log(i + ': ' + l.trim()); 
});
