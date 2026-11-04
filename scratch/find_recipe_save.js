const fs = require('fs');

const historyPath = 'C:/Users/Martin/Documents/sincronizador-etiquetas - copia/scratch/extracted_history.md';
const content = fs.readFileSync(historyPath, 'utf8');

const keyword = 'datosReceta';
let idx = content.indexOf(keyword);
if (idx !== -1) {
    console.log('Found keyword at index:', idx);
    // Find the EDIT header above this index
    const editHeaderIdx = content.lastIndexOf('## EDIT #', idx);
    if (editHeaderIdx !== -1) {
        console.log(content.substring(editHeaderIdx, idx + 800));
    } else {
        console.log(content.substring(idx - 200, idx + 800));
    }
} else {
    console.log('Keyword not found.');
}
