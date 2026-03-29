const fs = require('fs');
const content = fs.readFileSync('src/produccion/pages/gestion-mantenimiento.html', 'utf8');
const lines = content.split('\n');
lines.forEach((l, i) => {
   if (l.includes('fetch') && l.includes('ingredientes') && !l.includes('transferir-ingrediente')) {
       console.log('Línea fetch:', i, l.trim());
       console.log('Contexto post-fetch:');
       console.log(lines.slice(i, i+15).join('\n'));
   }
});
