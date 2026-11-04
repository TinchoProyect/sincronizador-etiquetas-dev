const fs = require('fs');

const historyPath = 'C:/Users/Martin/Documents/sincronizador-etiquetas - copia/scratch/extracted_history.md';
const content = fs.readFileSync(historyPath, 'utf8');

const keyword = '/api/produccion/recetas';
const idx = content.indexOf(keyword);
if (idx !== -1) {
    console.log(content.substring(idx - 500, idx + 1000));
} else {
    console.log('Keyword not found.');
}
