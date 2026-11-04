const fs = require('fs');

const historyPath = 'C:/Users/Martin/Documents/sincronizador-etiquetas - copia/scratch/extracted_history.md';
const content = fs.readFileSync(historyPath, 'utf8');

const regex = /## EDIT #(\d+)[^]*?- \*\*File\*\*: `([^`]+)`[^]*?### TargetContent\n```javascript\n([\s\S]*?)\n```\n\n### ReplacementContent\n```javascript\n([\s\S]*?)\n```/g;

let out = '';
let match;
while ((match = regex.exec(content)) !== null) {
    const editNum = match[1];
    const file = match[2];
    const target = match[3];
    const replacement = match[4];
    
    if (file.includes('listado-bunker.js')) {
        out += `=== EDIT #${editNum} ===\n`;
        out += `TARGET:\n${target}\n\n`;
        out += `REPLACEMENT:\n${replacement}\n`;
        out += `========================\n\n`;
    }
}

fs.writeFileSync('C:/Users/Martin/Documents/sincronizador-etiquetas - copia/scratch/all_js_edits.txt', out, 'utf8');
console.log('Wrote edits to scratch/all_js_edits.txt');
