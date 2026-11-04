const fs = require('fs');

const historyPath = 'C:/Users/Martin/Documents/sincronizador-etiquetas - copia/scratch/extracted_history.md';
const content = fs.readFileSync(historyPath, 'utf8');

const regex = /## EDIT #(\d+)[^]*?- \*\*File\*\*: `([^`]+)`[^]*?### TargetContent\n```javascript\n([\s\S]*?)\n```\n\n### ReplacementContent\n```javascript\n([\s\S]*?)\n```/g;

let match;
while ((match = regex.exec(content)) !== null) {
    const editNum = match[1];
    const file = match[2];
    const target = match[3];
    const replacement = match[4];
    
    if (file.includes('listado-bunker.js')) {
        console.log(`EDIT #${editNum}`);
        console.log('Target snippet:', target.substring(0, 150) + '...');
        console.log('Replacement snippet:', replacement.substring(0, 150) + '...');
        console.log('------------------');
    }
}
