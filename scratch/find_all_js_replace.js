const fs = require('fs');

const historyPath = 'C:/Users/Martin/Documents/sincronizador-etiquetas - copia/scratch/extracted_history.md';
const content = fs.readFileSync(historyPath, 'utf8');

const regex = /## EDIT #(\d+)/g;
let match;
while ((match = regex.exec(content)) !== null) {
    const editNum = match[1];
    // Find the file name between this edit header and the next edit header
    const nextEditIdx = content.indexOf('## EDIT #', regex.lastIndex);
    const editBlock = content.substring(regex.lastIndex - 20, nextEditIdx === -1 ? content.length : nextEditIdx);
    
    if (editBlock.includes('listado-bunker.js')) {
        console.log(`Edit #${editNum} modifies listado-bunker.js`);
    }
}
