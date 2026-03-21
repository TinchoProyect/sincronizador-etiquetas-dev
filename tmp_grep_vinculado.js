const fs = require('fs');
const path = require('path');

function searchInFile(filePath, term) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    if (line.toLowerCase().includes(term.toLowerCase())) {
      console.log(`[${path.basename(filePath)}:${i+1}] ${line.trim()}`);
    }
  });
}

const dirList = [
  'c:/Users/Martin/Documents/sincronizador-etiquetas - copia/src/presupuestos/controllers/presupuestosWrite.js',
  'c:/Users/Martin/Documents/sincronizador-etiquetas - copia/src/presupuestos/controllers/presupuestosLomasoft.js',
  'c:/Users/Martin/Documents/sincronizador-etiquetas - copia/src/presupuestos/controllers/presupuestos.js',
  'c:/Users/Martin/Documents/sincronizador-etiquetas - copia/src/presupuestos/js/presupuestosCreate.js',
  'c:/Users/Martin/Documents/sincronizador-etiquetas - copia/src/presupuestos/js/presupuestos.js'
];

dirList.forEach(f => {
  if(fs.existsSync(f)) {
    searchInFile(f, 'vinculado');
  } else {
    console.log('File not found:', f);
  }
});
