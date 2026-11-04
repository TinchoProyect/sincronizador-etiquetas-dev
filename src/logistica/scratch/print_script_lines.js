const fs = require('fs');
const path = require('path');

function printScriptLines() {
    const filePath = path.resolve(__dirname, '../../facturacion/pages/facturas.html');
    const content = fs.readFileSync(filePath, 'utf8');
    const scriptMatches = content.match(/<script>([\s\S]*?)<\/script>/gi);
    const jsCode = scriptMatches[0].replace(/<\/?script>/gi, '');

    const lines = jsCode.split('\n');
    console.log(`Total líneas en el bloque script: ${lines.length}`);

    for (let i = 1100; i <= lines.length; i++) {
        console.log(`${i}: ${lines[i - 1]}`);
    }
}

printScriptLines();
