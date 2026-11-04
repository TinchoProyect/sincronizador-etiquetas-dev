const fs = require('fs');

const historyPath = 'C:/Users/Martin/Documents/sincronizador-etiquetas - copia/scratch/extracted_history.md';
const content = fs.readFileSync(historyPath, 'utf8');

const regex = /## EDIT #(\d+) \(Step: (\d+), Tool: ([^\)]+)\)\n- \*\*File\*\*: `([^`]+)`\n- \*\*Instruction\*\*: ([^\n]*)/g;

let match;
while ((match = regex.exec(content)) !== null) {
    console.log(`Edit #${match[1]} | Step: ${match[2]} | Tool: ${match[3]} | File: ${match[4].split(/[\\/]/).pop()} | Instruction: ${match[5]}`);
}
