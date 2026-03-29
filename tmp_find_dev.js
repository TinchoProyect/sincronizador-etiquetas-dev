const fs = require('fs');
const content = fs.readFileSync('src/produccion/pages/gestion-mantenimiento.html', 'utf8');
const lines = content.split('\n');
const idx = lines.findIndex(l => l.includes('Devolver a Ingrediente') || l.includes('function devolver'));
if (idx !== -1) {
   console.log("Encontrado en linea:", idx);
   console.log(lines.slice(Math.max(0, idx - 50), idx + 100).join('\n'));
} else {
   console.log("No encontrado");
}
