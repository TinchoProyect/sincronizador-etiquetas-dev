const fs = require('fs');

const historyPath = 'C:/Users/Martin/Documents/sincronizador-etiquetas - copia/scratch/extracted_history.md';
const content = fs.readFileSync(historyPath, 'utf8');

const printEditBlock = (num) => {
    const idx = content.indexOf(`## EDIT #${num}`);
    if (idx !== -1) {
        const nextIdx = content.indexOf(`## EDIT #`, idx + 10);
        console.log(content.substring(idx, nextIdx === -1 ? content.length : nextIdx));
        console.log('-----------------------------------------------------\n');
    }
};

printEditBlock(33);
printEditBlock(34);
