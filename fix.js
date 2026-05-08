const fs = require('fs');

const file = 'src/produccion/js/gestionArticulos.js';
let content = fs.readFileSync(file, 'utf8');
let lines = content.split('\n');

let newLines = [];
let skip = false;

for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    
    if (i >= 543 && i <= 645) { // Lines 544 to 646 (0-indexed 543 to 645)
        continue;
    }
    
    newLines.push(line);
}

fs.writeFileSync(file, newLines.join('\n'), 'utf8');
console.log('Fixed syntax error and removed dead listeners');
