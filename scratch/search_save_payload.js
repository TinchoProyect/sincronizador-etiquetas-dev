const fs = require('fs');

const historyPath = 'C:/Users/Martin/Documents/sincronizador-etiquetas - copia/scratch/extracted_history.md';
const content = fs.readFileSync(historyPath, 'utf8');

const keyword = '/finanzas';
let idx = 0;
while (true) {
    idx = content.indexOf(keyword, idx);
    if (idx === -1) break;
    
    console.log(`Found occurrence at index: ${idx}`);
    // Print the EDIT header above this index
    const editHeaderIdx = content.lastIndexOf('## EDIT #', idx);
    if (editHeaderIdx !== -1) {
        console.log(content.substring(editHeaderIdx, editHeaderIdx + 120));
    }
    idx += keyword.length;
}
