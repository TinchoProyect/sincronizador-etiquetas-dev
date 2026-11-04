const fs = require('fs');

const historyPath = 'C:/Users/Martin/Documents/sincronizador-etiquetas - copia/scratch/extracted_history.md';
const content = fs.readFileSync(historyPath, 'utf8');

const keyword = '## EDIT #3';
const idx = content.indexOf(keyword);
if (idx !== -1) {
    console.log(content.substring(idx, idx + 2000));
} else {
    console.log('EDIT #3 not found.');
}
