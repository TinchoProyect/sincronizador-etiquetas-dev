const fs = require('fs');

const historyPath = 'C:/Users/Martin/Documents/sincronizador-etiquetas - copia/scratch/extracted_history.md';
const content = fs.readFileSync(historyPath, 'utf8');

const lines = content.split('\n');
lines.forEach((line, idx) => {
    if (line.toLowerCase().includes('switch-enlace')) {
        console.log(`Line ${idx + 1}: ${line.trim()}`);
    }
});
