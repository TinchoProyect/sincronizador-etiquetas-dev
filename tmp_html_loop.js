const fs = require('fs');
const html = fs.readFileSync('src/produccion/pages/gestion-mantenimiento.html', 'utf8');

const regex = /window\.mantenimientoStockData\.forEach\(\(item(.*?)\) =>/g;
let match;
while ((match = regex.exec(html)) !== null) {
  const start = Math.max(0, match.index - 50);
  console.log(html.substring(start, match.index + 2000));
}

// Búsqueda alternativa si usan for
const regex2 = /(filteredData|data)\.forEach\(/g;
while ((match = regex2.exec(html)) !== null) {
  const start = Math.max(0, match.index - 100);
  console.log('--- LOOP DE TABLA STOCK ---');
  console.log(html.substring(start, match.index + 2000));
}
