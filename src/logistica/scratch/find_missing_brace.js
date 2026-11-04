const fs = require('fs');
const path = require('path');

function findMissingBrace() {
    const filePath = path.resolve(__dirname, '../../facturacion/pages/facturas.html');
    const content = fs.readFileSync(filePath, 'utf8');
    const scriptMatches = content.match(/<script>([\s\S]*?)<\/script>/gi);
    const jsCode = scriptMatches[0].replace(/<\/?script>/gi, '');

    const lines = jsCode.split('\n');
    let stack = [];

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        // Quitar comentarios // ... y '...' y "..." y `...`
        let cleanLine = line.replace(/\/\/.*$/g, '');

        for (let col = 0; col < cleanLine.length; col++) {
            const char = cleanLine[col];
            if (char === '{') {
                stack.push({ lineNum: lineNum + 1, content: line.trim() });
            } else if (char === '}') {
                if (stack.length > 0) {
                    stack.pop();
                } else {
                    console.error(`❌ Exceso de '}' en línea ${lineNum + 1}: ${line.trim()}`);
                }
            }
        }
    }

    if (stack.length > 0) {
        console.log(`❌ ${stack.length} llaves '{' quedaron abiertas sin su '}' correspondiente:\n`);
        stack.forEach(s => {
            console.log(`- Línea ${s.lineNum}: ${s.content}`);
        });
    } else {
        console.log('✅ Todas las llaves están perfectamente balanceadas.');
    }
}

findMissingBrace();
