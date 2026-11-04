const fs = require('fs');

const historyPath = 'C:/Users/Martin/Documents/sincronizador-etiquetas - copia/scratch/extracted_history.md';
const content = fs.readFileSync(historyPath, 'utf8');

const keyword = 'guardar';
let idx = 0;
while (true) {
    idx = content.toLowerCase().indexOf(keyword.toLowerCase(), idx);
    if (idx === -1) break;
    
    console.log(`Found keyword at index: ${idx}`);
    console.log(content.substring(idx - 100, idx + 400));
    console.log('====================================\n');
    idx += keyword.length;
}
